// Plan grader (composer v3, commit A — Erik, Nov 3, 2026):
// the route harness's Monte Carlo machinery grown from an
// invariant net into a QUALITY scorer. The invariant suites in
// run.mjs prove the composer never produces an ILLEGAL plan;
// this grader measures whether the plans are any GOOD — silence
// share, thread yield, climax presence and strength, freshness
// decay across a repeated commute — over synthetic shelves at
// three depths and a fixed route battery.
//
// Fully synthetic, deterministic (seeded), zero live calls:
// the pipeline mirrored here is the App's buildRoute staging
// (orderFetchCandidates → fetchHeardAwareCandidates →
// composeRoutePlan → the ONE portal-climax re-compose →
// fillRouteGaps) with the guarantee pass
// run shelf-only (no discovery/generation deps — the same
// skip-fallback the production pass takes when generation is
// unavailable), so silence numbers are an upper bound against
// production, where generated gap stories can still land.
//
// Usage:
//   node scripts/route-mode/grader.mjs [--out <prefix>] [--baseline <grade.json>] [--label <text>]
// Writes <prefix>.json + <prefix>.md beside this script.
// The metric functions are exported for the harness's
// correctness suites (hand-computed plans); importing this
// module runs nothing.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ------------------------------------------------------------ seeded randomness

/** mulberry32 — small deterministic PRNG; the only randomness in the building. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(rnd, pairs) {
  let total = 0;
  for (const [, w] of pairs) total += w;
  let r = rnd() * total;
  for (const [v, w] of pairs) {
    r -= w;
    if (r <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

// ------------------------------------------------------------ plan metrics (pure)

/**
 * When each story SOUNDS, in expected travel seconds — the
 * same interval model the Coverage Guarantee walks
 * (routeGapFill.storyIntervalsSec, mirrored): a windowed story
 * sounds across [release, expire]; a windowless one (portal,
 * filler) sounds at its anchor for its duration. Bridges,
 * reactions and the preview are tissue, never coverage.
 */
export function storyIntervalsSec(items, driveSec) {
  const out = [];
  for (const it of items) {
    if ((it.kind !== 'story' && it.kind !== 'filler') || !it.unit) continue;
    const anchorSec = (it.anchorProgress ?? 0) * driveSec;
    const start = it.releaseProgress !== undefined ? it.releaseProgress * driveSec : anchorSec;
    const end = it.expireProgress !== undefined ? it.expireProgress * driveSec : start + it.durationSec;
    out.push({
      start: Math.max(0, Math.min(driveSec, start)),
      end: Math.max(0, Math.min(driveSec, end)),
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Total drive seconds with a story sounding (union of the intervals above). */
export function coveredStorySec(plan, driveSec) {
  let covered = 0;
  let cursor = 0;
  for (const iv of storyIntervalsSec(plan.items, driveSec)) {
    if (iv.end <= cursor) continue;
    covered += iv.end - Math.max(iv.start, cursor);
    cursor = Math.max(cursor, iv.end);
  }
  return covered;
}

/** Angle class in the composer's own terms: landmark shelf, corridor narration, other. */
export function angleClassOf(angle) {
  if (angle.startsWith('landmark')) return 'landmark';
  if (angle === 'corridor') return 'corridor';
  return 'other';
}

/**
 * The weight a climax winner is measured with is the standing
 * strength term the composer itself names — the telling's
 * length (the portal-climax bar compares exactly this).
 * Percentile = share of the candidate pool the winner beats,
 * ties counting half, in [0, 1].
 */
export function weightPercentile(pool, winner) {
  if (!winner || !pool || pool.length === 0) return null;
  let less = 0;
  let ties = 0;
  for (const u of pool) {
    if (u.durationSec < winner.durationSec) less += 1;
    else if (u.durationSec === winner.durationSec) ties += 1;
  }
  return Math.round(((less + 0.5 * ties) / pool.length) * 1000) / 1000;
}

/**
 * Grade one composed + guarantee-filled plan. `climaxPool` is
 * the eligible pool the winner was picked from (the driver
 * reconstructs it from the compose inputs); the percentile is
 * null without a winner or a pool.
 */
export function planMetrics(plan, { driveSec, climaxPool = null }) {
  const stories = plan.items.filter(i => i.kind === 'story');
  const covered = coveredStorySec(plan, driveSec);
  const silenceSec = Math.max(0, driveSec - covered);
  const budget = plan.budgetSec && plan.budgetSec > 0 ? plan.budgetSec : driveSec;
  const winnerItem = stories.find(i => i.climax) ?? null;
  const winner = winnerItem?.unit ?? null;
  let atRisk = 0;
  for (const it of stories) {
    if (it.releaseProgress === undefined || it.expireProgress === undefined) continue;
    const slack = (it.expireProgress - it.releaseProgress) * driveSec - it.durationSec;
    if (slack < it.durationSec / 4) atRisk += 1;
  }
  return {
    stories: stories.length,
    silenceSec: Math.round(silenceSec),
    silenceShare: Math.round((silenceSec / budget) * 1000) / 1000,
    threadTopic: plan.thread?.topic ?? null,
    climaxPresent: plan.climaxUnitId != null || winnerItem !== null,
    climaxMode: plan.climaxMode ?? null,
    climaxWinnerClass: winner ? angleClassOf(winner.angle) : null,
    climaxPercentile: weightPercentile(climaxPool, winner),
    distinctPlaces: new Set(stories.map(i => i.unit?.placeKey ?? i.id)).size,
    portalShare:
      stories.length === 0
        ? 0
        : Math.round((stories.filter(i => i.portal).length / stories.length) * 1000) / 1000,
    atRisk,
  };
}

// ------------------------------------------------------------ synthetic worlds

export const GRADER_TOPICS = [
  'Boom & Bust', 'Coast', 'Navy Century', 'Food & Drink', 'Sport', 'Film',
  'Border / CaliBaja', 'Deep Time', 'Music', 'Flight', 'San Diego River',
  'Water', 'Highway', 'folklore', 'Faith', 'Desert', 'Fire & Fault', 'Rail',
  'Mission Chain', 'Surf', 'The Cure', 'Expositions & the Canal',
];
const TOPIC_WEIGHTS = GRADER_TOPICS.map(t => [
  t,
  t === 'Coast' || t === 'Navy Century' || t === 'Food & Drink' ? 3 : t === 'Highway' ? 2 : 1,
]);
const TONE_WEIGHTS = [
  ['warm', 3], ['light', 2], ['grand', 1], ['reflective', 1],
  ['somber', 1], ['spooky', 1], ['reverent', 1],
];
const LANDMARK_ANGLES = [
  'landmark_origin', 'landmark_event', 'landmark_people',
  'landmark_cultural', 'landmark_recent', 'landmark_scandal',
];

/** Shelf shapes: census targets + per-place depth distributions ([units, weight]). */
export const SHAPES = {
  current: { target: 1264, depth: [[1, 45], [2, 35], [3, 20]] },
  '2x': { target: 2528, depth: [[1, 25], [2, 40], [3, 35]] },
  full: { target: 3800, depth: [[2, 30], [3, 45], [4, 25]] },
};

function densify(waypoints, points = 16) {
  const out = [];
  const segs = waypoints.length - 1;
  for (let i = 0; i < points; i++) {
    const t = (i / (points - 1)) * segs;
    const s = Math.min(segs - 1, Math.floor(t));
    const f = t - s;
    const a = waypoints[s];
    const b = waypoints[s + 1];
    out.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f });
  }
  return out;
}

function pointAlongPath(path, progress, rnd, jitterM = 420) {
  let total = 0;
  const lens = [];
  for (let i = 0; i < path.length - 1; i++) {
    const d = Math.hypot(
      (path[i + 1].lat - path[i].lat) * 111320,
      (path[i + 1].lng - path[i].lng) * 95300,
    );
    lens.push(d);
    total += d;
  }
  let target = progress * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const t = lens[i] === 0 ? 0 : Math.min(1, target / lens[i]);
      const lat = path[i].lat + (path[i + 1].lat - path[i].lat) * t;
      const lng = path[i].lng + (path[i + 1].lng - path[i].lng) * t;
      const j = () => ((rnd() - 0.5) * 2 * jitterM) / 111320;
      return { lat: lat + j(), lng: lng + j() };
    }
    target -= lens[i];
  }
  return path[path.length - 1];
}

