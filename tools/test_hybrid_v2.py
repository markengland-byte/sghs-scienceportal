"""Test v2: PDF text search for positions + AI for answers."""
import fitz, sys, io, json, base64, re, time, requests, os, shutil
from pathlib import Path
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PROJECT = Path(__file__).parent.parent
env_path = PROJECT.parent / 'biology_sol_platform' / 'backend' / '.env'
API_KEY = ''
with open(env_path, 'r') as f:
    for line in f:
        if line.startswith('GEMINI_API_KEY='):
            raw = line.strip().split('=', 1)[1].strip().strip('"').strip("'")
            API_KEY = raw[:39] if raw.startswith('AIza') else raw.split()[0]
            break

pdf_path = r'C:\Users\Mark England\Downloads\Ch. 27 - Bacteria and Archaea.pdf'
doc = fitz.open(pdf_path)

all_page_answers = {}

for pg_idx in [1, 5]:  # pages 2 and 6 (0-indexed)
    page = doc[pg_idx]
    pg_num = pg_idx + 1
    print('=== PAGE %d ===' % pg_num)

    # Step 1: PDF text search — exact blank positions, zero false positives
    blanks = page.search_for('___')
    blank_list = []
    for i, rect in enumerate(blanks):
        x = int(rect.x0 * 2)
        y = int(rect.y0 * 2)
        w = int((rect.x1 - rect.x0) * 2)
        blank_list.append({'id': i + 1, 'x': x, 'y': y, 'w': w})
        print('  Blank #%d: x=%d y=%d w=%d' % (i + 1, x, y, w))
    print('  Total text blanks: %d' % len(blank_list))

    # Step 2: AI answers
    img_path = str(PROJECT / 'slides' / 'images' / 'ch27' / 'pages' / ('page-%02d.png' % pg_num))
    with open(img_path, 'rb') as f:
        img_data = base64.b64encode(f.read()).decode('utf-8')

    prompt = (
        'Page %d of biology guided notes. I found %d blanks in the text.\n\n'
        'Blank positions (in 1224x1584 image coords):\n%s\n\n'
        'For each blank, provide the correct fill-in answer based on the page content.\n'
        'Reply as compact JSON array:\n'
        '[{"id":1,"a":"answer"},{"id":2,"a":"answer"},...]\n'
        'JSON only. No markdown. No explanation.'
    ) % (pg_num, len(blank_list), json.dumps(blank_list))

    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + API_KEY
    payload = {
        'contents': [{'parts': [
            {'text': prompt},
            {'inline_data': {'mime_type': 'image/png', 'data': img_data}}
        ]}],
        'generationConfig': {'temperature': 0.1, 'maxOutputTokens': 8192}
    }

    print('  Asking Gemini...')
    resp = requests.post(url, json=payload, timeout=90)
    result = resp.json()
    text = result['candidates'][0]['content']['parts'][0]['text'].strip()
    if text.startswith('```'):
        text = re.sub(r'^```\w*\n?', '', text)
        text = re.sub(r'\n?```$', '', text)

    try:
        ai_answers = json.loads(text.strip())
    except:
        ai_answers = []
        for m in re.finditer(r'\{[^}]+\}', text):
            try:
                ai_answers.append(json.loads(m.group()))
            except:
                pass
        print('  Partial JSON: recovered %d entries' % len(ai_answers))

    # Step 3: Merge
    final = []
    for a in ai_answers:
        idx = a.get('id', 0) - 1
        if 0 <= idx < len(blank_list):
            b = blank_list[idx]
            svg_y = b['y'] + 23  # PDF y0 is top of text span; underscore is ~25px below; text baseline sits just above
            fs = 18 if b['w'] > 100 else 16 if b['w'] > 60 else 14
            ans = a.get('a', '')
            final.append({'x': b['x'], 'y': svg_y, 'answer': ans, 'fs': fs})
            print('    #%d: x=%d y=%d -> "%s"' % (a.get('id', 0), b['x'], svg_y, ans))

    all_page_answers[pg_num] = final
    print('  Final: %d answers\n' % len(final))
    time.sleep(3)

