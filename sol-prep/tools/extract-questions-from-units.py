"""Re-extract review-* questions from unit-N.html files (fixed parser).

Replaces the old `extract-review-questions.py` which had two bugs:

  1. Options were extracted from a 3000-char window after each question's
     opening tag. That window often spilled into the NEXT question's
     <li> options, and the options dict (keyed by 'a/b/c/d') overwrote
     the current question's options with the next question's. Result:
     ~half the bank's review-* entries had stems paired with the WRONG
     question's options.
  2. Stems contained <span class="q-num"> and <span class="q-tag">
     wrappers (the visible question number and BIO.x standard code).
     The old parser stripped HTML tags but kept the inner text, so
     stems ended up polluted: "3 (2001-27) ... BIO.1c".

This parser uses BeautifulSoup to walk each <div class="qq..."> as a
discrete subtree, finds options ONLY in that question's own <ul
class="qopts">, and removes q-num / q-tag spans BEFORE cleaning the
stem. Citation prefixes like "(2006-30)" are extracted as a
`sourceCite` metadata field, not left in the stem text.

Output: `build-temp/review-extracted.json` — list of question dicts
ready to merge into question-bank.json (replacing existing review-*).

Usage:  python sol-prep/tools/extract-questions-from-units.py
"""
from __future__ import annotations
import json
import re
from pathlib import Path

from bs4 import BeautifulSoup

SCRIPT_DIR = Path(__file__).resolve().parent
SOL_PREP = SCRIPT_DIR.parent
BUILD_TEMP = SOL_PREP / 'build-temp'
BUILD_TEMP.mkdir(exist_ok=True)
OUT_PATH = BUILD_TEMP / 'review-extracted.json'

UNIT_TO_BIO = {1: 'BIO.1', 2: 'BIO.2', 3: 'BIO.3', 4: 'BIO.4',
               5: 'BIO.5', 6: 'BIO.6', 7: 'BIO.7', 8: 'BIO.8'}

CITATION_RE = re.compile(r'\((\d{4}-\d+)\)')


def clean_text(s: str) -> str:
    """Collapse whitespace and trim."""
    return re.sub(r'\s+', ' ', s).strip()


def extract_stem(stem_div) -> tuple[str, str | None]:
    """Return (clean_stem, source_citation_or_None).

    Removes q-num and q-tag spans, drops citation parens from stem,
    returns the citation as a separate field.
    """
    # Remove the question-number and standard-code spans entirely
    for span in stem_div.select('span.q-num, span.q-tag'):
        span.decompose()
    raw = clean_text(stem_div.get_text(' ', strip=True))
    # Pull citation out of the remaining text
    cite = None
    m = CITATION_RE.search(raw)
    if m:
        cite = m.group(1)
        raw = CITATION_RE.sub('', raw, count=1)
    # Tidy up double spaces left behind, leading punctuation
    raw = re.sub(r'\s+', ' ', raw).strip()
    raw = re.sub(r'^[—\-\s]+', '', raw)
    return raw, cite


def extract_options(qq_div) -> dict[str, str]:
    """Return options dict, scoped to THIS question's qopts <ul> only."""
    opts: dict[str, str] = {}
    qopts_ul = qq_div.find('ul', class_='qopts')
    if qopts_ul is None:
        return opts
    for li in qopts_ul.find_all('li', recursive=False):
        v = li.get('data-v')
        if v not in ('a', 'b', 'c', 'd'):
            continue
        # Drop the leading <div class="ol">A</div> letter marker
        ol = li.find('div', class_='ol')
        if ol is not None:
            ol.decompose()
        opts[v] = clean_text(li.get_text(' ', strip=True))
    return opts


def extract_image(qq_div) -> tuple[bool, str | None]:
    """Detect whether the question has an associated image.

    Returns (has_image, image_src_or_None).
    Considered images: <img>, <canvas> (Chart.js), or sol-img-wrap with
    no inner text content (visual-only divs).
    """
    img = qq_div.find('img')
    if img and img.get('src'):
        return True, img['src']
    canvas = qq_div.find('canvas')
    if canvas:
        return True, None  # Chart.js — not a static image
    return False, None


def extract_explanation(qq_div) -> str | None:
    qexp = qq_div.find('div', class_='qexp')
    if qexp is None:
        return None
    text = clean_text(qexp.get_text(' ', strip=True))
    return text or None


def parse_unit(html_path: Path, unit_num: int) -> list[dict]:
    soup = BeautifulSoup(html_path.read_text(encoding='utf-8'), 'html.parser')
    questions = []

    # Match both `qq gate-q` and bare `qq` divs.
    for qq in soup.select('div.qq'):
        ans = qq.get('data-ans')
        if ans not in ('a', 'b', 'c', 'd'):
            continue
        std = qq.get('data-std') or UNIT_TO_BIO.get(unit_num, f'BIO.{unit_num}')
        stem_div = qq.find('div', class_='q-stem')
        if stem_div is None:
            continue
        stem, cite = extract_stem(stem_div)
        opts = extract_options(qq)
        if len(opts) < 2 or not stem:
            continue
        has_image, image_src = extract_image(qq)
        explanation = extract_explanation(qq)
        cls = qq.get('class') or []
        is_gate = 'gate-q' in cls

        questions.append({
            'unit': unit_num,
            'is_gate': is_gate,
            'stem': stem,
            'options': opts,
            'correct': ans,
            'std': std,
            'sourceCite': cite,
            'hasImage': has_image,
            'imageUrl': image_src,
            'explanation': explanation,
        })
    return questions


def main() -> None:
    all_qs: list[dict] = []
    for unit_num in range(1, 9):
        path = SOL_PREP / f'unit-{unit_num}.html'
        if not path.exists():
            print(f'unit-{unit_num}.html  MISSING')
            continue
        qs = parse_unit(path, unit_num)
        gate_count = sum(1 for q in qs if q['is_gate'])
        prac_count = len(qs) - gate_count
        cite_count = sum(1 for q in qs if q['sourceCite'])
        print(f'unit-{unit_num}.html  total={len(qs)}  gate={gate_count}  practice={prac_count}  cited={cite_count}')
        all_qs.extend(qs)

    OUT_PATH.write_text(
        json.dumps(all_qs, indent=2, ensure_ascii=False),
        encoding='utf-8',
    )
    print(f'\nWrote {len(all_qs)} questions to {OUT_PATH.relative_to(SOL_PREP.parent)}')

    # Quick stats
    by_std = {}
    for q in all_qs:
        by_std[q['std']] = by_std.get(q['std'], 0) + 1
    print('By standard:')
    for std in sorted(by_std):
        print(f'  {std}: {by_std[std]}')


if __name__ == '__main__':
    main()
