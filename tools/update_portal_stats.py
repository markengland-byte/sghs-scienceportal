"""
Portal Stats Updater — Reads all module HTML files and updates the main
portal page (index.html) with accurate course, module, lesson, and question counts.

Usage:
    python tools/update_portal_stats.py

Scans ap/, biology/, and sol-prep/ folders for module HTML files,
counts panels (lessons) and quiz questions, then updates the portalStats
object in index.html.
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


def main():
    project_root = Path(__file__).parent.parent
    index_path = project_root / 'index.html'

    print(f"\n{'='*60}")
    print(f"  UPDATING PORTAL STATS")
    print(f"{'='*60}\n")

    total_modules = 0
    total_lessons = 0
    total_questions = 0

    # Scan all module folders
    for folder in ['ap', 'biology', 'sol-prep', 'physics']:
        folder_path = project_root / folder
        if not folder_path.is_dir():
            continue

        folder_modules = 0
        folder_lessons = 0
        folder_questions = 0

        for f in sorted(folder_path.iterdir()):
            if f.suffix == '.html' and f.name not in ('index.html', 'dashboard.html'):
                with open(f, 'r', encoding='utf-8', errors='replace') as fh:
                    soup = BeautifulSoup(fh.read(), 'html.parser')

                panels = soup.find_all('div', class_='panel')
                lessons = max(0, len(panels) - 2)  # minus overview + review
                questions = len(soup.find_all('div', class_='qq'))

                folder_modules += 1
                folder_lessons += lessons
                folder_questions += questions

        total_modules += folder_modules
        total_lessons += folder_lessons
        total_questions += folder_questions
        print(f"  {folder + '/':15s} {folder_modules:>3} modules, {folder_lessons:>4} lessons, {folder_questions:>5} questions")

    # Count courses from course cards
    with open(index_path, 'r', encoding='utf-8', errors='replace') as f:
        html = f.read()
    courses = len(re.findall(r'class="course-card', html))

    print(f"\n  {'TOTAL':15s} {total_modules:>3} modules, {total_lessons:>4} lessons, {total_questions:>5} questions")
    print(f"  {'COURSES':15s} {courses}")

    # Update the portalStats line in index.html
    new_stats = f'var portalStats = {{ courses: {courses}, modules: {total_modules}, lessons: {total_lessons}, questions: {total_questions} }};'
    updated = re.sub(
        r'var portalStats\s*=\s*\{[^}]+\};',
        new_stats,
        html
    )

    if updated != html:
        with open(index_path, 'w', encoding='utf-8') as f:
            f.write(updated)
        print(f"\n  Updated portal stats in index.html")
    else:
        print(f"\n  Stats already up to date")

    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