export const ROUTE_DEFS = {
  commute: {
    driveSec: 2400,
    waypoints: [
      { lat: 32.7, lng: -117.205 }, { lat: 32.76, lng: -117.19 },
      { lat: 32.82, lng: -117.18 }, { lat: 32.88, lng: -117.168 },
      { lat: 32.93, lng: -117.16 },
    ],
    corridorPlaces: 46,
    // Dense early, thin middle, moderate end — the commute shape.
    profile: rnd => {
      const r = rnd();
      if (r < 0.45) return 0.01 + rnd() * 0.27;
      if (r < 0.57) return 0.35 + rnd() * 0.3;
      return 0.68 + rnd() * 0.315;
    },
  },
  tourist: {
    driveSec: 1800,
    waypoints: [
      { lat: 32.655, lng: -117.285 }, { lat: 32.72, lng: -117.23 },
      { lat: 32.79, lng: -117.175 }, { lat: 32.855, lng: -117.12 },
      { lat: 32.905, lng: -117.06 },
    ],
    corridorPlaces: 34,
    profile: rnd => 0.01 + rnd() * 0.985,
  },
  hop: {
    driveSec: 720,
    waypoints: [
      { lat: 32.78, lng: -117.245 }, { lat: 32.8, lng: -117.225 },
      { lat: 32.82, lng: -117.205 }, { lat: 32.835, lng: -117.195 },
    ],
    corridorPlaces: 12,
    profile: rnd => 0.01 + rnd() * 0.985,
  },
};

/**
 * One synthetic county at one depth shape. Places sit on the
 * battery routes' corridors (with each route's density profile)
 * and scattered county-wide (the portal pool's ground). Class
 * mix follows the Nov 3 census (landmark ≈46%, corridor ≈20%,
 * intros ≈17%, fillers ≈16% of rows; ~30% of rows topic-less).
 * Names are synthetic and say so ('Commute 12', 'County 40').
 */
