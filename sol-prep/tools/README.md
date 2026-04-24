# SOL Exam Pipeline

Tools for extracting released Virginia Biology SOL exam questions + images from
PDF and wiring them into `sol-prep/question-bank.json` + `sol-prep/images/questions/`.

## What it does

Takes a released SOL exam PDF (e.g. `BiologySOL2003.pdf`), renders each page to
a PNG, parses question text + answer key from the PDF's text layer, crops one
image per question, and merges structured entries into the master question bank.

Covers released exams **2001–2008** and **2015**. Scripts are idempotent —
re-running skips questions already in the bank.

## Prerequisites

- Python 3.10+
- `PyMuPDF` (a.k.a. `fitz`) — PDF render + text extract
- `Pillow` — image cropping

```
pip install pymupdf pillow
```

## Adding a new exam year

Drop the PDF into `SOL Questions/` as `BiologySOL{YYYY}.pdf`, then from the
repo root:

```bash
python sol-prep/tools/render-exam-pdfs.py YYYY
python sol-prep/tools/parse-sol-exam.py YYYY
python sol-prep/tools/crop-images-v2.py              # crops all years
python sol-prep/tools/merge-into-bank.py YYYY
```

To process all default years (2001–2004) in one shot, omit the year argument.

After that:
- Inspect cropped images at `sol-prep/images/questions/YYYY-*.png` for blanks
  (the crop script prints warnings for crops that are >95% white).
