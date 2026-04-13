"""
AI Lecture Builder — Fully automated: PDF → interactive HTML lecture.

Uses Gemini Vision to read each page image, identify blanks, determine answers,
and estimate placement coordinates. No manual calibration needed.

Usage:
    python tools/ai_lecture_builder.py "path/to/notes.pdf" --chapter 27

Pipeline:
    1. Render PDF pages as images (PyMuPDF)
    2. Send each page to Gemini Vision → get blanks + answers + coordinates
    3. Generate interactive HTML with SVG overlays
"""

import sys
import io
import os
import json
import base64
import time
import re
import argparse
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = Path(__file__).parent.parent


def load_api_key():
    env_path = PROJECT_ROOT.parent / 'biology_sol_platform' / 'backend' / '.env'
    if env_path.exists():
        with open(env_path, 'r') as f:
            for line in f:
                if line.startswith('GEMINI_API_KEY='):
                    raw = line.strip().split('=', 1)[1].strip().strip('"').strip("'")
                    return raw[:39] if raw.startswith('AIza') else raw.split()[0]
    return os.environ.get('GEMINI_API_KEY', '')


def render_pdf_pages(pdf_path, output_dir):
    import fitz
    doc = fitz.open(str(pdf_path))
    output_dir.mkdir(parents=True, exist_ok=True)
    pages = []
    for i in range(len(doc)):
        page = doc[i]
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)
        filename = f'page-{i+1:02d}.png'
        filepath = output_dir / filename
        pix.save(str(filepath))
        pages.append(filepath)
    return pages


def analyze_page_with_ai(img_path, api_key, page_num, pdf_blanks=None):
    """Send page image + PDF-detected blank positions to Gemini for answers."""
    import requests

    with open(img_path, 'rb') as f:
        img_data = base64.b64encode(f.read()).decode('utf-8')

    url = f'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}'

    if pdf_blanks and len(pdf_blanks) > 0:
        blank_json = json.dumps(pdf_blanks)
        prompt = (
            f'Page {page_num} of biology guided notes. I found {len(pdf_blanks)} blanks in the text.\n\n'
            f'Blank positions (in 1224x1584 image coords):\n{blank_json}\n\n'
            f'For each blank, provide the correct fill-in answer based on the page content.\n'
            f'Reply as compact JSON array:\n'
            f'[{{"id":1,"a":"answer"}},{{"id":2,"a":"answer"}},...]\n'
            f'JSON only. No markdown. No explanation.'
        )
    else:
        prompt = (
            f'Page {page_num} of biology guided notes. This page has no text-layer blanks '
            f'but may have blanks inside images/diagrams. If there are no fill-in blanks, return [].\n'
            f'JSON only. No markdown.'
        )

    payload = {
        'contents': [{'parts': [
            {'text': prompt},
            {'inline_data': {'mime_type': 'image/png', 'data': img_data}}
        ]}],
        'generationConfig': {'temperature': 0.1, 'maxOutputTokens': 8192}
    }

    resp = requests.post(url, json=payload, timeout=90)
    result = resp.json()

    if 'candidates' not in result:
        print(f'    ERROR: {json.dumps(result)[:200]}')
        return []

    text = result['candidates'][0]['content']['parts'][0]['text'].strip()
    if text.startswith('```'):
        text = re.sub(r'^```\w*\n?', '', text)
        text = re.sub(r'\n?```$', '', text)
    text = text.strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Recover partial JSON
        entries = []
        for m in re.finditer(r'\{[^}]+\}', text):
            try:
                entries.append(json.loads(m.group()))
            except:
                pass
        return entries


