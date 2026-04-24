"""
Stage 2 of the SOL exam pipeline: parse raw text extractions into structured JSON.

Input:  sol-prep/build-temp/sol{year}-raw.txt  (from render-exam-pdfs.py)
Output: sol-prep/build-temp/sol{year}-questions.json
        sol-prep/build-temp/sol{year}-answers.json

Strategy
--------
1. Split raw text by "===== PAGE N =====" markers produced by render-exam-pdfs.py.
2. Parse the answer-key page (usually the last page) — four-line groups
   {qnum, letter, category_code, category_desc}.
3. Sweep remaining pages for standalone integer lines that are plausible question
   numbers (1-50, monotonically increasing).
4. For each question: collect stem lines until an option letter (A/B/C/D or F/G/H/J),
   then collect option text until next option letter, blank line, or page footer.
5. Picture-option questions (options are labeled images rather than text) are handled
   in a second pass: they're missed by step 4 because no option text exists between
   letters. We fill them in with letter-label options (matches 2005-style convention).
6. hasImage is true if ArtCodes appears on the page OR the question is picture-option.
7. std (BIO.1-BIO.8) is assigned by keyword heuristics on the stem; falls back to
   reporting category (001-004) mapping.

Usage:  python sol-prep/tools/parse-sol-exam.py 2001 2002 2003 2004
"""
import json
import re
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SOL_PREP = SCRIPT_DIR.parent
BUILD_TEMP = SOL_PREP / 'build-temp'

# ── Letter normalization ──
# Odd questions use A/B/C/D, even use F/G/H/J. Both normalize to a/b/c/d positionally.
ODD = {'A': 'a', 'B': 'b', 'C': 'c', 'D': 'd'}
EVEN = {'F': 'a', 'G': 'b', 'H': 'c', 'J': 'd'}


def normalize_letter(letter: str, qnum: int) -> str:
    letter = letter.upper()
    if qnum % 2 == 1:
        return ODD.get(letter, letter.lower())
    return EVEN.get(letter, letter.lower())


def option_letters_for(qnum: int):
    return ['A', 'B', 'C', 'D'] if qnum % 2 == 1 else ['F', 'G', 'H', 'J']


CATEGORY_NAMES = {
    '001': 'Scientific Investigation',
    '002': 'Life at the Molecular and Cellular Level',
    '003': 'Life at the Systems and Organisms Level',
    '004': 'Interaction of Life Forms',
}

# Keyword-based std assignment, ordered from most specific to least.
STD_RULES = [
    (r'\b(graph|data table|chart shows|according to the (graph|table|chart)|experimental design|control group|independent variable|dependent variable|scientific method|hypothesis|observation|qualitative|quantitative|accuracy|precision|inference|correlation|causation)\b', 'BIO.1'),
    (r'\b(DNA|RNA|codon|amino acid|Punnett|allele|chromosome|meiosis|mitosis|heterozygous|homozygous|dominant|recessive|genetic|karyotype|heredity|mutation|gene)\b', 'BIO.5'),
    (r'\b(organelle|nucleus|mitochondri|ribosome|golgi|endoplasmic|chloroplast|cell wall|cell membrane|osmosis|diffusion|homeostasis|prokaryot|eukaryot|cell theory|cell division)\b', 'BIO.3'),
    (r'\b(enzyme|amylase|protein|macromolecule|photosynthesis|respiration|ATP|glucose|carbohydrate|lipid|water cycle|pH)\b', 'BIO.2'),
    (r'\b(virus|bacteri|antibiotic|pathogen|disease|immune)\b', 'BIO.4'),
    (r'\b(evolv|evolution|natural selection|adaptat|fossil|species|common ancestor|homolog|analog|vestigial|Darwin|selective|survive)\b', 'BIO.7'),
    (r'\b(kingdom|phylum|genus|taxonomy|classif|dichotomous|cladogram|Archaea|Protista|Animalia|Plantae|Fungi|Monera|vertebrate|invertebrate)\b', 'BIO.6'),
    (r'\b(ecosystem|population|food (web|chain|pyramid)|biome|carrying capacity|succession|biodivers|habitat|predator|prey|symbio|parasit|mutualis|commensalism|niche|community|biomass|pollut|climate)\b', 'BIO.8'),
]

CATEGORY_TO_STD_FALLBACK = {
    '001': 'BIO.1',
    '002': 'BIO.2',
    '003': 'BIO.3',
    '004': 'BIO.8',
}


def assign_std(stem: str, category_code: str) -> str:
    for pattern, std in STD_RULES:
        if re.search(pattern, stem, re.IGNORECASE):
            return std
    return CATEGORY_TO_STD_FALLBACK.get(category_code, 'BIO.1')


