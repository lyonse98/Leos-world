// Partner approval document: for every story in a partner's
// approved (frozen) set, emit title, place, full text, and
// duration as Markdown — the document a partner signs off on
// before their set goes active. Text comes from LIVE shelf rows,
// so what they approve is what is on the shelf today.
//
// Usage:
//   node scripts/partner/export-transcripts.mjs <partner-id> [--out <file.md>]
// With no --out, the document goes to stdout.
// Exit 1 when the partner id is unknown, or a pinned story is
// missing live (that drift must be resolved before sign-off).

import { writeFileSync } from 'node:fs';
import { loadPartnerTools, loadAnon, fetchLiveRows, measuredDurationSec } from './lib-partner.mjs';

const args = process.argv.slice(2);
const partnerId = args.find(a => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outPath = outIdx >= 0 ? args[outIdx + 1] : null;
if (!partnerId) {
  console.error('usage: export-transcripts.mjs <partner-id> [--out <file.md>]');
  process.exit(2);
}

const tools = await loadPartnerTools();
const partner = tools.PARTNERS.find(p => p.id === partnerId);
if (!partner) {
  console.error(`unknown partner id "${partnerId}" — registry holds: ${tools.PARTNERS.map(p => p.id).join(', ') || '(none)'}`);
  process.exit(1);
}

const anon = await loadAnon();
const unitIds = partner.approvedStories.map(s => s.unitId);
const rows = await fetchLiveRows(anon, unitIds);

const lines = [];
lines.push(`# Partner approval document — ${partner.name}`);
lines.push('');
lines.push(`- Partner id: \`${partner.id}\``);
lines.push(`- Status: **${partner.status}**${partner.status === 'dormant' ? ' — prospect, NOT signed. This document is a draft for review; nothing serves until the partner signs and the status flips to active.' : ''}`);
lines.push(`- Site: ${partner.site.placeKeys.map(k => `\`${k}\``).join(', ')} at ${partner.site.lat}, ${partner.site.lng}`);
lines.push(`- Serve radius: ${partner.serveRadiusM} m — the approved tellings below win their serve class inside this radius and have no effect outside it.`);
lines.push(`- Generated: ${new Date().toISOString()} from live shelf rows (story_library).`);
lines.push('');

if (unitIds.length === 0) {
  lines.push('## Approved stories');
  lines.push('');
  lines.push('_None yet._ The approved set is frozen at signing: the stories the partner approves from this document are pinned by story id + audio path, and any later library-side change to them is detected by `scripts/partner/check-frozen.mjs`.');
} else {
  lines.push(`## Approved stories (${unitIds.length})`);
  lines.push('');
  let missing = 0;
  for (let i = 0; i < partner.approvedStories.length; i++) {
    const pin = partner.approvedStories[i];
    const row = rows.get(pin.unitId);
    lines.push(`### ${i + 1}. ${pin.unitId}`);
    lines.push('');
    if (!row) {
      missing++;
      lines.push(`> ⚠️ **Missing live row** — this pinned story is not on the shelf. Resolve before sign-off (see check-frozen.mjs).`);
      lines.push('');
      continue;
    }
    const measured = await measuredDurationSec(anon.supabaseUrl, row.audioPath);
    const estimated = tools.estimateDurationSec(row.storyText ?? '');
    lines.push(`- Place: ${row.placeName} (\`${row.placeKey}\`)`);
    lines.push(`- Angle: \`${row.angle}\``);
    lines.push(`- Audio: \`${row.audioPath}\`${measured != null ? ` — ${measured} s (measured from the audio file)` : ` — ≈${estimated} s (word-count estimate)`}`);
    lines.push('');
    lines.push(row.storyText ?? '_(no text on the live row)_');
    lines.push('');
  }
  if (missing > 0) {
    console.error(`export-transcripts: ${missing} pinned stor${missing === 1 ? 'y is' : 'ies are'} missing live — document emitted with warnings, exiting 1`);
    if (outPath) writeFileSync(outPath, lines.join('\n') + '\n');
    else console.log(lines.join('\n'));
    process.exit(1);
  }
}

const doc = lines.join('\n') + '\n';
if (outPath) {
  writeFileSync(outPath, doc);
  console.log(`wrote ${outPath} (${partner.approvedStories.length} stories, partner ${partner.id}, status ${partner.status})`);
} else {
  console.log(doc);
}