# Generate test HTML
out_dir = Path(os.path.expanduser('~/Desktop/ch27-test'))
out_dir.mkdir(parents=True, exist_ok=True)
(out_dir / 'images').mkdir(exist_ok=True)

html = '''<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Ch27 Hybrid v2 Test</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',sans-serif;background:#1a1a2e;display:flex;flex-direction:column;align-items:center;padding:20px}
.slide-wrap{position:relative;width:100%;max-width:960px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5);display:none}
.slide-wrap.active{display:block}
.slide-wrap svg{width:100%;height:auto;display:block}
.ans{fill:transparent;font-family:'Segoe UI',Arial,sans-serif;font-weight:700;transition:fill .3s ease}
.ans.revealed{fill:#c0392b}
.controls{display:flex;gap:16px;align-items:center;margin-top:14px;color:rgba(255,255,255,.6);font-size:.85rem}
.controls button{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 16px;border-radius:6px;cursor:pointer;font-family:inherit}
.controls .info{font-weight:600;color:#0B8F8C}
</style></head><body>
'''

first = True
for pg in [2, 6]:
    active = ' active' if first else ''
    first = False
    html += '<div class="slide-wrap%s" id="page-%d">\n' % (active, pg)
    html += '  <svg viewBox="0 0 1224 1584" xmlns="http://www.w3.org/2000/svg">\n'
    html += '    <image href="images/page-%02d.png" x="0" y="0" width="1224" height="1584"/>\n' % pg
    for a in all_page_answers.get(pg, []):
        html += '    <text class="ans" x="%d" y="%d" font-size="%d">%s</text>\n' % (a['x'], a['y'], a['fs'], a['answer'])
    html += '  </svg>\n</div>\n'

    # Copy image
    shutil.copy(str(PROJECT / 'slides' / 'images' / 'ch27' / 'pages' / ('page-%02d.png' % pg)),
                str(out_dir / 'images' / ('page-%02d.png' % pg)))

html += '''
<div class="controls">
  <button onclick="prevPage()">Prev</button>
  <span class="info" id="status">Click to reveal</span>
  <button onclick="nextPage()">Next</button>
</div>
<script>
var pages=document.querySelectorAll('.slide-wrap'),cp=0,ri={};
pages.forEach(function(p,i){ri[i]=0});
function ga(i){return pages[i].querySelectorAll('.ans')}
function rn(){var a=ga(cp),i=ri[cp];if(i<a.length){a[i].classList.add('revealed');ri[cp]++;document.getElementById('status').textContent='Blank '+ri[cp]+'/'+a.length}else{nextPage()}}
function ul(){if(ri[cp]>0){ri[cp]--;ga(cp)[ri[cp]].classList.remove('revealed');document.getElementById('status').textContent='Blank '+ri[cp]+'/'+ga(cp).length}}
window.nextPage=function(){if(cp<pages.length-1){pages[cp].classList.remove('active');cp++;pages[cp].classList.add('active');ri[cp]=0;document.getElementById('status').textContent='Click to reveal'}};
window.prevPage=function(){if(cp>0){pages[cp].classList.remove('active');cp--;pages[cp].classList.add('active');document.getElementById('status').textContent='Click to reveal'}};
document.addEventListener('click',function(e){if(e.target.tagName==='BUTTON')return;rn()});
document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();rn()}else if(e.key==='ArrowLeft'){e.preventDefault();ul()}else if(e.key==='ArrowDown'){e.preventDefault();nextPage()}else if(e.key==='ArrowUp'){e.preventDefault();prevPage()}});
</script></body></html>'''

with open(str(out_dir / 'test.html'), 'w', encoding='utf-8') as f:
    f.write(html)

print('Output: %s/test.html' % out_dir)
