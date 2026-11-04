import json, csv
from collections import Counter, defaultdict
import os
D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
rows=json.load(open(f'{D}/census.json'))
final=json.load(open(f'{D}/final.json'))
by={f"{r['place_key']}||{r['angle']}":r for r in rows}

# ---------- Protected set (32) per Nov 3 audits ----------
prot=set()
def add(pk,ang): prot.add(f"{pk}||{ang}")
for r in rows:
    pk,ang=r['place_key'],r['angle']
    if pk in ('fort rosecrans national cemetery','mount hope cemetery','mount soledad national veterans memorial'): add(pk,ang)
    if pk in ('barona cultural center & museum','kumeyaay-ipai interpretive center','mission san antonio de pala','santa ysabel asistencia'): add(pk,ang)
    if pk=='kuchamaa': add(pk,ang)
add('i-805 south: north park to lincoln park','corridor')
add('i-805 north: lincoln park to north park','corridor')
add('i-805 south: university city to kearny mesa','corridor')
add('i-8 east: midway district to mission valley','corridor')
add('mission san diego de alcalá','landmark_people')
add('mission san luis rey de francia','landmark_people')
add('mount hope','neighborhood_intro')
add('i-805 north: kearny mesa to university city','corridor')
missing=[k for k in prot if k not in by]
print('PROTECTED identified:', len(prot), '| missing from census:', missing)
print('protected class split:', Counter(final[k] for k in prot))

# ---------- tags ----------
tags={}
for rec in csv.DictReader(open('/home/hatch/workspace/leos-world/story-tags.csv')):
    k=f"{rec['place_key']}||{rec['angle']}"
    topics=[t.strip() for t in rec['topics'].split(';') if t.strip()] if rec['topics'] else []
    tags[k]={'topics':topics,'tone':rec['tone'],'tone2':rec['tone_secondary']}
print('tags rows:', len(tags), '| census rows:', len(by), '| tag keys not in census:', len([k for k in tags if k not in by]))
topicless=[k for k in by if not tags.get(k,{}).get('topics')]
print('topic-less rows:', len(topicless), Counter(final[k] for k in topicless))

# ---------- per-topic cross-tab (non-protected) ----------
topic_rows=defaultdict(list)
for k,t in tags.items():
    if k in prot or k not in by: continue
    for tp in t['topics']: topic_rows[tp].append(k)
print(f"\n{'topic':24} {'tagged':>6} {'safe':>5} {'mixed':>5} {'bound':>5} {'usable':>6} {'usable%':>7}")
topic_stats={}
for tp,ks in sorted(topic_rows.items(), key=lambda kv:-len(kv[1])):
    c=Counter(final[k] for k in ks); usable=c['safe']+c['mixed']
    topic_stats[tp]={'n':len(ks),'safe':c['safe'],'mixed':c['mixed'],'bound':c['bound'],'usable':usable}
    print(f"{tp:24} {len(ks):>6} {c['safe']:>5} {c['mixed']:>5} {c['bound']:>5} {usable:>6} {usable/len(ks)*100:>6.1f}%")

# ---------- tranche candidacy ----------
def aclass(a):
    if a.startswith('landmark_'): return 'landmark'
    if a=='corridor': return 'corridor'
    if a.startswith('neighborhood_intro'): return 'intro'
    if a.startswith('filler'): return 'filler'
    return 'other'
CLASSW={'landmark':3.0,'corridor':1.5,'intro':1.0}
cand=[]
for k in by:
    if k in prot: continue
    cls=final[k]
    if cls not in ('bound','mixed'): continue
    if aclass(by[k]['angle']) not in CLASSW: continue
    tps=tags.get(k,{}).get('topics') or []
    if not tps: continue
    rich=max(topic_stats[tp]['n'] for tp in tps)
    need=1.0 if cls=='bound' else 0.55
    score=rich*CLASSW[aclass(by[k]['angle'])]*need
    cand.append({'key':k,'place':by[k]['place_name'],'pk':by[k]['place_key'],'angle':by[k]['angle'],
                 'cls':cls,'topics':tps,'tone':tags[k]['tone'],'chars':len(by[k]['story_text'] or ''),
                 'score':round(score,1)})
cand.sort(key=lambda c:-c['score'])
print('\ncandidate universe (bound/mixed, non-protected, topic-tagged, non-filler):', len(cand),
      '| of which bound:', sum(1 for c in cand if c['cls']=='bound'))

def take(n):
    out=[]; perplace=Counter()
    for c in cand:
        if len(out)>=n: break
        if perplace[c['pk']]>=2: continue
        out.append(c); perplace[c['pk']]+=1
    return out
RATE_LO, RATE_HI = 7/111752, 10/111752
tiers={}
for n in (100,200,300):
    sel=take(n); tiers[n]=sel
    ch=sum(c['chars'] for c in sel)
    print(f"\nTIER {n}: selected {len(sel)} | distinct places {len(set(c['pk'] for c in sel))} | "
          f"bound {sum(1 for c in sel if c['cls']=='bound')} / mixed {sum(1 for c in sel if c['cls']=='mixed')} | "
          f"landmark {sum(1 for c in sel if aclass(c['angle'])=='landmark')} / corridor {sum(1 for c in sel if aclass(c['angle'])=='corridor')} / intro {sum(1 for c in sel if aclass(c['angle'])=='intro')} | "
          f"chars {ch:,} | price ${ch*RATE_LO:,.2f}–${ch*RATE_HI:,.2f}")
    conv=Counter()
    for c in sel:
        for tp in c['topics']: conv[tp]+=1
    print('  converts per topic:', dict(conv.most_common()))
print('\nper-topic usable depth: before -> after T100 -> T200 -> T300 (thread-rich topics)')
for tp,st in sorted(topic_stats.items(), key=lambda kv:-kv[1]['n'])[:12]:
    line=f"  {tp:24} {st['usable']:>3}"
    for n in (100,200,300):
        add_n=sum(1 for c in tiers[n] if tp in c['topics'])
        line+=f" -> {st['usable']+add_n:>3}"
    print(line)
# climax-grade: tier-100 landmark bound, grand tone first
cg=[c for c in tiers[100] if aclass(c['angle'])=='landmark' and c['cls']=='bound']
cg.sort(key=lambda c: (c['tone']!='grand', -c['score']))
print('\nCLIMAX-GRADE candidates in tier 100 (landmark + presence-bound):', len(cg))
for c in cg[:16]:
    print(f"  - {c['place']} — {c['angle']} — topics {'; '.join(c['topics'])} — tone {c['tone']} — {c['chars']} chars")
json.dump({'tiers':{str(n):tiers[n] for n in tiers},'topic_stats':topic_stats}, open(f'{D}/tranche.json','w'), indent=1)
# top of tier 100 for the report's texture
print('\ntier-100 head (top 15 by score):')
for c in tiers[100][:15]:
    print(f"  - {c['place']} — {c['angle']} — {c['cls']} — {'; '.join(c['topics'])} — tone {c['tone']}")
