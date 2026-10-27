// Corridor fact assembly — the upgraded assembler for the Highway
// Corridor Library builder (build-corridors.mjs), Oct 27, 2026.
//
// WHY THIS EXISTS: in the v1 bank, 10 of 86 segments assembled NO
// fact pack at all (empty Wikipedia + registry + OSM + Wikidata
// union — see the build report, Item 6 quality flag 1). The legacy
// assembly sampled ONE point per named area anchor, and on these
// stretches that fails structurally:
//   - several segments carry a single anchor (e.g. the I-5 Pacific
//     Beach pieces sample only "Pacific Beach"), so one dry well
//     empties the whole segment;
//   - anchor coordinates sit ON the freeway, fact-sparse ground —
//     the La Jolla anchor is inland near SR-52, so the Cove/Soledad
//     articles fall outside the 1 km geosearch radius;
//   - endpoint places the segment connects (Mission Bay, Allied
//     Gardens, Tierrasanta…) are not anchors at all and were never
//     sampled.
// The neighborhood builder solved the analogous problem for areas
// (commits f4d66e4 + 989a4b1: deep-mode retry, then a tier-3
// name-search fallback). This module applies the corridor-scale
// version of the same doctrine, in stages, ALL corridor-scoped —
// lib.mjs and the place/neighborhood builders are untouched:
//
//   A. Per-area legacy assembly (lib.mjs assembleFacts, unchanged),
//      plus the f4d66e4 deep-mode Wikipedia retry for an area whose
//      standard pass found no Wikipedia.
//   B. Polyline sampling: Wikipedia geosearch + OSM at interpolated
//      points along the segment's own line (~800 m spacing), merged
//      and deduped against the area packs — the drive's ground, not
//      just its named anchors.
//   C. Inheritance: library subjects (the 345) whose pins fall
//      within 1 km of the polyline AND whose banked pack carried
//      Wikipedia or registry material contribute their own
//      assembled pack (re-assembled at their pin with the shared
//      assembler — the corpus persisted source flags, not blocks);
//      plus historic-registry records within 600 m of the line,
//      name-agnostic, verified first, capped at 5.
//   D. Tier-3 name search (989a4b1's rule, verbatim guard): only
//      when the segment still has no Wikipedia — search by the
//      segment's documented names (its areas, then the places it
//      connects) and take the first result whose title actually
//      names the subject.
//
// Returns { areaFacts, sources, detail } in exactly the shape
// build-corridors.mjs already consumes (areaFacts entries are
// { area, facts }; supplement stages arrive as extra entries whose
// `area.name` labels the FACTS block in the prompt). `detail` is a
// JSON-serializable per-stage account for the manifest + audits.

import { readFileSync } from 'node:fs';
import { assembleFacts, formatRegistryFacts, withTimeout } from './lib.mjs';

const UA = 'LeosWorldLibraryBuilder/1.0 (offline corpus build)';
const POLYLINE_SPACING_M = 800; // stage B sample spacing along the line
const SAMPLE_AREA_SKIP_M = 250; // samples this close to an anchor add nothing
const SUBJECT_BUFFER_M = 1000; // stage C: library-subject distance to the line
const SUBJECT_CAP = 4; // stage C: nearest subjects inherited per segment
const REGISTRY_BUFFER_M = 600; // stage C: registry-record distance to the line
const REGISTRY_CAP = 5; // stage C: buffer records per segment

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- geometry

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Min distance from a point to a polyline, via a local equirectangular
// projection (builder precision — the dataset's own containment
// buffer is 450 m, so metre-level exactness is not the requirement).
export function distToPolylineM(lat, lng, polyline) {
  if (!polyline?.length) return Infinity;
  if (polyline.length === 1) return haversineM(lat, lng, polyline[0].lat, polyline[0].lng);
  const kx = 111320 * Math.cos((lat * Math.PI) / 180);
  const ky = 110540;
  const px = lng * kx;
  const py = lat * ky;
  let best = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const ax = polyline[i].lng * kx;
    const ay = polyline[i].lat * ky;
    const bx = polyline[i + 1].lng * kx;
    const by = polyline[i + 1].lat * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d < best) best = d;
  }
  return best;
}

