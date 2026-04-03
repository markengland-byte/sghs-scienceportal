"""
A&P Module Auditor — Compares module HTML against OpenStax source via LibreTexts mirror.

Usage:
    python audit_module.py ap/bone-tissue.html 6
    python audit_module.py ap/joints.html 9
    python audit_module.py ap/endocrine-system.html 17

Arguments:
    1. Path to module HTML file (relative to portal root)
    2. OpenStax chapter number

Requirements:
    pip install requests beautifulsoup4
"""

import sys
import os
import re
import json
import time
import io
from pathlib import Path

# Fix Windows console encoding for emoji/unicode
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Install dependencies: pip install requests beautifulsoup4")
    sys.exit(1)

# --- CONFIG ---
LIBRETEXTS_BASE = "https://med.libretexts.org/Bookshelves/Anatomy_and_Physiology/Anatomy_and_Physiology_2e_(OpenStax)"
UNIT_MAP = {
    5: "02%3A_Support_and_Movement",
    6: "02%3A_Support_and_Movement",
    7: "02%3A_Support_and_Movement",
    8: "02%3A_Support_and_Movement",
    9: "02%3A_Support_and_Movement",
    10: "02%3A_Support_and_Movement",
    11: "02%3A_Support_and_Movement",
    12: "03%3A_Regulation_Integration_and_Control",
    13: "03%3A_Regulation_Integration_and_Control",
    14: "03%3A_Regulation_Integration_and_Control",
    15: "03%3A_Regulation_Integration_and_Control",
    16: "03%3A_Regulation_Integration_and_Control",
    17: "03%3A_Regulation_Integration_and_Control",
    18: "04%3A_Fluids_and_Transport",
    19: "04%3A_Fluids_and_Transport",
    20: "04%3A_Fluids_and_Transport",
    21: "04%3A_Fluids_and_Transport",
    22: "05%3A_Energy_Maintenance_and_Environmental_Exchange",
    23: "05%3A_Energy_Maintenance_and_Environmental_Exchange",
    24: "05%3A_Energy_Maintenance_and_Environmental_Exchange",
    25: "06%3A_Human_Development_and_the_Continuity_of_Life",
    26: "06%3A_Human_Development_and_the_Continuity_of_Life",
    27: "07%3A_Human_Development_and_the_Continuity_of_Life",
    28: "07%3A_Human_Development_and_the_Continuity_of_Life",
}
CHAPTER_TITLES = {
    5: "05%3A_The_Integumentary_System",
    6: "06%3A_Bone_Tissue_and_the_Skeletal_System",
    7: "07%3A_Axial_Skeleton",
    8: "08%3A_The_Appendicular_Skeleton",
    9: "09%3A_Joints",
    10: "10%3A_Muscle_Tissue",
    11: "11%3A_The_Muscular_System",
    12: "12%3A_The_Nervous_System_and_Nervous_Tissue",
    13: "13%3A_Anatomy_of_the_Nervous_Tissue",
    14: "14%3A_The_Somatic_Nervous_System",
    15: "15%3A_The_Autonomic_Nervous_System",
    16: "16%3A_The_Neurological_Exam",
    17: "17%3A_The_Endocrine_System",
}
DELAY = 1.5  # seconds between requests to be polite

# --- HELPERS ---

def clean_text(text):
    """Normalize text for comparison: lowercase, strip whitespace, collapse spaces."""
    text = re.sub(r'\s+', ' ', text.strip().lower())
    text = re.sub(r'[^\w\s]', '', text)  # remove punctuation
    return text

def extract_words(text):
    """Extract set of meaningful words (>3 chars) from text."""
    return set(w for w in clean_text(text).split() if len(w) > 3)

def similarity(text_a, text_b):
    """Jaccard similarity between two texts based on word sets."""
    words_a = extract_words(text_a)
    words_b = extract_words(text_b)
    if not words_a or not words_b:
        return 0.0
    intersection = words_a & words_b
    union = words_a | words_b
    return len(intersection) / len(union)

# --- PARSE MODULE HTML ---

