"""
Hub Stats Updater — Reads actual module HTML files and updates the A&P hub
page (ap/index.html) with accurate lesson counts, image counts, and question counts.

Usage:
    python tools/update_hub_stats.py

Reads each module HTML file referenced in ap/index.html, counts the actual
panels, images, and quiz questions, then updates the mc-stats spans in place.
"""

import sys
import os
import re
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    from bs4 import BeautifulSoup
except ImportError:
    print("Install: pip install beautifulsoup4")
    sys.exit(1)


def get_module_stats(filepath):
    """Read a module HTML file and return actual stats."""
    with open(filepath, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')

    # Panels (subtract 2: overview + review = content panels)
    panels = soup.find_all('div', class_='panel')
    content_panels = max(0, len(panels) - 2)  # overview + review don't count as "lessons"
    lesson_count = content_panels

    # Images
    images = [img for img in soup.find_all('img') if 'images/' in img.get('src', '')]
    img_count = len(images)

    # Quiz questions (count unique questions — in section quizzes only, not the review panel)
    # Actually count all unique questions since some appear in both section and review
    all_qq = soup.find_all('div', class_='qq')
    # The review panel duplicates section questions, so count total unique by question text
    seen = set()
    unique_qs = 0
    for qq in all_qq:
        qt = qq.find('span', class_='qt-inner')
        if qt:
            text = qt.get_text(strip=True)[:80]
            if text not in seen:
                seen.add(text)
                unique_qs += 1

    # Vocab cards
    vocab_count = len(soup.find_all('div', class_='vcard'))

    return {
        'lessons': lesson_count,
        'images': img_count,
        'questions': unique_qs,
        'vocab': vocab_count,
    }


def main():
    project_root = Path(__file__).parent.parent
    hub_path = project_root / 'ap' / 'index.html'

    print(f"\n{'='*60}")
    print(f"  UPDATING HUB STATS")
    print(f"  Hub: {hub_path}")
    print(f"{'='*60}\n")

    with open(hub_path, 'r', encoding='utf-8') as f:
        hub_html = f.read()

    # Find all module hrefs in the hub
    hrefs = re.findall(r'href="([^"]+\.html)"', hub_html)
    module_hrefs = [h for h in hrefs if h != '../index.html' and not h.startswith('http')]

    updates = 0
    for href in module_hrefs:
        filepath = project_root / 'ap' / href
        if not filepath.exists():
            print(f"  SKIP: {href} (file not found)")
            continue

        stats = get_module_stats(str(filepath))

        # Build the new stats HTML
        new_stats = f'<span class="mc-stat">{stats["lessons"]} lessons</span><span class="mc-stat">{stats["images"]} images</span><span class="mc-stat">{stats["questions"]} Qs</span>'

        # Find the existing mc-stats div for this module's card
        # Pattern: href="filename.html" ... <div class="mc-stats">...</div>
        # We need to find the mc-stats that belongs to this specific card
        pattern = re.compile(
            r'(href="' + re.escape(href) + r'".*?<div class="mc-stats">)(.*?)(</div>)',
            re.DOTALL
        )

        match = pattern.search(hub_html)
        if match:
            old_stats = match.group(2)
            if old_stats.strip() != new_stats.strip():
                hub_html = hub_html[:match.start(2)] + new_stats + hub_html[match.end(2):]
                print(f"  UPDATED: {href:<35} {stats['lessons']} lessons, {stats['images']} images, {stats['questions']} Qs")
                updates += 1
            else:
                print(f"  OK:      {href:<35} {stats['lessons']} lessons, {stats['images']} images, {stats['questions']} Qs")
        else:
            print(f"  SKIP:    {href:<35} (stats div not found in hub)")

    # Write back
    if updates > 0:
        with open(hub_path, 'w', encoding='utf-8') as f:
            f.write(hub_html)
        print(f"\n  Updated {updates} module cards in hub.")
    else:
        print(f"\n  All stats already accurate. No changes needed.")

    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
