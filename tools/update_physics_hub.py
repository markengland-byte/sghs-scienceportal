"""
Physics Hub Updater — Regenerates the module cards in physics/index.html
based on actual built module files + config data.
"""

import json
import sys
import io
import re
from pathlib import Path
from bs4 import BeautifulSoup

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

PROJECT = Path(__file__).parent.parent

UNITS = [
    (1, 'Introduction to Physics', 'Chapter 1', [1]),
    (2, 'Kinematics', 'Chapters 2\u20133', [2, 3]),
    (3, 'Dynamics &amp; Forces', 'Chapters 4\u20136', [4, 5, 6]),
    (4, 'Energy &amp; Momentum', 'Chapters 7\u20138', [7, 8]),
    (5, 'Rotational Mechanics', 'Chapters 9\u201310', [9, 10]),
    (6, 'Fluids', 'Chapters 11\u201312', [11, 12]),
    (7, 'Thermodynamics', 'Chapters 13\u201315', [13, 14, 15]),
    (8, 'Waves &amp; Sound', 'Chapters 16\u201317', [16, 17]),
    (9, 'Electricity', 'Chapters 18\u201321', [18, 19, 20, 21]),
    (10, 'Magnetism &amp; Electromagnetic Waves', 'Chapters 22\u201324', [22, 23, 24]),
    (11, 'Optics', 'Chapters 25\u201327', [25, 26, 27]),
    (12, 'Modern Physics', 'Chapters 28\u201334', [28, 29, 30, 31, 32, 33, 34]),
]


def get_chapter_stats(ch_num):
    config_path = PROJECT / 'tools' / 'configs' / f'physics-ch{ch_num}.json'
    if not config_path.exists():
        return None
    config = json.load(open(config_path, encoding='utf-8'))
    html_path = PROJECT / 'physics' / config['filename']
    if not html_path.exists():
        return None
    with open(html_path, 'r', encoding='utf-8', errors='replace') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')
    panels = len(soup.find_all('div', class_='panel'))
    return {
        'title': config['title'],
        'filename': config['filename'],
        'emoji': config['emoji'],
        'lessons': max(0, panels - 2),
        'images': len(soup.find_all('img')),
        'questions': len(soup.find_all('div', class_='qq')),
    }


def make_live_card(ch, d):
    return (
        f'      <a class="mod-card mc-live" href="{d["filename"]}">'
        f'<div class="mc-top"></div><div class="mc-body">'
        f'<span class="mc-icon">{d["emoji"]}</span>'
        f'<div class="mc-title">Ch. {ch} \u00b7 {d["title"]}</div>'
        f'<div class="mc-stats">'
        f'<span class="mc-stat">{d["lessons"]} lessons</span>'
        f'<span class="mc-stat">{d["images"]} images</span>'
        f'<span class="mc-stat">{d["questions"]} Qs</span>'
        f'</div>'
        f'<div class="mc-cta"><span class="badge-live">\u25cf Live Now</span>'
        f'<div class="mc-cta-arrow">\u2192</div></div>'
        f'</div></a>'
    )


def make_soon_card(ch, title, emoji):
    return (
        f'      <div class="mod-card mod-soon"><div class="mc-top mc-soon"></div>'
        f'<div class="mc-body"><span class="mc-icon">{emoji}</span>'
        f'<div class="mc-title">Ch. {ch} \u00b7 {title}</div>'
        f'<div class="mc-meta">Coming soon.</div>'
        f'<div class="mc-cta"><span class="badge-soon">Coming Soon</span></div>'
        f'</div><div class="soon-overlay">COMING SOON</div></div>'
    )


def main():
    hub_path = PROJECT / 'physics' / 'index.html'
    with open(hub_path, 'r', encoding='utf-8') as f:
        html = f.read()

    # Find the <main> content and replace the unit sections
    main_start = html.index('<main class="main">')
    main_end = html.index('  <div style="margin-top:48px">')

    # Build new cards
    lines = []
    live_count = 0
    for u_num, u_title, u_range, u_chapters in UNITS:
        lines.append(f'  <!-- U{u_num}: {u_title} -->')
        lines.append(f'  <div class="unit-section">')
        lines.append(f'    <div class="unit-header"><div class="unit-num">U{u_num}</div><div class="unit-title">{u_title}</div><span class="unit-ch">{u_range}</span></div>')
        lines.append(f'    <div class="module-grid">')
        for ch in u_chapters:
            d = get_chapter_stats(ch)
            if d:
                lines.append(make_live_card(ch, d))
                live_count += 1
                print(f'  Ch {ch:2d}: LIVE ({d["lessons"]} lessons, {d["images"]} img, {d["questions"]} Qs)')
            else:
                cfg = json.load(open(PROJECT / 'tools' / 'configs' / f'physics-ch{ch}.json', encoding='utf-8'))
                lines.append(make_soon_card(ch, cfg['title'], cfg['emoji']))
                print(f'  Ch {ch:2d}: Coming Soon')
        lines.append(f'    </div>')
        lines.append(f'  </div>')

    new_cards = '\n'.join(lines) + '\n'

    # Replace content between <main> opening and the roadmap div
    before = html[:main_start] + '<main class="main">\n'
    after = html[main_end:]
    new_html = before + new_cards + after

    # Update progress bar
    pct = int(live_count / 34 * 100)
    new_html = re.sub(r'style="width:\d+%"', f'style="width:{pct}%"', new_html, count=1)
    new_html = re.sub(r'<strong>\d+</strong> of 34 modules live', f'<strong>{live_count}</strong> of 34 modules live', new_html)

    with open(hub_path, 'w', encoding='utf-8') as f:
        f.write(new_html)

    print(f'\n  Updated hub: {live_count}/34 live')


if __name__ == '__main__':
    main()
