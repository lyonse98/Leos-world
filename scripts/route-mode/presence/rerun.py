import json, subprocess, sys, time, os
import os
D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
rows=json.load(open(f'{D}/census.json'))
sig=json.load(open(f'{D}/signals.json')); flash=json.load(open(f'{D}/flash.json'))
by={f"{r['place_key']}||{r['angle']}":r for r in rows}
keys=json.load(open('/tmp/leo_library_keys.json'))
MODEL='gemini-3.6-flash'; REFERER='https://leos-world-mobile-80g2.bolt.host/'

pop=[k for k,f in flash.items() if f['cls']=='bound' and sig[k]['scripted']!='bound']
pop+= [k for k,f in flash.items() if f['cls']=='mixed' and sig[k]['scripted']=='bound']
pop=sorted(set(pop))
print('refined re-run population:', len(pop))

RUBRIC = """You are re-auditing San Diego audio-tour stories for PRESENCE REGISTER: how much the language assumes the listener is physically at the place right now. A previous pass over-called "bound"; apply this calibrated standard exactly.

BOUND (presence-bound) — SUSTAINED co-location. The text places the listener (or the host riding with the listener: "we're on Harbor Drive", "as we pass") at the place at TWO OR MORE points in the text, or sustains one co-located scene from the listener's own viewpoint/motion/senses across a full passage. Examples of bound language: "beneath your tires", "you roll right out over the water", "watch the waterfront as we pass", "look past the name and take in that mothership rising over the canyon" (visual tour of what is in front of the listener), a narrator who repeatedly rides the road with you ("I always brace for that stomach-drop as the pavement pitches down... you are dropping into...").

MIXED — ISOLATED presence touches in a place-independent body. Exactly one or two discrete devices, not sustained: a single imperative scene invitation ("Stand at the pool after a wet winter and watch it happen:" followed by history), one conditional ("if you walk toward the south edge...", "if you glance up..."), one closing line ("when you catch a glimpse of it from the freeway..."), one experiential scene paragraph framed by "Picture the crossing today:", one host frame line ("I'm Leo, and we're in Balboa Park") followed by institutional history. The body between touches must narrate the place independently of the listener.

SAFE (weave-safe) — NO listener placement at all. Watch for these NON-presence traps and do NOT count them: (a) figurative "look at" meaning "consider" ("if you want to understand this place, you have to look at..."); (b) historical characters looking ("he took one look at the repair bills"); (c) "right here" referring to the PLACE's location in the county, not the listener ("a community right here drew a line"); (d) "Picture/Imagine [a past scene]" visualization of history ("Picture a heavy excavator chewing through dirt in 2009"); (e) a third-person present-tense scene about the place's people, machines, or water with no listener in it (the Forward Criteria mandate such scenes — they are documentary, not presence); (f) generic-you describing an experience in the abstract without locating this listener ("you can spot figures at dawn" as a description of what the place is like).

Judge the TEXT as written. Return ONLY a JSON array, one object per item, in order: [{"i":0,"cls":"bound","why":"short reason"}, ...]"""

def prompt(batch):
    items=[f"--- ITEM {i} ---\nPlace: {r['place_name']}\nAngle: {r['angle']}\nText: {r['story_text']}" for i,r in enumerate(batch)]
    return RUBRIC + "\n\n" + "\n\n".join(items)

def call(batch):
    body=json.dumps({"contents":[{"parts":[{"text":prompt(batch)}]}],
        "generationConfig":{"responseMimeType":"application/json","temperature":0.1,"thinkingConfig":{"thinkingBudget":0}}})
    res=subprocess.run(["curl","-s","-f","-X","POST",
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={keys['geminiKey']}",
        "-H","Content-Type: application/json","-H",f"Referer: {REFERER}","-d",body],
        capture_output=True,text=True,timeout=300)
    if res.returncode!=0: raise RuntimeError(f"curl fail: {res.stderr[:150]} {res.stdout[:150]}")
    j=json.loads(res.stdout)
    arr=json.loads(j['candidates'][0]['content']['parts'][0]['text'])
    if not isinstance(arr,list) or len(arr)!=len(batch): raise RuntimeError("bad array")
    return arr

OUT=f'{D}/flash2.json'
done={}
if os.path.exists(OUT): done=json.load(open(OUT))
todo=[k for k in pop if k not in done]
print(f'refined: {len(done)} done, {len(todo)} to go')
BATCH=10
for s in range(0,len(todo),BATCH):
    batch=[by[k] for k in todo[s:s+BATCH]]; out=None; lastErr=None
    for attempt in range(1,4):
        try: out=call(batch); break
        except Exception as e:
            lastErr=e; msg=str(e)
            if '429' in msg or 'RESOURCE_EXHAUSTED' in msg.upper():
                print(f"QUOTA STOP at {s}: {msg[:160]}"); json.dump(done,open(OUT,'w')); sys.exit(2)
            print(f"batch {s//BATCH} attempt {attempt} failed: {msg[:150]}"); time.sleep(4*attempt)
    if out is None:
        print(f"BATCH FAILED at {s}: {lastErr}"); json.dump(done,open(OUT,'w')); sys.exit(1)
    for k,o in zip(todo[s:s+BATCH],out):
        done[k]={'cls':o.get('cls'),'why':str(o.get('why',''))[:220]}
    json.dump(done,open(OUT,'w'))
    print(f"refined batch {s//BATCH+1} ok ({len(done)} total)", flush=True)
from collections import Counter
print('refined split:', Counter(v['cls'] for v in done.values()))
moved=Counter((flash[k]['cls'], done[k]['cls']) for k in done)
print('transitions (flash -> refined):', dict(moved))
