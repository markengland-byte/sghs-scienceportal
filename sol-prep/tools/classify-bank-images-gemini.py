"""
Classify remaining bank PNG images using Gemini vision.

Targets every `question-bank.json` entry with `hasImage: true` that doesn't
already have a `chart` or `table` field — these are images we haven't
converted to native rendering yet.

For each, sends the PNG to Gemini with a classification prompt, asks it to
tell us whether the image is:
- CHART (graph/plot): a Chart.js conversion candidate
- TABLE: an HTML table candidate
- PUNNETT: a Punnett square (convertible to HTML table)
- DICHOTOMOUS_KEY: branching key (convertible to HTML table or styled list)
- PICTURE_OPTIONS: four labeled answer options as images (keep as PNG)
- ILLUSTRATION: drawing/photo/diagram (keep as PNG)
- MIXED: combination type
- BLANK: crop failed

Writes a JSON report to build-temp/gemini-classification.json with each
entry's classification + description + confidence.

Usage:
    python sol-prep/build-temp/classify-bank-images-gemini.py [--limit N] [--resume]
"""
import json
import os
import re
import sys
import time
from pathlib import Path

import google.generativeai as genai
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
SOL_PREP = SCRIPT_DIR.parent
BANK_PATH = SOL_PREP / 'question-bank.json'
IMG_DIR = SOL_PREP / 'images' / 'questions'
REPORT_PATH = SCRIPT_DIR / 'gemini-classification.json'
ENV_PATH = Path(r'C:/Users/Mark England/Desktop/biology_sol_platform/backend/.env')


def load_api_key() -> str:
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if key.startswith('AIza') and len(key) >= 39:
        return key[:39] if len(key) > 39 else key
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            if line.startswith('GEMINI_API_KEY='):
                raw = line.split('=', 1)[1].strip().strip('"').strip("'")
                if raw.startswith('AIza'):
                    return raw[:39]
                return raw.split()[0]
    raise SystemExit('GEMINI_API_KEY not found in env or .env')


PROMPT = """You are classifying an image from a Virginia Biology SOL exam question bank.

Return exactly one JSON object with these keys:
{
  "classification": "CHART" | "TABLE" | "PUNNETT" | "DICHOTOMOUS_KEY" | "PICTURE_OPTIONS" | "ILLUSTRATION" | "MIXED" | "BLANK",
  "confidence": 0.0-1.0,
  "description": "one-sentence summary of what the image shows"
}

Definitions:
- CHART: A data visualization with x/y axes — line graph, bar graph, pie chart, histogram, scatter plot. Punnett squares and food webs do NOT count as charts.
- TABLE: A grid of data with labeled rows and columns that a student reads values from.
- PUNNETT: A Punnett square showing allele combinations (2x2, 4x4, etc.).
- DICHOTOMOUS_KEY: A branching identification key.
- PICTURE_OPTIONS: The image is MOSTLY a set of 3-5 labeled answer options (A/B/C/D or F/G/H/J) where each option is itself a small picture or diagram. The student picks by appearance.
- ILLUSTRATION: A diagram, drawing, photograph, anatomical figure, cladogram, food web, cell diagram, phylogenetic tree, map, or other picture that's not a data viz.
- MIXED: Has significant portions of two of the above categories (e.g., a data table above 4 picture options).
- BLANK: Image is mostly empty white space — crop failed.

Only respond with the JSON object. No preamble."""


def classify_image(model, img_path: Path) -> dict:
    img = Image.open(img_path)
    try:
        resp = model.generate_content(
            [PROMPT, img],
            generation_config={'temperature': 0.0, 'response_mime_type': 'application/json'},
        )
        text = resp.text.strip()
        return json.loads(text)
    except Exception as e:
        return {'classification': 'ERROR', 'confidence': 0.0, 'description': str(e)[:200]}


def main():
    limit = None
    resume = False
    for arg in sys.argv[1:]:
        if arg == '--resume':
            resume = True
        elif arg.startswith('--limit='):
            limit = int(arg.split('=', 1)[1])
        elif arg == '--limit' and '--limit' in sys.argv:
            idx = sys.argv.index('--limit')
            limit = int(sys.argv[idx + 1])

    genai.configure(api_key=load_api_key())
    # gemini-2.0-flash is deprecated for new users; 2.5-flash-lite is the
    # cheap + fast current option with vision support and generous quota.
    model = genai.GenerativeModel('gemini-2.5-flash-lite')

    bank = json.loads(BANK_PATH.read_text(encoding='utf-8'))
    targets = []
    for q in bank:
        if not q.get('hasImage'):
            continue
        if 'chart' in q or 'table' in q:
            continue
        qid = q['id']
        img_path = IMG_DIR / f'{qid}.png'
        if not img_path.exists():
            continue
        targets.append((qid, img_path, q.get('imageNote', '')[:100], q.get('stem', '')[:100]))

    existing = {}
    if resume and REPORT_PATH.exists():
        existing = json.loads(REPORT_PATH.read_text(encoding='utf-8'))
        targets = [t for t in targets if t[0] not in existing]
        print(f'Resume: skipping {len(existing)} already classified')

    print(f'Targets to classify: {len(targets)}')
    if limit:
        targets = targets[:limit]
        print(f'Limiting to first {limit}')

    results = dict(existing)
    for i, (qid, img_path, note, stem) in enumerate(targets):
        print(f'[{i+1}/{len(targets)}] {qid} ...', end='', flush=True)
        result = classify_image(model, img_path)
        result['qid'] = qid
        result['original_note'] = note
        result['original_stem'] = stem
        results[qid] = result
        print(f' {result.get("classification", "?")} (conf {result.get("confidence", 0):.2f})')
        # Save incremental — allow resume if interrupted
        if (i + 1) % 10 == 0 or (i + 1) == len(targets):
            REPORT_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')
        # Gentle rate limit for Gemini Flash (free tier = 15 RPM, paid = much higher).
        time.sleep(0.5)

    # Final write
    REPORT_PATH.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf-8')

    # Summary
    from collections import Counter
    classes = Counter(r.get('classification', 'ERROR') for r in results.values())
    print('\n=== Classification summary ===')
    for cls, n in classes.most_common():
        print(f'  {cls:<20} {n}')
    print(f'\nReport saved: {REPORT_PATH}')


if __name__ == '__main__':
    main()