- Spot-check `sol-prep/question-bank.json` — look for stems that ended up
  contaminated with image label text, and `std` values that don't match
  the question content (the heuristic isn't perfect).
- Commit the new images + bank change. **Do not commit `build-temp/`** —
  it's `.gitignored` by design (scratch dir for intermediates).

## Pipeline stages

| Stage | Script | Input | Output |
|-------|--------|-------|--------|
| 1 | `render-exam-pdfs.py` | `SOL Questions/BiologySOL{YYYY}.pdf` | `build-temp/exam-pages/{YYYY}-p{NN}.png` + `build-temp/sol{YYYY}-raw.txt` |
| 2 | `parse-sol-exam.py` | `build-temp/sol{YYYY}-raw.txt` | `build-temp/sol{YYYY}-questions.json` + `build-temp/sol{YYYY}-answers.json` |
| 3 | `crop-images-v2.py` | exam-pages PNGs + questions.json | `sol-prep/images/questions/{YYYY}-{N}.png` |
| 4 | `merge-into-bank.py` | questions.json files | `sol-prep/question-bank.json` |

## Layout of a released SOL PDF (what the parser assumes)

VDOE released exams have a consistent structure:

- **Cover + copyright pages** (1-2) — ignored.
- **Sample / directions page** (page 3) — may contain Q1.
- **Question pages** (~4-18 depending on year) — 2-column portrait layouts
  (1-column in 2007/2008, landscape in 2015). Each question has:
  - Question number on its own line (a bare digit, 1-50).
  - Stem lines.
  - Options labeled `A B C D` for odd questions or `F G H J` for even
    questions (alternating pattern is a VDOE convention).
  - A page footer block with `BY{CODE}` entries, each followed by the
    correct letter, and optionally an `ArtCodes` sub-block for questions
    that have images.
  - **The correct option is marked in the raw text with a trailing STX
    control character** (`\x02`) on its last line. The parser uses this
    as a secondary validation against the answer key.
- **Answer key page** (last page) — four-line groups: `{qnum, letter,
  category_code, category_desc}`. Parser uses this as the authoritative
  source for correct answers and reporting categories.

### Picture-option questions

Some questions use **labeled images as options** (e.g., "Which of these DNA
segments..." with A/B/C/D each showing a different image). These look
different in the raw text — option letters appear but with no intervening
stem text. The parser handles them in a second pass:

1. Main parse loop sees option letters with no text and can't assemble the
   question cleanly — skips it.
2. Fill-in pass finds the orphaned question number on the page and creates
   an entry with `is_picture_option: true` and placeholder letter-labels
   (`"a": "A", "b": "B", "c": "C", "d": "D"`) — matching the convention
   used by existing 2005 entries.
3. `hasImage: true` is always set for picture-option questions.

## Page maps (the main source of per-year pain)

The crop script needs to know, for every question: which page is it on,
and which region of that page contains it.

- **2005-2015**: hand-built page maps (`build_2005_map()`, etc.). These
  came from visually inspecting each year's PDF — different years had
  different layouts (2 vs 1 column, 2 vs 4 questions per page, etc.).
- **2001-2004**: **auto-derived** from the `page` field written by
  `parse-sol-exam.py`. The layout function fills left column top-to-bottom,
  then right column. Slot heights depend on how many questions share the
  page. Not as precise as hand-tuned maps, but works for the 2-column
  portrait layouts in those years.

When adding a new year whose layout differs from 2001-2004, write a
dedicated `build_YYYY_map()` function following the 2005-2008 pattern.

## Known limitations

1. **`hasImage` over-reports.** If a page has *any* question with ArtCodes,
   every question on that page is flagged `hasImage: true`. The crop script
   warns when the resulting crop is mostly white; those warnings usually
   indicate a question that shouldn't have had `hasImage`. Not a correctness
   bug (extra blank crops don't break anything) but worth cleaning up for
   production quality.

2. **Stem pollution.** When a question's image has labels (axes, legend text,
   figure captions), PyMuPDF extracts those labels into the text stream
   interleaved with the actual question stem. The parser tries to truncate
   at option letters and page footers, but some contamination leaks through
   (e.g., `"...option D text O2 and CO2 Levels in a Pond..."`). Manual
   cleanup per question may be warranted for bank polish.

3. **`std` assignment is heuristic.** Uses keyword matching on the stem to
   pick BIO.1-BIO.8. Falls back to the SOL reporting category (001-004).
   Works for most questions but gets confused on multi-topic questions
   (e.g., an enzyme graph question could be tagged BIO.1 for graph-reading
   OR BIO.2 for enzyme content). Review and refine per-question as needed.

4. **Per-year page-layout hand-coding.** `build_2001_2004_map` works because
   those years use simple 2-column portrait layouts. Years with more variable
   or unusual layouts (like 2006) need a dedicated page map.

## Why `build-temp/` is gitignored

The intermediate artifacts are large and reproducible:
- ~100 MB of rendered PDF pages per year
- ~30 KB of raw text per year
- questions.json + answers.json are intermediate representations

The source of truth is the PDF (in `SOL Questions/`, also gitignored — those
PDFs are copyrighted releases that educators have fair-use access to but we
don't redistribute via git). The permanent artifacts are the cropped
question images (`sol-prep/images/questions/`) and the merged
`question-bank.json`. Everything else can be regenerated from the PDFs.

If you need to clean and re-run the full pipeline:

```bash
rm -rf sol-prep/build-temp/
python sol-prep/tools/render-exam-pdfs.py
python sol-prep/tools/parse-sol-exam.py
python sol-prep/tools/crop-images-v2.py
python sol-prep/tools/merge-into-bank.py
```

---

## Future work — parked for later consideration

### Pull in missing exam years + review documents (ready-to-run, just need PDFs)

The source VDOE page lists more released content than we've currently ingested.
To complete the bank Mark needs to drop the missing PDFs into `SOL Questions/`,
then re-run the pipeline.

**Missing released exams** (would add ~150 questions):

- `BiologySOL2000.pdf`
- `BiologySOL2009.pdf`
- `BiologySOL2018.pdf`

Once added, run:
```bash
python sol-prep/tools/render-exam-pdfs.py 2000 2009 2018
python sol-prep/tools/parse-sol-exam.py 2000 2009 2018
python sol-prep/tools/crop-images-v2.py
python sol-prep/tools/merge-into-bank.py 2000 2009 2018
```

Note: 2018 uses a newer format (shorter exam, ~40 questions instead of 50). May
need a dedicated `build_2018_map()` in `crop-images-v2.py` if the auto-derived
layout from the parser's `page` field doesn't produce clean crops — same
pattern as the 2015 addition.

**Missing SOL review documents** (would add ~18 questions):

- `BIO-SOL-Review-17-Fossils-ANSWERS.pdf` (8 questions)
- `BIO-SOL-Review-18-Human-Body-ANSWERS.pdf` (10 questions)

These use a different extraction path than released exams — they're textbook-
style review booklets, not SOL exam format. The existing 16 reviews were
processed into `sol-review-1.txt` through `sol-review-16.txt` files in
`sol-prep/`, and question entries went into the bank via a separate
(not-yet-recreated-as-tool) workflow. To add 17 and 18 consistently:

1. Extract text from each PDF (`pymupdf` — same approach as
   `render-exam-pdfs.py`).
2. Save as `sol-review-17.txt` and `sol-review-18.txt` in `sol-prep/`.
3. Parse into bank entries using the same schema as existing review entries
   (year="review", std=corresponding BIO.N). `extract-review-questions.py`
   is the closest template but it operates on unit HTML, not raw review text —
   a new parser (or LLM-assisted pass) may be simpler.

**Current bank counts (as of 2026-04-23):**
- Released exams: 440 (2001-2008 + 2015)
- Review questions: 318 (from Reviews 1-16)
- Total: 758
- After pulling the missing content: ~925

### Chart.js / HTML-table conversion of bank entries (not yet decided)

As of 2026-04-23, the unit review pages (`unit-1.html` ... `unit-8.html`) render
9 SOL questions natively — 7 as Chart.js canvases (amylase, pepsin/trypsin,
mice, lynx/hare, bluegill, Tasmanian sheep, plus 2001-27 duplicate) and 3 as
HTML data tables (sparrow/jay, UV/wheat, cell organelles).

The bank itself (`sol-prep/question-bank.json`, used by `practice-test.html`)
still holds **278 questions with `hasImage: true`**, all of which render as
`<img src={imageUrl}>` in the practice test. Of those:

- ~28 entries are **graph-type** (candidates for Chart.js). Examples:
  2001-3, 2001-8, 2001-26, 2001-47, 2002-48, 2003-25, 2006-1, 2007-9, 2007-33,
  2007-46, 2015-3, 2015-10, 2015-13, plus others.
- ~3 entries are **data tables** (candidates for HTML table). Examples:
  2005-24 (vertebrate embryo table), 2005-44 (field data pH), 2005-50
  (disinfectants).
- ~71 are illustrations — diagrams, photographs, cladograms, Punnett squares,
  dichotomous keys, anatomical drawings. Must stay as PNG.
- ~176 are **unclassified** by regex-based classifier — would need manual or
  vision-based review. Some are likely additional graph/table candidates; most
  are probably illustrations.

**What a full bank conversion would require:**

1. **Schema change**: bank entries gain a `chart` field (`{type, data, options}`)
   instead of / alongside `imageUrl`.
2. **`practice-test.html` update** — detect `chart`, render `<canvas>` + inline
   Chart.js init; fall back to `<img>` for illustrations.
3. **Per-question data extraction** — read each source PNG, estimate axis
   values, write Chart.js config. Roughly 10–15 min per graph.

**Options for scope:**

- **A — Full conversion**: schema + practice-test.html change + ~30 entries
  converted. ~2 hours. Uniform quality across unit pages and practice test.
- **B — Partial**: convert only the 2005+ bank entries (highest-volume in the
  bank since that's where released exam coverage started). ~10–15 conversions,
  ~1 hour.
- **C — Keep as PNG**: practice test uses PNG crops as-is. Students do deep
  study on unit pages (polished) and quick drill on practice test (less
  visual-critical). Zero new work, minor visual inconsistency.

Also parked: classifying the 176 "unclear" PNGs. An LLM-vision pass could
categorize these correctly but consumes tokens. Regex classification caught
the obvious data-viz and illustration cases; the unclear ones are mixed.

Decision owner: Mark. Revisit if practice-test visual quality becomes a
complaint from students, or during the next major content pass.