// Interpolated sample points along the polyline at ~spacingM
// intervals (start point, then one per spacing step, plus the end
// point when it falls >200 m past the last sample).
export function samplePolyline(polyline, spacingM = POLYLINE_SPACING_M) {
  if (!polyline?.length) return [];
  if (polyline.length === 1) return [{ ...polyline[0] }];
  const pts = [{ ...polyline[0] }];
  let sinceLast = 0;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    const legM = haversineM(a.lat, a.lng, b.lat, b.lng);
    let d = spacingM - sinceLast;
    while (d < legM) {
      const t = d / legM;
      pts.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      d += spacingM;
    }
    sinceLast = (sinceLast + legM) % spacingM;
  }
  const last = polyline[polyline.length - 1];
  const tail = pts[pts.length - 1];
  if (haversineM(tail.lat, tail.lng, last.lat, last.lng) > 200) pts.push({ ...last });
  return pts;
}

// ---------------------------------------------------------------- pack parsing
// The shared assembler returns formatted prompt blocks, not article
// lists; the merge stages dedupe against what is already in the pack
// by reading titles/names back out of those blocks.

function wikiTitlesIn(wikiContext) {
  const out = new Set();
  for (const m of (wikiContext || '').matchAll(/^- (.+?) \(\d+m away\):/gm)) out.add(m[1]);
  return out;
}

