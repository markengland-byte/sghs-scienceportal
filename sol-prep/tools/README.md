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

### Current bank composition (as of 2026-04-24)

| Source | Count |
|---|---|
| 2001–2008 released exams | 400 |
| 2015 released exam | 40 |
| Review docs (from 16 review PDFs in `SOL Questions/`) | 318 |
| Instructor-written questions pulled from unit HTML | 90 |
| **Total** | **848** |

The 90 instructor-written questions occupy `review-319` through `review-408`
and came from `extract-instructor-questions.py` (see next section). They're
the original gate-check and practice questions that live only in
`unit-1.html` ... `unit-8.html` and don't cite a released SOL exam. Pulling
them into the bank makes them reachable via `practice-test.html` random drill.

### Adding new instructor-written unit questions to the bank

If you author more instructor-written questions directly in the unit HTML
files, re-run to append them to the bank (dedupes against existing entries
by normalized stem, starts new IDs at `review-{max_existing+1}`):

```bash
python sol-prep/tools/extract-instructor-questions.py         # preview
python sol-prep/tools/extract-instructor-questions.py --apply # write
```

The script filters out questions that carry a `(YYYY-NN)` SOL citation
since those are paraphrases of released-exam entries already in the bank.

### Native rendering in practice-test.html (Chart.js / HTML table)

Bank entries can carry optional `chart` or `table` fields that practice-test
renders natively instead of the PNG crop:

- `chart`: a Chart.js config object (`{type, data, options}`). Renders as a
  `<canvas>` with Chart.js. The `practice-test.html` render loop detects this
  field, inserts a canvas, and runs `new Chart(el, q.chart)` after DOM insert.
- `table`: `{title, headers: [...], rows: [[...]]}`. Renders as an HTML table.
- `imageUrl`: fallback for illustrations / photographs when neither `chart`
  nor `table` is present.

As of 2026-04-24, **22 bank entries have `chart` configs and 10 have `table`
configs** (32 native renderings total). See `add-native-renderings.py` below.

### Adding / regenerating Chart.js and HTML-table configs

```bash
python sol-prep/tools/add-native-renderings.py          # preview
python sol-prep/tools/add-native-renderings.py --apply  # write to bank
```

The script holds `CHARTS`, `TABLES`, and `CHART_ALIASES` dicts. To convert
another bank entry:

1. Inspect the source PNG at `sol-prep/images/questions/{id}.png`.
2. Add an entry to `CHARTS` (for graphs) or `TABLES` (for data tables) keyed
   by the bank `id`. Data values for Chart.js configs are visual estimates —
   match the shape and relative scale of the source graph, not exact values.
3. `CHART_ALIASES` maps `review-N` duplicate IDs to their canonical SOL IDs
   so the same config is reused.
4. Run `--apply`. Re-running overwrites prior `chart`/`table` fields
   (idempotent).

### Remaining bank conversion parking lot

- **~240 illustration PNGs** (diagrams, photographs, cladograms, Punnett
  squares, dichotomous keys, anatomical drawings) stay as `imageUrl` — Chart.js
  can't render drawings.
- **5 unconverted non-candidates**: 2001-41 (picture-option with 4 answer
  graphs), 2007-33 (chromosome crossing-over illustration), 2007-39 (lady
  beetles variation illustration), 2005-50 (disinfectant table — couldn't
  extract values from the crop).
- **2015-44 Elodea** — bank stem describes an Elodea data table but the
  current PNG crop is misaligned (shows Q44 Chincoteague ponies text question
  instead, due to 2015 TEI-item page-offset). Need to find correct page in
  `BiologySOL2015.pdf` and either re-crop or extract data into an HTML table.
- **~160 "unclear" images** — after today's second classifier pass surfaced
  15 more table + 2 chart candidates, a vision-based LLM pass would still likely
  find a handful more. Diminishing returns after this point.

### Bank data quality issue — misassigned imageNotes

During the second-pass classification (2026-04-24), multiple bank entries were
found to have `imageNote` strings that describe a DIFFERENT question's image.
Examples: 2007-39 imageNote says "Population growth curve with sections..."
but the actual PNG + stem is about lady beetles variation; 2007-23 says "Cell
Structures and Functions table" but the actual content is a Fluid Mosaic Model
diagram; 2008-39 says "Geologic Time Scale" but the actual crop is a Bacterial
Culture Experiment. These misassignments likely happened when imageNote strings
were batch-authored (via LLM vision or manual tagging) and indices got
off-by-N in some stretch. The classifier built in `add-native-renderings.py`
is therefore **unreliable when used alone** — always verify by viewing the
actual PNG before converting. Known affected entries include: 2007-9 / 2007-11
(same "Island Species" imageNote), 2007-23, 2007-39, 2008-21, 2008-39, 2015-29.
The underlying bank `stem` and `correct` fields appear correct; only the
`imageNote` field was affected.

Decision owner: Mark. Revisit if practice-test visual quality becomes a
complaint from students, or during the next major content pass.
