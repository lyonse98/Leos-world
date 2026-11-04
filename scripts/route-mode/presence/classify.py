import json, re, subprocess, sys, time, os
D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
rows=json.load(open(f'{D}/census.json'))
keyof=lambda r: f"{r['place_key']}||{r['angle']}"

# ---------------- scripted presence signals ----------------
HARD = [
 (r"\bon your (left|right)\b",'deictic-side'),
 (r"\bto your (left|right)\b",'deictic-side'),
 (r"\byour (left|right)(-hand)? side\b",'deictic-side'),
 (r"\bin front of you\b",'deictic-front'),
 (r"\b(ahead of|behind|beside|next to|above|below) you\b",'deictic-rel'),
 (r"\blook (at|up|down|out|over|toward|towards)\b",'gaze'),
 (r"\byou (can|could|will|'ll) (see|hear|smell|feel|spot|make out|notice)\b",'you-sensory'),
 (r"\bas you (pass|drive|cross|approach|travel|head|ride|walk|climb|descend|enter|leave|round|coast|roll)\b",'you-motion'),
 (r"\byou('re| are) (passing|driving|crossing|approaching|standing|sitting|riding|looking|climbing|descending)\b",'you-motion'),
 (r"\bright here\b",'deictic-here'),
 (r"\bthe (road|freeway|highway|street) (you're|you are) on\b",'you-road'),
 (r"\bwhere you (stand|sit|'re standing|are standing)\b",'you-place'),
]
SOFT = [
 (r"\bwatch for\b",'watch'),
 (r"\bnotice\b",'notice'),
 (r"\bcoming up\b",'coming-up'),
 (r"\bwelcome to\b",'welcome'),
 (r"\bif you (stop|park|stand|look|listen|linger|pause)\b",'conditional'),
 (r"\byou pass\b",'you-pass'),
 (r"\baround you\b",'around-you'),
 (r"\bjust ahead\b",'just-ahead'),
 (r"\boff to (the|your) (left|right)\b",'off-side'),
 (r"\bkeep an eye\b",'eye'),
 (r"\blook for\b",'look-for'),
 (r"\bthis stretch\b",'this-stretch'),
]
def signals(text):
    t=' '+text.lower().replace('\u2019',"'")+' '
    hard=[]; soft=[]
    for pat,name in HARD:
        for m in re.finditer(pat,t):
            hard.append((name, round(m.start()/max(len(t),1),3)))
    for pat,name in SOFT:
        for m in re.finditer(pat,t):
            soft.append((name, round(m.start()/max(len(t),1),3)))
    return hard, soft

def scripted_label(hard, soft):
    h=len(hard); s=len(soft)
    if h>=2 or (h==1 and h+s>=4): return 'bound'
    if h==0 and s<=1: return 'safe'
    return 'mixed'

sig={}
for r in rows:
    hard,soft=signals(r['story_text'] or '')
    sig[keyof(r)]={'hard':hard,'soft':soft,'scripted':scripted_label(hard,soft),
                  'nhard':len(hard),'nsoft':len(soft)}
json.dump(sig, open(f'{D}/signals.json','w'), indent=0)
from collections import Counter
print('scripted split:', Counter(v['scripted'] for v in sig.values()))

# ---------------- Gemini Flash pass ----------------
keys=json.load(open('/tmp/leo_library_keys.json'))
MODEL='gemini-3.6-flash'
REFERER='https://leos-world-mobile-80g2.bolt.host/'
FLASH_PATH=f'{D}/flash.json'
flash={}
if os.path.exists(FLASH_PATH): flash=json.load(open(FLASH_PATH))
todo=[r for r in rows if keyof(r) not in flash]
print(f'flash: {len(flash)} done, {len(todo)} to go')