def parse_module(filepath):
    """Parse the local module HTML and extract structured content."""
    with open(filepath, 'r', encoding='utf-8') as f:
        soup = BeautifulSoup(f.read(), 'html.parser')

    result = {
        'title': '',
        'panels': [],
        'quiz_questions': [],
        'vocab_terms': [],
        'checkpoints': [],
        'module_config': {},
    }

    # Title
    title_el = soup.find('title')
    if title_el:
        result['title'] = title_el.text.strip()

    # MODULE_CONFIG
    scripts = soup.find_all('script')
    for script in scripts:
        if script.string and 'MODULE_CONFIG' in (script.string or ''):
            match = re.search(r'MODULE_CONFIG\s*=\s*\{(.+?)\}', script.string, re.DOTALL)
            if match:
                try:
                    # Extract key fields manually since it's not valid JSON
                    config_str = match.group(0)
                    name_match = re.search(r"name:\s*'([^']+)'", config_str)
                    pc_match = re.search(r'panelCount:\s*(\d+)', config_str)
                    lc_match = re.search(r'lessonCount:\s*(\d+)', config_str)
                    result['module_config'] = {
                        'name': name_match.group(1) if name_match else '',
                        'panelCount': int(pc_match.group(1)) if pc_match else 0,
                        'lessonCount': int(lc_match.group(1)) if lc_match else 0,
                    }
                except:
                    pass

    # Panels
    panels = soup.find_all('div', class_='panel')
    for panel in panels:
        panel_id = panel.get('id', '')
        hero = panel.find('div', class_='hero')
        title_div = panel.find('div', class_='h-title')
        prose_divs = panel.find_all('p', class_='prose')

        panel_data = {
            'id': panel_id,
            'title': title_div.text.strip() if title_div else '',
            'prose_text': ' '.join(p.text.strip() for p in prose_divs),
            'has_checkpoint': bool(panel.find('div', class_='checkpoint-box')),
            'has_quiz': bool(panel.find('div', class_='quiz-box')),
        }
        result['panels'].append(panel_data)

    # Quiz questions
    questions = soup.find_all('div', class_='qq')
    for qq in questions:
        qt = qq.find('span', class_='qt-inner')
        ans = qq.get('data-ans', '')
        options = []
        for opt in qq.find_all('li', class_='qo'):
            val = opt.get('data-v', '')
            # Get text without the letter circle
            ol = opt.find('div', class_='ol')
            text = opt.text.strip()
            if ol:
                text = text.replace(ol.text.strip(), '', 1).strip()
            options.append({'value': val, 'text': text})

        exp_div = qq.find('div', class_='qexp')
        result['quiz_questions'].append({
            'question': qt.text.strip() if qt else '',
            'correct_answer': ans,
            'options': options,
            'explanation': exp_div.text.strip() if exp_div else '',
        })

    # Vocab terms
    vcards = soup.find_all('div', class_='vcard')
    for vc in vcards:
        term_div = vc.find('div', class_='vterm')
        def_div = vc.find('div', class_='vdef')
        if term_div and def_div:
            result['vocab_terms'].append({
                'term': term_div.text.strip(),
                'definition': def_div.text.strip(),
            })

    # Checkpoints
    cp_boxes = soup.find_all('div', class_='checkpoint-box')
    for cp in cp_boxes:
        q_div = cp.find('div', class_='cp-question')
        if q_div:
            result['checkpoints'].append(q_div.text.strip())

    return result

# --- FETCH OPENSTAX CONTENT ---

def fetch_chapter_toc(chapter_num):
    """Fetch the table of contents for a chapter from LibreTexts."""
    unit = UNIT_MAP.get(chapter_num)
    ch_title = CHAPTER_TITLES.get(chapter_num)
    if not unit or not ch_title:
        print(f"  [ERROR] Chapter {chapter_num} not in URL map")
        return []

    url = f"{LIBRETEXTS_BASE}/{unit}/{ch_title}"
    print(f"  Fetching TOC: {url}")
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        print(f"  [ERROR] Failed to fetch TOC: {e}")
        return []

    soup = BeautifulSoup(resp.text, 'html.parser')
    links = []
    for a in soup.find_all('a', href=True):
        href = a['href']
        text = a.text.strip()
        # Match section links like "6.02: The Functions..."
        if re.match(rf'{chapter_num}\.\d+', text):
            full_url = href if href.startswith('http') else f"https://med.libretexts.org{href}"
            links.append({'title': text, 'url': full_url})

    return links

