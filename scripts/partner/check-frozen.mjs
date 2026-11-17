// Frozen-set drift check: compare every partner's approved
// (frozen) story pins against LIVE shelf rows and flag drift —
// a row that vanished, an audio_path that moved (the signature
// of a library swap re-render), or text that changed under a
// pin that recorded a text hash. This is the check that makes
// "the approved set is immune to library batches" a tested
// property instead of an intention: a batch that touches a
// frozen row shows up here before the partner hears it.
//
// Usage: node scripts/partner/check-frozen.mjs
// Exit 0 = no drift; exit 1 = drift found (details on stdout).

import { loadPartnerTools, loadAnon, fetchLiveRows } from './lib-partner.mjs';

const tools = await loadPartnerTools();
const anon = await loadAnon();

const unitIds = [...new Set(tools.PARTNERS.flatMap(p => p.approvedStories.map(s => s.unitId)))];
const rows = await fetchLiveRows(anon, unitIds);
const live = new Map([...rows.entries()].map(([id, r]) => [id, { audioPath: r.audioPath, storyText: r.storyText }]));

const drift = tools.checkFrozenSets(tools.PARTNERS, live);
const totalPins = tools.PARTNERS.reduce((n, p) => n + p.approvedStories.length, 0);
console.log(`frozen-set check: ${tools.PARTNERS.length} partner(s), ${totalPins} pinned stor${totalPins === 1 ? 'y' : 'ies'}`);
for (const p of tools.PARTNERS) {
  console.log(`  ${p.id} (${p.status}): ${p.approvedStories.length} pinned`);
}
if (drift.length === 0) {
  console.log('no drift — every pinned story matches its live row');
  process.exit(0);
}
console.log(`DRIFT: ${drift.length} entr${drift.length === 1 ? 'y' : 'ies'}`);
for (const d of drift) {
  console.log(`  [${d.kind}] partner=${d.partnerId} unit=${d.unitId}`);
  console.log(`      expected: ${d.expected ?? '(none)'}`);
  console.log(`      actual:   ${d.actual ?? '(missing)'}`);
}
process.exit(1);
