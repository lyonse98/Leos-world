# Emit ~/workspace/leos-world/presence-classes.csv from the
# pipeline's final.json + census.json — the per-story
# machine-readable artifact the woven-seating build consumes
# (via scripts/route-mode/build-route-presence.mjs →
# src/data/routePresence.ts). This emitter is NEW (Nov 4,
# 2026, woven production build): the original audit reported
# aggregates in presence-audit-2026-11-04.md but wrote no
# per-story file.
#
# The Protected-register rules below are the audit's own,
# verbatim from analysis.py (Nov 3 sacred/Kumeyaay audits):
# the sacred places (all angles), Kuchamaa (all angles), and
# the individually named rows. The emitter asserts the set
# resolves to exactly 32 census rows before writing.
#
# Usage: PRESENCE_AUDIT_DIR=<workdir> python3 emit_csv.py [out.csv]

import csv, json, os, sys
from collections import Counter

D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/hatch/workspace/leos-world/presence-classes.csv'

rows = json.load(open(f'{D}/census.json'))
final = json.load(open(f'{D}/final.json'))
by = {f"{r['place_key']}||{r['angle']}": r for r in rows}
assert set(final) == set(by), 'final.json keys != census keys'

# ---------- Protected set (32) per Nov 3 audits ----------
prot = set()
def add(pk, ang): prot.add(f"{pk}||{ang}")
for r in rows:
    pk, ang = r['place_key'], r['angle']
    if pk in ('fort rosecrans national cemetery', 'mount hope cemetery', 'mount soledad national veterans memorial'): add(pk, ang)
    if pk in ('barona cultural center & museum', 'kumeyaay-ipai interpretive center', 'mission san antonio de pala', 'santa ysabel asistencia'): add(pk, ang)
    if pk == 'kuchamaa': add(pk, ang)
add('i-805 south: north park to lincoln park', 'corridor')
add('i-805 north: lincoln park to north park', 'corridor')
add('i-805 south: university city to kearny mesa', 'corridor')
add('i-8 east: midway district to mission valley', 'corridor')
add('mission san diego de alcalá', 'landmark_people')
add('mission san luis rey de francia', 'landmark_people')
add('mount hope', 'neighborhood_intro')
add('i-805 north: kearny mesa to university city', 'corridor')
missing = [k for k in prot if k not in by]
assert not missing, f'Protected keys missing from census: {missing}'
assert len(prot) == 32, f'Protected set is {len(prot)}, expected 32'
print('protected:', len(prot), '| split:', dict(Counter(final[k] for k in prot)))
print('classes:', dict(Counter(final.values())))

with open(OUT, 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['place_key', 'angle', 'presence_class', 'protected'])
    for r in rows:
        k = f"{r['place_key']}||{r['angle']}"
        w.writerow([r['place_key'], r['angle'], final[k], 1 if k in prot else 0])
print('wrote', OUT, len(rows), 'rows')