def fetch_page_text(url):
    """Fetch a LibreTexts page and extract the main text content."""
    try:
        resp = requests.get(url, timeout=30)
        resp.raise_for_status()
    except Exception as e:
        return f"[ERROR fetching: {e}]"

    soup = BeautifulSoup(resp.text, 'html.parser')
    # Remove script, style, nav elements
    for tag in soup.find_all(['script', 'style', 'nav', 'header', 'footer']):
        tag.decompose()

    # Get main content area
    main = soup.find('article') or soup.find('div', class_='mt-content-container') or soup.find('body')
    if not main:
        return ""

    return main.get_text(separator=' ', strip=True)

def fetch_review_questions(chapter_num):
    """Fetch OpenStax review questions for comparison."""
    unit = UNIT_MAP.get(chapter_num)
    ch_title = CHAPTER_TITLES.get(chapter_num)
    if not unit or not ch_title:
        return ""

    # Find the review questions page — numbering varies by chapter
    toc = fetch_chapter_toc(chapter_num)
    time.sleep(DELAY)

    for entry in toc:
        if 'Review_Questions' in entry.get('url', '') or 'review' in entry.get('title', '').lower():
            print(f"  Fetching review questions: {entry['title']}")
            text = fetch_page_text(entry['url'])
            time.sleep(DELAY)
            return text

    return ""

def fetch_key_terms(chapter_num):
    """Fetch OpenStax key terms for vocab comparison."""
    unit = UNIT_MAP.get(chapter_num)
    ch_title = CHAPTER_TITLES.get(chapter_num)
    if not unit or not ch_title:
        return ""

    toc = fetch_chapter_toc(chapter_num)
    time.sleep(DELAY)

    for entry in toc:
        if 'Key_Terms' in entry.get('url', '') or 'key terms' in entry.get('title', '').lower():
            print(f"  Fetching key terms: {entry['title']}")
            text = fetch_page_text(entry['url'])
            time.sleep(DELAY)
            return text

    return ""

# --- AUDIT FUNCTIONS ---

def audit_section_coverage(module_data, toc_sections):
    """Check if the module covers all OpenStax sections."""
    print("\n📋 SECTION COVERAGE")
    print("=" * 60)

    # Extract section numbers from TOC (e.g., "17.02" -> "17.2")
    openstax_sections = []
    for entry in toc_sections:
        match = re.match(r'(\d+)\.(\d+)', entry['title'])
        if match:
            ch = match.group(1)
            sec = str(int(match.group(2)))  # remove leading zero
            openstax_sections.append(f"{ch}.{sec}")

    # Filter out non-content sections
    content_sections = [s for s in openstax_sections
                       if not any(x in s for x in ['Key_Terms', 'Chapter_Review', 'Interactive', 'Review_Questions', 'Critical_Thinking'])]

    # Check module panels for section references — check both panel titles AND full prose
    all_text = ' '.join(p['title'] + ' ' + p['prose_text'] for p in module_data['panels'])
    module_lesson_panels = [p for p in module_data['panels'] if p['id'] != 'p0' and p['has_checkpoint']]

    # Filter TOC to content sections only (skip intro, key terms, review, interactive, critical thinking)
    skip_keywords = ['Introduction', 'Key_Terms', 'Key Terms', 'Chapter_Review', 'Chapter Review',
                     'Interactive', 'Review_Questions', 'Review Questions', 'Critical_Thinking', 'Critical Thinking']
    content_entries = [e for e in toc_sections if not any(kw in e['title'] for kw in skip_keywords)]

    print(f"  OpenStax content sections: {len(content_entries)}")
    print(f"  Module lesson panels: {len(module_lesson_panels)}")

    missing = []
    covered = []
    for entry in content_entries:
        title_words = extract_words(entry['title'])
        # Check if the section topic appears in our module text
        section_found = False
        for panel in module_data['panels']:
            panel_words = extract_words(panel['title'] + ' ' + panel['prose_text'])
            overlap = len(title_words & panel_words)
            if overlap >= min(3, len(title_words)):
                section_found = True
                break

        if section_found:
            covered.append(entry['title'])
        else:
            missing.append(entry['title'])

    if missing:
        print(f"  ⚠️  Potentially missing sections: {missing}")
    else:
        print(f"  ✅ All content sections appear to be covered")

    return {'covered': covered, 'missing': missing, 'total': len(content_sections)}

