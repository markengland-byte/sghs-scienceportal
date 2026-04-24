"""
Stage 1 of the SOL exam pipeline: render each released exam PDF to per-page PNGs
and extract raw text. Run this first when adding a new exam year.

Input:  REPO_ROOT/SOL Questions/BiologySOL{year}.pdf
Output: sol-prep/build-temp/exam-pages/{year}-p{NN}.png  (one per PDF page)
        sol-prep/build-temp/sol{year}-raw.txt            (concatenated page text)

Usage:  python sol-prep/tools/render-exam-pdfs.py 2001 2002 2003 2004
"""
import sys
from pathlib import Path

import fitz  # PyMuPDF
from PIL import Image  # noqa: F401 — imported to fail fast if Pillow is missing

SCRIPT_DIR = Path(__file__).resolve().parent
SOL_PREP = SCRIPT_DIR.parent
REPO_ROOT = SOL_PREP.parent
PDF_DIR = REPO_ROOT / 'SOL Questions'
BUILD_TEMP = SOL_PREP / 'build-temp'
EXAM_PAGES = BUILD_TEMP / 'exam-pages'
EXAM_PAGES.mkdir(parents=True, exist_ok=True)

DPI = 150  # Matches the page dimensions expected by crop-images-v2.py page maps


def render_year(year: int) -> None:
    pdf_path = PDF_DIR / f'BiologySOL{year}.pdf'
    if not pdf_path.exists():
        print(f'{year}: MISSING {pdf_path}')
        return

    doc = fitz.open(str(pdf_path))
    raw_parts = []
    for i, page in enumerate(doc, start=1):
        pix = page.get_pixmap(dpi=DPI)
        pix.save(str(EXAM_PAGES / f'{year}-p{i:02d}.png'))
        raw_parts.append(f'\n===== PAGE {i} =====\n')
        raw_parts.append(page.get_text())
    raw = ''.join(raw_parts)
    (BUILD_TEMP / f'sol{year}-raw.txt').write_text(raw, encoding='utf-8')

    # Page-2 dimensions are what the crop maps reference (page 1 is usually cover).
    w, h = Image.open(EXAM_PAGES / f'{year}-p02.png').size
    print(f'{year}: {len(doc)} pages rendered at {w}x{h}px, {len(raw)} chars of text')
    doc.close()


if __name__ == '__main__':
    years = [int(y) for y in sys.argv[1:]] or [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2015]
    for y in years:
        render_year(y)