RUBRIC = """You are auditing short San Diego audio-tour stories for a route-mode composer. Each story was written to be heard by a driver AT or PASSING the place it describes. Classify each story's PRESENCE REGISTER — how much its language assumes the listener is physically at the place right now.

Classes:
- "bound" (presence-bound): the text speaks as if the listener is there — directions relative to the listener ("on your left", "in front of you"), gaze directions ("look up at..."), sensory present addressed to the listener ("you can smell..."), motion co-location ("as you climb this grade", "the road beneath you"), or a present-tense scene the listener is placed inside. Played 15 miles away, this language would sound FALSE.
- "mixed": light presence language — one or two presence touches, or presence confined to a brief framing line (an opening "welcome to X" or a closing invitation like "next time you stop...") while the body is told in a place-independent way. An honest host introduction could carry this story off-location without the text itself lying.
- "safe" (weave-safe): no presence assumptions at all. The story narrates the place's history/people/events in a way that works heard anywhere; nothing in the language references the listener's position, motion, gaze, or senses. Pure narration ABOUT a segment of road (its history, what was built there) without addressing the driver on it counts as safe; continual "this stretch / right here" framing addressed to the driver counts as presence.

Judge the TEXT as written, not the subject. Return ONLY a JSON array, one object per item, in order: [{"i":0,"cls":"bound","why":"short reason"}, ...]"""

def prompt(batch):
    items=[]
    for i,r in enumerate(batch):
        items.append(f"--- ITEM {i} ---\nPlace: {r['place_name']}\nAngle: {r['angle']}\nText: {r['story_text']}")
    return RUBRIC + "\n\n" + "\n\n".join(items)

def call(batch):
    body=json.dumps({"contents":[{"parts":[{"text":prompt(batch)}]}],
        "generationConfig":{"responseMimeType":"application/json","temperature":0.1,"thinkingConfig":{"thinkingBudget":0}}})
    res=subprocess.run(["curl","-s","-f","-X","POST",
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent?key={keys['geminiKey']}",
        "-H","Content-Type: application/json","-H",f"Referer: {REFERER}","-d",body],
        capture_output=True,text=True,timeout=300)
    if res.returncode!=0: raise RuntimeError(f"curl fail: {res.stderr[:200]} {res.stdout[:200]}")
    j=json.loads(res.stdout)
    text=j['candidates'][0]['content']['parts'][0]['text']
    arr=json.loads(text)
    if not isinstance(arr,list) or len(arr)!=len(batch): raise RuntimeError(f"bad array {len(arr) if isinstance(arr,list) else type(arr)} vs {len(batch)}")
    return arr

BATCH=10
nb=(len(todo)+BATCH-1)//BATCH
for s in range(0,len(todo),BATCH):
    batch=todo[s:s+BATCH]; out=None; lastErr=None
    for attempt in range(1,4):
        try: out=call(batch); break
        except Exception as e:
            lastErr=e; msg=str(e)
            if '429' in msg or 'RESOURCE_EXHAUSTED' in msg.upper():
                print(f"QUOTA STOP at {s}: {msg[:160]}"); json.dump(flash,open(FLASH_PATH,'w')); sys.exit(2)
            print(f"batch {s//BATCH} attempt {attempt} failed: {msg[:160]}"); time.sleep(4*attempt)
    if out is None:
        print(f"BATCH FAILED permanently at {s}: {lastErr}"); json.dump(flash,open(FLASH_PATH,'w')); sys.exit(1)
    for r,o in zip(batch,out):
        flash[keyof(r)]={'cls':o.get('cls'),'why':str(o.get('why',''))[:220]}
    json.dump(flash,open(FLASH_PATH,'w'))
    print(f"flash batch {s//BATCH+1}/{nb} ok ({len(flash)} total)", flush=True)
print('flash split:', Counter(v['cls'] for v in flash.values()))
agree=sum(1 for k in flash if flash[k]['cls']==sig[k]['scripted'])
print(f"scripted vs flash agreement: {agree}/{len(flash)} = {agree/len(flash):.1%}")