def audit_quiz_questions(module_data, review_text):
    """Compare module quiz questions against OpenStax review questions."""
    print("\n📝 QUIZ QUESTION AUDIT")
    print("=" * 60)

    module_qs = module_data['quiz_questions']
    print(f"  Module has {len(module_qs)} quiz questions")

    if not review_text:
        print("  ⚠️  Could not fetch OpenStax review questions for comparison")
        return

    review_lower = clean_text(review_text)

    # For each module question, check if key phrases appear in the review text
    matched = 0
    unmatched = []
    for i, mq in enumerate(module_qs):
        q_text = mq['question']
        q_words = extract_words(q_text)

        # Check: do the distinctive words from this question appear in the review page?
        # Use words > 5 chars to avoid common words
        distinctive = set(w for w in q_words if len(w) > 5)
        if not distinctive:
            distinctive = q_words

        found_in_review = sum(1 for w in distinctive if w in review_lower)
        match_ratio = found_in_review / max(len(distinctive), 1)

        if match_ratio > 0.4:  # 40% of distinctive words found
            matched += 1
        else:
            # Also check option text
            option_text = ' '.join(o['text'] for o in mq['options'])
            option_words = set(w for w in extract_words(option_text) if len(w) > 5)
            option_found = sum(1 for w in option_words if w in review_lower)
            if option_found > len(option_words) * 0.3:
                matched += 1
            else:
                unmatched.append(f"  Q{i+1}: {q_text[:80]}...")

    print(f"  Matched to OpenStax: {matched}/{len(module_qs)}")
    if unmatched:
        print(f"  ⚠️  {len(unmatched)} questions may not match OpenStax review questions:")
        for u in unmatched[:5]:
            print(f"    {u}")
    else:
        print(f"  ✅ All questions appear to match OpenStax source")

def audit_vocab_terms(module_data, key_terms_text):
    """Compare module vocab against OpenStax key terms."""
    print("\n📖 VOCABULARY AUDIT")
    print("=" * 60)

    module_vocab = module_data['vocab_terms']
    print(f"  Module has {len(module_vocab)} vocab flip cards")

    if not key_terms_text:
        print("  ⚠️  Could not fetch OpenStax key terms for comparison")
        return

    key_terms_lower = key_terms_text.lower()

    found = 0
    missing = []
    for vt in module_vocab:
        term = vt['term'].lower()
        # Check if term appears in key terms page
        if term in key_terms_lower or term.replace(' ', '') in key_terms_lower.replace(' ', ''):
            found += 1
        else:
            # Try partial match
            words = term.split()
            if any(w in key_terms_lower for w in words if len(w) > 4):
                found += 1
            else:
                missing.append(vt['term'])

    print(f"  Terms found in OpenStax glossary: {found}/{len(module_vocab)}")
    if missing:
        print(f"  ⚠️  Terms not found in OpenStax key terms: {missing}")
    else:
        print(f"  ✅ All vocab terms match OpenStax glossary")

def audit_content_depth(module_data, toc_sections):
    """Check content depth by comparing prose length per section."""
    print("\n📊 CONTENT DEPTH")
    print("=" * 60)

    for panel in module_data['panels']:
        if panel['id'] == 'p0':  # skip overview
            continue
        word_count = len(panel['prose_text'].split())
        status = "✅" if word_count > 50 else "⚠️  THIN" if word_count > 0 else "❌ EMPTY"
        print(f"  {panel['id']}: {panel['title'][:50]:50s} — {word_count:4d} words {status}")