export function buildWorld(seed, shape) {
  const spec = SHAPES[shape];
  if (!spec) throw new Error(`unknown shelf shape: ${shape}`);
  const rnd = mulberry32(seed);
  const routes = {};
  for (const [name, def] of Object.entries(ROUTE_DEFS)) {
    routes[name] = { ...def, path: densify(def.waypoints) };
  }
  const meanDepth = spec.depth.reduce((s, [d, w]) => s + d * w, 0) / spec.depth.reduce((s, [, w]) => s + w, 0);
  const totalPlaces = Math.round(spec.target / meanDepth);

  const places = [];
  let placeSeq = 0;
  const addPlace = (lat, lng, kind, routeName = null) => {
    placeSeq += 1;
    const place = {
      placeKey: `place-${placeSeq}`,
      placeName: `${kind === 'scatter' ? 'County' : routeName} ${placeSeq}`,
      lat,
      lng,
      kind,
      homeTopic: rnd() < 0.3 ? null : pickWeighted(rnd, TOPIC_WEIGHTS),
    };
    places.push(place);
    return place;
  };
  const destPlaceByRoute = {};
  for (const [name, route] of Object.entries(routes)) {
    const label = name[0].toUpperCase() + name.slice(1);
    for (let k = 0; k < route.corridorPlaces - 1; k++) {
      const p = pointAlongPath(route.path, route.profile(rnd), rnd);
      addPlace(p.lat, p.lng, 'corridor', label);
    }
    const end = route.path[route.path.length - 1];
    destPlaceByRoute[name] = addPlace(end.lat, end.lng, 'corridor', label);
    route.dest = { lat: end.lat, lng: end.lng };
    route.destName = destPlaceByRoute[name].placeName;
    route.destPlaceKey = destPlaceByRoute[name].placeKey;
  }
  const corridorCount = places.length;
  for (let k = corridorCount; k < totalPlaces; k++) {
    addPlace(32.62 + rnd() * 0.36, -117.32 + rnd() * 0.3, 'scatter');
  }

  const unitsById = new Map();
  const index = [];
  const addUnit = (place, angle, durationSec) => {
    const topics = [];
    if (rnd() >= 0.3) {
      const first =
        place.homeTopic !== null && rnd() < 0.6 ? place.homeTopic : pickWeighted(rnd, TOPIC_WEIGHTS);
      topics.push(first);
      if (rnd() < 0.15) {
        const second = pickWeighted(rnd, TOPIC_WEIGHTS);
        if (second !== first) topics.push(second);
      }
    }
    const unit = {
      id: `${place.placeKey}|${angle}`,
      placeKey: place.placeKey,
      placeName: place.placeName,
      angle,
      lat: place.lat,
      lng: place.lng,
      durationSec,
      topics,
      tone: rnd() < 0.8 ? pickWeighted(rnd, TONE_WEIGHTS) : null,
      toneSecondary: rnd() < 0.15 ? pickWeighted(rnd, TONE_WEIGHTS) : null,
      audioPath: `x/${place.placeKey}-${angle}.wav`,
      // A unique filed text per telling — the synthetic
      // ledger's story_text, so the App's story-level heard
      // derivation (heardKeysForStories) runs here verbatim.
      storyText: `text:${place.placeKey}|${angle}`,
    };
    unitsById.set(unit.id, unit);
    index.push({ place_key: place.placeKey, angle, lat: place.lat, lng: place.lng });
    return unit;
  };

  for (const place of places) {
    const depth = pickWeighted(rnd, spec.depth);
    const used = new Set();
    for (let k = 0; k < depth; k++) {
      const r = rnd();
      let cls;
      if (place.kind === 'corridor' && r < 0.2) cls = 'corridor';
      else if (r < 0.66) cls = 'landmark';
      else if (r < 0.83) cls = 'intro';
      else cls = 'filler';
      let angle = null;
      let durationSec = 0;
      if (cls === 'corridor' && !used.has('corridor')) {
        angle = 'corridor';
        durationSec = 120 + Math.round(rnd() * 240);
      } else if (cls === 'intro') {
        const a = rnd() < 0.85 ? 'neighborhood_intro' : 'neighborhood_intro_greet';
        if (!used.has(a)) {
          angle = a;
          durationSec = 40 + Math.round(rnd() * 50);
        }
      } else if (cls === 'filler') {
        const a = rnd() < 0.5 ? 'filler' : 'filler_hosted';
        if (!used.has(a)) {
          angle = a;
          durationSec = 60 + Math.round(rnd() * 60);
        }
      }
      if (angle === null) {
        const free = LANDMARK_ANGLES.filter(a => !used.has(a));
        if (free.length === 0) break;
        angle = free[Math.floor(rnd() * free.length)];
        durationSec = 90 + Math.round(rnd() * 210);
      }
      used.add(angle);
      addUnit(place, angle, durationSec);
    }
  }

  const all = [...unitsById.values()];
  return {
    shape,
    unitsById,
    index,
    routes,
    fillerUnits: all.filter(u => u.angle === 'filler_hosted').slice(0, 10),
    census: all.length,
    topicLessShare: Math.round((all.filter(u => u.topics.length === 0).length / all.length) * 1000) / 1000,
  };
}

// ------------------------------------------------------------ the driver (main only)

async function loadBundles(repoRoot) {
  const bundle = async (entry, name, define) => {
    const out = join(mkdtempSync(join(tmpdir(), `grader-${name}-`)), `${name}.mjs`);
    execFileSync(
      join(repoRoot, 'node_modules', '.bin', 'esbuild'),
      [
        join(repoRoot, 'src', 'core', entry),
        '--bundle', '--format=esm', '--platform=node',
        ...(define ? [`--define:import.meta.env={}`] : []),
        `--outfile=${out}`, '--log-level=warning',
      ],
      { stdio: 'inherit' },
    );
    return import(pathToFileURL(out).href);
  };
  return {
    rm: await bundle('routeMode.ts', 'routeMode'),
    gf: await bundle('routeGapFill.ts', 'routeGapFill', true),
    rh: await bundle('routeHistory.ts', 'routeHistory'),
  };
}

/**
 * One route build, mirroring App.buildRoute's staging order
 * with the network replaced by the synthetic world: fetch plan
 * → row reads → compose → (portal-climax seeking: one bounded
 * index scan + single re-compose) → shelf-only guarantee pass.
 */