ANSWER_KEY_RE = re.compile(r'Answer Key.*?(?=SESSION:|$)', re.DOTALL)


def parse_answer_key(raw: str) -> dict:
    """Return {qnum (int): {'letter': 'A', 'normalized': 'a', 'category_code': '001', 'category': '...'}}."""
    m = ANSWER_KEY_RE.search(raw)
    if not m:
        return {}
    lines = [ln.strip() for ln in m.group(0).split('\n') if ln.strip()]
    result = {}
    i = 0
    while i < len(lines):
        if re.fullmatch(r'\d+', lines[i]):
            qnum = int(lines[i])
            if (i + 3 < len(lines)
                    and re.fullmatch(r'[A-J]', lines[i + 1])
                    and re.fullmatch(r'\d{3}', lines[i + 2])):
                result[qnum] = {
                    'letter': lines[i + 1],
                    'normalized': normalize_letter(lines[i + 1], qnum),
                    'category_code': lines[i + 2],
                    'category': lines[i + 3],
                }
                i += 4
                continue
        i += 1
    return result


def page_has_artcode_for_question(page_text: str, qnum: int) -> bool:
    """Over-reports: returns True for any page containing ArtCodes metadata."""
    return 'ArtCodes' in page_text


OPTION_LETTERS_ALL = set('ABCDFGHJ')
PAGE_FOOTER_RE = re.compile(r'^(SESSION: \d+ PAGE:|BY[A-Z0-9]{7,}|ArtCodes)\b')
CTRL_CHARS_RE = re.compile(r'[\x00-\x08\x0b-\x1f]')


def parse_page_questions(page_text: str, expected_qnums):
    lines = page_text.split('\n')
    questions = []

    qnum_positions = {}
    for qn in expected_qnums:
        for i, ln in enumerate(lines):
            if ln.strip() == str(qn) and qn not in qnum_positions:
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j < len(lines):
                    next_line = lines[j].strip()
                    if next_line not in OPTION_LETTERS_ALL and not re.fullmatch(r'\d+', next_line):
                        qnum_positions[qn] = i
                        break

    sorted_qnums = sorted(qnum_positions.keys(), key=lambda q: qnum_positions[q])

    for idx, qn in enumerate(sorted_qnums):
        start = qnum_positions[qn]
        end = qnum_positions[sorted_qnums[idx + 1]] if idx + 1 < len(sorted_qnums) else len(lines)
        block = lines[start + 1:end]

        option_letters = option_letters_for(qn)
        stem_lines = []
        option_start = None
        for i, ln in enumerate(block):
            if ln.strip() in option_letters:
                option_start = i
                break
            stem_lines.append(ln)

        options = {}
        raw_correct = None
        if option_start is not None:
            i = option_start
            while i < len(block) and len(options) < 4:
                if block[i].strip() in option_letters:
                    letter = block[i].strip()
                    opt_text = []
                    j = i + 1
                    while j < len(block):
                        s = block[j]
                        if s.strip() in option_letters:
                            break
                        if PAGE_FOOTER_RE.match(s.strip()):
                            break
                        if not s.strip() and opt_text:
                            break
                        opt_text.append(s)
                        j += 1
                    if any('\x02' in line for line in opt_text):
                        raw_correct = letter
                    clean = ' '.join(CTRL_CHARS_RE.sub('', s).strip() for s in opt_text if s.strip() or True)
                    clean = re.sub(r'\s+', ' ', clean).strip()
                    options[letter] = clean
                    i = j
                else:
                    i += 1

        if set(options.keys()) != set(option_letters):
            continue

        stem = ' '.join(CTRL_CHARS_RE.sub('', s).strip() for s in stem_lines if s.strip())
        stem = re.sub(r'\s+', ' ', stem).strip()
        questions.append({
            'qnum': qn,
            'stem': stem,
            'options_by_letter': options,
            'raw_correct_letter': raw_correct,
        })

    return questions