def audit_answer_keys(module_data):
    """Check that all quiz questions have valid answer keys."""
    print("\n🔑 ANSWER KEY AUDIT")
    print("=" * 60)

    issues = []
    for i, q in enumerate(module_data['quiz_questions']):
        ans = q['correct_answer']
        option_values = [o['value'] for o in q['options']]

        if not ans:
            issues.append(f"  Q{i+1}: No correct answer specified (data-ans empty)")
        elif ans not in option_values:
            issues.append(f"  Q{i+1}: Answer '{ans}' not in options {option_values}")
        elif not q['explanation']:
            issues.append(f"  Q{i+1}: Missing explanation")

    if issues:
        print(f"  ⚠️  {len(issues)} issues found:")
        for issue in issues:
            print(f"    {issue}")
    else:
        print(f"  ✅ All {len(module_data['quiz_questions'])} questions have valid answer keys and explanations")

def audit_structural(module_data):
    """Check structural integrity."""
    print("\n🔧 STRUCTURAL AUDIT")
    print("=" * 60)

    config = module_data['module_config']
    panels = module_data['panels']
    issues = []

    # Panel count
    if config.get('panelCount') and config['panelCount'] != len(panels):
        issues.append(f"  panelCount={config['panelCount']} but found {len(panels)} panels")

    # Lesson count
    if config.get('lessonCount') and config['lessonCount'] != len(panels) - 1:
        issues.append(f"  lessonCount={config['lessonCount']} but should be {len(panels)-1}")

    # Checkpoints on content panels (skip p0 and last panel)
    for panel in panels[1:-1]:
        if not panel['has_checkpoint']:
            issues.append(f"  {panel['id']} ({panel['title'][:40]}): Missing checkpoint")

    # Quiz on content panels
    for panel in panels[1:-1]:
        if not panel['has_quiz']:
            issues.append(f"  {panel['id']} ({panel['title'][:40]}): Missing quiz")

    if issues:
        print(f"  ⚠️  {len(issues)} structural issues:")
        for issue in issues:
            print(f"    {issue}")
    else:
        print(f"  ✅ Structure OK — {len(panels)} panels, {len(module_data['quiz_questions'])} questions, {len(module_data['vocab_terms'])} vocab, {len(module_data['checkpoints'])} checkpoints")

# --- MAIN ---

def main():
    if len(sys.argv) < 3:
        print("Usage: python audit_module.py <module_path> <chapter_number>")
        print("Example: python audit_module.py ap/bone-tissue.html 6")
        sys.exit(1)

    module_path = sys.argv[1]
    chapter_num = int(sys.argv[2])

    # Resolve path relative to portal root
    portal_root = Path(__file__).parent.parent
    full_path = portal_root / module_path
    if not full_path.exists():
        print(f"File not found: {full_path}")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"🔍 AUDITING: {module_path} (Chapter {chapter_num})")
    print(f"{'='*60}")

    # Parse module
    print("\n📂 Parsing module HTML...")
    module_data = parse_module(full_path)
    print(f"  Title: {module_data['title']}")
    print(f"  Panels: {len(module_data['panels'])}")
    print(f"  Quiz Questions: {len(module_data['quiz_questions'])}")
    print(f"  Vocab Terms: {len(module_data['vocab_terms'])}")
    print(f"  Checkpoints: {len(module_data['checkpoints'])}")

    # Structural audit (no network needed)
    audit_structural(module_data)
    audit_answer_keys(module_data)
    audit_content_depth(module_data, [])

    # Fetch OpenStax content for comparison
    print("\n🌐 Fetching OpenStax source from LibreTexts...")
    toc = fetch_chapter_toc(chapter_num)
    time.sleep(DELAY)

    if toc:
        print(f"  Found {len(toc)} sections in TOC")
        audit_section_coverage(module_data, toc)
    else:
        print("  ⚠️  Could not fetch TOC — skipping section coverage audit")

    # Fetch and compare review questions
    print("\n🌐 Fetching review questions...")
    review_text = fetch_review_questions(chapter_num)
    if review_text:
        audit_quiz_questions(module_data, review_text)

    # Fetch and compare key terms
    print("\n🌐 Fetching key terms...")
    key_terms_text = fetch_key_terms(chapter_num)
    if key_terms_text:
        audit_vocab_terms(module_data, key_terms_text)

    print(f"\n{'='*60}")
    print(f"✅ AUDIT COMPLETE: {module_path}")
    print(f"{'='*60}\n")

if __name__ == '__main__':
    main()
