"""Test hybrid approach: scanner positions + AI answers on 2 pages."""
import sys, io, json, base64, re, time
from pathlib import Path
from PIL import Image
import numpy as np
import requests

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


def scan_underscores(img_path):
    img = Image.open(img_path).convert('L')
    pixels = np.array(img)
    h, w = pixels.shape
    blanks = []
    for y in range(60, h - 60):
        row = pixels[y, :]
        in_dark = False
        start_x = 0
        for x in range(w):
            if row[x] < 120:
                if not in_dark:
                    start_x = x
                    in_dark = True
            else:
                if in_dark:
                    run_len = x - start_x
                    if 30 <= run_len <= 350:
                        above = pixels[max(0, y-5):max(0, y-1), start_x:x].mean() if y > 5 else 255
                        below = pixels[min(h, y+2):min(h, y+6), start_x:x].mean() if y < h-6 else 255
                        if above > 150 and below > 150:
                            blanks.append((start_x, y, x, run_len))
                    in_dark = False
    merged = []
    for x0, y0, x1, bw in blanks:
        found = False
        for i, m in enumerate(merged):
            if abs(x0 - m[0]) < 20 and abs(y0 - m[4]) <= 4 and abs(bw - m[3]) < 40:
                merged[i] = (min(m[0], x0), m[1], max(m[2], x1), max(m[3], bw), y0)
                found = True
                break
        if not found:
            merged.append((x0, y0, x1, bw, y0))
    merged.sort(key=lambda b: (b[1], b[0]))
    return [(x0, y_start, x1, width) for x0, y_start, x1, width, y_end in merged]


def ask_gemini(img_path, blanks, pg_num):
    with open(img_path, 'rb') as f:
        img_data = base64.b64encode(f.read()).decode('utf-8')

    blank_list = [{'id': i+1, 'x': b[0], 'y': b[1], 'width': b[3]} for i, b in enumerate(blanks)]

    prompt = (
        'Page %d of biology guided notes. Image is 1224x1584 pixels.\n\n'
        'I detected %d underscores. For each, reply with the answer or SKIP if decorative.\n\n'
        'Positions:\n%s\n\n'
        'Reply as JSON array: [{"id":1,"a":"answer"},{"id":2,"a":"SKIP"},...]\n'
        'Use "a":"SKIP" for decorative lines. Keep answers short (1-2 words).\n'
        'JSON only, no markdown.'
    ) % (pg_num, len(blanks), json.dumps(blank_list))

    url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + API_KEY
    payload = {
        'contents': [{'parts': [
            {'text': prompt},
            {'inline_data': {'mime_type': 'image/png', 'data': img_data}}
        ]}],
        'generationConfig': {'temperature': 0.1, 'maxOutputTokens': 16384}
    }

    resp = requests.post(url, json=payload, timeout=90)
    result = resp.json()

    if 'candidates' not in result:
        print('  ERROR:', json.dumps(result)[:200])
        return []

    text = result['candidates'][0]['content']['parts'][0]['text'].strip()
    if text.startswith('```'):
        text = re.sub(r'^```\w*\n?', '', text)
        text = re.sub(r'\n?```$', '', text)

    text = text.strip()
    # Fix common JSON issues from Gemini
    text = text.replace("'", '"')
    text = re.sub(r',\s*}', '}', text)
    text = re.sub(r',\s*]', ']', text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Try to salvage partial JSON by extracting individual objects
        entries = []
        for m in re.finditer(r'\{[^}]+\}', text):
            try:
                obj = json.loads(m.group())
                entries.append(obj)
            except:
                pass
        if entries:
            print('  Partial JSON: recovered %d entries' % len(entries))
            return entries
        print('  JSON parse failed completely')
        print('  Raw (first 500): %s' % text[:500])
        return []


for pg in [2, 6]:
    img_path = str(PROJECT / 'slides' / 'images' / 'ch27' / 'pages' / ('page-%02d.png' % pg))
    print('=== PAGE %d ===' % pg)

    blanks = scan_underscores(img_path)
    print('Scanner found %d underscores:' % len(blanks))
    for i, (x0, y, x1, w) in enumerate(blanks):
        print('  #%d: x=%d y=%d w=%d' % (i+1, x0, y, w))

    print('  Sending to Gemini...')
    answers = ask_gemini(img_path, blanks, pg)

    print('  AI classified %d underscores:' % len(answers))
    final = []
    for a in answers:
        idx = a.get('id', 0) - 1
        ans = a.get('a', a.get('answer', 'SKIP'))
        if idx < len(blanks) and ans != 'SKIP':
            x0, y, x1, w = blanks[idx]
            svg_y = y - 2
            fs = 18 if w > 100 else 16 if w > 60 else 14
            final.append({'x': x0, 'y': svg_y, 'answer': ans, 'fs': fs})
            print('    #%d: x=%d y=%d -> "%s"' % (a.get('id',0), x0, svg_y, ans))
        else:
            print('    #%d: SKIP' % a.get('id',0))

    print('  Final: %d answers with exact positions\n' % len(final))
    time.sleep(3)
