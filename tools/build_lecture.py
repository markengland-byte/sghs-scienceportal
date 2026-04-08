"""
Lecture Slide Generator — Creates interactive HTML lecture from PDF guided notes.

1. Renders PDF pages as images (already done)
2. Scans each page image for underscore blanks (pixel detection)
3. Pairs blanks with answers from answer key
4. Generates a single HTML file with SVG overlays and click-to-reveal

Usage:
    python tools/build_lecture.py

Output: slides/ch1-lecture.html (self-contained with image references)
"""

import sys
import io
import importlib.util
from pathlib import Path
from PIL import Image
import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = Path(__file__).parent.parent


def scan_underscores(img_path):
    """Scan a page image for horizontal underscore blanks. Returns list of (x, y, x1, width)."""
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

    # Merge adjacent rows (same underscore spans multiple pixel rows)
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


def generate_html(pages_dir, answers_module, output_path, title='Lecture', img_w=1224, img_h=1584):
    """Generate the interactive lecture HTML file."""

    # Load answer key
    spec = importlib.util.spec_from_file_location('answers', answers_module)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    ANSWERS = mod.ANSWERS

    # Find all page images
    page_images = sorted(pages_dir.glob('page-*.png'))
    num_pages = len(page_images)

    print(f'  Pages: {num_pages}')
    print(f'  Image size: {img_w} x {img_h}')

    # Scan and pair
    total_blanks = 0
    total_answers = 0
    page_data = []

    for pg_num, img_path in enumerate(page_images, 1):
        blanks = scan_underscores(img_path)
        answers = ANSWERS.get(pg_num, [])

        # Pair blanks with answers
        paired = []
        for i, (x0, y, x1, w) in enumerate(blanks):
            answer = answers[i] if i < len(answers) else None
            if answer:  # Skip None (decorative lines)
                # SVG text y = underscore y - 2 (baseline just above the line)
                svg_y = y - 2
                # Font size based on blank width
                fs = 18 if w > 100 else 16 if w > 60 else 14
                paired.append((x0, svg_y, answer, fs))
                total_answers += 1

        # Add manual overrides (for blanks inside images that scanner can't detect)
        manual_key = f'{pg_num}_manual'
        manual = ANSWERS.get(manual_key, [])
        for m in manual:
            x, y, answer, fs = m
            paired.append((x, y, answer, fs))
            total_answers += 1

        # Sort all answers by y position (reading order: top to bottom)
        paired.sort(key=lambda a: (a[1], a[0]))

        page_data.append({
            'num': pg_num,
            'img': img_path.name,
            'blanks': len(blanks),
            'answers': paired,
        })
        total_blanks += len(blanks)
        print(f'  Page {pg_num:2d}: {len(blanks):2d} blanks, {len(paired):2d} answers')

    # Determine relative image path from output to pages dir
    rel_img_path = 'images'

    # Generate HTML
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

    # Generate each page slide
    for pd in page_data:
        active = ' active' if pd['num'] == 1 else ''
        html += f'\n<div class="slide-wrap{active}" id="page-{pd["num"]}">\n'
        html += f'  <svg viewBox="0 0 {img_w} {img_h}" xmlns="http://www.w3.org/2000/svg">\n'
        html += f'    <image href="{rel_img_path}/{pd["img"]}" x="0" y="0" width="{img_w}" height="{img_h}"/>\n'

        for x, y, answer, fs in pd['answers']:
            # Escape HTML entities in answer
            safe = answer.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')
            html += f'    <text class="ans" x="{x}" y="{y}" font-size="{fs}">{safe}</text>\n'

        html += f'  </svg>\n'
        html += f'</div>\n'

    # Progress bar and controls
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
    document.getElementById('status').textContent='Page '+(cp+1)+' \\u00b7 '+r+' / '+t;
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

    # Write output
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html)

    print(f'\n  Total blanks detected: {total_blanks}')
    print(f'  Total answers placed:  {total_answers}')
    print(f'  Output: {output_path}')


def main():
    pages_dir = PROJECT_ROOT / 'slides' / 'images' / 'ch1' / 'pages'
    answers_file = PROJECT_ROOT / 'tools' / 'lecture_answers_ch1.py'
    output_file = PROJECT_ROOT / 'slides' / 'ch1-lecture.html'

    print(f"\n{'='*60}")
    print(f"  BUILDING LECTURE: Campbell Biology Ch. 1")
    print(f"{'='*60}\n")

    generate_html(
        pages_dir=pages_dir,
        answers_module=str(answers_file),
        output_path=output_file,
        title='Ch. 1 — Evolution, Themes of Biology & Scientific Inquiry',
    )

    print(f"\n{'='*60}\n")


if __name__ == '__main__':
    main()
