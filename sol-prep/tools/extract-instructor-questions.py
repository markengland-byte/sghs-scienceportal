"""
Extract instructor-written interactive questions (no SOL citation) from
unit-1.html through unit-8.html, deduplicate against existing bank, and
merge into question-bank.json.

Filters:
- Only takes questions WITHOUT a `(YYYY-NN)` citation in the stem — those
  with citations are paraphrases of released SOL exam entries already in
  the bank under their numeric IDs.
- Skips questions with fewer than 2 parsed options (malformed extraction).

ID allocation: starts at review-{max_existing+1} to avoid collisions with
the 318 existing review entries.

Writes a preview to stdout and only modifies question-bank.json if --apply
is passed.

Usage:  python extract-instructor-questions.py [--apply]
"""
import html
import json
import re
import sys
from collections import Counter
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SOL_PREP = SCRIPT_DIR.parent
BANK_PATH = SOL_PREP / 'question-bank.json'
CITATION_RE = re.compile(r'\(20[0-1][0-9]-\d+\)')


def clean(text: str) -> str:
    text = html.unescape(text)
    text = re.sub(r'<[^>]+>', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def extract_qq_blocks(html_text: str, unit_num: int):
    """Yield one dict per interactive question in the HTML."""
    # Find each <div class="qq ..."> opening tag
    for match in re.finditer(r'<div[^>]*class="[^"]*\bqq\b[^"]*"[^>]*>', html_text):
        tag = match.group(0)
        start = match.end()

        ans_m = re.search(r'data-ans="([a-d])"', tag)
        if not ans_m:
            continue
        correct = ans_m.group(1)
        std_m = re.search(r'data-std="([^"]*)"', tag)
        std = std_m.group(1) if std_m else f'BIO.{unit_num}'

        # Question stem is the first <div class="q-stem">...</div>
        stem_m = re.search(r'<div class="q-stem">(.*?)</div>', html_text[start:start + 3000], re.DOTALL)
        if not stem_m:
            continue
        raw_stem = stem_m.group(1)
        stem = clean(raw_stem)
        # Strip leading "1." / "1)" / "?" pattern left by q-num span
        stem = re.sub(r'^[\?\d]+[\.\)]?\s*', '', stem).strip()

        # Options keyed by a-d
        opts = {}
        region = html_text[start:start + 4000]
        for opt_m in re.finditer(
            r'<li[^>]*data-v="([a-d])"[^>]*>.*?<div class="ol">[A-D]</div>(.*?)</li>',
            region, re.DOTALL,
        ):
            opts[opt_m.group(1)] = clean(opt_m.group(2))

        if len(opts) < 2 or not stem:
            continue

        # Look for an associated image wired right before or inside the question
        img_m = re.search(r'<img[^>]*class="sol-img"[^>]*src="([^"]+)"', html_text[start - 500:start + 1500])

        yield {
            'stem': stem,
            'options': opts,
            'correct': correct,
            'std': std,
            'unit': unit_num,
            'hasImage': bool(img_m),
            'imageUrl': img_m.group(1) if img_m else None,
            'raw_stem_snippet': raw_stem[:120],
        }


def normalize_stem(stem: str) -> str:
    s = stem.lower()
    s = re.sub(r'[^a-z0-9\s]', '', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:120]


def main(apply: bool):
    bank = json.loads(BANK_PATH.read_text(encoding='utf-8'))
    existing_ids = {q['id'] for q in bank}
    existing_stems = {normalize_stem(q['stem']) for q in bank}

    # Find highest review-N number already used
    max_review = 0
    for qid in existing_ids:
        m = re.match(r'review-(\d+)$', qid)
        if m:
            max_review = max(max_review, int(m.group(1)))

    print(f'Existing bank: {len(bank)} questions; review IDs go up to review-{max_review}')

    all_candidates = []
    by_unit_stats = {}
    for unit in range(1, 9):
        path = SOL_PREP / f'unit-{unit}.html'
        if not path.exists():
            continue
        html_text = path.read_text(encoding='utf-8')
        total_for_unit = 0
        cited_for_unit = 0
        kept_for_unit = 0
        for q in extract_qq_blocks(html_text, unit):
            total_for_unit += 1
            if CITATION_RE.search(q['stem']):
                cited_for_unit += 1
                continue
            all_candidates.append(q)
            kept_for_unit += 1
        by_unit_stats[unit] = (total_for_unit, cited_for_unit, kept_for_unit)

    print('\nPer-unit extraction (filtering out SOL-cited paraphrases):')
    print(f'{"Unit":<6}{"Total":<8}{"Cited":<8}{"Instructor-written":<20}')
    for unit, (t, c, k) in by_unit_stats.items():
        print(f'{unit:<6}{t:<8}{c:<8}{k:<20}')
    totals = [sum(r[i] for r in by_unit_stats.values()) for i in range(3)]
    print(f'{"TOTAL":<6}{totals[0]:<8}{totals[1]:<8}{totals[2]:<20}')

    # Dedupe against bank (normalized stem match)
    to_add = []
    dupes = 0
    for q in all_candidates:
        norm = normalize_stem(q['stem'])
        if norm in existing_stems:
            dupes += 1
            continue
        existing_stems.add(norm)
        to_add.append(q)

    print(f'\nDuplicates (normalized stem already in bank): {dupes}')
    print(f'Net new questions: {len(to_add)}')

    by_std = Counter(q['std'] for q in to_add)
    print(f'\nNew questions by std:')
    for s, n in sorted(by_std.items()):
        print(f'  {s}: {n}')

    if not apply:
        print('\n(preview only — pass --apply to write to question-bank.json)')
        print('\nFirst 5 new entries (stems preview):')
        for q in to_add[:5]:
            print(f'  [{q["std"]}] unit-{q["unit"]}: {q["stem"][:120]}')
        return

    # Apply: assign IDs + insert into bank
    next_id = max_review + 1
    appended = []
    for q in to_add:
        entry = {
            'id': f'review-{next_id}',
            'stem': q['stem'],
            'options': q['options'],
            'correct': q['correct'],
            'std': q['std'],
            'year': 'review',
        }
        if q.get('hasImage') and q.get('imageUrl'):
            entry['hasImage'] = True
            entry['imageUrl'] = q['imageUrl']
            entry['imageNote'] = ''
        else:
            entry['hasImage'] = False
        # stdParent
        std = q['std']
        entry['stdParent'] = f"{std.split('.')[0]}.{std.split('.')[1][0]}" if '.' in std else std
        bank.append(entry)
        appended.append(entry)
        next_id += 1

    with BANK_PATH.open('w', encoding='utf-8') as f:
        json.dump(bank, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f'\nApplied: wrote {len(bank)} questions to {BANK_PATH.name}')
    print(f'Added {len(appended)} new review entries: review-{max_review+1} to review-{max_review+len(appended)}')


if __name__ == '__main__':
    apply_flag = '--apply' in sys.argv
    main(apply_flag)
