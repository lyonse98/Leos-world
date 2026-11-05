// Episode capture — live read-back verifier (Nov 4, 2026).
//
// Proves capture end-to-end against the PUBLISHED app: reads
// the latest route_episodes rows with the app's own anon key
// (extracted from the live bundle exactly as the library
// tooling does — key values are never printed), validates the
// payload shape against the capture spec, and prints a
// compact summary per row.
//
// Usage: node scripts/route-mode/verify-episode-capture.mjs [rows]
// Exit 0 = rows read + shape-valid. Exit 2 = the route_episodes
// table does not exist yet (SQL not pasted). Exit 1 = other
// failure (no key, bad shape, network).

const SITE = 'https://miles-dbky.bolt.host';
const LIMIT = Number(process.argv[2] ?? 5);

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

function validatePlan(p) {
  const problems = [];
  if (p.schema !== 1) problems.push('schema !== 1');
  if (!Array.isArray(p.items)) problems.push('items not an array');
  if (!p.route_plan_started || typeof p.route_plan_started !== 'object') problems.push('route_plan_started missing');
  else if (!p.route_plan_started.decisions) problems.push('route_plan_started.decisions missing');
  if (!p.stage_timings_ms || typeof p.stage_timings_ms.total !== 'number') problems.push('stage_timings_ms.total missing');
  if (typeof p.tour_id !== 'string' || !p.tour_id) problems.push('tour_id missing');
  return problems;
}

function validateOutcome(p) {
  const problems = [];
  if (p.schema !== 1) problems.push('schema !== 1');
  if (typeof p.end_reason !== 'string' || !p.end_reason) problems.push('end_reason missing');
  if (!Array.isArray(p.played)) problems.push('played not an array');
  if (!Array.isArray(p.dropped)) problems.push('dropped not an array');
  if (typeof p.driven !== 'boolean') problems.push('driven not a boolean');
  return problems;
}

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
    console.log(
      `${row.created_at} OUTCOME tour=${row.tour_id} build=${row.build_id} end=${p.end_reason} begun=${p.begun} ` +
        `played=${(p.played ?? []).length} dropped=${(p.dropped ?? []).length} driven=${p.driven} max_displacement_m=${p.max_displacement_m}` +
        (problems.length ? ` PROBLEMS: ${problems.join('; ')}` : ' shape=ok'),
    );
  }
}
console.log(`\n${rows.length} row(s) read; ${bad} with shape problems.`);
process.exit(bad === 0 ? 0 : 1);