async function runBuild({ rm, gf, rh }, world, route, { heardNames, heardTexts, driveRecords, input, nowMs }) {
  const tagsOf = (pk, ang) => {
    const u = world.unitsById.get(`${pk}|${ang}`);
    return { topics: u ? u.topics : [] };
  };
  const fetchOrder = rm.orderFetchCandidates(world.index, route.path, route.dest, tagsOf, {
    userTopics: input.topics,
  });
  // The heard-aware fetch, exactly like the App's (v3.1,
  // commit B): synthetic row reads over the world, heard
  // classified by filed text.
  const fetched = await rm.fetchHeardAwareCandidates({
    geoOrder: fetchOrder.geo,
    portalOrder: fetchOrder.portals,
    path: route.path,
    readRow: async e => world.unitsById.get(`${e.place_key}|${e.angle}`) ?? null,
    rowText: u => u.storyText,
    heardTexts,
  });
  const units = [...fetched.geo, ...fetched.portals].map(x => x.row);
  // Story-level heard, exactly like the App's (v3.1): the
  // ledger's filed texts name the tellings that are out.
  const heardKeys = rm.heardKeysForStories(units, heardTexts);
  const records = (driveRecords ?? []).map(r => ({
    ...r,
    owedSubjects: rh.stillOwedSubjects(r, heardNames),
  }));
  const opts = {
    nowMs,
    heardKeys,
    fillerUnits: world.fillerUnits,
    budgetSecOverride: rm.budgetSecFor(route.driveSec),
    driveSec: route.driveSec,
    driveRecords: records,
    destinationPlaceKey: route.destPlaceKey,
  };
  let plan = rm.composeRoutePlan(units, route.path, route.dest, route.destName, input, opts);
  let climaxOnlyUnits = [];
  if (plan.portalClimaxSeeking) {
    const topic = plan.portalClimaxSeeking;
    const fetchedIds = new Set(
      [...fetched.geo, ...fetched.portals].map(x => `${x.entry.place_key}|${x.entry.angle}`),
    );
    climaxOnlyUnits = world.index
      .filter(
        e =>
          e.angle.startsWith('landmark') &&
          !fetchedIds.has(`${e.place_key}|${e.angle}`) &&
          tagsOf(e.place_key, e.angle).topics.includes(topic) &&
          rm.distanceToPathM({ lat: e.lat, lng: e.lng }, route.path) > 1500 &&
          rm.haversineM({ lat: e.lat, lng: e.lng }, route.dest) > 1500,
      )
      .slice(0, 12)
      .map(e => world.unitsById.get(`${e.place_key}|${e.angle}`))
      .filter(u => u && !(u.storyText && heardTexts.has(u.storyText)));
    if (climaxOnlyUnits.length > 0) {
      plan = rm.composeRoutePlan(units, route.path, route.dest, route.destName, input, {
        ...opts,
        climaxOnlyUnits,
      });
    }
  }
  plan = await gf.fillRouteGaps(
    plan,
    { fetchedUnits: units, heardKeys, input, driveSec: route.driveSec },
    {},
  );
  plan.driveSec = route.driveSec;
  plan.budgetSec = rm.budgetSecFor(route.driveSec);
  return { plan, units, climaxOnlyUnits, heardKeys, fetchStats: fetched.stats };
}

/** The eligible pool a plan's climax winner was picked from (for the percentile). */
function climaxPoolFor(rm, build, route) {
  const { plan, units, climaxOnlyUnits, heardKeys } = build;
  if (!plan.climaxUnitId) return null;
  const winnerItem = plan.items.find(i => i.climax);
  if (plan.climaxMode === 'portal') {
    const topic = plan.thread?.topic ?? null;
    return [...units, ...climaxOnlyUnits].filter(
      u =>
        !heardKeys.has(u.id) &&
        u.angle.startsWith('landmark') &&
        (topic === null || u.topics.includes(topic)),
    );
  }
  return units.filter(
    u =>
      !heardKeys.has(u.id) &&
      u.angle !== 'neighborhood_intro' &&
      !['neighborhood_intro_greet', 'filler', 'filler_hosted'].includes(u.angle) &&
      (rm.progressAlongPath({ lat: u.lat, lng: u.lng }, route.path) >= 2 / 3 ||
        rm.haversineM({ lat: u.lat, lng: u.lng }, route.dest) <= 1500),
  );
}

const BASE_NOW = Date.parse('2026-11-03T15:00:00-08:00');

async function gradeAll(mods) {
  const shapes = {};
  for (const [shapeName, seed] of [['current', 1103], ['2x', 2207], ['full', 3313]]) {
    const world = buildWorld(seed, shapeName);
    const shapeReport = { census: world.census, topicLessShare: world.topicLessShare, routes: {}, commuteRepeats: null };
    for (const routeName of ['tourist', 'hop']) {
      const route = world.routes[routeName];
      const input = { destinationText: route.destName, arrivalTimeMs: null, tone: null, topics: [] };
      const build = await runBuild(mods, world, route, {
        heardNames: new Set(),
        heardTexts: new Set(),
        driveRecords: [],
        input,
        nowMs: BASE_NOW,
      });
      shapeReport.routes[routeName] = planMetrics(build.plan, {
        driveSec: route.driveSec,
        climaxPool: climaxPoolFor(mods.rm, build, route),
      });
    }
    // The repeat commute: 20 drives, one route, a growing
    // heard ledger (story-text-based, exactly like the App's
    // since v3.1; place names are still kept alongside for
    // the records' subject-level owed discharge) and a
    // growing drive-record store feeding the next build.
    const route = world.routes.commute;
    const input = { destinationText: route.destName, arrivalTimeMs: null, tone: null, topics: [] };
    const heardNames = new Set();
    const heardTexts = new Set();
    let records = [];
    const drives = [];
    const seenPlaces = new Set();
    for (let d = 0; d < 20; d++) {
      const nowMs = BASE_NOW + d * 24 * 60 * 60 * 1000;
      const build = await runBuild(mods, world, route, {
        heardNames,
        heardTexts,
        driveRecords: records,
        input,
        nowMs,
      });
      const metrics = planMetrics(build.plan, {
        driveSec: route.driveSec,
        climaxPool: climaxPoolFor(mods.rm, build, route),
      });
      const played = build.plan.items.filter(i => i.kind === 'story' && i.unit);
      for (const it of played) seenPlaces.add(it.unit.placeKey);
      drives.push({
        drive: d + 1,
        ...metrics,
        cumulativePlaces: seenPlaces.size,
        fetchReads: build.fetchStats.reads,
        fetchUnheard: build.fetchStats.unheard,
        fetchCeilingHit: build.fetchStats.ceilingHit,
      });
      for (const it of played) {
        heardNames.add(it.unit.placeName);
        if (it.unit.storyText) heardTexts.add(it.unit.storyText);
      }
      records = [
        {
          destinationName: route.destName,
          destinationPlaceKey: route.destPlaceKey,
          threadTopic: build.plan.thread?.topic ?? null,
          playedSubjects: [...new Set(played.map(i => i.unit.placeName))],
          owedSubjects: [],
          endedAt: nowMs,
        },
        ...records,
      ].slice(0, 20);
    }
    shapeReport.routes.commute = drives[0];
    shapeReport.commuteRepeats = {
      drives,
      summary: {
        drivesWithThread: drives.filter(d => d.threadTopic !== null).length,
        drivesWithClimax: drives.filter(d => d.climaxPresent).length,
        firstDriveStories: drives[0].stories,
        lastDriveStories: drives[drives.length - 1].stories,
        minStories: Math.min(...drives.map(d => d.stories)),
        meanSilenceShare:
          Math.round((drives.reduce((s, d) => s + d.silenceShare, 0) / drives.length) * 1000) / 1000,
      },
    };
    shapes[shapeName] = shapeReport;
  }
  return shapes;
}