function osmNamesIn(osmContext) {
  const out = new Set();
  for (const line of (osmContext || '').split('\n')) {
    const m = /^- (.+?)( \(|$)/.exec(line);
    if (m) out.add(m[1].toLowerCase());
  }
  return out;
}

function registryNamesIn(registryContext) {
  const out = new Set();
  for (const m of (registryContext || '').matchAll(/HISTORIC REGISTRY FACTS for (.+?): /g)) out.add(m[1]);
  return out;
}

// ---------------------------------------------------------------- library subjects

// The banked place subjects available for stage-C inheritance:
// deduped from the 345-story corpus manifest (3 angle entries per
// place share one pin), with the union of their recorded fact
// sources. A subject is inheritable only if its own banked pack
// carried Wikipedia or registry material — the WOW-gate sources.
export function loadLibrarySubjects(placeManifestPath) {
  const entries = JSON.parse(readFileSync(placeManifestPath, 'utf8'));
  const byKey = new Map();
  for (const e of entries) {
    if (e.lat == null || e.lng == null) continue;
    let s = byKey.get(e.place_key);
    if (!s) {
      s = { name: e.place_name, lat: e.lat, lng: e.lng, sources: new Set() };
      byKey.set(e.place_key, s);
    }
    (e.fact_sources || []).forEach(x => s.sources.add(x));
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- tier-3 (989a4b1's rule)

// Wikipedia by name instead of by radius: search "<name> San
// Diego", take the first result whose title actually names the
// subject (the relevance guard — an unguarded top hit can be the
// generic city article), and require a real extract (>400 chars).
// Returns { title, extract } or null.
async function wikipediaNameSearch(name) {
  const headers = { 'User-Agent': UA };
  const q = encodeURIComponent(`${name} San Diego`);
  const sres = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const sjson = await sres.json();
  const wanted = name.toLowerCase().replace(/-/g, ' ');
  const title = (sjson?.query?.search ?? [])
    .map(r => r.title)
    .find(t => t.toLowerCase().replace(/-/g, ' ').includes(wanted));
  if (!title) return null;
  const tres = await fetch(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=${encodeURIComponent(title)}&format=json`, {
    headers,
    signal: AbortSignal.timeout(20_000),
  });
  const tjson = await tres.json();
  const page = Object.values(tjson?.query?.pages ?? {})[0];
  const extract = (page?.extract ?? '').trim();
  if (extract.length <= 400) return null;
  return { title, extract };
}

// ---------------------------------------------------------------- the assembler

export async function assembleCorridorFacts(app, records, segment, librarySubjects, log = console.log) {
  const areaFacts = [];
  const sources = new Set();
  const detail = {
    deepRetryAreas: [],
    polyline: { samples: 0, wikiTitles: [], osmFeatures: 0 },
    inherited: [],
    registryBuffer: [],
    tier3: null,
    wikiTitles: [],
  };
  const wikiTitlesSeen = new Set();
  const osmNamesSeen = new Set();
  const registryNamesSeen = new Set();
  const absorb = facts => {
    facts.sources.forEach(s => sources.add(s));
    wikiTitlesIn(facts.wikiContext).forEach(t => wikiTitlesSeen.add(t));
    osmNamesIn(facts.osmContext).forEach(n => osmNamesSeen.add(n));
    registryNamesIn(facts.registryContext).forEach(n => registryNamesSeen.add(n));
  };
  const posOf = (lat, lng) => ({
    lat, lng, accuracy: 10, altitude: null, altitudeAccuracy: null, heading: null, speed: null,
  });

  // ---- Stage A: per-area legacy assembly + deep-mode retry.
  // f4d66e4's rule: an area whose standard pass found no Wikipedia
  // retries at the service's deep-mode radius (2 km) before the
  // pack accepts thin — with one correction the neighborhood
  // builder's inline version doesn't make: the app service's
  // geosearch cache is keyed by POSITION ONLY (200 m tolerance,
  // 5-min TTL) and a cache hit ignores deepMode entirely, so a
  // same-point retry right after the standard call can only ever
  // return the standard call's (empty) result. The retry therefore
  // runs from a point nudged 350 m toward the segment's centroid —
  // a genuine cache miss, a genuine 2 km fetch, still centered on
  // the area's own ground.
  const centroid = segment.polyline.length
    ? {
        lat: segment.polyline.reduce((a, p) => a + p.lat, 0) / segment.polyline.length,
        lng: segment.polyline.reduce((a, p) => a + p.lng, 0) / segment.polyline.length,
      }
    : null;
  const deepRetryPos = area => {
    if (!centroid) return posOf(area.lat, area.lng);
    const total = haversineM(area.lat, area.lng, centroid.lat, centroid.lng);
    if (total < 500) return posOf(area.lat, area.lng);
    const t = 350 / total;
    return posOf(area.lat + (centroid.lat - area.lat) * t, area.lng + (centroid.lng - area.lng) * t);
  };
  for (const area of segment.areas) {
    const facts = await assembleFacts(app, records, { name: area.name }, { lat: area.lat, lng: area.lng });
    if (!facts.sources.includes('wikipedia')) {
      try {
        const deep = await app.wikipedia.getNearbyArticles(deepRetryPos(area), true);
        if (deep.length > 0) {
          facts.wikiContext = [facts.wikiContext, app.wikipedia.formatForPrompt(deep)].filter(Boolean).join('\n');
          facts.sources.push('wikipedia');
          detail.deepRetryAreas.push(area.name);
        }
      } catch (e) {
        console.warn(`[corridor-facts] ${segment.id} · ${area.name}: deep-mode retry failed: ${e.message}`);
      }
    }
    absorb(facts);
    areaFacts.push({ area, facts });
    log(`[corridors] ${segment.id} · ${area.name}: facts ${facts.sources.join('+') || 'NONE'}`);
  }

  // ---- Stage B: polyline sampling. The legacy assembly only ever
  // sampled the anchor points; the segment's own line crosses
  // ground the anchors miss. Wikipedia + OSM at interpolated
  // points, merged, deduped against everything already packed.
  const samples = samplePolyline(segment.polyline).filter(
    p => segment.areas.every(a => haversineM(p.lat, p.lng, a.lat, a.lng) > SAMPLE_AREA_SKIP_M)
  );
  detail.polyline.samples = samples.length;
  if (samples.length > 0) {
    const polyArticles = new Map();
    const polyFeatures = new Map();
    for (const p of samples) {
      const pos = posOf(p.lat, p.lng);
      try {
        const articles = await app.wikipedia.getNearbyArticles(pos, false);
        for (const a of articles) {
          if (!wikiTitlesSeen.has(a.title) && !polyArticles.has(a.title)) polyArticles.set(a.title, a);
        }
      } catch (e) {
        console.warn(`[corridor-facts] ${segment.id}: polyline wikipedia failed: ${e.message}`);
      }
      try {
        const features = await withTimeout(app.osmService.getNearbyFeatures(pos, null), 15000, []);
        for (const f of features) {
          const key = f.name.toLowerCase();
          if (!osmNamesSeen.has(key) && !polyFeatures.has(key)) polyFeatures.set(key, f);
        }
      } catch (e) {
        console.warn(`[corridor-facts] ${segment.id}: polyline osm failed: ${e.message}`);
      }
      await sleep(150);
    }
    if (polyArticles.size > 0 || polyFeatures.size > 0) {
      const facts = {
        wikiContext: polyArticles.size > 0 ? app.wikipedia.formatForPrompt([...polyArticles.values()]) : '',
        osmContext: polyFeatures.size > 0 ? app.osmService.formatForPrompt([...polyFeatures.values()]) : '',
        wikidataContext: '',
        registryContext: '',
        sources: [],
      };
      if (polyArticles.size > 0) facts.sources.push('wikipedia');
      if (polyFeatures.size > 0) facts.sources.push('openstreetmap');
      detail.polyline.wikiTitles = [...polyArticles.keys()];
      detail.polyline.osmFeatures = polyFeatures.size;
      absorb(facts);
      areaFacts.push({ area: { name: 'Along the drive' }, facts });
      log(`[corridors] ${segment.id} · along the drive: +${polyArticles.size} wiki, +${polyFeatures.size} osm from ${samples.length} polyline samples`);
    }
  }

  // ---- Stage C1: inherit the packs of library subjects the drive
  // passes. The corpus persisted source flags, not blocks, so a
  // subject's pack is re-assembled at its own pin with the shared
  // assembler — the same material its own stories were built from.
  const subjectCandidates = (librarySubjects || [])
    .map(s => ({ s, d: distToPolylineM(s.lat, s.lng, segment.polyline) }))
    .filter(x => x.d <= SUBJECT_BUFFER_M && (x.s.sources.has('wikipedia') || x.s.sources.has('historic_registry')))
    .sort((a, b) => a.d - b.d)
    .slice(0, SUBJECT_CAP);
  for (const { s } of subjectCandidates) {
    try {
      const facts = await assembleFacts(app, records, { name: s.name }, { lat: s.lat, lng: s.lng });
      if (!facts.wikiContext && !facts.registryContext) continue; // nothing substantive to inherit today
      absorb(facts);
      areaFacts.push({ area: { name: s.name }, facts });
      detail.inherited.push({ subject: s.name, sources: facts.sources });
      log(`[corridors] ${segment.id} · inherited ${s.name}: facts ${facts.sources.join('+') || 'NONE'}`);
    } catch (e) {
      console.warn(`[corridor-facts] ${segment.id}: inheritance failed for ${s.name}: ${e.message}`);
    }
    await sleep(150);
  }

  // ---- Stage C2: historic-registry records inside the buffer,
  // name-agnostic (stage A's registry match is name-bound). The
  // drive passes these parcels whether or not an anchor shares
  // their name. Verified coords first, then nearest; capped.
  const bufferRecords = records
    .filter(r => r.lat !== null && r.lng !== null && !registryNamesSeen.has(r.name))
    .map(r => ({ r, d: distToPolylineM(r.lat, r.lng, segment.polyline) }))
    .filter(x => x.d <= REGISTRY_BUFFER_M)
    .sort((a, b) => {
      const av = a.r.coordQuality === 'verified' ? 0 : 1;
      const bv = b.r.coordQuality === 'verified' ? 0 : 1;
      return av - bv || a.d - b.d;
    })
    .slice(0, REGISTRY_CAP);
  if (bufferRecords.length > 0) {
    const facts = {
      wikiContext: '',
      osmContext: '',
      wikidataContext: '',
      registryContext: bufferRecords.map(x => formatRegistryFacts(x.r)).join('\n'),
      sources: ['historic_registry'],
    };
    absorb(facts);
    areaFacts.push({ area: { name: 'Historic registry along the drive' }, facts });
    detail.registryBuffer = bufferRecords.map(x => x.r.name);
    log(`[corridors] ${segment.id} · registry buffer: +${bufferRecords.length} records`);
  }

  // ---- Stage D: tier-3 name search (989a4b1), only when the
  // segment still has no Wikipedia at all. Candidate names are the
  // segment's documented subjects: its areas, then the places it
  // connects (fromName/toName — endpoints that are not anchors).
  if (!sources.has('wikipedia')) {
    const names = [];
    for (const n of [...segment.areas.map(a => a.name), segment.fromName, segment.toName]) {
      if (n && !names.includes(n)) names.push(n);
    }
    for (const name of names) {
      try {
        const hit = await wikipediaNameSearch(name);
        if (hit) {
          const facts = {
            wikiContext: `Wikipedia — ${hit.title}:\n${hit.extract.slice(0, 6000)}`,
            osmContext: '',
            wikidataContext: '',
            registryContext: '',
            sources: ['wikipedia'],
          };
          absorb(facts);
          areaFacts.push({ area: { name }, facts });
          detail.tier3 = { name, title: hit.title };
          log(`[corridors] ${segment.id} · name-search fallback found "${hit.title}" for ${name}`);
          break;
        }
      } catch (e) {
        console.warn(`[corridor-facts] ${segment.id}: name-search failed for ${name}: ${e.message}`);
      }
      await sleep(150);
    }
  }

  detail.wikiTitles = [...wikiTitlesSeen];
  return { areaFacts, sources, detail };
}