def generate_html(pages_dir, all_answers, output_path, title='Lecture'):
    page_images = sorted(pages_dir.glob('page-*.png'))

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:'Segoe UI',sans-serif;background:#1a1a2e;display:flex;flex-direction:column;align-items:center;min-height:100vh;padding:20px}}
.slide-wrap{{position:relative;width:100%;max-width:960px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5);display:none}}
.slide-wrap.active{{display:block}}
.slide-wrap svg{{width:100%;height:auto;display:block}}
.ans{{fill:transparent;font-family:'Segoe UI',Arial,sans-serif;font-weight:700;cursor:default;transition:fill .3s ease}}
.ans.revealed{{fill:#c0392b}}
.progress-bar{{width:100%;max-width:960px;height:6px;background:#333;border-radius:3px;margin-top:12px;overflow:hidden}}
.progress-fill{{height:100%;background:linear-gradient(90deg,#0B8F8C,#12c4c0);border-radius:3px;transition:width .3s ease;width:0%}}
.controls{{display:flex;gap:16px;align-items:center;margin-top:14px;color:rgba(255,255,255,.6);font-size:.85rem;flex-wrap:wrap;justify-content:center}}
.controls kbd{{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:2px 8px;font-family:monospace;font-size:.8rem;color:rgba(255,255,255,.8)}}
.controls .page-info{{font-weight:600;color:#0B8F8C}}
.controls button{{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:.85rem}}
.controls button:hover{{background:rgba(255,255,255,.2)}}
</style>
</head>
<body>
'''

    total_answers = 0
    for i, img_path in enumerate(page_images):
        pg_num = i + 1
        active = ' active' if pg_num == 1 else ''
        answers = all_answers.get(pg_num, [])
        # Sort by y coordinate
        answers.sort(key=lambda a: (a.get('y', 0), a.get('x', 0)))

        html += f'\n<div class="slide-wrap{active}" id="page-{pg_num}">\n'
        html += f'  <svg viewBox="0 0 1224 1584" xmlns="http://www.w3.org/2000/svg">\n'
        html += f'    <image href="images/{ch_label}/pages/{img_path.name}" x="0" y="0" width="1224" height="1584"/>\n'

        for a in answers:
            x = a.get('x', 0)
            y = a.get('y', 0)
            text = a.get('answer', '')
            fs = a.get('fs', 18)
            safe = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            html += f'    <text class="ans" x="{x}" y="{y}" font-size="{fs}">{safe}</text>\n'
            total_answers += 1

        html += f'  </svg>\n</div>\n'

    html += f'''
<div class="progress-bar"><div class="progress-fill" id="prog"></div></div>
<div class="controls">
  <button onclick="prevPage()">&#8592; Prev</button>
  <span><kbd>Click</kbd> / <kbd>&#8594;</kbd> reveal &middot; <kbd>&#8592;</kbd> undo &middot; <kbd>F</kbd> fullscreen</span>
  <span class="page-info" id="status">Page 1</span>
  <button onclick="nextPage()">Next &#8594;</button>
</div>
<script>
(function(){{
  var pages=document.querySelectorAll('.slide-wrap'),cp=0,ri={{}};
  pages.forEach(function(p,i){{ri[i]=0}});
  function ga(i){{return pages[i].querySelectorAll('.ans')}}
  function tb(){{var t=0;pages.forEach(function(p){{t+=p.querySelectorAll('.ans').length}});return t}}
  function rb(){{var r=0;pages.forEach(function(p){{r+=p.querySelectorAll('.ans.revealed').length}});return r}}
  function us(){{
    var a=ga(cp),r=ri[cp],t=a.length;
    document.getElementById('status').textContent='Page '+(cp+1)+' of {len(page_images)}'+' \\u00b7 '+r+' / '+t+' blanks';
    var pct=tb()>0?Math.round((rb()/tb())*100):0;
    document.getElementById('prog').style.width=pct+'%';
  }}
  function rn(){{var a=ga(cp),i=ri[cp];if(i<a.length){{a[i].classList.add('revealed');ri[cp]++;us()}}else{{nextPage()}}}}
  function ul(){{var i=ri[cp];if(i>0){{ri[cp]--;ga(cp)[ri[cp]].classList.remove('revealed');us()}}else{{prevPage()}}}}
  window.nextPage=function(){{if(cp<pages.length-1){{pages[cp].classList.remove('active');cp++;pages[cp].classList.add('active');us()}}}};
  window.prevPage=function(){{if(cp>0){{pages[cp].classList.remove('active');cp--;pages[cp].classList.add('active');us()}}}};
  document.addEventListener('click',function(e){{if(e.target.tagName==='BUTTON')return;rn()}});
  document.addEventListener('keydown',function(e){{
    if(e.key==='ArrowRight'||e.key===' '||e.key==='Enter'){{e.preventDefault();rn()}}
    else if(e.key==='ArrowLeft'||e.key==='Backspace'){{e.preventDefault();ul()}}
    else if(e.key==='ArrowDown'||e.key==='PageDown'){{e.preventDefault();nextPage()}}
    else if(e.key==='ArrowUp'||e.key==='PageUp'){{e.preventDefault();prevPage()}}
    else if(e.key==='f'){{if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen()}}
  }});
  us();
}})();
</script>
</body>
</html>'''

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    return total_answers


def main():
    parser = argparse.ArgumentParser(description='AI Lecture Builder')
    parser.add_argument('pdf', help='Path to guided notes PDF')
    parser.add_argument('--chapter', type=int, default=0, help='Chapter number')
    parser.add_argument('--skip-pages', type=str, default='', help='Comma-separated page numbers to skip (e.g., "1,5")')
    parser.add_argument('--start', type=int, default=1, help='Start page (default: 1)')
    parser.add_argument('--end', type=int, default=0, help='End page (default: all)')
    args = parser.parse_args()

    pdf_path = Path(args.pdf)
    if not pdf_path.exists():
        print(f'ERROR: PDF not found: {pdf_path}')
        sys.exit(1)

    ch = args.chapter or 0
    ch_label = f'ch{ch}' if ch else 'lecture'
    pages_dir = PROJECT_ROOT / 'slides' / 'images' / ch_label / 'pages'
    output_html = PROJECT_ROOT / 'slides' / f'{ch_label}-lecture.html'
    answers_cache = PROJECT_ROOT / 'tools' / f'ai_answers_{ch_label}.json'

    skip_pages = set()
    if args.skip_pages:
        skip_pages = set(int(x) for x in args.skip_pages.split(','))

    api_key = load_api_key()
    if not api_key:
        print('ERROR: No Gemini API key')
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  AI LECTURE BUILDER")
    print(f"  PDF: {pdf_path.name}")
    print(f"  Chapter: {ch}")
    print(f"{'='*60}\n")

    # Step 1: Render pages
    print('[1/3] Rendering PDF pages...')
    page_images = render_pdf_pages(pdf_path, pages_dir)
    print(f'  {len(page_images)} pages rendered\n')

    # Step 2: PDF text search + AI analysis
    print('[2/3] Finding blanks (PDF text) + AI answers...')

    import fitz
    doc = fitz.open(str(pdf_path))

    all_answers = {}

    # Load cached answers if they exist
    if answers_cache.exists():
        with open(answers_cache, 'r', encoding='utf-8') as f:
            cached = json.load(f)
        print(f'  Loaded {len(cached)} cached pages from {answers_cache.name}')
        all_answers = {int(k): v for k, v in cached.items()}

    end_page = args.end if args.end > 0 else len(page_images)
    Y_OFFSET = 23  # PDF y0 to SVG baseline offset

    for i, img_path in enumerate(page_images):
        pg_num = i + 1
        if pg_num < args.start or pg_num > end_page:
            continue
        if pg_num in skip_pages:
            print(f'  Page {pg_num:2d}: SKIPPED')
            continue
        if pg_num in all_answers and all_answers[pg_num]:
            print(f'  Page {pg_num:2d}: CACHED ({len(all_answers[pg_num])} answers)')
            continue

        # PDF text search for underscore positions
        page = doc[i]
        pdf_blanks_raw = page.search_for('___')
        pdf_blanks = []
        for j, rect in enumerate(pdf_blanks_raw):
            pdf_blanks.append({
                'id': j + 1,
                'x': int(rect.x0 * 2),
                'y': int(rect.y0 * 2),
                'w': int((rect.x1 - rect.x0) * 2)
            })

        if not pdf_blanks:
            print(f'  Page {pg_num:2d}: No text blanks')
            all_answers[pg_num] = []
            continue

        print(f'  Page {pg_num:2d}: {len(pdf_blanks)} text blanks, asking AI...', end='', flush=True)
        ai_result = analyze_page_with_ai(img_path, api_key, pg_num, pdf_blanks)

        # Merge: PDF positions + AI answers
        merged = []
        for a in ai_result:
            idx = a.get('id', 0) - 1
            if 0 <= idx < len(pdf_blanks):
                b = pdf_blanks[idx]
                svg_y = b['y'] + Y_OFFSET
                fs = 18 if b['w'] > 100 else 16 if b['w'] > 60 else 14
                ans = a.get('a', '')
                if ans:
                    merged.append({'x': b['x'], 'y': svg_y, 'answer': ans, 'fs': fs})

        all_answers[pg_num] = merged
        print(f' {len(merged)} answers')

        # Save cache after each page
        cache_data = {str(k): v for k, v in all_answers.items()}
        with open(answers_cache, 'w', encoding='utf-8') as f:
            json.dump(cache_data, f, indent=2)

        time.sleep(2)

    print()

    # Step 3: Generate HTML
    print('[3/3] Generating interactive HTML...')
    total = generate_html(pages_dir, all_answers, output_html,
        title=f'Ch. {ch} — Bacteria and Archaea' if ch else 'Lecture')

    print(f'  Total answers: {total}')
    print(f'  Output: {output_html}')
    print(f'  Answers cached: {answers_cache}')
    print(f"\n{'='*60}\n")


if __name__ == '__main__':
    main()
