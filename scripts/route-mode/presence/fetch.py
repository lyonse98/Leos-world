import json, subprocess, sys
keys=json.load(open('/tmp/leo_library_keys.json'))
url=keys['supabaseUrl']; anon=keys['anonKey']
base=f"{url}/rest/v1/story_library"
rows=[]; offset=0; PAGE=200
q="select=place_key,place_name,angle,lat,lng,story_text,audio_path,persona_version,voice,created_at&order=place_key.asc,angle.asc"
while True:
    res=subprocess.run(["curl","-s","-f", f"{base}?{q}", "-H", f"apikey: {anon}", "-H", f"Authorization: Bearer {anon}", "-H", "Range-Unit: items", "-H", f"Range: {offset}-{offset+PAGE-1}"], capture_output=True, text=True, timeout=120)
    if res.returncode!=0:
        print("curl fail", res.stderr[:300]); sys.exit(1)
    data=json.loads(res.stdout)
    rows.extend(data)
    if len(data)<PAGE: break
    offset+=PAGE
import os
_D = os.environ.get('PRESENCE_AUDIT_DIR', '/tmp/presence-audit')
json.dump(rows, open(f'{_D}/census.json','w'), indent=1)
from collections import Counter
print("TOTAL ROWS:", len(rows))
print(Counter(r['angle'].split('_')[0] if not r['angle'].startswith('neighborhood') else 'neighborhood' for r in rows))
ang=Counter(r['angle'] for r in rows)
print("landmark rows:", sum(v for k,v in ang.items() if k.startswith('landmark_')))
print("corridor:", ang.get('corridor',0), "| fillers:", sum(v for k,v in ang.items() if k.startswith('filler')))
print("distinct place_key:", len(set(r['place_key'] for r in rows)))
chars=[len(r.get('story_text') or '') for r in rows]
print("story_text chars total:", sum(chars), "avg:", round(sum(chars)/len(chars)))
print("empty texts:", sum(1 for c in chars if c==0))
