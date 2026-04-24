"""
Stage 3 of the SOL exam pipeline: crop per-question images from exam page PNGs.

Uses per-year page maps to know which page + crop box belongs to each question.
For 2005-2015 the maps are hand-built (from visual inspection). For 2001-2004
they're auto-derived from the `page` field written by parse-sol-exam.py.

Input:  sol-prep/build-temp/exam-pages/{year}-p{NN}.png  (from render-exam-pdfs.py)
        sol-prep/build-temp/sol{year}-questions.json     (from parse-sol-exam.py)
Output: sol-prep/images/questions/{year}-{qnum}.png

Usage:  python sol-prep/tools/crop-images-v2.py
"""
import json
import os
from pathlib import Path

from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
SOL_PREP = SCRIPT_DIR.parent
BUILD_TEMP = SOL_PREP / 'build-temp'
PAGES_DIR = BUILD_TEMP / 'exam-pages'
OUT_DIR = SOL_PREP / 'images' / 'questions'
OUT_DIR.mkdir(parents=True, exist_ok=True)

# ── Load all image-bearing questions across all year JSONs ──
all_qs = []
for year in [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2015]:
    path = BUILD_TEMP / f'sol{year}-questions.json'
    if not path.exists():
        continue
    with open(path, 'r', encoding='utf-8') as f:
        for q in json.load(f):
            if q.get('hasImage'):
                all_qs.append(q)
print(f'Image questions to process: {len(all_qs)}')


# ══════════════════════════════════════════════════════════
# PAGE MAPS: question_number → (page, crop_box)
# Hand-built for 2005-2015 from visual inspection of exam pages.
# ══════════════════════════════════════════════════════════

def build_2005_map():
    """2005: 1350x1710, 2-column, 4 Qs/page. p02: Q1-2 (right col). p03+: quadrants."""
    W, H = 1350, 1710
    mt, mb = 30, 60
    mx = W // 2
    my = (H - mt - mb) // 2 + mt

    boxes = {
        'LT': (0, mt, mx, my),
        'LB': (0, my, mx, H - mb),
        'RT': (mx, mt, W, my),
        'RB': (mx, my, W, H - mb),
    }
    pos_order = ['LT', 'LB', 'RT', 'RB']

    m = {}
    m[1] = (2, boxes['RT'])
    m[2] = (2, boxes['RB'])
    for qn in range(3, 51):
        page = (qn - 3) // 4 + 3
        pos = (qn - 3) % 4
        m[qn] = (page, boxes[pos_order[pos]])
    return m


def build_2006_map():
    """2006: 1212x1572, 2-column, variable density (2/3/4/5 questions per page)."""
    W, H = 1212, 1572
    mt, mb = 30, 50
    mx = W // 2
    th = (H - mt - mb) // 3
    hh = (H - mt - mb) // 2

    def left_third(i):
        return (0, mt + i * th, mx, mt + (i + 1) * th)

    def right_half(i):
        return (mx, mt + i * hh, W, mt + (i + 1) * hh)

    def left_half(i):
        return (0, mt + i * hh, mx, mt + (i + 1) * hh)

    page_starts = {
        3: [1, 2],
        4: [3, 4, 5, 6, 7],
        5: [8, 9, 10, 11, 12],
        6: [13, 14],
        7: [15, 16, 17, 18, 19],
        8: [20, 21, 22, 23, 24],
        9: [25, 26, 27, 28],
        10: [29, 30, 31, 32, 33],
        11: [34, 35, 36, 37, 38],
        12: [39, 40, 41, 42, 43],
        13: [44, 45, 46],
        14: [47, 48],
        15: [49, 50],
    }

    m = {}
    for page, qnums in page_starts.items():
        n = len(qnums)
        for i, qn in enumerate(qnums):
            if page == 3:
                m[qn] = (page, right_half(i))
            elif n == 5:
                m[qn] = (page, left_third(i) if i < 3 else right_half(i - 3))
            elif n == 4:
                m[qn] = (page, left_half(i) if i < 2 else right_half(i - 2))
            elif n == 3:
                m[qn] = (page, left_half(i) if i < 2 else right_half(0))
            elif n == 2:
                m[qn] = (page, left_half(0) if i == 0 else right_half(0))
    return m


def build_2007_map():
    """2007: 1212x1572, 1-column, ~2 Qs/page."""
    W, H = 1212, 1572
    mt, mb = 30, 50
    my = (H - mt - mb) // 2 + mt
    m = {}
    for qn in range(1, 51):
        page = (qn - 1) // 2 + 4
        pos = (qn - 1) % 2
        m[qn] = (page, (0, mt, W, my) if pos == 0 else (0, my, W, H - mb))
    return m


def build_2008_map():
    """2008: 1224x1584, 1-column, ~2 Qs/page."""
    W, H = 1224, 1584
    mt, mb = 30, 50
    my = (H - mt - mb) // 2 + mt
    m = {}
    for qn in range(1, 51):
        page = (qn - 1) // 2 + 4
        pos = (qn - 1) % 2
        m[qn] = (page, (0, mt, W, my) if pos == 0 else (0, my, W, H - mb))
    return m


def build_2015_map():
    """2015: 1566x1206, landscape, ~1 Q/page."""
    W, H = 1566, 1206
    mt, mb = 15, 40
    m = {}
    for qn in range(1, 50):
        m[qn] = (qn + 3, (0, mt, W, H - mb))
    return m


