"""
Bold Lecture Builder — Finds bold words in a PDF and creates interactive
lecture slides where bold terms are hidden and revealed on click.

Works with any PDF that uses bold font for key terms/vocab.

Usage:
    python tools/bold_lecture_builder.py "path/to/notes.pdf" --chapter 29 --skip-pages "1"

Pipeline:
    1. Render PDF pages as images (PyMuPDF)
    2. Extract bold text spans with exact positions
    3. Generate interactive HTML with blanked-out bold words (SVG overlays)
"""

import sys
import io
import os
import json
import re
import argparse
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = Path(__file__).parent.parent


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
        out_path = output_dir / filename
        pix.save(str(out_path))
        pages.append(out_path)
    return pages


def extract_bold_spans(pdf_path, skip_pages=None):
    """Extract all bold text spans with positions from each page."""
    import fitz
    skip_pages = skip_pages or set()
    doc = fitz.open(str(pdf_path))
    all_answers = {}

    # Words/patterns to skip (headers, footers, labels)
    SKIP_PATTERNS = {
        'urry - campbell biology', 'urry -campbell biology',
        'concept:', 'example:', 'note:', 'review:',
    }

    for i in range(len(doc)):
        pg_num = i + 1
        if pg_num in skip_pages:
            continue

        page = doc[i]
        page_width = page.rect.width
        page_height = page.rect.height
        blocks = page.get_text('dict')['blocks']
        answers = []

        for b in blocks:
            if 'lines' not in b:
                continue
            for line in b['lines']:
                for span in line['spans']:
                    text = span['text'].strip()
                    if not text or len(text) <= 1:
                        continue

                    font = span['font']
                    is_bold = 'Bold' in font or 'bold' in font

                    if not is_bold:
                        continue

                    # Skip headers/footers/labels
                    if text.lower().rstrip(':') in {p.rstrip(':') for p in SKIP_PATTERNS}:
                        continue
                    # Skip if it looks like a page header (chapter title at top)
                    bbox = span['bbox']
                    if bbox[1] < 30:  # very top of page
                        continue
                    # Skip footers
                    if bbox[1] > page_height - 20:
                        continue

                    # Convert PDF coords to SVG coords (2x scale)
                    x = int(bbox[0] * 2)
                    y = int(bbox[3] * 2)  # use bottom of bbox for text baseline
                    w = int((bbox[2] - bbox[0]) * 2)

                    # Determine font size based on span width
                    fs = 18 if w > 100 else 16 if w > 60 else 14

                    answers.append({
                        'x': x,
                        'y': y,
                        'answer': text,
                        'fs': fs
                    })

        # Sort by y then x (reading order)
        answers.sort(key=lambda a: (a['y'], a['x']))
        all_answers[pg_num] = answers

    return all_answers