// ------------------------------------------------------------ woven-pool simulation (v3.1, commit F)
//
// Erik's hypothesis (Nov 4, 2026): every library story is
// written in a presence register ("as if you are there"), so
// route composition can only use corridor-anchored material —
// one fixed commute can yield only as many genuinely different
// episodes as its corridor holds, and thread/climax starve
// first. A WOVEN register version (host-told, no presence
// language) could be drawn from anywhere in the county. This
// simulation prices that idea BEFORE anyone pays for woven
// versions: when enabled, a parameterized share of
// OFF-corridor stories becomes eligible THREAD and CLIMAX
// material only — woven units never geo-tile, never open
// chapters; they count toward thread support county-wide, and
// the strongest unheard woven landmark on the thread's topic
// may ride as ONE windowless climax insert, sequenced last,
// in the spirit of the portal climax. Grader-side only: no
// production composer behavior changes.
//
// Model notes (the simplifications, stated):
//   - The thread is re-detected per drive as the REAL
//     detectRouteThread over (corridor support pool ∪ woven
//     pool) — the corridor pool replicates the composer's own
//     partition (unheard, non-intro/greet/filler, within
//     1500 m of path or destination).
//   - The thread's selection NUDGE on corridor picks is not
//     re-modeled: tiling is the standard build's, so silence
//     moves only by the climax insert's own duration and
//     distinctness only by the insert + thread changes. The
//     sim is conservative for woven on both.
//   - A woven climax replaces an existing climax only in
//     presence terms (never modeled — presence is the metric);
//     it is inserted only when the standard build found a
//     thread but no climax, or a thread only woven support
//     found (in which case the standard build has no climax
//     by construction).
//   - Eligibility is a property of the STORY (it either has a
//     woven version or not), drawn once per configuration from
//     a seeded stream over the county pool in world order;
//     flat-share configurations share one stream, so pools
//     nest (25% ⊂ 50% ⊂ 75%).

/**
 * Per-topic woven-usable shares (weave-safe + mixed) from the
 * presence audit of Nov 4, 2026
 * (~/workspace/leos-world/presence-audit-2026-11-04.md,
 * non-Protected topic-tagged stories). Topics the audit table
 * does not list use its overall tagged share (567/679 ≈ 0.835).
 */
export const WOVEN_AUDIT_USABLE = {
  'Boom & Bust': 0.883, Coast: 0.911, 'Navy Century': 0.753,
  'Food & Drink': 0.958, Sport: 0.859, 'Border / CaliBaja': 0.898,
  Flight: 0.739, Film: 0.895, Rail: 0.938, Surf: 0.968,
  Music: 0.966, folklore: 1.0, Highway: 0.577, 'Deep Time': 0.72,
  'San Diego River': 0.75, Faith: 0.87, Water: 0.667,
  Desert: 0.737, 'The Cure': 0.824,
};
export const WOVEN_AUDIT_FALLBACK = 0.835;

/**
 * The county pool for one route: landmark-class units whose
 * place is NOT on the route's own corridor (in the synthetic
 * world, corridor places are named for their route; everything
 * else — scatter places and other routes' corridors — is
 * county ground for this route).
 */
export function wovenPoolUnits(world, routeName) {
  const label = routeName[0].toUpperCase() + routeName.slice(1);
  return [...world.unitsById.values()].filter(
    u => u.angle.startsWith('landmark') && !u.placeName.startsWith(`${label} `),
  );
}

/**
 * The woven-eligible subset of the county pool for one
 * configuration: { share } for a flat sweep share, or
 * { audit: true } for the presence audit's measured per-topic
 * usable shares (a story's primary topic governs; a topic-less
 * story can never join a thread and is never climax material
 * here, exactly as the audit's tagging-gap note says).
 * Deterministic: a seeded stream over the pool in world order.
 */
export function wovenEligibleUnits(world, routeName, config, seed = 9100) {
  const pool = wovenPoolUnits(world, routeName);
  const rnd = mulberry32(seed);
  const out = [];
  for (const u of pool) {
    let p;
    if (config.audit) {
      if (u.topics.length === 0) p = 0;
      else p = WOVEN_AUDIT_USABLE[u.topics[0]] ?? WOVEN_AUDIT_FALLBACK;
    } else {
      p = config.share;
    }
    if (rnd() < p) out.push(u);
  }
  return out;
}

/** Consecutive-episode distinctness: mean Jaccard overlap of story-id sets (lower = more different). */
export function meanConsecutiveOverlap(episodeSets) {
  if (episodeSets.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < episodeSets.length; i++) {
    const a = episodeSets[i - 1];
    const b = episodeSets[i];
    if (a.size === 0 && b.size === 0) {
      sum += 1; // two silent episodes are identically empty
      continue;
    }
    let inter = 0;
    for (const id of a) if (b.has(id)) inter += 1;
    sum += inter / (a.size + b.size - inter);
  }
  return Math.round((sum / (episodeSets.length - 1)) * 1000) / 1000;
}

/** The first drive (1-based) starting a run of 5 consecutive thread-less drives, or null. */
export function threadStarvationDrive(drives) {
  let run = 0;
  for (let i = 0; i < drives.length; i++) {
    run = drives[i].threadTopic !== null ? 0 : run + 1;
    if (run >= 5) return i - 3; // 1-based drive where the failing run began (i is 0-based, run ends at i)
  }
  return null;
}

/**
 * The woven battery: the commute at CURRENT shelf depth,
 * extended to 40 drives, one run per configuration. Reuses
 * runBuild (the standard machinery, v3.1 window + story-level
 * heard included) and applies the woven post-pass per drive.
 */
