import json
import os
D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
rows=json.load(open(f'{D}/census.json'))
sig=json.load(open(f'{D}/signals.json')); flash=json.load(open(f'{D}/flash.json'))
flash2=json.load(open(f'{D}/flash2.json'))
by={f"{r['place_key']}||{r['angle']}":r for r in rows}
assert len(flash2)>=433, f"flash2 incomplete: {len(flash2)}"

# ---- my hand labels, parallel to the review files' key order ----
bsample=json.load(open(f'{D}/bsample-keys.json'))
B_labels=['bound','bound','bound','bound','mixed','mixed','mixed','bound','safe','bound',
          'mixed','bound','mixed','bound','mixed','mixed','mixed','mixed','mixed','bound',
          'bound','bound','mixed','mixed']
samples=json.load(open(f'{D}/sample-keys.json'))
S_bound=['mixed','mixed','bound','mixed','mixed','mixed','bound','mixed','bound','mixed','mixed','bound']
S_mixed=['mixed']*12
S_safe =['mixed','safe','safe','safe','safe','safe','mixed','safe','safe','safe','safe','safe']
hand={}
for k,l in zip(bsample,B_labels): hand[k]=l
for k,l in zip(samples['bound'],S_bound): hand[k]=l
for k,l in zip(samples['mixed'],S_mixed): hand[k]=l
for k,l in zip(samples['safe'],S_safe): hand[k]=l
A_over={'spreckels theatre||landmark_people':'mixed','the big drop||filler':'mixed'}
for k in list(hand)+list(A_over): assert k in by, f"missing key {k}"

# ---- final labels ----
final={}
for k,f in flash.items(): final[k]=f['cls']
for k,f2 in flash2.items(): final[k]=f2['cls']
for k,l in A_over.items(): final[k]=l
# hand-read safe samples that fall outside the re-run population override flash (consistency of standard)
for k,l in hand.items():
    if k not in flash2: final[k]=l
json.dump(final, open(f'{D}/final.json','w'), indent=0)
json.dump(hand, open(f'{D}/hand.json','w'), indent=0)

from collections import Counter
print('FINAL split:', Counter(final.values()), 'n=', len(final))
# validation: my reads vs flash2 within the re-run population
inv=[k for k in hand if k in flash2]
agree=sum(1 for k in inv if hand[k]==flash2[k]['cls'])
print(f'hand vs REFINED pass on disputed pop: {agree}/{len(inv)} = {agree/len(inv):.0%}')
dis=[(k,hand[k],flash2[k]['cls']) for k in inv if hand[k]!=flash2[k]['cls']]
for k,m,f in dis: print('  DISAGREE:', k, 'mine=',m,'refined=',f)
# my reads vs ORIGINAL flash (bound samples + B set)
bkeys=[k for k in hand if flash[k]['cls']=='bound']
ag=sum(1 for k in bkeys if hand[k]=='bound')
print(f'hand vs ORIGINAL flash on bound-labeled reads: {ag}/{len(bkeys)} upheld bound')
# angle-class splits
def aclass(a):
    if a.startswith('landmark_'): return 'landmark'
    if a=='corridor': return 'corridor'
    if a.startswith('neighborhood_intro'): return 'intro'
    if a.startswith('filler'): return 'filler'
    return 'other'
for c in ['landmark','corridor','intro','filler','other']:
    cnt=Counter(final[f"{r['place_key']}||{r['angle']}"] for r in rows if aclass(r['angle'])==c)
    n=sum(cnt.values())
    print(c, dict(cnt), 'n=',n, {k:round(v/n*100,1) for k,v in cnt.items()})
