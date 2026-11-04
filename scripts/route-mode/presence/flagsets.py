import json, random, re
import os
_D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
rows=json.load(open(f'{_D}/census.json')); sig=json.load(open(f'{_D}/signals.json')); flash=json.load(open(f'{_D}/flash.json'))
by={f"{r['place_key']}||{r['angle']}":r for r in rows}
random.seed(7)
A=[k for k,f in flash.items() if f['cls']=='safe' and sig[k]['nhard']>=2]
C=[k for k,f in flash.items() if f['cls']=='safe' and sig[k]['scripted']=='bound']
B=[k for k,f in flash.items() if f['cls']=='bound' and sig[k]['scripted']=='safe']
D=[k for k,f in flash.items() if f['cls']=='bound' and sig[k]['nhard']==0 and sig[k]['nsoft']<=1]
print('A flash-safe & hard>=2 (Flash-miss suspects):', len(A))
print('C flash-safe & scripted-bound (subset of A mostly):', len(C))
print('B flash-bound & scripted-safe:', len(B), '| of which corridor:', sum(1 for k in B if by[k]['angle']=='corridor'), '| landmark:', sum(1 for k in B if by[k]['angle'].startswith('landmark_')))
print('D flash-bound & zero scripted signals:', len(D))
json.dump({'A':A,'C':C,'B':B,'D':D}, open(f'{_D}/flagsets.json','w'))

def snippets(k):
    r=by[k]; t=r['story_text']
    out=[]
    tl=' '+t.lower().replace('\u2019',"'")+' '
    for name,pos in sig[k]['hard']:
        pass
    # recompute hit contexts from stored positions (fraction of padded lower text ~ close enough)
    n=len(t)
    for name,frac in sig[k]['hard']:
        c=int(frac*n); s=max(0,c-260); e=min(n,c+260)
        out.append(f"[{name} @ {frac:.0%}] ...{t[s:e]}...")
    return out

with open('review-A.txt','w') as fh:
    for k in A:
        fh.write(f"\n{'='*90}\nKEY: {k}\nFLASH: safe — {flash[k]['why']}\nSCRIPTED: {sig[k]['scripted']} hard={sig[k]['hard']}\n")
        for s in snippets(k): fh.write(s+"\n")
Bsample=random.sample(B, 24)
with open('review-B.txt','w') as fh:
    for k in Bsample:
        r=by[k]
        fh.write(f"\n{'='*90}\nKEY: {k}\nFLASH: bound — {flash[k]['why']}\nSCRIPTED: safe hard={sig[k]['hard']} soft={sig[k]['soft']}\n--- TEXT ---\n{r['story_text']}\n")
json.dump(Bsample, open(f'{_D}/bsample-keys.json','w'))
import os; print('review-A size:', os.path.getsize('review-A.txt'), '| review-B size:', os.path.getsize('review-B.txt'))