export async function runWovenSimulation(mods, { drives: driveCount = 40 } = {}) {
  const { rm } = mods;
  const world = buildWorld(1103, 'current');
  const route = world.routes.commute;
  const input = { destinationText: route.destName, arrivalTimeMs: null, tone: null, topics: [] };
  const configs = [
    { key: '0%', share: 0 },
    { key: '25%', share: 0.25 },
    { key: '50%', share: 0.5 },
    { key: '75%', share: 0.75 },
    { key: 'audit', audit: true },
  ];
  const results = {};
  for (const config of configs) {
    const eligible = wovenEligibleUnits(world, 'commute', config, config.audit ? 9200 : 9100);
    const heardNames = new Set();
    const heardTexts = new Set();
    let records = [];
    const drives = [];
    const episodeSets = [];
    for (let d = 0; d < driveCount; d++) {
      const nowMs = BASE_NOW + d * 24 * 60 * 60 * 1000;
      const build = await runBuild(mods, world, route, {
        heardNames,
        heardTexts,
        driveRecords: records,
        input,
        nowMs,
      });
      // The composer's corridor support pool, replicated from
      // its partition (see header): unheard story-class units
      // within the corridor tolerance.
      const corridorPool = build.units.filter(
        u =>
          !build.heardKeys.has(u.id) &&
          u.angle !== 'neighborhood_intro' &&
          u.angle !== 'neighborhood_intro_greet' &&
          u.angle !== 'filler' &&
          u.angle !== 'filler_hosted' &&
          (rm.distanceToPathM({ lat: u.lat, lng: u.lng }, route.path) <= 1500 ||
            rm.haversineM({ lat: u.lat, lng: u.lng }, route.dest) <= 1500),
      );
      const wovenAvail = eligible.filter(u => !(u.storyText && heardTexts.has(u.storyText)));
      const unionThread = rm.detectRouteThread([...corridorPool, ...wovenAvail], []);
      const threadTopic = unionThread?.topic ?? build.plan.thread?.topic ?? null;

      // Woven climax insert: a thread exists but the standard
      // build seated no climax → the strongest unheard woven
      // landmark on the thread's topic rides, windowless, last.
      let plan = build.plan;
      let climaxViaWoven = false;
      if (!plan.climaxUnitId && threadTopic !== null) {
        const playedIds = new Set(
          plan.items.filter(i => i.kind === 'story' && i.unit).map(i => i.unit.id),
        );
        const playedPlaces = new Set(
          plan.items.filter(i => i.kind === 'story' && i.unit).map(i => i.unit.placeKey),
        );
        const candidates = wovenAvail
          .filter(
            u => u.topics.includes(threadTopic) && !playedIds.has(u.id) && !playedPlaces.has(u.placeKey),
          )
          .sort((a, b) => b.durationSec - a.durationSec);
        const winner = candidates[0];
        if (winner) {
          const insert = {
            kind: 'story',
            id: winner.id,
            unit: winner,
            text: null,
            durationSec: winner.durationSec,
            anchorProgress: Math.max(0, 1 - winner.durationSec / route.driveSec),
            climax: true,
            portal: true,
            woven: true,
          };
          plan = {
            ...plan,
            items: [...plan.items, insert],
            climaxUnitId: winner.id,
            climaxMode: 'woven',
            thread: unionThread ?? plan.thread,
          };
          climaxViaWoven = true;
        }
      } else if (unionThread && plan.thread?.topic !== unionThread.topic) {
        plan = { ...plan, thread: unionThread };
      }

      const metrics = planMetrics(plan, { driveSec: route.driveSec, climaxPool: null });
      const played = plan.items.filter(i => i.kind === 'story' && i.unit);
      episodeSets.push(new Set(played.map(i => i.unit.id)));
      drives.push({
        drive: d + 1,
        stories: metrics.stories,
        silenceShare: metrics.silenceShare,
        threadTopic,
        climaxPresent: metrics.climaxPresent,
        climaxViaWoven,
      });
      for (const it of played) {
        heardNames.add(it.unit.placeName);
        if (it.unit.storyText) heardTexts.add(it.unit.storyText);
      }
      records = [
        {
          destinationName: route.destName,
          destinationPlaceKey: route.destPlaceKey,
          threadTopic,
          playedSubjects: [...new Set(played.map(i => i.unit.placeName))],
          owedSubjects: [],
          endedAt: nowMs,
        },
        ...records,
      ].slice(0, 20);
    }
    const starvation = threadStarvationDrive(drives);
    const threadBefore =
      starvation === null
        ? drives.filter(d => d.threadTopic !== null).length
        : drives.slice(0, starvation - 1).filter(d => d.threadTopic !== null).length;
    // Substance, kept beside the headline so it can't be
    // misread: a drive counts as a substantive EPISODE when
    // stories cover at least half of it (silence ≤ 50%). Past
    // corridor exhaustion a "thread-bearing" drive may be a
    // single woven climax insert in a mostly silent drive —
    // a through-line and one story, not an episode.
    const substantive = drives.filter(d => d.silenceShare <= 0.5);
    results[config.key] = {
      config: config.audit ? 'audit (per-topic measured usable shares)' : `flat ${config.key}`,
      eligibleUnits: eligible.length,
      drives,
      summary: {
        threadDrives: drives.filter(d => d.threadTopic !== null).length,
        climaxDrives: drives.filter(d => d.climaxPresent).length,
        wovenClimaxDrives: drives.filter(d => d.climaxViaWoven).length,
        threadStarvationDrive: starvation,
        threadEpisodesBeforeStarvation: threadBefore,
        substantiveEpisodes: substantive.length,
        substantiveThreadEpisodes: substantive.filter(d => d.threadTopic !== null).length,
        meanSilenceShare:
          Math.round((drives.reduce((s, d) => s + d.silenceShare, 0) / drives.length) * 1000) / 1000,
        meanConsecutiveOverlap: meanConsecutiveOverlap(episodeSets),
        minStories: Math.min(...drives.map(d => d.stories)),
        lastDriveStories: drives[drives.length - 1].stories,
      },
    };
  }
  return { world: { census: world.census, shape: 'current' }, results };
}

