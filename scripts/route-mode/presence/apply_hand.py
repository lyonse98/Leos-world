import json
from collections import Counter
import os
D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
rows=json.load(open(f'{D}/census.json')); final=json.load(open(f'{D}/final.json')); hand=json.load(open(f'{D}/hand.json'))
by={f"{r['place_key']}||{r['angle']}":r for r in rows}
changed=0
for k,l in hand.items():
    if final[k]!=l: changed+=1
    final[k]=l
json.dump(final, open(f'{D}/final.json','w'), indent=0)
print('hand overrides changed', changed, 'labels')
print('FINAL split:', Counter(final.values()))
n=len(final)
for c in ['bound','mixed','safe']:
    print(f"  {c}: {Counter(final.values())[c]} = {Counter(final.values())[c]/n*100:.1f}%")
def aclass(a):
    if a.startswith('landmark_'): return 'landmark'
    if a=='corridor': return 'corridor'
    if a.startswith('neighborhood_intro'): return 'intro'
    if a.startswith('filler'): return 'filler'
    return 'other'
for c in ['landmark','corridor','intro','filler']:
    cnt=Counter(final[f"{r['place_key']}||{r['angle']}"] for r in rows if aclass(r['angle'])==c)
    nn=sum(cnt.values())
    print(c, dict(cnt), 'n=',nn, {k:round(v/nn*100,1) for k,v in cnt.items()},
          '| woven-usable:', round((cnt['safe']+cnt['mixed'])/nn*100,1),'%')
tot=Counter(final.values()); print('woven-usable overall:', tot['safe']+tot['mixed'], f"= {(tot['safe']+tot['mixed'])/n*100:.1f}%")
