import json, random
import os
D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
rows=json.load(open(f'{D}/census.json'))
sig=json.load(open(f'{D}/signals.json'))
flash=json.load(open(f'{D}/flash.json'))
by={f"{r['place_key']}||{r['angle']}":r for r in rows}
random.seed(20261104)

flags=[]
for k,f in flash.items():
    s=sig[k]
    if f['cls']=='safe' and s['nhard']>=2: flags.append((k,'flash-safe vs scripted-hard>=2'))
    elif f['cls']=='bound' and s['nhard']==0 and s['nsoft']<=1: flags.append((k,'flash-bound vs scripted-clean'))
    elif f['cls']=='safe' and s['scripted']=='bound': flags.append((k,'flash-safe vs scripted-bound'))
    elif f['cls']=='bound' and s['scripted']=='safe': flags.append((k,'flash-bound vs scripted-safe'))
print('disagreement flags:', len(flags))

def dump(items, fh):
    for k,note in items:
        r=by[k]
        fh.write(f"\n{'='*100}\nKEY: {k}\nNOTE: {note}\nFLASH: {flash[k]['cls']} — {flash[k]['why']}\nSCRIPTED: {sig[k]['scripted']} hard={sig[k]['hard']} soft={sig[k]['soft']}\n--- TEXT ---\n{r['story_text']}\n")

with open(f'{D}/review-flags.txt','w') as fh:
    dump(flags, fh)
json.dump([k for k,_ in flags], open(f'{D}/flag-keys.json','w'))
print('wrote review-flags.txt')

# random samples per flash class for agreement check
samples={}
for cls in ['bound','mixed','safe']:
    pool=[k for k,f in flash.items() if f['cls']==cls]
    samples[cls]=random.sample(pool, min(12,len(pool)))
with open(f'{D}/review-samples.txt','w') as fh:
    for cls,ks in samples.items():
        fh.write(f"\n\n########## SAMPLE CLASS: {cls} ##########")
        dump([(k,f'random sample of flash-{cls}') for k in ks], fh)
json.dump(samples, open(f'{D}/sample-keys.json','w'))
print('wrote review-samples.txt', {c:len(v) for c,v in samples.items()})
