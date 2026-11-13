// Episode capture — live read-back verifier (Nov 4, 2026).
//
// Proves capture end-to-end against the PUBLISHED app: reads
// the latest route_episodes rows with the app's own anon key
// (extracted from the live bundle exactly as the library
// tooling does — key values are never printed), validates the
// payload shape against the capture spec, and prints a
// compact summary per row.
//
// Payload schemas: 1 = the original full-settle capture
// (plan row at full settle, no render_results); 2 = the
// render-ahead pipeline (plan row at OPENING settle with every
// text; outcome row carries per-item render_results and
// render_queue_drained_ms). Both are valid history; the
// validators below are also exported for the route harness's
// fixture checks (importing this file does not run the live
// read-back).
//
// Schema-2 outcomes may also carry commissions[] (drop
// coherence, Nov 4, 2026): the re-bridges authored at drive
// time when a story dropped stale — pseudo-items with their
// full text and a verdict each. The field is optional: rows
// written before the mechanism shipped simply omit it.
//
// Usage: node scripts/route-mode/verify-episode-capture.mjs [rows]
// Exit 0 = rows read + shape-valid. Exit 2 = the route_episodes
// table does not exist yet (SQL not pasted). Exit 1 = other
// failure (no key, bad shape, network).

import { pathToFileURL } from 'node:url';

const SITE = 'https://miles-dbky.bolt.host';

async function fetchText(url, headers = {}) {
  const res = await fetch(url, { headers });
  return { ok: res.ok, status: res.status, text: () => res.text() };
}

async function loadAnonKey() {
  const html = await (await fetchText(SITE)).text();
  const m = html.match(/assets\/index-[A-Za-z0-9_-]+\.js/);
  if (!m) throw new Error('live bundle path not found in site HTML');
  const js = await (await fetchText(`${SITE}/${m[0]}`)).text();
  const urlM = js.match(/https:\/\/[a-z0-9]+\.supabase\.co/);
  if (!urlM) throw new Error('supabase URL not found in live bundle');
  const jwts = [...new Set(js.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g) || [])];
  for (const j of jwts) {
    try {
      const payload = JSON.parse(Buffer.from(j.split('.')[1], 'base64url').toString('utf8'));
      if (payload.role === 'anon') return { supabaseUrl: urlM[0], anonKey: j };
    } catch {
      /* not a JWT we care about */
    }
  }
  throw new Error('Supabase anon key not found in live bundle');
}

const RENDER_RESULTS = new Set(['pre-start', 'ahead', 'skipped-late', 'failed', 'pending']);
const COMMISSION_RESULTS = new Set(['sounded', 'skipped-late', 'failed', 'discarded-cap', 'pending']);
const COMMISSION_VIAS = new Set(['suppression', 'gate']);

export function validatePlan(p) {
  const problems = [];
  if (p.schema !== 1 && p.schema !== 2) problems.push(`schema ${p.schema} not in {1, 2}`);
  if (!Array.isArray(p.items)) problems.push('items not an array');
  else {
    for (const [i, it] of p.items.entries()) {
      if (typeof it.index !== 'number' || it.index !== i) problems.push(`items[${i}].index mismatch`);
      if (typeof it.id !== 'string' || !it.id) problems.push(`items[${i}].id missing`);
      if (!(typeof it.text === 'string' || it.text === null)) problems.push(`items[${i}].text not string|null`);
      // Short-cut version fields (optional — plan rows
      // written before the wiring shipped omit them).
      if (it.version !== undefined) {
        if (it.version !== 'full' && it.version !== 'short') problems.push(`items[${i}].version '${it.version}' unknown`);
        if (it.version === 'short' && typeof it.versionOf !== 'string') problems.push(`items[${i}].versionOf missing on a short item`);
        if (it.version === 'full' && it.versionOf !== null && it.versionOf !== undefined) problems.push(`items[${i}].versionOf set on a full item`);
      }
    }
    if (p.short_cut_pieces !== undefined && typeof p.short_cut_pieces !== 'number') {
      problems.push('short_cut_pieces not a number');
    }
  }
  if (!p.route_plan_started || typeof p.route_plan_started !== 'object') problems.push('route_plan_started missing');
  else if (!p.route_plan_started.decisions) problems.push('route_plan_started.decisions missing');
  if (!p.stage_timings_ms || typeof p.stage_timings_ms.total !== 'number') problems.push('stage_timings_ms.total missing');
  if (typeof p.tour_id !== 'string' || !p.tour_id) problems.push('tour_id missing');
  return problems;
}

