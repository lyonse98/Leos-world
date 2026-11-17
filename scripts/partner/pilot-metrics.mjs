// Pilot metrics aggregation (READS ONLY — capture schema is
// untouched): starts and sounded plays per partner place, from
// the trailing telemetry window the readable views expose
// (analytics_recent_events covers ~72 h; route_episodes is the
// episode ledger). A "start" is a story_played event (the story
// was committed to the tour); a "sounded" play is a
// story_playback event (audio actually began), with its
// sounded_ms as the heard-depth signal. Route episodes are
// counted when the partner's place key appears in the episode
// record.
//
// Usage: node scripts/partner/pilot-metrics.mjs
// Expect zeros while every partner is dormant — that is the
// honest pre-pilot state, printed as such.

import { loadPartnerTools, loadAnon } from './lib-partner.mjs';

const tools = await loadPartnerTools();
const { supabaseUrl, anonKey } = await loadAnon();
const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

async function getJson(path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return res.json();
}

const events = await getJson('analytics_recent_events?select=id,created_at,event_type,data&order=created_at.desc&limit=5000');
const episodes = await getJson('route_episodes?select=*&order=created_at.desc&limit=200').catch(() => []);

const norm = s => String(s ?? '').trim().toLowerCase();
const subjectKey = data => norm(data?.subject).replace(/^welcome:/, '');

const windowFrom = events.length ? events[events.length - 1].created_at : null;
const windowTo = events.length ? events[0].created_at : null;
console.log(`telemetry window: ${windowFrom ?? '(no events)'} → ${windowTo ?? ''} (${events.length} events, ${episodes.length} recent route episodes)`);

for (const partner of tools.PARTNERS) {
  const keys = new Set(partner.site.placeKeys.map(norm));
  const matches = e => keys.has(subjectKey(e.data));
  const starts = events.filter(e => e.event_type === 'story_played' && matches(e));
  const sounded = events.filter(e => e.event_type === 'story_playback' && matches(e));
  const tours = new Set(starts.map(e => e.data?.tour_id).filter(Boolean));
  const soundedMs = sounded.map(e => Number(e.data?.sounded_ms)).filter(n => Number.isFinite(n) && n > 0);
  const medianMs = soundedMs.length ? soundedMs.sort((a, b) => a - b)[Math.floor(soundedMs.length / 2)] : null;
  const episodeHits = episodes.filter(ep => {
    const text = JSON.stringify(ep).toLowerCase();
    return [...keys].some(k => text.includes(k));
  }).length;
  console.log('');
  console.log(`${partner.name} (\`${partner.id}\`, ${partner.status})`);
  console.log(`  places: ${partner.site.placeKeys.join(', ')}`);
  console.log(`  starts (story_played): ${starts.length} across ${tours.size} tour(s)`);
  console.log(`  sounded (story_playback): ${sounded.length}${medianMs != null ? `, median sounded ${Math.round(medianMs / 1000)} s` : ''}`);
  console.log(`  route episodes mentioning the place: ${episodeHits}`);
  if (partner.status === 'dormant') console.log('  note: dormant prospect — no pilot traffic is expected yet');
}
