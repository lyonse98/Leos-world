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
 * → row reads → compose (with index-level thread support) →
 * (portal-climax seeking: one bounded index scan + single
 * re-compose) → (member seeking: one bounded member fetch +
 * single re-compose) → shelf-only guarantee pass → seating.
 */
async function runBuild({ rm, gf, rh }, world, route, { heardNames, heardTexts, driveRecords, input, nowMs }) {
  const tagsOf = (pk, ang) => {
    const u = world.unitsById.get(`${pk}|${ang}`);
    return { topics: u ? u.topics : [] };
  };
  const eligibleOf = (pk, ang) => world.unitsById.get(`${pk}|${ang}`)?.wovenEligible === true;
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
  // Index-level thread support (the member-fetch lever): the
  // build's fetched-id set grows across its fetches, and the
  // support map is recomputed before every compose — exactly
  // the App's discipline. Heard ids are EXACT here (the
  // synthetic ledger is id-addressable through the filed
  // texts); in the App they are the fetched set's heard keys,
  // the one place the mirror is stronger than production.
  const fetchedIds = new Set(
    [...fetched.geo, ...fetched.portals].map(x => `${x.entry.place_key}|${x.entry.angle}`),
  );
  const heardIds = new Set(
    [...world.unitsById.values()].filter(u => u.storyText && heardTexts.has(u.storyText)).map(u => u.id),
  );
  const supportNow = () =>
    rm.wovenIndexSupportByTopic(world.index, route.path, route.dest, tagsOf, eligibleOf, {
      fetchedIds,
      heardIds,
    });
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
    wovenIndexSupport: supportNow(),
  };
  let plan = rm.composeRoutePlan(units, route.path, route.dest, route.destName, input, opts);
  let climaxOnlyUnits = [];
  if (plan.portalClimaxSeeking) {
    const topic = plan.portalClimaxSeeking;
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
      for (const u of climaxOnlyUnits) fetchedIds.add(u.id);
      plan = rm.composeRoutePlan(units, route.path, route.dest, route.destName, input, {
        ...opts,
        wovenIndexSupport: supportNow(),
        climaxOnlyUnits,
      });
    }
  }
  // The member fetch (the lever): the App's bounded fetch,
  // mirrored — selectMemberFetchEntries over the world index,
  // reads counted per entry attempted in chunks of 12 toward
  // the seat need's survivor target (memberFetchSizing off
  // plan.wovenMemberNeed: the lever's 8/24 at the standing
  // cap, 16/48 when the composed plan already sits below the
  // thread-carried floor), heard discarded at read time, one
  // re-compose carrying the climax units forward.
  let memberUnits = [];
  let memberFetch = null;
  if (plan.wovenMembersSeeking) {
    const topic = plan.wovenMembersSeeking;
    const sizing = rm.memberFetchSizing(plan.wovenMemberNeed ?? rm.WOVEN_MEMBER_CAP);
    const entries = rm.selectMemberFetchEntries(world.index, {
      topic,
      fetchedIds,
      path: route.path,
      destination: route.dest,
      tagsOf,
      eligibleOf,
      cap: sizing.readCap,
    });
    let reads = 0;
    for (let i = 0; i < entries.length && memberUnits.length < sizing.target; i += 12) {
      const chunk = entries.slice(i, i + 12);
      reads += chunk.length;
      for (const e of chunk) {
        const u = world.unitsById.get(`${e.place_key}|${e.angle}`);
        if (u && !(u.storyText && heardTexts.has(u.storyText))) memberUnits.push(u);
      }
    }
    memberFetch = { topic, reads, candidates: memberUnits.length };
    if (memberUnits.length > 0) {
      for (const u of memberUnits) fetchedIds.add(u.id);
      plan = rm.composeRoutePlan(units, route.path, route.dest, route.destName, input, {
        ...opts,
        wovenIndexSupport: supportNow(),
        climaxOnlyUnits,
        memberUnits,
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
  // Woven seated members (Nov 4, 2026): the App's post-
  // guarantee seating pass, same staging position. A strict
  // no-op on worlds whose units carry no wovenEligible marks
  // (every pre-feature battery), so the standard grades are
  // untouched by its presence here.
  plan = rm.seatWovenMembers(plan, [...units, ...memberUnits], { heardKeys });
  // Thread-carried episodes (Nov 4, 2026): the App's
  // assessment + anchoring top-up, same staging position.
  // assessThreadCarried reads the plan's own thread and geo
  // coverage, so on an unmarked world (no thread can carry
  // members — detection saw no eligible support) it never
  // engages: the standard grades stay untouched here too.
  plan.threadCarried = rm.assessThreadCarried(plan);
  if (plan.threadCarried.active) {
    plan = rm.seatWovenMembers(plan, [...units, ...memberUnits], {
      heardKeys,
      maxMembers: plan.threadCarried.memberCap,
      threadCarried: true,
    });
  }
  return {
    plan,
    units,
    climaxOnlyUnits,
    memberUnits,
    memberFetch,
    heardKeys,
    fetchStats: memberFetch ? { ...fetched.stats, memberFetch } : fetched.stats,
  };
}

/** The eligible pool a plan's climax winner was picked from (for the percentile). */
function climaxPoolFor(rm, build, route) {
  const { plan, units, climaxOnlyUnits, memberUnits, heardKeys } = build;
  if (!plan.climaxUnitId) return null;
  const winnerItem = plan.items.find(i => i.climax);
  if (plan.climaxMode === 'thread') {
    // The designated member climax (thread-carried): the
    // pool it was picked from is the member candidacy pool —
    // fetched units plus the member fetch's survivors.
    const topic = plan.thread?.topic ?? null;
    return [...units, ...(memberUnits ?? [])].filter(
      u =>
        !heardKeys.has(u.id) &&
        u.angle.startsWith('landmark') &&
        u.wovenEligible === true &&
        (topic === null || u.topics.includes(topic)),
    );
  }
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

// ------------------------------------------------------------ woven SEATED-members simulation (follow-up to commit F)
//
// Commit F's verdict: with woven units allowed ONLY as a
// single climax insert, substantive episodes (silence ≤ 50%)
// were 9 at every share — climax-only woven buys the episode
// SHAPE (a named through-line + a closing story), not episode
// substance, and exactly +1 substantive thread-bearing
// episode. F's own conclusion: woven value scales only if
// woven stories may be SEATED AS THREAD MEMBERS inside the
// episode. Erik approved simulating that variant (Nov 4,
// 2026) before any woven tranche decision. Grader-side only,
// like F: no production composer behavior changes.
//
// The model (everything not listed here is F's machinery,
// inherited unchanged — same world, same commute battery,
// same eligibility draws and seeds, same union thread
// detection, same climax post-pass, same metrics):
//   - After F's climax pass, additional woven members —
//     unheard eligible units on the detected thread topic,
//     strongest (longest) first — seat as windowless inserts
//     distributed through the episode. They never geo-tile
//     and never open chapters (the pool is landmark-class by
//     construction, as in F).
//   - Placement is IDEALIZED: each member seats at the start
//     of the largest remaining silent gap (per the grader's
//     window-coverage model) and only if it fits entirely
//     inside one gap. Inserts therefore never displace
//     sounding geo material in the sim; the displacement
//     cost a real composer would pay is represented by the
//     caps below, which bound how much of the episode woven
//     material may claim.
//   - Caps (fixed in advance, per Erik's brief): seated
//     configurations bound TOTAL woven story-seconds in the
//     episode (the F climax insert counts toward the total)
//     at 25% or 40% of the episode budget — the same
//     budgetSec the silence share is measured against — or,
//     in the count configuration, bound the member count at
//     4 per episode (the climax is not a member and is not
//     counted). In material-rich drives the silent gaps are
//     scarce, so placement binds before the caps do; in
//     exhausted drives the caps are the only limit.
//   - A member that seats is played, so it joins the heard
//     ledger exactly like any story (story-level heard,
//     v3.1) and burns the woven pool: the report tracks
//     per-topic consumption and the drive each used topic's
//     unheard woven pool runs dry (the woven cliff).

/**
 * The silent gaps of a plan under the grader's coverage
 * model: the complement of the story-interval union inside
 * [0, driveSec], in drive order.
 */
export function silentGapsSec(items, driveSec) {
  const gaps = [];
  let cursor = 0;
  for (const iv of storyIntervalsSec(items, driveSec)) {
    if (iv.start > cursor) gaps.push({ start: cursor, end: iv.start });
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < driveSec) gaps.push({ start: cursor, end: driveSec });
  return gaps;
}

/**
 * Seat woven thread members into a plan's silent gaps.
 * Pure and deterministic. `candidates` are pre-filtered by
 * the caller (eligible, unheard, on the thread topic); this
 * helper enforces the episode-level rules: strongest first
 * (duration desc, id asc), one telling per place per plan
 * (v3.1's invariant — ids and places already in the plan, or
 * seated earlier in this call, are out), the seconds cap on
 * total woven time (`wovenSecBefore` carries any woven
 * seconds already seated, e.g. the F climax insert), the
 * member-count cap, and whole-gap placement into the largest
 * fitting gap. A candidate that violates the seconds cap or
 * fits no gap is skipped, not fatal — shorter candidates
 * later in the order still seat.
 */
export function seatWovenMembers({
  items,
  candidates,
  driveSec,
  budgetSec,
  wovenSecBefore = 0,
  capShare = null,
  maxMembers = Infinity,
}) {
  const usedIds = new Set();
  const usedPlaces = new Set();
  for (const it of items) {
    if (it.kind === 'story' && it.unit) {
      usedIds.add(it.unit.id);
      usedPlaces.add(it.unit.placeKey);
    }
  }
  const sorted = [...candidates].sort(
    (a, b) =>
      b.durationSec - a.durationSec || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const working = [...items];
  const inserts = [];
  let memberSec = 0;
  for (const u of sorted) {
    if (inserts.length >= maxMembers) break;
    if (usedIds.has(u.id) || usedPlaces.has(u.placeKey)) continue;
    if (
      capShare !== null &&
      wovenSecBefore + memberSec + u.durationSec > capShare * budgetSec
    ) {
      continue;
    }
    const gap = silentGapsSec(working, driveSec)
      .filter(g => g.end - g.start >= u.durationSec)
      .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)[0];
    if (!gap) continue;
    const insert = {
      kind: 'story',
      id: u.id,
      unit: u,
      text: null,
      durationSec: u.durationSec,
      anchorProgress: gap.start / driveSec,
      woven: true,
      member: true,
    };
    working.push(insert);
    inserts.push(insert);
    memberSec += u.durationSec;
    usedIds.add(u.id);
    usedPlaces.add(u.placeKey);
  }
  return { inserts, memberSec };
}

/**
 * Substantive-thread starvation: within the subsequence of
 * SUBSTANTIVE drives (silence ≤ 50%), the first run of 5
 * consecutive thread-less ones. Returns the drive number the
 * run begins at and how many substantive thread-bearing
 * drives precede it (the headline count), or a null drive
 * when no such run exists.
 */
export function substantiveThreadStarvation(drives) {
  let run = 0;
  let runStart = null;
  let before = 0;
  for (const d of drives) {
    if (d.silenceShare > 0.5) continue;
    if (d.threadTopic !== null) {
      run = 0;
      runStart = null;
      before += 1;
    } else {
      if (run === 0) runStart = d.drive;
      run += 1;
      if (run >= 5) return { starvationDrive: runStart, substantiveThreadBefore: before };
    }
  }
  return { starvationDrive: null, substantiveThreadBefore: before };
}

/**
 * The woven seated-members battery: F's 40-drive commute at
 * current shelf depth, per configuration. Configurations:
 * the no-woven baseline and F's climax-only model at the two
 * eligibilities (flat 50%, the audit's measured shares) —
 * these rerun F's model and must reproduce its numbers —
 * plus seated members under a 25% and a 40% woven-seconds
 * cap and under a 4-member cap, at both eligibilities.
 */
export async function runWovenSeatedSimulation(mods, { drives: driveCount = 40 } = {}) {
  const { rm } = mods;
  const world = buildWorld(1103, 'current');
  const route = world.routes.commute;
  const input = { destinationText: route.destName, arrivalTimeMs: null, tone: null, topics: [] };
  const configs = [
    { key: '0%', mode: 'climax', share: 0, desc: 'no woven (baseline)' },
    { key: 'climax-only 50%', mode: 'climax', share: 0.5, desc: "F's model, flat 50%" },
    { key: 'climax-only audit', mode: 'climax', audit: true, desc: "F's model, audit shares" },
    { key: 'seated-25% 50%', mode: 'seated', capShare: 0.25, share: 0.5, desc: 'seated, woven ≤25% of budget, flat 50%' },
    { key: 'seated-25% audit', mode: 'seated', capShare: 0.25, audit: true, desc: 'seated, woven ≤25% of budget, audit shares' },
    { key: 'seated-40% 50%', mode: 'seated', capShare: 0.4, share: 0.5, desc: 'seated, woven ≤40% of budget, flat 50%' },
    { key: 'seated-40% audit', mode: 'seated', capShare: 0.4, audit: true, desc: 'seated, woven ≤40% of budget, audit shares' },
    { key: 'seated-max4 50%', mode: 'seated', maxMembers: 4, share: 0.5, desc: 'seated, ≤4 members/episode, flat 50%' },
    { key: 'seated-max4 audit', mode: 'seated', maxMembers: 4, audit: true, desc: 'seated, ≤4 members/episode, audit shares' },
  ];
  const results = {};
  for (const config of configs) {
    const eligible = wovenEligibleUnits(world, 'commute', config, config.audit ? 9200 : 9100);
    const heardNames = new Set();
    const heardTexts = new Set();
    let records = [];
    const drives = [];
    const episodeSets = [];
    // Woven pool burn accounting (per topic tag; a unit with
    // several topics counts in each of its topics' pools and
    // is removed from all of them when consumed).
    const eligibleByTopic = new Map();
    for (const u of eligible) {
      for (const t of u.topics) {
        eligibleByTopic.set(t, (eligibleByTopic.get(t) ?? 0) + 1);
      }
    }
    const consumedByTopic = new Map();
    const dryAfterDrive = new Map();
    let supplyDryDrive = null;
    for (let d = 0; d < driveCount; d++) {
      const nowMs = BASE_NOW + d * 24 * 60 * 60 * 1000;
      const build = await runBuild(mods, world, route, {
        heardNames,
        heardTexts,
        driveRecords: records,
        input,
        nowMs,
      });
      // F's machinery, verbatim: corridor support pool, union
      // thread detection, woven climax post-pass.
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
      const wovenAvailOnTopic =
        threadTopic === null ? 0 : wovenAvail.filter(u => u.topics.includes(threadTopic)).length;
      if (
        eligible.length > 0 &&
        threadTopic !== null &&
        wovenAvailOnTopic === 0 &&
        supplyDryDrive === null
      ) {
        supplyDryDrive = d + 1;
      }

      let plan = build.plan;
      let climaxViaWoven = false;
      let climaxSec = 0;
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
          climaxSec = winner.durationSec;
        }
      } else if (unionThread && plan.thread?.topic !== unionThread.topic) {
        plan = { ...plan, thread: unionThread };
      }

      // The seated-members pass (this simulation's variant):
      // members on the thread topic seat into the plan the
      // climax pass left, under the configuration's cap.
      let membersSeated = 0;
      if (config.mode === 'seated' && threadTopic !== null) {
        const seated = seatWovenMembers({
          items: plan.items,
          candidates: wovenAvail.filter(u => u.topics.includes(threadTopic)),
          driveSec: route.driveSec,
          budgetSec: plan.budgetSec,
          wovenSecBefore: climaxSec,
          capShare: config.capShare ?? null,
          maxMembers: config.maxMembers ?? Infinity,
        });
        if (seated.inserts.length > 0) {
          plan = { ...plan, items: [...plan.items, ...seated.inserts] };
          membersSeated = seated.inserts.length;
        }
      }

      const metrics = planMetrics(plan, { driveSec: route.driveSec, climaxPool: null });
      const played = plan.items.filter(i => i.kind === 'story' && i.unit);
      episodeSets.push(new Set(played.map(i => i.unit.id)));
      const wovenPlayed = played.filter(i => i.woven);
      drives.push({
        drive: d + 1,
        stories: metrics.stories,
        silenceShare: metrics.silenceShare,
        threadTopic,
        climaxPresent: metrics.climaxPresent,
        climaxViaWoven,
        membersSeated,
        wovenUnits: wovenPlayed.length,
        wovenSec: wovenPlayed.reduce((s, i) => s + i.durationSec, 0),
        wovenAvailOnTopic,
      });
      for (const it of played) {
        heardNames.add(it.unit.placeName);
        if (it.unit.storyText) heardTexts.add(it.unit.storyText);
      }
      if (threadTopic !== null && wovenPlayed.length > 0) {
        const c = consumedByTopic.get(threadTopic) ?? { units: 0, sec: 0 };
        c.units += wovenPlayed.length;
        c.sec += wovenPlayed.reduce((s, i) => s + i.durationSec, 0);
        consumedByTopic.set(threadTopic, c);
      }
      // Pool state at drive end, for the topics this commute
      // has threaded on so far: the first drive a used topic's
      // unheard woven pool reaches zero is its cliff.
      for (const t of consumedByTopic.keys()) {
        if (dryAfterDrive.has(t)) continue;
        const remaining = eligible.filter(
          u => u.topics.includes(t) && !(u.storyText && heardTexts.has(u.storyText)),
        ).length;
        if (remaining === 0) dryAfterDrive.set(t, d + 1);
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
    const substantive = drives.filter(d => d.silenceShare <= 0.5);
    const subStarvation = substantiveThreadStarvation(drives);
    const perTopic = {};
    for (const [t, c] of consumedByTopic.entries()) {
      perTopic[t] = {
        eligibleUnits: eligibleByTopic.get(t) ?? 0,
        consumedUnits: c.units,
        consumedSec: c.sec,
        dryAfterDrive: dryAfterDrive.get(t) ?? null,
      };
    }
    results[config.key] = {
      config: config.desc,
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
        substantiveStarvationDrive: subStarvation.starvationDrive,
        substantiveThreadBeforeStarvation: subStarvation.substantiveThreadBefore,
        meanSilenceShare:
          Math.round((drives.reduce((s, d) => s + d.silenceShare, 0) / drives.length) * 1000) / 1000,
        meanConsecutiveOverlap: meanConsecutiveOverlap(episodeSets),
        minStories: Math.min(...drives.map(d => d.stories)),
        lastDriveStories: drives[drives.length - 1].stories,
      },
      burn: {
        totalWovenUnits: drives.reduce((s, d) => s + d.wovenUnits, 0),
        totalWovenSec: drives.reduce((s, d) => s + d.wovenSec, 0),
        totalMembers: drives.reduce((s, d) => s + d.membersSeated, 0),
        drivesWithMembers: drives.filter(d => d.membersSeated > 0).length,
        supplyDryDrive,
        perTopic,
      },
    };
  }
  return { world: { census: world.census, shape: 'current' }, results };
}

function renderWovenSeatedMarkdown(sim, label) {
  const lines = [];
  lines.push('# Woven SEATED-members simulation — route mode (follow-up to composer v3.1, commit F)');
  lines.push('');
  lines.push(
    `Composer: ${label ?? 'working tree'} · synthetic shelf, current depth (${sim.world.census} units), seeded; ` +
      'the standard 40-drive commute battery with the heard-aware window and story-level heard (v3.1 A+B) underneath. ' +
      "Same world, eligibility draws and union thread detection as commit F's `--woven` run; the climax-only rows below " +
      "rerun F's model at the same eligibilities and reproduce grade-woven-sim.md's numbers. " +
      'Guarantee pass is shelf-only (silence is an upper bound vs production).',
  );
  lines.push('');
  lines.push(
    'THE MODEL — woven members seated in-episode: after F\'s climax post-pass, unheard eligible woven units ' +
      'on the detected thread topic seat as windowless inserts, strongest first, one telling per place, each placed ' +
      'at the start of the largest silent gap it fits entirely inside (idealized placement — inserts never displace ' +
      'sounding geo material in the sim; the caps stand in for the displacement cost). Seconds-capped configurations ' +
      'bound TOTAL woven story-seconds (the climax insert counts) at 25% / 40% of the episode budget — the same ' +
      'budgetSec the silence share is measured against; the count configuration bounds members at 4 per episode ' +
      '(climax not counted). Seated members are played, hence heard: they burn the woven pool, tracked per topic below. ' +
      "Inherited from F unchanged: thread detection over (corridor pool ∪ woven pool), and the thread's selection " +
      'nudge on corridor picks is not re-modeled, so tiling is the standard build\'s.',
  );
  lines.push('');
  const zero = sim.results['0%'].summary;
  lines.push(
    `HEADLINE — substantive thread-bearing episodes (silence ≤ 50% AND a thread found) across 40 drives, ` +
      `vs the 0% run's ${zero.substantiveThreadEpisodes} and F's climax-only best of 9:`,
  );
  lines.push('');
  lines.push('| configuration | eligible units | substantive thread-bearing | substantive episodes | substantive-thread starvation | thread drives /40 | climax /40 | mean silence | mean consecutive overlap | woven burned (units / sec) | members seated | woven supply-dry drive |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const key of Object.keys(sim.results)) {
    const r = sim.results[key];
    const s = r.summary;
    const b = r.burn;
    lines.push(
      `| ${key} | ${r.eligibleUnits} | ${s.substantiveThreadEpisodes} | ${s.substantiveEpisodes} | ` +
        `${s.substantiveStarvationDrive ?? 'none in 40'} | ${s.threadDrives} | ${s.climaxDrives} | ` +
        `${fmtPct(s.meanSilenceShare)} | ${s.meanConsecutiveOverlap} | ${b.totalWovenUnits} / ${b.totalWovenSec} | ` +
        `${b.totalMembers} | ${b.supplyDryDrive ?? 'none in 40'} |`,
    );
  }
  lines.push('');
  const s25a = sim.results['seated-25% audit'];
  const s40a = sim.results['seated-40% audit'];
  const m4f = sim.results['seated-max4 50%'];
  const m4a = sim.results['seated-max4 audit'];
  const cappedMembers = Math.min(
    s25a.burn.totalMembers, sim.results['seated-25% 50%'].burn.totalMembers,
    s40a.burn.totalMembers, sim.results['seated-40% 50%'].burn.totalMembers,
  );
  const cappedMembersMax = Math.max(
    s25a.burn.totalMembers, sim.results['seated-25% 50%'].burn.totalMembers,
    s40a.burn.totalMembers, sim.results['seated-40% 50%'].burn.totalMembers,
  );
  const coastM4a = m4a.burn.perTopic['Coast'];
  lines.push(
    'HONEST READING — seating scales substance only when woven seconds are allowed to become the episode\'s ' +
      'majority material; capped below that, it buys fullness, not episodes. ' +
      '(1) THE SECONDS CAPS FAIL THE HEADLINE METRIC FOR AN ARITHMETIC REASON: a substantive episode needs ' +
      '≥1,200 covered seconds of the 2,400 budget, and in a corridor-dead drive (geo coverage ≈ 0) a 25% cap ' +
      `(600 woven seconds) or a 40% cap (960) can never reach that line — substantive thread-bearing episodes ` +
      `stay ${s25a.summary.substantiveThreadEpisodes} at both caps and both eligibilities, exactly F's climax-only ` +
      `count, even though members seat on most drives (${cappedMembers}–${cappedMembersMax} members burned across ` +
      `the capped runs) and mean silence falls to ${fmtPct(s25a.summary.meanSilenceShare)} / ` +
      `${fmtPct(s40a.summary.meanSilenceShare)}. The capped models make dead drives less dark (1 story → 2–4), never episodes. ` +
      '(2) THE 4-MEMBER CONFIGURATION SCALES: substantive thread-bearing episodes rise to ' +
      `${m4f.summary.substantiveThreadEpisodes} (flat 50%) and ${m4a.summary.substantiveThreadEpisodes} (audit) of 40 — ` +
      `every substantive episode thread-bearing, no substantive-thread starvation in 40, mean silence ` +
      `${fmtPct(m4f.summary.meanSilenceShare)} / ${fmtPct(m4a.summary.meanSilenceShare)}. The price is in the burn ` +
      `tables: ~4.3 woven units per drive (${m4a.burn.totalWovenUnits} of ${m4a.eligibleUnits} eligible units across ` +
      '40 drives in the audit run), and in dead drives woven supplies ~1,100–1,450 of the 2,400 budget seconds — ' +
      'nearly all of the covered story time. The geo spine becomes the frame, not the content. ' +
      '(3) THE WOVEN CLIFF, AS A HARD EVENT, DOES NOT ARRIVE IN 40 DRIVES: no topic\'s pool empties ' +
      `(deepest burn: Coast ${coastM4a.consumedUnits} of ${coastM4a.eligibleUnits} audit-eligible) and no detected ` +
      'thread ever finds zero woven supply — detection rotates topics as pools thin. What arrives instead is a ' +
      'DURATION FADE: strongest-first seating spends the county\'s long stories first, so a five-story woven ' +
      'bundle sums to ~1,250 story-seconds around drives 28–30 but only ~730 by drive 40 (flat 50%), and ' +
      'substance lapses drive-by-drive from ~drive 31; the audit pool\'s deeper per-topic benches hold substance ' +
      'to drive 39, with dips. The binding resource is the pool\'s LONG stratum, not its unit count. ' +
      '(4) CONSEQUENCE FOR THE DESIGN QUESTION: a production seating rule must cap members by count (as ' +
      'simulated), or set any seconds cap above ~50% of budget for exhausted drives (arithmetic from the ' +
      'substance line — not itself simulated); a 25–40% cap spends woven stories on fullness. And if a woven ' +
      'tranche is ever bought, its value concentrates in LONG stories on the topics this commute burned ' +
      'deepest (Coast, Navy Century, Food & Drink — see the burn tables). The distinctness column inherits ' +
      'F\'s caveat: past the corridor\'s life it is exhaustion arithmetic, not an episode-diversity measure.',
  );
  lines.push('');
  lines.push('## Woven pool burn, per configuration and topic');
  lines.push('');
  for (const key of Object.keys(sim.results)) {
    const r = sim.results[key];
    const topics = Object.keys(r.burn.perTopic);
    lines.push(`### ${key} (${r.eligibleUnits} eligible units)`);
    lines.push('');
    if (topics.length === 0) {
      lines.push('No woven units consumed.');
      lines.push('');
      continue;
    }
    lines.push('| thread topic | eligible units (topic-tagged) | consumed | consumed sec | pool dry after drive |');
    lines.push('|---|---|---|---|---|');
    for (const t of topics) {
      const p = r.burn.perTopic[t];
      lines.push(
        `| ${t} | ${p.eligibleUnits} | ${p.consumedUnits} | ${p.consumedSec} | ${p.dryAfterDrive ?? 'not in 40'} |`,
      );
    }
    lines.push('');
    lines.push(
      `Totals: ${r.burn.totalWovenUnits} woven units (${r.burn.totalWovenSec} story-seconds), ` +
        `${r.burn.totalMembers} of them seated members, across ${r.burn.drivesWithMembers} drives with members; ` +
        `first drive a detected thread found zero unheard woven units on its topic: ${r.burn.supplyDryDrive ?? 'none in 40'}.`,
    );
    lines.push('');
  }
  for (const key of Object.keys(sim.results)) {
    const r = sim.results[key];
    lines.push(`## ${key} (${r.eligibleUnits} eligible units)`);
    lines.push('');
    lines.push('| drive | stories | silence | thread | members | climax |');
    lines.push('|---|---|---|---|---|---|');
    for (const d of r.drives) {
      lines.push(
        `| ${d.drive} | ${d.stories} | ${fmtPct(d.silenceShare)} | ${d.threadTopic ?? '—'} | ` +
          `${d.membersSeated} | ${d.climaxPresent ? (d.climaxViaWoven ? 'woven' : 'yes') : '—'} |`,
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

// ------------------------------------------------------------ woven seated members — PRODUCTION (Nov 4, 2026)
//
// The seated-members simulation above justified the build;
// this battery is its ACCEPTANCE: the same 40-drive commute
// at current depth and the same audit eligibility draw (seed
// 9200, per-topic measured usable shares — 473 eligible
// units), but the plans come from the PRODUCTION pipeline
// end to end — runBuild mirrors App.buildRoute's staging
// (fetch → compose with woven thread support → the ONE
// portal-climax re-compose → shelf-only guarantee →
// rm.seatWovenMembers) with no sim-side post-pass anywhere.
// The member-fetch lever (later the same day) extends the
// staging it mirrors: index-level thread support in every
// compose, and the ONE bounded member fetch + re-compose
// when a plan seeks members — this battery is the lever's
// acceptance too, against the pre-lever run's 13.
// The eligibility marks ride the world units themselves
// (unit.wovenEligible), exactly as the App bakes them from
// the bundled presence data. Fresh-drive spot checks
// (tourist / hop / commute drive 1) run on the same marked
// world so the feature's effect on a first drive is on the
// record beside the repeat-commute headline.

export async function runWovenProduction(mods, { drives: driveCount = 40 } = {}) {
  const { rm } = mods;
  const world = buildWorld(1103, 'current');
  const eligible = wovenEligibleUnits(world, 'commute', { audit: true }, 9200);
  const eligibleIds = new Set(eligible.map(u => u.id));
  for (const u of world.unitsById.values()) {
    if (eligibleIds.has(u.id)) u.wovenEligible = true;
  }
  const route = world.routes.commute;
  const input = { destinationText: route.destName, arrivalTimeMs: null, tone: null, topics: [] };

  // Fresh drives on the marked world (empty ledgers).
  const fresh = {};
  for (const routeName of ['tourist', 'hop', 'commute']) {
    const r = world.routes[routeName];
    const build = await runBuild(mods, world, r, {
      heardNames: new Set(),
      heardTexts: new Set(),
      driveRecords: [],
      input: { destinationText: r.destName, arrivalTimeMs: null, tone: null, topics: [] },
      nowMs: BASE_NOW,
    });
    const m = planMetrics(build.plan, { driveSec: r.driveSec, climaxPool: null });
    fresh[routeName] = {
      stories: m.stories,
      silenceSec: m.silenceSec,
      silenceShare: m.silenceShare,
      threadTopic: m.threadTopic,
      climaxPresent: m.climaxPresent,
      members: build.plan.wovenMembers?.count ?? 0,
      memberFetch: build.memberFetch ?? null,
      threadCarried: build.plan.threadCarried
        ? {
            active: build.plan.threadCarried.active,
            geoCoverageFraction: Math.round(build.plan.threadCarried.geoCoverageFraction * 1000) / 1000,
            memberCap: build.plan.threadCarried.memberCap,
          }
        : null,
    };
  }

  const heardNames = new Set();
  const heardTexts = new Set();
  let records = [];
  const drives = [];
  const episodeSets = [];
  let totalMembers = 0;
  for (let d = 0; d < driveCount; d++) {
    const nowMs = BASE_NOW + d * 24 * 60 * 60 * 1000;
    const build = await runBuild(mods, world, route, {
      heardNames,
      heardTexts,
      driveRecords: records,
      input,
      nowMs,
    });
    const plan = build.plan;
    const metrics = planMetrics(plan, { driveSec: route.driveSec, climaxPool: null });
    const played = plan.items.filter(i => i.kind === 'story' && i.unit);
    episodeSets.push(new Set(played.map(i => i.unit.id)));
    const members = plan.wovenMembers?.count ?? 0;
    totalMembers += members;
    drives.push({
      drive: d + 1,
      stories: metrics.stories,
      silenceShare: metrics.silenceShare,
      threadTopic: plan.thread?.topic ?? null,
      climaxPresent: metrics.climaxPresent,
      climaxMode: metrics.climaxMode,
      members,
      memberFetch: build.memberFetch ?? null,
      fetchReads: build.fetchStats.reads,
      ceilingHit: build.fetchStats.ceilingHit,
      threadCarried: plan.threadCarried
        ? {
            active: plan.threadCarried.active,
            geoCoverageFraction: Math.round(plan.threadCarried.geoCoverageFraction * 1000) / 1000,
            memberCap: plan.threadCarried.memberCap,
          }
        : null,
    });
    for (const it of played) {
      heardNames.add(it.unit.placeName);
      if (it.unit.storyText) heardTexts.add(it.unit.storyText);
    }
    records = [
      {
        destinationName: route.destName,
        destinationPlaceKey: route.destPlaceKey,
        threadTopic: plan.thread?.topic ?? null,
        playedSubjects: [...new Set(played.map(i => i.unit.placeName))],
        owedSubjects: [],
        endedAt: nowMs,
      },
      ...records,
    ].slice(0, 20);
  }
  const substantive = drives.filter(d => d.silenceShare <= 0.5);
  const starvation = substantiveThreadStarvation(drives);
  // The lever's funnel (Nov 4, 2026): where the member fetch
  // fired, what it cost, and what it returned — split at the
  // pre-lever battery's phase boundary (drives 1–13 succeeded
  // on geo substance; 14–40 starved).
  const phase = list => ({
    drives: list.length,
    threadDrives: list.filter(d => d.threadTopic !== null).length,
    substantiveThread: list.filter(d => d.silenceShare <= 0.5 && d.threadTopic !== null).length,
    members: list.reduce((s, d) => s + d.members, 0),
    memberFetches: list.filter(d => d.memberFetch).length,
    memberReads: list.reduce((s, d) => s + (d.memberFetch?.reads ?? 0), 0),
    memberCandidates: list.reduce((s, d) => s + (d.memberFetch?.candidates ?? 0), 0),
    departureReads: list.reduce((s, d) => s + d.fetchReads, 0),
    ceilingHits: list.filter(d => d.ceilingHit).length,
  });
  // Thread-carried bands (Nov 4, 2026): where the mode
  // engaged across the battery's own phases — the geo-
  // healthy head (1–13, must never fire), the thinning
  // shoulder (14–16), the member-arithmetic band (17–21),
  // and the exhausted tail (22–40) the rule was built for.
  const band = list => ({
    ...phase(list),
    carriedFires: list.filter(d => d.threadCarried?.active).length,
    carriedClimaxes: list.filter(d => d.climaxMode === 'thread').length,
    meanSilenceShare:
      list.length === 0
        ? 0
        : Math.round((list.reduce((s, d) => s + d.silenceShare, 0) / list.length) * 1000) / 1000,
  });
  return {
    world: { census: world.census, shape: 'current' },
    eligibleUnits: eligible.length,
    fresh,
    drives,
    summary: {
      substantiveThreadEpisodes: substantive.filter(d => d.threadTopic !== null).length,
      substantiveEpisodes: substantive.length,
      substantiveStarvationDrive: starvation.starvationDrive,
      threadDrives: drives.filter(d => d.threadTopic !== null).length,
      climaxDrives: drives.filter(d => d.climaxPresent).length,
      meanSilenceShare:
        Math.round((drives.reduce((s, d) => s + d.silenceShare, 0) / drives.length) * 1000) / 1000,
      meanConsecutiveOverlap: meanConsecutiveOverlap(episodeSets),
      totalMembers,
      drivesWithMembers: drives.filter(d => d.members > 0).length,
      minStories: Math.min(...drives.map(d => d.stories)),
      lastDriveStories: drives[drives.length - 1].stories,
      funnel: {
        early: phase(drives.slice(0, 13)),
        late: phase(drives.slice(13)),
        all: phase(drives),
      },
      carried: {
        fires: drives.filter(d => d.threadCarried?.active).length,
        climaxes: drives.filter(d => d.climaxMode === 'thread').length,
        bands: {
          head: band(drives.slice(0, 13)),
          shoulder: band(drives.slice(13, 16)),
          arithmetic: band(drives.slice(16, 21)),
          tail: band(drives.slice(21)),
        },
      },
    },
  };
}

function renderWovenProductionMarkdown(prod, label) {
  const lines = [];
  lines.push('# Woven seated members + thread-carried episodes — PRODUCTION acceptance (route mode)');
  lines.push('');
  lines.push(
    `Composer: ${label ?? 'working tree'} · synthetic shelf, current depth (${prod.world.census} units), seeded; ` +
      'the standard 40-drive commute battery with the heard-aware window and story-level heard (v3.1 A+B) underneath. ' +
      `Eligibility: the presence audit's measured per-topic usable shares (seed 9200) — ${prod.eligibleUnits} eligible units, ` +
      'marked on the world units (unit.wovenEligible) and consulted by the PRODUCTION composer + seating passes ' +
      '(runBuild mirrors App.buildRoute staging end to end — guarantee, normal seating, the thread-carried ' +
      'assessment and its anchoring top-up; no sim post-pass). Guarantee pass is shelf-only ' +
      '(silence is an upper bound vs production).',
  );
  lines.push('');
  const s = prod.summary;
  lines.push(
    `HEADLINE — substantive thread-bearing episodes (silence ≤ 50% AND a thread found) across 40 drives: ` +
      `**${s.substantiveThreadEpisodes}** (the seated-members SIMULATION predicted 26 at this eligibility; ` +
      `climax-only production-equivalent is 9; the PRE-LEVER production run scored 13; the LEVER run scored 16). ` +
      `Substantive episodes ${s.substantiveEpisodes}, ` +
      `substantive-thread starvation ${s.substantiveStarvationDrive ?? 'none in 40'}, thread drives ${s.threadDrives}/40, ` +
      `climax ${s.climaxDrives}/40, mean silence ${fmtPct(s.meanSilenceShare)} (sim: 41%), ` +
      `members seated ${s.totalMembers} across ${s.drivesWithMembers} drives, mean consecutive overlap ${s.meanConsecutiveOverlap}. ` +
      (s.carried
        ? `Thread-carried engaged on ${s.carried.fires}/40 drives (${s.carried.climaxes} designated member climaxes).`
        : ''),
  );
  lines.push('');
  if (s.funnel) {
    const f = s.funnel;
    lines.push('## The lever funnel — member fetch, by phase');
    lines.push('');
    lines.push(
      'Pre-lever, drives 1–13 succeeded on geo substance and drives 14–40 starved (thread detection and member ' +
        'candidacy saw only the fetched set). The lever counts thread support from the county index and answers a ' +
        'short-handed thread with ONE bounded member fetch per build.',
    );
    lines.push('');
    lines.push('| phase | thread drives | substantive thread-bearing | members seated | member fetches | member reads | candidates returned | departure reads | departure ceiling hits |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    const row = (label, p) =>
      `| ${label} | ${p.threadDrives}/${p.drives} | ${p.substantiveThread} | ${p.members} | ${p.memberFetches} | ${p.memberReads} | ${p.memberCandidates} | ${p.departureReads} | ${p.ceilingHits} |`;
    lines.push(row('drives 1–13', f.early));
    lines.push(row('drives 14–40', f.late));
    lines.push(row('all 40', f.all));
    lines.push('');
  }
  if (s.carried) {
    const c = s.carried;
    lines.push('## Thread-carried — the exhausted-case rule, by band');
    lines.push('');
    lines.push(
      'The floor predicate: post-guarantee geo-anchored coverage (stories + guarantee fills, members excluded) ' +
        'under 50% of the drive, with a thread present. In mode, members anchor the episode (departure edge open), ' +
        'the cap rises to 8 total, and the strongest member takes the climax position when the road crowned none. ' +
        'The geo-healthy head (drives 1–13) must never fire; the tail (22–40) is the case the rule was built for.',
    );
    lines.push('');
    lines.push('| band | thread drives | carried fires | member climaxes | substantive thread-bearing | members seated | member reads | mean silence |');
    lines.push('|---|---|---|---|---|---|---|---|');
    const crow = (label, b) =>
      `| ${label} | ${b.threadDrives}/${b.drives} | ${b.carriedFires} | ${b.carriedClimaxes} | ${b.substantiveThread} | ${b.members} | ${b.memberReads} | ${fmtPct(b.meanSilenceShare)} |`;
    lines.push(crow('drives 1–13 (geo-healthy head)', c.bands.head));
    lines.push(crow('drives 14–16 (thinning shoulder)', c.bands.shoulder));
    lines.push(crow('drives 17–21 (member arithmetic)', c.bands.arithmetic));
    lines.push(crow('drives 22–40 (exhausted tail)', c.bands.tail));
    lines.push('');
  }
  lines.push('## Fresh drives on the marked world (vs grade-after-addendum-b, unmarked)');
  lines.push('');
  lines.push('| route | stories | silence | thread | members | carried |');
  lines.push('|---|---|---|---|---|---|');
  for (const [name, f] of Object.entries(prod.fresh)) {
    lines.push(
      `| ${name} | ${f.stories} | ${f.silenceSec}s (${fmtPct(f.silenceShare)}) | ${f.threadTopic ?? '—'} | ${f.members} | ${f.threadCarried?.active ? 'FIRED' : '—'} |`,
    );
  }
  lines.push('');
  lines.push('## The 40 drives');
  lines.push('');
  lines.push('| drive | stories | silence | thread | members | climax | carried |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const d of prod.drives) {
    lines.push(
      `| ${d.drive} | ${d.stories} | ${fmtPct(d.silenceShare)} | ${d.threadTopic ?? '—'} | ${d.members} | ${d.climaxPresent ? d.climaxMode ?? 'yes' : '—'} | ${d.threadCarried?.active ? `yes (${fmtPct(d.threadCarried.geoCoverageFraction)})` : '—'} |`,
    );
  }
  lines.push('');
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
  if (argv.includes('--woven-seated')) {
    // The woven SEATED-members battery (follow-up to commit
    // F, approved by Erik Nov 4, 2026): 40-drive commute,
    // climax-only reruns at both eligibilities plus seated
    // members under 25% / 40% seconds caps and a 4-member
    // cap. Writes grade-woven-seated.json/.md unless --out
    // says otherwise.
    const sim = await runWovenSeatedSimulation(mods);
    const seatedReport = {
      generatedBy: 'scripts/route-mode/grader.mjs --woven-seated',
      generatedAt: new Date().toISOString(),
      label,
      world: sim.world,
      results: sim.results,
    };
    const seatedPrefix = argOf('--out') ?? 'grade-woven-seated';
    writeFileSync(join(here, `${seatedPrefix}.json`), JSON.stringify(seatedReport, null, 2));
    writeFileSync(join(here, `${seatedPrefix}.md`), renderWovenSeatedMarkdown(sim, label));
    console.log(`grader (woven-seated): wrote ${seatedPrefix}.json + ${seatedPrefix}.md (composer ${label ?? '?'})`);
    for (const [key, r] of Object.entries(sim.results)) {
      const s = r.summary;
      console.log(
        `  ${key}: substantive thread-bearing ${s.substantiveThreadEpisodes} ` +
          `(substantive ${s.substantiveEpisodes}), substantive starvation ${s.substantiveStarvationDrive ?? 'none in 40'}, ` +
          `thread ${s.threadDrives}/40, climax ${s.climaxDrives}/40, woven burned ${r.burn.totalWovenUnits}u/${r.burn.totalWovenSec}s ` +
          `(members ${r.burn.totalMembers}), overlap ${s.meanConsecutiveOverlap}, silence ${fmtPct(s.meanSilenceShare)}`,
      );
    }
    return;
  }
  if (argv.includes('--woven-production')) {
    // The production acceptance battery for woven seated
    // members (Nov 4, 2026): the 40-drive commute through the
    // production pipeline at audit eligibility. Writes
    // grade-woven-production.json/.md unless --out says
    // otherwise.
    const prod = await runWovenProduction(mods);
    const prodReport = {
      generatedBy: 'scripts/route-mode/grader.mjs --woven-production',
      generatedAt: new Date().toISOString(),
      label,
      world: prod.world,
      eligibleUnits: prod.eligibleUnits,
      fresh: prod.fresh,
      drives: prod.drives,
      summary: prod.summary,
    };
    const prodPrefix = argOf('--out') ?? 'grade-woven-production';
    writeFileSync(join(here, `${prodPrefix}.json`), JSON.stringify(prodReport, null, 2));
    writeFileSync(join(here, `${prodPrefix}.md`), renderWovenProductionMarkdown(prod, label));
    console.log(`grader (woven production): wrote ${prodPrefix}.json + ${prodPrefix}.md (composer ${label ?? '?'})`);
    const s = prod.summary;
    console.log(
      `  production seated: substantive thread-bearing ${s.substantiveThreadEpisodes}/40 (sim predicted 26), ` +
        `substantive ${s.substantiveEpisodes}, starvation ${s.substantiveStarvationDrive ?? 'none in 40'}, ` +
        `thread ${s.threadDrives}/40, climax ${s.climaxDrives}/40, silence ${fmtPct(s.meanSilenceShare)}, ` +
        `members ${s.totalMembers} over ${s.drivesWithMembers} drives, overlap ${s.meanConsecutiveOverlap}`,
    );
    if (s.funnel) {
      const f = s.funnel;
      console.log(
        `  lever funnel: member fetches ${f.all.memberFetches} (${f.all.memberReads} reads → ${f.all.memberCandidates} candidates); ` +
          `early (1–13): thread ${f.early.threadDrives}/13, substantive-thread ${f.early.substantiveThread}, members ${f.early.members}; ` +
          `late (14–40): thread ${f.late.threadDrives}/27, substantive-thread ${f.late.substantiveThread}, members ${f.late.members}; ` +
          `departure ceiling hits ${f.all.ceilingHits}/40`,
      );
    }
    for (const [name, f] of Object.entries(prod.fresh)) {
      console.log(
        `  fresh ${name}: stories ${f.stories}, silence ${f.silenceSec}s, thread ${f.threadTopic ?? '—'}, members ${f.members}`,
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