export function validateOutcome(p) {
  const problems = [];
  if (p.schema !== 1 && p.schema !== 2) problems.push(`schema ${p.schema} not in {1, 2}`);
  if (typeof p.end_reason !== 'string' || !p.end_reason) problems.push('end_reason missing');
  if (!Array.isArray(p.played)) problems.push('played not an array');
  if (!Array.isArray(p.dropped)) problems.push('dropped not an array');
  if (typeof p.driven !== 'boolean') problems.push('driven not a boolean');
  if (p.schema === 2) {
    if (!Array.isArray(p.render_results)) problems.push('render_results not an array (schema 2)');
    else {
      for (const [i, r] of p.render_results.entries()) {
        if (typeof r.index !== 'number') problems.push(`render_results[${i}].index not a number`);
        if (typeof r.id !== 'string' || !r.id) problems.push(`render_results[${i}].id missing`);
        if (!RENDER_RESULTS.has(r.result)) problems.push(`render_results[${i}].result '${r.result}' unknown`);
      }
    }
    if (!(typeof p.render_queue_drained_ms === 'number' || p.render_queue_drained_ms === null)) {
      problems.push('render_queue_drained_ms not number|null (schema 2)');
    }
    // Drop-coherence commissions (optional — rows written
    // before the mechanism shipped omit the field entirely).
    if (p.commissions !== undefined) {
      if (!Array.isArray(p.commissions)) problems.push('commissions not an array (schema 2)');
      else {
        for (const [i, c] of p.commissions.entries()) {
          if (typeof c.id !== 'string' || !c.id) problems.push(`commissions[${i}].id missing`);
          if (typeof c.for_story_id !== 'string' || !c.for_story_id) problems.push(`commissions[${i}].for_story_id missing`);
          if (!(typeof c.prev_story_id === 'string' || c.prev_story_id === null)) problems.push(`commissions[${i}].prev_story_id not string|null`);
          if (typeof c.next_story_id !== 'string' || !c.next_story_id) problems.push(`commissions[${i}].next_story_id missing`);
          if (!COMMISSION_VIAS.has(c.via)) problems.push(`commissions[${i}].via '${c.via}' unknown`);
          if (!(typeof c.text === 'string' || c.text === null)) problems.push(`commissions[${i}].text not string|null`);
          if (!COMMISSION_RESULTS.has(c.result)) problems.push(`commissions[${i}].result '${c.result}' unknown`);
        }
      }
    }
  }
  return problems;
}

const IS_MAIN = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (!IS_MAIN) {
  // Imported (the route harness validates fixtures through
  // these validators) — the live read-back below must not run.
} else {
const LIMIT = Number(process.argv[2] ?? 5);
const { supabaseUrl, anonKey } = await loadAnonKey();
const res = await fetch(
  `${supabaseUrl}/rest/v1/route_episodes?select=id,tour_id,kind,build_id,created_at,payload&order=created_at.desc&limit=${LIMIT}`,
  { headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` } },
);
const body = await res.text();
if (!res.ok) {
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* leave null */
  }
  const msg = parsed?.message ?? body.slice(0, 200);
  if (/route_episodes/.test(msg) && /(does not exist|could not find|not found|undefined table|schema cache)/i.test(msg)) {
    console.log('route_episodes table does not exist yet — the SQL has not been pasted. Capture is inert until it is.');
    process.exit(2);
  }
  console.error(`read failed: HTTP ${res.status}: ${msg}`);
  process.exit(1);
}

const rows = JSON.parse(body);
if (rows.length === 0) {
  console.log('route_episodes exists but holds no rows yet — no captured episode since the table was created.');
  process.exit(0);
}

let bad = 0;
for (const row of rows) {
  const p = row.payload ?? {};
  const problems = row.kind === 'plan' ? validatePlan(p) : validateOutcome(p);
  if (problems.length) bad += 1;
  if (row.kind === 'plan') {
    const items = Array.isArray(p.items) ? p.items : [];
    const live = items.filter(i => i.textSource === 'live').length;
    const chars = items.reduce((n, i) => n + (typeof i.text === 'string' ? i.text.length : 0), 0);
    const kinds = items.reduce((acc, i) => ((acc[i.kind] = (acc[i.kind] ?? 0) + 1), acc), {});
    console.log(
      `${row.created_at} PLAN tour=${row.tour_id} build=${row.build_id} mode=${p.mode} dest="${p.destination_name}" ` +
        `items=${items.length} live=${live} chars=${chars} build_ms=${p.stage_timings_ms?.total} kinds=${JSON.stringify(kinds)}` +
        (problems.length ? ` PROBLEMS: ${problems.join('; ')}` : ' shape=ok'),
    );
  } else {
    const renders = Array.isArray(p.render_results)
      ? p.render_results.reduce((acc, r) => ((acc[r.result] = (acc[r.result] ?? 0) + 1), acc), {})
      : null;
    const commissions = Array.isArray(p.commissions)
      ? p.commissions.reduce((acc, c) => ((acc[c.result] = (acc[c.result] ?? 0) + 1), acc), {})
      : null;
    console.log(
      `${row.created_at} OUTCOME tour=${row.tour_id} build=${row.build_id} end=${p.end_reason} begun=${p.begun} ` +
        `played=${(p.played ?? []).length} dropped=${(p.dropped ?? []).length} driven=${p.driven} max_displacement_m=${p.max_displacement_m}` +
        (renders ? ` renders=${JSON.stringify(renders)} queue_drained_ms=${p.render_queue_drained_ms}` : '') +
        (commissions ? ` commissions=${JSON.stringify(commissions)}` : '') +
        (problems.length ? ` PROBLEMS: ${problems.join('; ')}` : ' shape=ok'),
    );
  }
}
console.log(`\n${rows.length} row(s) read; ${bad} with shape problems.`);
process.exit(bad === 0 ? 0 : 1);
}
