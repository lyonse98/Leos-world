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
// (selectFetchCandidates → composeRoutePlan → the ONE portal-
// climax re-compose → fillRouteGaps) with the guarantee pass
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
      storyText: null,
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
async function runBuild({ rm, gf, rh }, world, route, { heardNames, driveRecords, input, nowMs }) {
  const tagsOf = (pk, ang) => {
    const u = world.unitsById.get(`${pk}|${ang}`);
    return { topics: u ? u.topics : [] };
  };
  const fetchSet = rm.selectFetchCandidates(world.index, route.path, route.dest, tagsOf, {
    userTopics: input.topics,
  });
  const units = fetchSet
    .map(e => world.unitsById.get(`${e.place_key}|${e.angle}`))
    .filter(Boolean);
  const heardKeys = new Set(units.filter(u => heardNames.has(u.placeName)).map(u => u.id));
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
    const fetchedIds = new Set(fetchSet.map(e => `${e.place_key}|${e.angle}`));
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
      .filter(u => u && !heardNames.has(u.placeName));
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
  return { plan, units, climaxOnlyUnits, heardKeys };
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
    // heard ledger (name-based, exactly like the App's) and a
    // growing drive-record store feeding the next build.
    const route = world.routes.commute;
    const input = { destinationText: route.destName, arrivalTimeMs: null, tone: null, topics: [] };
    const heardNames = new Set();
    let records = [];
    const drives = [];
    const seenPlaces = new Set();
    for (let d = 0; d < 20; d++) {
      const nowMs = BASE_NOW + d * 24 * 60 * 60 * 1000;
      const build = await runBuild(mods, world, route, {
        heardNames,
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
      drives.push({ drive: d + 1, ...metrics, cumulativePlaces: seenPlaces.size });
      for (const it of played) heardNames.add(it.unit.placeName);
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