def generate_html(page_images, all_answers, output_path, title='Lecture', ch_label='lecture'):
    """Generate interactive HTML lecture with blanked bold words."""

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{background:#1a1a2e;display:flex;flex-direction:column;align-items:center;padding:20px;min-height:100vh;font-family:'Segoe UI',sans-serif}}
.slide-wrap{{position:relative;width:100%;max-width:960px;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.5);display:none}}
.slide-wrap.active{{display:block}}
.slide-wrap svg{{width:100%;height:auto;display:block}}
.ans{{fill:transparent;cursor:pointer;transition:fill .3s ease;font-family:'Segoe UI',Arial,sans-serif;font-weight:700}}
.ans.revealed{{fill:#c0392b}}
.blank-line{{stroke:#888;stroke-width:1.5;opacity:0.6}}
.blank-line.revealed{{opacity:0}}
.progress-bar{{width:100%;max-width:960px;height:6px;background:#333;border-radius:3px;margin-top:12px;overflow:hidden}}
.progress-fill{{height:100%;background:linear-gradient(90deg,#0B8F8C,#12c4c0);border-radius:3px;transition:width .3s ease;width:0%}}
.controls{{width:100%;max-width:960px;color:rgba(255,255,255,.5);font-size:.8rem;margin-top:10px;display:flex;justify-content:space-between;align-items:center}}
.controls kbd{{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:4px;padding:2px 8px;font-family:monospace;font-size:.8rem;color:rgba(255,255,255,.8)}}
.page-label{{color:#0B8F8C;font-weight:700;font-size:.95rem}}
.controls button{{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 16px;border-radius:6px;cursor:pointer;font-family:inherit;font-size:.85rem}}
.controls button:hover{{background:rgba(255,255,255,.2)}}
</style>
</head>
<body>

<div style="width:100%;max-width:960px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center">
  <div class="page-label" id="page-label">Page 1</div>
  <div style="display:flex;gap:8px">
    <button class="controls button" onclick="prevPage()" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:.85rem">&larr; Prev</button>
    <button class="controls button" onclick="nextPage()" style="background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);color:#fff;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:.85rem">Next &rarr;</button>
  </div>
</div>

'''

    total_answers = 0
    for i, img_path in enumerate(page_images):
        pg_num = i + 1
        active = ' active' if pg_num == 1 else ''
        answers = all_answers.get(pg_num, [])
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
            # Add a white cover rectangle behind the text (hides the printed bold word)
            text_width = len(text) * fs * 0.6 + 8
            rect_height = fs + 6
            html += f'    <rect class="blank-cover" x="{x-2}" y="{y - rect_height + 2}" width="{text_width}" height="{rect_height}" fill="white" stroke="none"/>\n'
            # Add a subtle underline where the blank is
            html += f'    <line class="blank-line" x1="{x}" y1="{y+2}" x2="{x + text_width - 8}" y2="{y+2}"/>\n'
            # Add the answer text (hidden until clicked)
            html += f'    <text class="ans" x="{x}" y="{y}" font-size="{fs}">{safe}</text>\n'
            total_answers += 1

        html += f'  </svg>\n</div>\n'

    html += f'''
<div class="progress-bar"><div class="progress-fill" id="progress"></div></div>
<div class="controls">
  <span><kbd>Click</kbd> / <kbd>&#8594;</kbd> reveal &middot; <kbd>&#8592;</kbd> undo &middot; <kbd>F</kbd> fullscreen</span>
  <span id="counter">0 / {total_answers}</span>
</div>

<script>
var cp=0,pages=document.querySelectorAll('.slide-wrap'),ri={{}},tot={total_answers};
for(var i=0;i<pages.length;i++)ri[i]=0;
function ga(p){{return pages[p].querySelectorAll('.ans')}}
function gl(p){{return pages[p].querySelectorAll('.blank-line')}}
function us(){{var r=0;pages.forEach(function(p){{r+=p.querySelectorAll('.ans.revealed').length}});document.getElementById('counter').textContent=r+' / '+tot;document.getElementById('progress').style.width=(tot?r/tot*100:0)+'%';document.getElementById('page-label').textContent='Page '+(cp+1)+' / '+pages.length}}
function sp(n){{pages[cp].classList.remove('active');cp=n;pages[cp].classList.add('active');us()}}
function nextPage(){{if(cp<pages.length-1)sp(cp+1)}}
function prevPage(){{if(cp>0)sp(cp-1)}}
function rn(){{var a=ga(cp),l=gl(cp),i=ri[cp];if(i<a.length){{a[i].classList.add('revealed');if(l[i])l[i].classList.add('revealed');ri[cp]++;us()}}else{{nextPage()}}}}
function ul(){{var i=ri[cp];if(i>0){{ri[cp]--;var a=ga(cp),l=gl(cp);a[ri[cp]].classList.remove('revealed');if(l[ri[cp]])l[ri[cp]].classList.remove('revealed');us()}}else{{prevPage()}}}}
document.addEventListener('keydown',function(e){{
  if(e.key==='ArrowRight'||e.key===' '){{e.preventDefault();rn()}}
  else if(e.key==='ArrowLeft'||e.key==='Backspace'){{e.preventDefault();ul()}}
  else if(e.key==='ArrowDown'||e.key==='PageDown'){{e.preventDefault();nextPage()}}
  else if(e.key==='ArrowUp'||e.key==='PageUp'){{e.preventDefault();prevPage()}}
  else if(e.key==='f'||e.key==='F'){{if(!document.fullscreenElement)document.documentElement.requestFullscreen();else document.exitFullscreen()}}
}});
document.querySelectorAll('.slide-wrap').forEach(function(s){{s.addEventListener('click',function(e){{if(!e.target.closest('.ans'))rn()}})}});
us();
</script>
</body>
</html>'''

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    return total_answers


def main():
    parser = argparse.ArgumentParser(description='Bold Lecture Builder')
    parser.add_argument('pdf', help='Path to PDF file')
    parser.add_argument('--chapter', type=int, default=0, help='Chapter number')
    parser.add_argument('--skip-pages', type=str, default='', help='Comma-separated page numbers to skip')
    parser.add_argument('--start', type=int, default=1, help='Start page')
    parser.add_argument('--end', type=int, default=0, help='End page')
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

    # Derive title from PDF filename
    pdf_stem = pdf_path.stem
    lecture_title = f'Ch. {ch} Lecture' if ch else 'Lecture'
    if pdf_stem:
        clean = re.sub(r'^Ch\.\s*\d+\s*[-–—]\s*', '', pdf_stem).replace('_', ' ').strip()
        if clean:
            lecture_title = f'Ch. {ch} — {clean}' if ch else clean

    print(f"\n{'='*60}")
    print(f"  BOLD LECTURE BUILDER")
    print(f"  PDF: {pdf_path.name}")
    print(f"  Chapter: {ch}")
    print(f"  Title: {lecture_title}")
    print(f"{'='*60}\n")

    # Step 1: Render pages
    print('[1/3] Rendering PDF pages...')
    page_images = render_pdf_pages(pdf_path, pages_dir)
    print(f'  {len(page_images)} pages rendered\n')

    # Step 2: Extract bold spans
    print('[2/3] Extracting bold text...')
    all_answers = extract_bold_spans(pdf_path, skip_pages)

    # Load and merge any existing manual calibrator entries
    if answers_cache.exists():
        with open(answers_cache, 'r', encoding='utf-8') as f:
            cached = json.load(f)
        for k, v in cached.items():
            pg = int(k)
            if v and pg not in skip_pages:
                # Merge: cached entries take priority (may include manual additions)
                existing_positions = {(a['x'], a['y']) for a in all_answers.get(pg, [])}
                for entry in v:
                    if (entry['x'], entry['y']) not in existing_positions:
                        all_answers.setdefault(pg, []).append(entry)
        print(f'  Merged with cached answers from {answers_cache.name}')

    for pg_num in sorted(all_answers.keys()):
        answers = all_answers[pg_num]
        if pg_num in skip_pages:
            print(f'  Page {pg_num:2d}: SKIPPED')
        elif answers:
            print(f'  Page {pg_num:2d}: {len(answers)} bold terms')
        else:
            print(f'  Page {pg_num:2d}: No bold text')

    # Save answers cache
    cache_data = {str(k): v for k, v in all_answers.items()}
    with open(answers_cache, 'w', encoding='utf-8') as f:
        json.dump(cache_data, f, indent=2)

    # Step 3: Generate HTML
    print(f'\n[3/3] Generating interactive HTML...')
    total = generate_html(page_images, all_answers, output_html,
        title=lecture_title, ch_label=ch_label)

    print(f'  Total answers: {total}')
    print(f'  Output: {output_html}')
    print(f'  Answers cached: {answers_cache}')
    print(f"\n{'='*60}\n")


if __name__ == '__main__':
    main()
