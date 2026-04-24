"""
Stage 4 of the SOL exam pipeline: merge parsed year-questions.json files into
the master question-bank.json used by practice-test.html.

Idempotent — existing question IDs are skipped, so re-running is safe.
Preserves the pretty-printed (indent=2) format of question-bank.json.

Input:  sol-prep/build-temp/sol{year}-questions.json  (from parse-sol-exam.py)
Output: sol-prep/question-bank.json                  (updated in place)

Usage:  python sol-prep/tools/merge-into-bank.py 2001 2002 2003 2004
"""
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SOL_PREP = SCRIPT_DIR.parent
BUILD_TEMP = SOL_PREP / 'build-temp'
BANK_PATH = SOL_PREP / 'question-bank.json'


def stdparent(std: str) -> str:
    """BIO.1c -> BIO.1, BIO.5 -> BIO.5."""
    if '.' in std:
        head, tail = std.split('.', 1)
        return f'{head}.{tail[0]}' if tail else std
    return std


def main(years):
    bank = json.loads(BANK_PATH.read_text(encoding='utf-8'))
    existing_ids = {q['id'] for q in bank}
    int_years = sorted({q.get('year') for q in bank if isinstance(q.get('year'), int)})
    print(f'Existing bank: {len(bank)} questions, released-exam years: {int_years}')

    added = skipped = 0
    for year in years:
        src = BUILD_TEMP / f'sol{year}-questions.json'
        if not src.exists():
            print(f'MISSING: {src}')
            continue
        for q in json.loads(src.read_text(encoding='utf-8')):
            if q['id'] in existing_ids:
                skipped += 1
                continue
            entry = {
                'id': q['id'],
                'stem': q['stem'],
                'options': q['options'],
                'correct': q['correct'],
                'std': q['std'],
                'year': q['year'],
            }
            if q.get('hasImage'):
                entry['hasImage'] = True
                entry['imageNote'] = ''
                entry['imageUrl'] = f'images/questions/{q["id"]}.png'
            entry['stdParent'] = stdparent(q['std'])
            bank.append(entry)
            existing_ids.add(q['id'])
            added += 1

    # Write back in the pretty-printed format the existing bank uses.
    with BANK_PATH.open('w', encoding='utf-8') as f:
        json.dump(bank, f, indent=2, ensure_ascii=False)
        f.write('\n')

    print(f'Merged: {added} new, {skipped} duplicates skipped')
    print(f'Bank size: {len(bank)} ({sum(1 for q in bank if q.get("hasImage"))} with images)')


if __name__ == '__main__':
    years = [int(y) for y in sys.argv[1:]] or [2001, 2002, 2003, 2004]
    main(years)