function renderWovenMarkdown(sim, label) {
  const lines = [];
  lines.push('# Woven-pool simulation — route mode (composer v3.1, commit F)');
  lines.push('');
  lines.push(
    `Composer: ${label ?? 'working tree'} · synthetic shelf, current depth (${sim.world.census} units), seeded; ` +
      'the standard 40-drive commute battery with the heard-aware window and story-level heard (v3.1 A+B) underneath. ' +
      'Woven units are thread/climax material only — they never geo-tile and never open chapters. ' +
      'Guarantee pass is shelf-only (silence is an upper bound vs production).',
  );
  lines.push('');
  const zero = sim.results['0%'].summary;
  lines.push(
    `HEADLINE — distinct, thread-bearing commute episodes before thread starvation ` +
      `(thread-found failing on 5 consecutive drives), vs the 0% run's ${zero.threadEpisodesBeforeStarvation}:`,
  );
  lines.push('');
  lines.push('| woven share | eligible units | thread episodes before starvation | additional vs 0% | starvation drive | thread drives /40 | climax drives /40 | woven climaxes | substantive episodes (silence ≤ 50%) | of those, thread-bearing | mean consecutive overlap | mean silence |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const key of ['0%', '25%', '50%', '75%', 'audit']) {
    const r = sim.results[key];
    const s = r.summary;
    lines.push(
      `| ${key} | ${r.eligibleUnits} | ${s.threadEpisodesBeforeStarvation} | ` +
        `${key === '0%' ? '—' : `+${s.threadEpisodesBeforeStarvation - zero.threadEpisodesBeforeStarvation}`} | ` +
        `${s.threadStarvationDrive ?? 'none in 40'} | ${s.threadDrives} | ${s.climaxDrives} | ${s.wovenClimaxDrives} | ` +
        `${s.substantiveEpisodes} | ${s.substantiveThreadEpisodes} | ` +
        `${s.meanConsecutiveOverlap} | ${fmtPct(s.meanSilenceShare)} |`,
    );
  }
  lines.push('');
  lines.push(
    'WHAT THE HEADLINE DOES AND DOES NOT SAY — read before deciding: at every woven share the corridor ' +
      'itself exhausts on the same drive as the 0% run (the geo supply is untouched by register). Past that ' +
      'drive, a "thread-bearing" drive is ONE woven climax story under a county-detected through-line, in a ' +
      'drive that is otherwise ~89% silence (see the per-drive tables). Woven therefore buys ZERO additional ' +
      'substantive episodes (silence ≤ 50%: identical at every share) — what it buys is that the commute never ' +
      'goes fully dark: the episode SHAPE (a named through-line + a closing story) survives indefinitely, and ' +
      '25% already saturates that effect (25/50/75/audit are indistinguishable) because the pool is spent only ' +
      'through the single climax slot, one story per drive. The distinctness column is dominated by exhaustion ' +
      'arithmetic (empty-vs-empty pairs score 1; singleton-insert pairs score 0) and should not be read as an ' +
      'episode-diversity measure past the corridor\'s life. The open design question the sim poses: woven value ' +
      'scales only if woven members may also be SEATED as thread members inside the episode (multiple inserts), ' +
      'not only as its climax — that variant is not simulated here.',
  );
  lines.push('');
  lines.push(
    'Model notes: episode distinctness is the mean Jaccard overlap of consecutive episodes\' story sets ' +
      '(lower = more different). Silence barely moves by design — woven units do not tile; the only ' +
      'coverage they add is the climax insert\'s own duration. The selection-nudge effect of a ' +
      'woven-supported thread on corridor picks is not modeled, so distinctness gains here are a floor.',
  );
  lines.push('');
  for (const key of ['0%', '25%', '50%', '75%', 'audit']) {
    const r = sim.results[key];
    lines.push(`## Woven share ${key} (${r.eligibleUnits} eligible units)`);
    lines.push('');
    lines.push('| drive | stories | silence | thread | climax |');
    lines.push('|---|---|---|---|---|');
    for (const d of r.drives) {
      lines.push(
        `| ${d.drive} | ${d.stories} | ${fmtPct(d.silenceShare)} | ${d.threadTopic ?? '—'} | ` +
          `${d.climaxPresent ? (d.climaxViaWoven ? 'woven' : 'yes') : '—'} |`,
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ------------------------------------------------------------ reporting

function fmtPct(x) {
  return x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`;
}

function metricsRow(label, m) {
  return (
    `| ${label} | ${m.stories} | ${m.distinctPlaces} | ${fmtPct(m.silenceShare)} | ` +
    `${m.threadTopic ?? '—'} | ${m.climaxPresent ? `${m.climaxMode}/${m.climaxWinnerClass}/${fmtPct(m.climaxPercentile)}` : '—'} | ` +
    `${fmtPct(m.portalShare)} | ${m.atRisk} |`
  );
}

function renderMarkdown(report, baseline) {
  const lines = [];
  lines.push(`# Route plan grade report`);
  lines.push('');
  lines.push(
    `Composer: ${report.label ?? 'working tree'} · generated ${report.generatedAt} · ` +
      `synthetic shelves, seeded; guarantee pass is shelf-only (silence is an upper bound vs production).`,
  );
  lines.push('');
  for (const [shapeName, s] of Object.entries(report.shapes)) {
    lines.push(`## Shelf: ${shapeName} (${s.census} units, ${fmtPct(s.topicLessShare)} topic-less)`);
    lines.push('');
    lines.push('| route | stories | places | silence | thread | climax mode/class/pct | portal share | at-risk |');
    lines.push('|---|---|---|---|---|---|---|---|');
    for (const r of ['commute', 'tourist', 'hop']) lines.push(metricsRow(r, s.routes[r]));
    lines.push('');
    lines.push(`Commute ×20 (same route, growing heard ledger):`);
    lines.push('');
    lines.push('| drive | stories | silence | thread | climax | cum. places |');
    lines.push('|---|---|---|---|---|---|');
    for (const d of s.commuteRepeats.drives) {
      lines.push(
        `| ${d.drive} | ${d.stories} | ${fmtPct(d.silenceShare)} | ${d.threadTopic ?? '—'} | ` +
          `${d.climaxPresent ? `${d.climaxMode}/${d.climaxWinnerClass}/${fmtPct(d.climaxPercentile)}` : '—'} | ${d.cumulativePlaces} |`,
      );
    }
    const sum = s.commuteRepeats.summary;
    lines.push('');
    lines.push(
      `Summary: thread on ${sum.drivesWithThread}/20 drives, climax on ${sum.drivesWithClimax}/20, ` +
        `stories ${sum.firstDriveStories} → ${sum.lastDriveStories} (min ${sum.minStories}), mean silence ${fmtPct(sum.meanSilenceShare)}.`,
    );
    lines.push('');
  }
  if (baseline) {
    lines.push(`## Deltas vs baseline (${baseline.label ?? 'baseline'})`);
    lines.push('');
    lines.push('| shape / route | silence | stories | climax pct |');
    lines.push('|---|---|---|---|');
    for (const [shapeName, s] of Object.entries(report.shapes)) {
      const b = baseline.shapes?.[shapeName];
      if (!b) continue;
      for (const r of ['commute', 'tourist', 'hop']) {
        const cur = s.routes[r];
        const old = b.routes[r];
        if (!old) continue;
        const d = (a, c) => (a === null || c === null ? '—' : `${a} → ${c}`);
        lines.push(
          `| ${shapeName} / ${r} | ${d(fmtPct(old.silenceShare), fmtPct(cur.silenceShare))} | ` +
            `${d(old.stories, cur.stories)} | ${d(fmtPct(old.climaxPercentile), fmtPct(cur.climaxPercentile))} |`,
        );
      }
      const curSum = s.commuteRepeats.summary;
      const oldSum = b.commuteRepeats?.summary;
      if (oldSum) {
        lines.push(
          `| ${shapeName} / commute ×20 | mean silence ${fmtPct(oldSum.meanSilenceShare)} → ${fmtPct(curSum.meanSilenceShare)} | ` +
            `stories ${oldSum.firstDriveStories}→${oldSum.lastDriveStories} → ${curSum.firstDriveStories}→${curSum.lastDriveStories} (min ${oldSum.minStories} → ${curSum.minStories}) | — |`,
        );
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}

async function main() {
  const argv = process.argv.slice(2);
  const argOf = name => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = join(here, '..', '..');
  const outPrefix = argOf('--out') ?? 'grade-report';
  const baselinePath = argOf('--baseline');
  let label = argOf('--label');
  if (!label) {
    try {
      label = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoRoot })
        .toString()
        .trim();
    } catch {
      label = null;
    }
  }
  const mods = await loadBundles(repoRoot);
  if (argv.includes('--woven')) {
    // The woven-pool battery (v3.1, commit F): current shelf
    // depth, 40-drive commute, woven off vs each share. Writes
    // grade-woven-sim.json/.md unless --out says otherwise.
    const sim = await runWovenSimulation(mods);
    const wovenReport = {
      generatedBy: 'scripts/route-mode/grader.mjs --woven',
      generatedAt: new Date().toISOString(),
      label,
      world: sim.world,
      results: sim.results,
    };
    const wovenPrefix = argOf('--out') ?? 'grade-woven-sim';
    writeFileSync(join(here, `${wovenPrefix}.json`), JSON.stringify(wovenReport, null, 2));
    writeFileSync(join(here, `${wovenPrefix}.md`), renderWovenMarkdown(sim, label));
    console.log(`grader (woven): wrote ${wovenPrefix}.json + ${wovenPrefix}.md (composer ${label ?? '?'})`);
    const zero = sim.results['0%'].summary;
    for (const key of ['0%', '25%', '50%', '75%', 'audit']) {
      const s = sim.results[key].summary;
      console.log(
        `  woven ${key}: thread episodes before starvation ${s.threadEpisodesBeforeStarvation} ` +
          `(0%: ${zero.threadEpisodesBeforeStarvation}), starvation ${s.threadStarvationDrive ?? 'none in 40'}, ` +
          `thread ${s.threadDrives}/40, climax ${s.climaxDrives}/40, substantive episodes ${s.substantiveEpisodes} ` +
          `(thread-bearing ${s.substantiveThreadEpisodes}), overlap ${s.meanConsecutiveOverlap}, silence ${fmtPct(s.meanSilenceShare)}`,
      );
    }
    return;
  }
  const shapes = await gradeAll(mods);
  const baseline = baselinePath
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : existsSync(join(here, 'grade-baseline.json')) && outPrefix !== 'grade-baseline'
      ? JSON.parse(readFileSync(join(here, 'grade-baseline.json'), 'utf8'))
      : null;
  const report = {
    generatedBy: 'scripts/route-mode/grader.mjs',
    generatedAt: new Date().toISOString(),
    label,
    shapes,
  };
  writeFileSync(join(here, `${outPrefix}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(here, `${outPrefix}.md`), renderMarkdown(report, baseline));
  console.log(`grader: wrote ${outPrefix}.json + ${outPrefix}.md (composer ${label ?? '?'})`);
  for (const [shapeName, s] of Object.entries(shapes)) {
    const c = s.routes.commute;
    console.log(
      `  ${shapeName} (${s.census}): commute silence ${fmtPct(c.silenceShare)}, thread ${c.threadTopic ?? 'none'}, ` +
        `climax ${c.climaxPresent ? `${c.climaxMode}/${c.climaxWinnerClass}/${fmtPct(c.climaxPercentile)}` : 'none'}; ` +
        `×20 stories ${s.commuteRepeats.summary.firstDriveStories}→${s.commuteRepeats.summary.lastDriveStories}`,
    );
  }
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  await main();
}