# ══════════════════════════════════════════════════════════
# 2001-2004 maps: auto-derived from the parser's `page` field.
# Two-column portrait layout; left column fills top-to-bottom before right.
# Slot heights depend on how many questions share the page.
# ══════════════════════════════════════════════════════════

def build_2001_2004_map(year: int, width: int, height: int):
    path = BUILD_TEMP / f'sol{year}-questions.json'
    if not path.exists():
        return {}
    with open(path, 'r', encoding='utf-8') as f:
        questions = json.load(f)

    mt, mb = 30, 60
    mx = width // 2

    page_starts = {}
    for q in questions:
        if not q.get('hasImage'):
            continue
        page = q.get('page')
        if page is None:
            continue
        page_starts.setdefault(page, []).append(q['qnum'])
    for p in page_starts:
        page_starts[p] = sorted(page_starts[p])

    page_total_counts = {}
    for q in questions:
        page = q.get('page')
        if page is None:
            continue
        page_total_counts[page] = page_total_counts.get(page, 0) + 1

    m = {}
    for page, qnums_with_image in page_starts.items():
        n_total = page_total_counts.get(page, len(qnums_with_image))
        all_qnums_on_page = sorted(
            q['qnum'] for q in questions if q.get('page') == page
        )

        n_left = (n_total + 1) // 2
        n_right = n_total - n_left
        usable_h = (height - mt - mb)

        def slot_box(col, slot, slots_in_col):
            h_per_slot = usable_h // max(slots_in_col, 1)
            y1 = mt + slot * h_per_slot
            y2 = mt + (slot + 1) * h_per_slot if slot < slots_in_col - 1 else height - mb
            return (0, y1, mx, y2) if col == 0 else (mx, y1, width, y2)

        for qn in qnums_with_image:
            try:
                pos = all_qnums_on_page.index(qn)
            except ValueError:
                continue
            if pos < n_left:
                box = slot_box(0, pos, n_left)
            else:
                box = slot_box(1, pos - n_left, n_right if n_right else 1)
            m[qn] = (page, box)
    return m


# Page dimensions observed from PyMuPDF render at 150 DPI.
maps = {
    2001: build_2001_2004_map(2001, 1275, 1650),
    2002: build_2001_2004_map(2002, 1250, 1630),
    2003: build_2001_2004_map(2003, 1407, 1782),
    2004: build_2001_2004_map(2004, 1257, 1632),
    2005: build_2005_map(),
    2006: build_2006_map(),
    2007: build_2007_map(),
    2008: build_2008_map(),
    2015: build_2015_map(),
}

# Per-question crop overrides for cases where the generic layout misses content.
# Format: {(year, qnum): (page, (x1, y1, x2, y2))}
# Typical reason: unequal vertical split on a page (e.g., a question with a big
# data table needs more height than the auto-layout's equal slots allow).
OVERRIDES = {
    # 2001 p9: Q16 is small + Q17 has a big cell-features table that needs 2/3 of
    # the left column. Auto-halves put Q17's crop too low, missing the table.
    (2001, 17): (9, (0, 420, 640, 1220)),
    # 2004 p10: Q29's Population Fluctuations graph sits above the stem, taking
    # more vertical space than auto-halves allow. Extend crop upward to capture
    # the graph title + full y-axis range + legend; bottom stretches to include
    # all four options.
    (2004, 29): (10, (0, 400, 628, 1400)),
}
for (year, qnum), mapping in OVERRIDES.items():
    maps.setdefault(year, {})[qnum] = mapping

# ── Crop each image-bearing question ──
success = 0
failed = []
warnings = []

for q in all_qs:
    qid = q['id']
    year = q['year']
    qnum = q['qnum']

    m = maps.get(year, {})
    if qnum not in m:
        failed.append((qid, 'not in page map'))
        continue

    page, box = m[qnum]
    page_file = PAGES_DIR / f'{year}-p{page:02d}.png'

    if not page_file.exists():
        found = False
        for offset in [-1, 1, -2, 2]:
            alt = PAGES_DIR / f'{year}-p{page + offset:02d}.png'
            if alt.exists():
                page_file = alt
                warnings.append((qid, f'used page {page + offset} instead of {page}'))
                found = True
                break
        if not found:
            failed.append((qid, f'page {page} not found'))
            continue

    try:
        img = Image.open(page_file)
        x1 = max(0, box[0])
        y1 = max(0, box[1])
        x2 = min(img.width, box[2])
        y2 = min(img.height, box[3])
        cropped = img.crop((x1, y1, x2, y2))

        # Flag likely-misaligned crops (mostly white pixels).
        gray = cropped.convert('L')
        pixels = list(gray.getdata())
        white_pct = sum(1 for p in pixels if p > 240) / len(pixels) * 100
        if white_pct > 95:
            warnings.append((qid, f'mostly blank ({white_pct:.0f}% white)'))

        cropped.save(OUT_DIR / f'{qid}.png', 'PNG', optimize=True)
        success += 1
    except Exception as e:
        failed.append((qid, str(e)))

print(f'\nResults: {success} cropped, {len(failed)} failed, {len(warnings)} warnings')
if failed:
    print('\nFailed:')
    for qid, reason in failed:
        print(f'  {qid}: {reason}')
if warnings:
    print('\nWarnings:')
    for qid, reason in warnings:
        print(f'  {qid}: {reason}')