def parse_year(year: int):
    raw_path = BUILD_TEMP / f'sol{year}-raw.txt'
    if not raw_path.exists():
        print(f'{year}: MISSING {raw_path} — run render-exam-pdfs.py first')
        return

    raw = raw_path.read_text(encoding='utf-8')
    answer_key = parse_answer_key(raw)
    print(f'{year}: answer key has {len(answer_key)} entries')

    pages = re.split(r'===== PAGE (\d+) =====', raw)
    page_texts = {}
    for i in range(1, len(pages), 2):
        page_num = int(pages[i])
        page_texts[page_num] = pages[i + 1] if i + 1 < len(pages) else ''

    max_q = max(answer_key.keys()) if answer_key else 50

    all_questions = []
    next_expected = 1
    for page_num in sorted(page_texts.keys()):
        page_text = page_texts[page_num]
        candidates = list(range(next_expected, min(next_expected + 10, max_q + 1)))
        qs = parse_page_questions(page_text, candidates)
        for q in qs:
            q['page'] = page_num
            q['has_artcodes'] = page_has_artcode_for_question(page_text, q['qnum'])
        all_questions.extend(qs)
        if qs:
            next_expected = max(q['qnum'] for q in qs) + 1

    print(f'{year}: initial parse: {len(all_questions)} of {max_q} expected')
    missing = sorted(set(range(1, max_q + 1)) - {q['qnum'] for q in all_questions})

    # Fill in picture-option questions (options are labeled images, not text).
    for qn in missing:
        found_page = None
        found_stem = ''
        for page_num in sorted(page_texts.keys()):
            page_text = page_texts[page_num]
            lines = page_text.split('\n')
            for i, ln in enumerate(lines):
                if ln.strip() != str(qn):
                    continue
                j = i + 1
                while j < len(lines) and not lines[j].strip():
                    j += 1
                if j >= len(lines):
                    continue
                next_line = lines[j].strip()
                if next_line in OPTION_LETTERS_ALL or re.fullmatch(r'\d+', next_line):
                    continue
                stem_lines = []
                for k in range(j, min(j + 40, len(lines))):
                    s = lines[k].strip()
                    if re.fullmatch(r'\d+', s) and 1 <= int(s) <= 50 and int(s) != qn:
                        break
                    if s in OPTION_LETTERS_ALL:
                        break
                    if PAGE_FOOTER_RE.match(s):
                        break
                    stem_lines.append(CTRL_CHARS_RE.sub('', s))
                found_page = page_num
                found_stem = re.sub(r'\s+', ' ', ' '.join(s for s in stem_lines if s)).strip()
                break
            if found_page is not None:
                break

        if found_page is None:
            print(f'{year}-{qn}: could not locate on any page')
            continue

        all_questions.append({
            'qnum': qn,
            'page': found_page,
            'stem': found_stem,
            'options_by_letter': {},
            'raw_correct_letter': None,
            'has_artcodes': True,
            'is_picture_option': True,
        })

    all_questions.sort(key=lambda q: q['qnum'])
    still_missing = sorted(set(range(1, max_q + 1)) - {q['qnum'] for q in all_questions})
    print(f'{year}: after picture-option fill-in: {len(all_questions)} total'
          + (f', still missing: {still_missing}' if still_missing else ''))

    out_questions = []
    for q in all_questions:
        qn = q['qnum']
        ak = answer_key.get(qn)
        if not ak:
            print(f'{year}-{qn}: no answer key entry — skipping')
            continue

        letters = option_letters_for(qn)
        options_abcd = {}
        if q.get('is_picture_option'):
            for i, letter in enumerate(letters):
                options_abcd['abcd'[i]] = letter
        else:
            for i, letter in enumerate(letters):
                options_abcd['abcd'[i]] = q['options_by_letter'].get(letter, '')

        correct = ak['normalized']
        has_image = q['has_artcodes'] or q.get('is_picture_option', False)

        entry = {
            'id': f'{year}-{qn}',
            'year': year,
            'qnum': qn,
            'page': q['page'],
            'stem': q['stem'],
            'options': options_abcd,
            'correct': correct,
            'std': assign_std(q['stem'], ak['category_code']),
        }
        if has_image:
            entry['hasImage'] = True
        out_questions.append(entry)

    out_questions.sort(key=lambda q: q['qnum'])

    questions_path = BUILD_TEMP / f'sol{year}-questions.json'
    questions_path.write_text(
        '[\n' + ',\n'.join('  ' + json.dumps(q, ensure_ascii=False) for q in out_questions) + '\n]',
        encoding='utf-8')

    answers_out = {str(k): v for k, v in sorted(answer_key.items())}
    (BUILD_TEMP / f'sol{year}-answers.json').write_text(
        json.dumps(answers_out, ensure_ascii=False, indent=2),
        encoding='utf-8')

    n_img = sum(1 for q in out_questions if q.get('hasImage'))
    print(f'{year}: wrote {len(out_questions)} questions ({n_img} with images) + {len(answer_key)} answers')


if __name__ == '__main__':
    years = [int(y) for y in sys.argv[1:]] or [2001, 2002, 2003, 2004]
    for y in years:
        parse_year(y)
        print()
