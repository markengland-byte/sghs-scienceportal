"""
Chapter Extractor — Fetches verbatim OpenStax content from LibreTexts.

Usage:
    python tools/extract_chapter.py 19              # A&P chapter
    python tools/extract_chapter.py --physics 1     # Physics chapter

Supports:
    - OpenStax Anatomy & Physiology 2e (A&P)
    - OpenStax College Physics 1e (Physics)

Extracts:
    - All section prose, headings, images, tables, callouts, learning objectives
    - Downloads images locally
    - Key terms with definitions
    - Review/conceptual questions with answer choices
    - Critical thinking / problems & exercises
    - Writes extracted text to course-specific directory

Requirements:
    pip install requests beautifulsoup4
"""

import sys
import os
import re
import time
import io
import urllib.parse
from pathlib import Path

# Fix Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import requests
    from bs4 import BeautifulSoup, NavigableString, Tag
except ImportError:
    print("Install dependencies: pip install requests beautifulsoup4")
    sys.exit(1)

# --- CONFIG ---

# A&P config
AP_BASE = "https://med.libretexts.org/Bookshelves/Anatomy_and_Physiology/Anatomy_and_Physiology_2e_(OpenStax)"
AP_UNIT_MAP = {
    1: "01%3A_Levels_of_Organization",
    2: "01%3A_Levels_of_Organization",
    3: "01%3A_Levels_of_Organization",
    4: "01%3A_Levels_of_Organization",
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
    25: "05%3A_Energy_Maintenance_and_Environmental_Exchange",
    26: "05%3A_Energy_Maintenance_and_Environmental_Exchange",
    27: "06%3A_Human_Development_and_the_Continuity_of_Life",
    28: "06%3A_Human_Development_and_the_Continuity_of_Life",
}
AP_CHAPTER_TITLES = {
    1: "01%3A_An_Introduction_to_the_Human_Body",
    2: "02%3A_The_Chemical_Level_of_Organization",
    3: "03%3A_The_Cellular_Level_of_Organization",
    4: "04%3A_The_Tissue_Level_of_Organization",
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
    18: "18%3A_The_Cardiovascular_System_-_Blood",
    19: "19%3A_The_Cardiovascular_System_-_The_Heart",
    20: "20%3A_The_Cardiovascular_System_-_Blood_Vessels_and_Circulation",
    21: "21%3A_The_Lymphatic_and_Immune_System",
    22: "22%3A_The_Respiratory_System",
    23: "23%3A_The_Digestive_System",
    24: "24%3A_Metabolism_and_Nutrition",
    25: "25%3A_The_Urinary_System",
    26: "26%3A_Fluid_Electrolyte_and_Acid-Base_Balance",
    27: "27%3A_The_Reproductive_System",
    28: "28%3A_Development_and_Inheritance",
}

# Physics config
PHYSICS_BASE = "https://phys.libretexts.org/Bookshelves/College_Physics/College_Physics_1e_(OpenStax)"
PHYSICS_CHAPTER_TITLES = {
    1: "01%3A_The_Nature_of_Science_and_Physics",
    2: "02%3A_Kinematics",
    3: "03%3A_Two-Dimensional_Kinematics",
    4: "04%3A_Dynamics-_Force_and_Newton's_Laws_of_Motion",
    5: "05%3A_Further_Applications_of_Newton's_Laws-_Friction_Drag_and_Elasticity",
    6: "06%3A_Uniform_Circular_Motion_and_Gravitation",
    7: "07%3A_Work_Energy_and_Energy_Resources",
    8: "08%3A_Linear_Momentum_and_Collisions",
    9: "09%3A_Statics_and_Torque",
    10: "10%3A_Rotational_Motion_and_Angular_Momentum",
    11: "11%3A_Fluid_Statics",
    12: "12%3A_Fluid_Dynamics_and_Its_Biological_and_Medical_Applications",
    13: "13%3A_Temperature_Kinetic_Theory_and_the_Gas_Laws",
    14: "14%3A_Heat_and_Heat_Transfer_Methods",
    15: "15%3A_Thermodynamics",
    16: "16%3A_Oscillatory_Motion_and_Waves",
    17: "17%3A_Physics_of_Hearing",
    18: "18%3A_Electric_Charge_and_Electric_Field",
    19: "19%3A_Electric_Potential_and_Electric_Field",
    20: "20%3A_Electric_Current_Resistance_and_Ohm's_Law",
    21: "21%3A_Circuits_Bioelectricity_and_DC_Instruments",
    22: "22%3A_Magnetism",
    23: "23%3A_Electromagnetic_Induction_AC_Circuits_and_Electrical_Technologies",
    24: "24%3A_Electromagnetic_Waves",
    25: "25%3A_Geometric_Optics",
    26: "26%3A_Vision_and_Optical_Instruments",
    27: "27%3A_Wave_Optics",
    28: "28%3A_Special_Relativity",
    29: "29%3A_Introduction_to_Quantum_Physics",
    30: "30%3A_Atomic_Physics",
    31: "31%3A_Radioactivity_and_Nuclear_Physics",
    32: "32%3A_Medical_Applications_of_Nuclear_Physics",
    33: "33%3A_Particle_Physics",
    34: "34%3A_Frontiers_of_Physics",
}

DELAY = 1.5
HEADERS = {
    'User-Agent': 'SGHS-Portal-OER-Builder/1.0 (Educational; CC-BY-4.0 reuse)'
}

# --- COURSE MODE (set by CLI) ---
COURSE = 'ap'  # 'ap' or 'physics'


# --- HELPERS ---

def get_chapter_url(ch_num):
    if COURSE == 'physics':
        chapter = PHYSICS_CHAPTER_TITLES.get(ch_num)
        if not chapter:
            print(f"ERROR: Physics chapter {ch_num} not in URL maps (valid: 1-34)")
            sys.exit(1)
        return f"{PHYSICS_BASE}/{chapter}"
    else:
        unit = AP_UNIT_MAP.get(ch_num)
        chapter = AP_CHAPTER_TITLES.get(ch_num)
        if not unit or not chapter:
            print(f"ERROR: A&P chapter {ch_num} not in URL maps (valid: 1-28)")
            sys.exit(1)
        return f"{AP_BASE}/{unit}/{chapter}"


def get_libretexts_domain():
    return "phys.libretexts.org" if COURSE == 'physics' else "med.libretexts.org"


def fetch_page(url, retries=3):
    """Fetch a page and return BeautifulSoup object. Retries on timeout."""
    print(f"  Fetching: {url[:80]}...")
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=90)
            if resp.status_code == 503:
                raise requests.exceptions.ConnectionError("503 Service Unavailable")
            resp.raise_for_status()
            time.sleep(DELAY)
            return BeautifulSoup(resp.text, 'html.parser')
        except (requests.exceptions.ReadTimeout, requests.exceptions.ConnectionError) as e:
            if attempt < retries - 1:
                wait = (attempt + 1) * 10
                print(f"    Retry in {wait}s (attempt {attempt + 2}/{retries}): {e}")
                time.sleep(wait)
            else:
                print(f"    FAILED after {retries} attempts: {e}")
                raise


def is_junk_paragraph(text):
    """Filter out LaTeX preamble and license footer paragraphs."""
    text = text.strip()
    if not text:
        return True
    if text.startswith('\\(') or '\\newcommand' in text:
        return True
    if 'This page titled' in text and 'is shared under a CC' in text:
        return True
    if text.startswith('OpenStax') and 'CC BY' in text:
        return True
    if len(text) < 5:
        return True
    return False


def slugify(text, max_len=40):
    """Create a URL/filename-safe slug from text."""
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_]+', '-', text)
    text = re.sub(r'-+', '-', text).strip('-')
    return text[:max_len]


def download_image(img_url, save_dir, ch_num, fig_counter, alt_text=''):
    """Download an image and save it locally. Returns local filename."""
    try:
        # Create descriptive filename
        slug = slugify(alt_text) if alt_text else f"image-{fig_counter}"
        # Determine extension from URL or default to png
        ext = '.jpg'
        if '.png' in img_url.lower():
            ext = '.png'
        elif '.gif' in img_url.lower():
            ext = '.gif'
        elif '.svg' in img_url.lower():
            ext = '.svg'

        filename = f"fig{ch_num}-{fig_counter}-{slug}{ext}"
        filepath = os.path.join(save_dir, filename)

        resp = requests.get(img_url, headers=HEADERS, timeout=30)
        resp.raise_for_status()

        with open(filepath, 'wb') as f:
            f.write(resp.content)

        print(f"    Downloaded: {filename} ({len(resp.content)//1024} KB)")
        time.sleep(0.5)
        return filename
    except Exception as e:
        print(f"    WARNING: Failed to download image: {e}")
        return None


# --- SECTION DISCOVERY ---

def discover_sections_from_jsonld(soup, ch_num):
    """Fallback: extract section URLs from JSON-LD relatedLink data.
    Some LibreTexts chapters render TOC links via JavaScript only.
    The JSON-LD structured data is always in static HTML."""
    import json as json_mod
    sections = []
    domain = get_libretexts_domain()

    for script in soup.find_all('script', type='application/ld+json'):
        try:
            data = json_mod.loads(script.string)
        except:
            continue

        related = data.get('relatedLink', [])
        if not related:
            continue

        for url in related:
            # Match section URLs like .../12.01%3A_... or .../12.E%3A_...
            match = re.search(rf'/({ch_num}\.\w+)%3A_(.+?)(?:\?|$)', url)
            if not match:
                continue

            section_num = match.group(1)
            # Convert URL-encoded title to readable text
            raw_title = urllib.parse.unquote(match.group(2)).replace('_', ' ')
            title = f"{section_num}: {raw_title}"

            # Classify
            section_type = 'content'
            title_lower = title.lower()

            if COURSE == 'physics':
                if '.E' in section_num or 'exercise' in title_lower:
                    section_type = 'exercises'
            else:
                if 'key term' in title_lower:
                    section_type = 'key_terms'
                elif 'review question' in title_lower:
                    section_type = 'review_questions'
                elif 'critical thinking' in title_lower:
                    section_type = 'critical_thinking'
                elif 'chapter review' in title_lower:
                    section_type = 'chapter_review'
                elif 'interactive link' in title_lower:
                    section_type = 'interactive_links'

            full_url = url if url.startswith('http') else f"https://{domain}{url}"

            sections.append({
                'num': section_num,
                'title': title,
                'url': full_url,
                'type': section_type,
            })

    return sections


def discover_sections(soup, ch_num):
    """Find all section links from the chapter TOC page."""
    sections = []
    links = soup.find_all('a')
    domain = get_libretexts_domain()

    if COURSE == 'physics':
        chapter_code = PHYSICS_CHAPTER_TITLES[ch_num]
    else:
        chapter_code = AP_CHAPTER_TITLES[ch_num]

    for link in links:
        href = link.get('href', '')
        text = link.get_text(strip=True)

        # Match section links like "19.01:", "19.1:", etc.
        pattern = rf'{ch_num}\.(\w+)'
        match = re.search(pattern, text)
        if match and chapter_code.split('%3A_')[0] in href:
            section_num = match.group(0)
            # Classify the section
            text_lower = text.lower()
            section_type = 'content'

            if COURSE == 'physics':
                # Physics: single Exercises page (N.E), skip prelude (N.00)
                if '.E' in section_num or 'exercise' in text_lower:
                    section_type = 'exercises'
                elif section_num.endswith('.00') or section_num.endswith('.0') or 'prelude' in text_lower:
                    section_type = 'content'  # Include prelude as content
            else:
                # A&P: separate pages for key terms, review, critical thinking
                if 'key term' in text_lower:
                    section_type = 'key_terms'
                elif 'review question' in text_lower:
                    section_type = 'review_questions'
                elif 'critical thinking' in text_lower:
                    section_type = 'critical_thinking'
                elif 'chapter review' in text_lower:
                    section_type = 'chapter_review'
                elif 'interactive link' in text_lower:
                    section_type = 'interactive_links'

            # Build full URL
            if href.startswith('http'):
                full_url = href
            else:
                full_url = f"https://{domain}{href}"

            sections.append({
                'num': section_num,
                'title': text,
                'url': full_url,
                'type': section_type,
            })

    # Deduplicate by URL
    seen = set()
    unique = []
    for s in sections:
        if s['url'] not in seen:
            seen.add(s['url'])
            unique.append(s)

    # Fallback: if we found very few sections, try JSON-LD
    content_count = sum(1 for s in unique if s['type'] == 'content')
    if content_count <= 1:
        print(f"    Static HTML had only {content_count} sections — trying JSON-LD fallback...")
        jsonld_sections = discover_sections_from_jsonld(soup, ch_num)
        if len(jsonld_sections) > len(unique):
            print(f"    JSON-LD found {len(jsonld_sections)} sections")
            unique = jsonld_sections

    return unique


# --- CONTENT EXTRACTION ---

def extract_section_content(soup, section_url, ch_num, img_dir, fig_counter):
    """Extract all content from a section page."""
    output_lines = []
    images_downloaded = []
    para_count = 0
    word_count = 0

    # Title
    h1 = soup.find('h1')
    if h1:
        title = h1.get_text(strip=True)
        # Clean up title (remove "X.Y:" prefix duplication)
        output_lines.append(f"TITLE: {title}")
        output_lines.append("")

    # Learning Objectives
    obj_box = soup.find('div', class_='box-objectives') or soup.find('div', class_='learning-objectives')
    if not obj_box:
        # Try finding by text content
        for div in soup.find_all('div'):
            if 'learning objectives' in div.get_text(strip=True).lower()[:30]:
                obj_box = div
                break

    if obj_box:
        output_lines.append("LEARNING OBJECTIVES")
        items = obj_box.find_all('li')
        for item in items:
            text = item.get_text(strip=True)
            if text:
                output_lines.append(f"- {text}")
        output_lines.append("")

    # Main content area
    content_area = soup.find('section', class_='mt-content-container')
    if not content_area:
        content_area = soup.find('div', id='mt-content-container')
    if not content_area:
        content_area = soup.find('div', class_='mt-content-container')
    if not content_area:
        # Fallback: use the body
        content_area = soup.find('body')

    if content_area:
        # Walk through elements in document order
        for element in content_area.descendants:
            if not isinstance(element, Tag):
                continue

            # Headings
            if element.name in ('h2', 'h3', 'h4') and element.string != element.parent.string if element.parent else True:
                heading_text = element.get_text(strip=True)
                if heading_text and len(heading_text) > 2 and not is_junk_paragraph(heading_text):
                    level = int(element.name[1])
                    prefix = '#' * level
                    output_lines.append(f"{prefix} {heading_text}")
                    output_lines.append("")

            # Paragraphs
            elif element.name == 'p':
                # Skip if inside a nav, header, footer, or already-processed box
                if element.find_parent(['nav', 'header', 'footer']):
                    continue

                text = element.get_text(strip=True)
                if not is_junk_paragraph(text):
                    # Check for bold/strong terms inline
                    html_content = str(element)
                    # Preserve bold markers
                    for strong in element.find_all(['strong', 'b']):
                        strong_text = strong.get_text(strip=True)
                        if strong_text:
                            text = text  # keep as-is, bold noted in raw text

                    output_lines.append(text)
                    output_lines.append("")
                    para_count += 1
                    word_count += len(text.split())

            # Images
            elif element.name == 'img':
                src = element.get('src', '')
                alt = element.get('alt', '')

                if 'deki/files' in src or 'openstax.org' in src:
                    # Make URL absolute if needed
                    domain = get_libretexts_domain()
                    if src.startswith('//'):
                        src = 'https:' + src
                    elif src.startswith('/'):
                        src = f'https://{domain}' + src

                    fig_counter += 1
                    local_name = download_image(src, img_dir, ch_num, fig_counter, alt)

                    # Look for caption
                    caption = ''
                    cap_container = element.find_parent('figure') or element.find_parent('div', class_='os-figure')
                    if cap_container:
                        cap_el = cap_container.find(['figcaption', 'div'], class_=lambda c: c and 'caption' in str(c).lower())
                        if cap_el:
                            caption = cap_el.get_text(strip=True)
                    if not caption and alt:
                        caption = alt

                    img_prefix = 'physics' if COURSE == 'physics' else 'ap'
                    output_lines.append(f"FIGURE: {img_prefix}/images/ch{ch_num}/{local_name}" if local_name else f"FIGURE: {src}")
                    output_lines.append(f"ORIGINAL: {src}")
                    if caption:
                        output_lines.append(f"CAPTION: {caption}")
                    output_lines.append("")

                    if local_name:
                        images_downloaded.append(local_name)

            # Tables
            elif element.name == 'table':
                # Don't re-process nested tables
                if element.find_parent('table'):
                    continue

                output_lines.append("TABLE:")
                rows = element.find_all('tr')
                for i, row in enumerate(rows):
                    cells = row.find_all(['th', 'td'])
                    cell_texts = [c.get_text(strip=True) for c in cells]
                    output_lines.append("| " + " | ".join(cell_texts) + " |")
                    if i == 0 and row.find('th'):
                        output_lines.append("|" + "|".join(["---"] * len(cells)) + "|")
                output_lines.append("")

    # Callout boxes / notes
    for box in (soup.find_all('div', class_='box-note') or []):
        title_el = box.find(['h3', 'h4', 'strong', 'b'])
        title_text = title_el.get_text(strip=True) if title_el else 'Note'
        body_text = box.get_text(strip=True)
        if title_el:
            body_text = body_text.replace(title_text, '', 1).strip()
        if body_text and not is_junk_paragraph(body_text):
            output_lines.append(f"CALLOUT: {title_text}")
            output_lines.append(body_text)
            output_lines.append("")

    return output_lines, para_count, word_count, fig_counter, images_downloaded


def extract_key_terms(soup):
    """Extract key terms from the Key Terms page."""
    output_lines = ["=== KEY TERMS ===", ""]
    term_count = 0

    # Try definition lists first
    dls = soup.find_all('dl')
    for dl in dls:
        dts = dl.find_all('dt')
        dds = dl.find_all('dd')
        for dt, dd in zip(dts, dds):
            term = dt.get_text(strip=True)
            definition = dd.get_text(strip=True)
            if term and definition:
                output_lines.append(f"{term}: {definition}")
                term_count += 1

    # Fallback: look for bold terms followed by definitions
    if term_count == 0:
        for p in soup.find_all('p'):
            strong = p.find(['strong', 'b'])
            if strong:
                term = strong.get_text(strip=True)
                full_text = p.get_text(strip=True)
                definition = full_text.replace(term, '', 1).strip()
                if definition.startswith(':'):
                    definition = definition[1:].strip()
                if term and definition:
                    output_lines.append(f"{term}: {definition}")
                    term_count += 1

    output_lines.append("")
    return output_lines, term_count


def extract_review_questions(soup):
    """Extract review questions from the Review Questions page."""
    output_lines = ["=== REVIEW QUESTIONS ===", ""]
    q_count = 0

    # Find all list items or numbered paragraphs that look like questions
    # LibreTexts uses alternating <p> and <ol> for questions
    content = soup.find('section', class_='mt-content-container') or soup.find('body')
    if not content:
        return output_lines, 0

    current_question = None
    for element in content.find_all(['p', 'ol']):
        text = element.get_text(strip=True)
        if is_junk_paragraph(text):
            continue

        if element.name == 'p':
            # Check if this looks like a question (starts with number or has question mark)
            if re.match(r'^\d+\.', text) or (len(text) > 20 and '?' in text) or (len(text) > 20 and '________' in text):
                q_count += 1
                # Clean up numbering
                text = re.sub(r'^\d+\.\s*', '', text)
                current_question = text
                output_lines.append(f"{q_count}. {current_question}")

        elif element.name == 'ol' and current_question:
            items = element.find_all('li')
            letters = 'abcdefgh'
            for i, item in enumerate(items):
                if i < len(letters):
                    item_text = item.get_text(strip=True)
                    output_lines.append(f"   {letters[i]}) {item_text}")
            output_lines.append(f"   ANSWER: [determine from content]")
            output_lines.append("")
            current_question = None

    return output_lines, q_count


def extract_critical_thinking(soup):
    """Extract critical thinking questions."""
    output_lines = ["=== CRITICAL THINKING ===", ""]
    q_count = 0

    content = soup.find('section', class_='mt-content-container') or soup.find('body')
    if not content:
        return output_lines, 0

    for element in content.find_all('p'):
        text = element.get_text(strip=True)
        if is_junk_paragraph(text):
            continue

        # Check if it looks like a question
        if re.match(r'^\d+\.', text) or (len(text) > 20 and '?' in text):
            q_count += 1
            text = re.sub(r'^\d+\.\s*', '', text)
            output_lines.append(f"{q_count}. {text}")
            output_lines.append("")

    return output_lines, q_count


def extract_physics_exercises(soup):
    """Extract exercises from Physics chapter (single page with Conceptual Questions + Problems & Exercises)."""
    conceptual_lines = ["=== CONCEPTUAL QUESTIONS ===", ""]
    problems_lines = ["=== PROBLEMS AND EXERCISES ===", ""]
    conceptual_count = 0
    problems_count = 0

    content = soup.find('section', class_='mt-content-container') or soup.find('div', id='mt-content-container') or soup.find('body')
    if not content:
        return conceptual_lines, 0, problems_lines, 0

    # Track which section we're in
    current_section = None  # 'conceptual' or 'problems'

    for element in content.find_all(['h2', 'h3', 'h4', 'p', 'ol']):
        if element.name in ('h2', 'h3', 'h4'):
            heading = element.get_text(strip=True).lower()
            if 'conceptual question' in heading:
                current_section = 'conceptual'
            elif 'problem' in heading and 'exercise' in heading:
                current_section = 'problems'
            elif 'problem' in heading:
                current_section = 'problems'
            continue

        if not current_section:
            continue

        text = element.get_text(strip=True)
        if is_junk_paragraph(text):
            continue

        if element.name == 'p':
            # Numbered question
            if re.match(r'^\d+\.', text):
                text = re.sub(r'^\d+\.\s*', '', text)
                if current_section == 'conceptual':
                    conceptual_count += 1
                    conceptual_lines.append(f"{conceptual_count}. {text}")
                    conceptual_lines.append("")
                else:
                    problems_count += 1
                    problems_lines.append(f"{problems_count}. {text}")
                    problems_lines.append("")

    conceptual_lines.append("")
    problems_lines.append("")
    return conceptual_lines, conceptual_count, problems_lines, problems_count


def extract_inline_key_terms(all_output_text):
    """Extract key terms from inline bold definitions in physics sections.
    Physics doesn't have a separate Key Terms page — terms are bolded inline."""
    terms = []
    # Look for patterns like "**Term** definition" or "Term: definition" after bold
    for line in all_output_text:
        # This is a heuristic — terms defined inline are typically bold in the original HTML
        # We'll collect them during section extraction instead
        pass
    return terms


# --- MAIN ---

def main():
    global COURSE

    # Parse args
    args = sys.argv[1:]
    if '--physics' in args:
        COURSE = 'physics'
        args.remove('--physics')
    elif '--ap' in args:
        COURSE = 'ap'
        args.remove('--ap')

    if len(args) < 1:
        print("Usage: python extract_chapter.py [--physics|--ap] <chapter_number>")
        print("  python extract_chapter.py 19           # A&P Ch. 19")
        print("  python extract_chapter.py --physics 1  # Physics Ch. 1")
        sys.exit(1)

    ch_num = int(args[0])

    # Resolve paths relative to project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    if COURSE == 'physics':
        course_label = "OpenStax College Physics 1e"
        img_dir = project_root / 'physics' / 'images' / f'ch{ch_num}'
        output_file = project_root / 'physics' / 'extracted' / f'physics-ch{ch_num}-extracted.txt'
    else:
        course_label = "OpenStax A&P 2e"
        img_dir = project_root / 'ap' / 'images' / f'ch{ch_num}'
        output_file = project_root / 'ap' / 'extracted' / f'ap-ch{ch_num}-extracted.txt'

    # Create directories
    img_dir.mkdir(parents=True, exist_ok=True)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  EXTRACTING CHAPTER {ch_num}")
    print(f"  Source: {course_label} via LibreTexts")
    print(f"  Images: {img_dir}")
    print(f"  Output: {output_file}")
    print(f"{'='*60}\n")

    # Step 1: Fetch chapter TOC page
    chapter_url = get_chapter_url(ch_num)
    print(f"[1/4] Fetching chapter TOC...")
    toc_soup = fetch_page(chapter_url)

    # Discover sections
    sections = discover_sections(toc_soup, ch_num)

    content_sections = [s for s in sections if s['type'] == 'content']
    exercises_sections = [s for s in sections if s['type'] == 'exercises']
    key_terms_sections = [s for s in sections if s['type'] == 'key_terms']
    review_q_sections = [s for s in sections if s['type'] == 'review_questions']
    crit_think_sections = [s for s in sections if s['type'] == 'critical_thinking']

    if COURSE == 'physics':
        print(f"  Found: {len(content_sections)} content sections, "
              f"{len(exercises_sections)} exercises page")
    else:
        print(f"  Found: {len(content_sections)} content sections, "
              f"{len(key_terms_sections)} key terms page, "
              f"{len(review_q_sections)} review Qs page, "
              f"{len(crit_think_sections)} critical thinking page")
    print()

    # Step 2: Extract each content section
    print(f"[2/4] Extracting content sections...")
    all_output = []
    total_paras = 0
    total_words = 0
    total_images = 0
    fig_counter = 0

    for sec in content_sections:
        print(f"\n  --- {sec['num']}: {sec['title']} ---")
        all_output.append(f"=== SECTION {sec['num']} ===")
        all_output.append(f"SOURCE: {sec['url']}")
        all_output.append("")

        soup = fetch_page(sec['url'])
        lines, paras, words, fig_counter, imgs = extract_section_content(
            soup, sec['url'], ch_num, str(img_dir), fig_counter
        )
        all_output.extend(lines)
        all_output.append("")

        total_paras += paras
        total_words += words
        total_images += len(imgs)

        print(f"  Extracted: {paras} paragraphs, {words} words, {len(imgs)} images")

    # Step 3: Extract questions
    term_count = 0
    review_count = 0
    crit_count = 0
    conceptual_count = 0
    problems_count = 0

    if COURSE == 'physics':
        print(f"\n[3/4] Extracting exercises (conceptual questions + problems)...")
        if exercises_sections:
            soup = fetch_page(exercises_sections[0]['url'])
            c_lines, conceptual_count, p_lines, problems_count = extract_physics_exercises(soup)
            # Conceptual questions → CRITICAL THINKING (for checkpoints)
            all_output.extend(["=== CRITICAL THINKING ===", ""])
            for line in c_lines:
                if line.startswith("=== CONCEPTUAL"):
                    continue
                all_output.append(line)
            # Problems → separate section for reference
            all_output.extend(p_lines)
            print(f"  Conceptual questions: {conceptual_count} (→ checkpoints)")
            print(f"  Problems & exercises: {problems_count}")
            print(f"  NOTE: Run generate_physics_quiz.py to create MC review questions")
        review_count = 0  # MC questions generated separately
        crit_count = conceptual_count
    else:
        print(f"\n[3/4] Extracting key terms, review questions, critical thinking...")
        if key_terms_sections:
            soup = fetch_page(key_terms_sections[0]['url'])
            lines, term_count = extract_key_terms(soup)
            all_output.extend(lines)
            print(f"  Key terms: {term_count}")

        if review_q_sections:
            soup = fetch_page(review_q_sections[0]['url'])
            lines, review_count = extract_review_questions(soup)
            all_output.extend(lines)
            print(f"  Review questions: {review_count}")

        if crit_think_sections:
            soup = fetch_page(crit_think_sections[0]['url'])
            lines, crit_count = extract_critical_thinking(soup)
            all_output.extend(lines)
            print(f"  Critical thinking: {crit_count}")

    # Step 4: Write output file
    print(f"\n[4/4] Writing output file...")
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write('\n'.join(all_output))

    # Print summary report
    print(f"\n{'='*60}")
    print(f"  EXTRACTION REPORT — Chapter {ch_num} ({COURSE.upper()})")
    print(f"{'='*60}")
    print(f"  Content sections:     {len(content_sections)}")
    print(f"  Prose paragraphs:     {total_paras}")
    print(f"  Prose word count:     {total_words}")
    print(f"  Images downloaded:    {total_images}")
    if COURSE == 'physics':
        print(f"  Conceptual questions: {conceptual_count}")
        print(f"  Problems & exercises: {problems_count}")
    else:
        print(f"  Key terms:            {term_count}")
        print(f"  Review questions:     {review_count}")
        print(f"  Critical thinking:    {crit_count}")
    print(f"  Output file:          {output_file}")
    print(f"  Image directory:      {img_dir}")
    print()

    # Quality gate (adjusted thresholds for physics)
    issues = []
    if total_paras < 10:
        issues.append(f"  LOW PARAGRAPH COUNT: {total_paras} (target: 10+)")
    if total_words < 1000:
        issues.append(f"  LOW WORD COUNT: {total_words} (target: 1000+)")
    if total_images < 1:
        issues.append(f"  LOW IMAGE COUNT: {total_images} (target: 1+)")
    if COURSE == 'ap':
        if term_count < 30:
            issues.append(f"  LOW TERM COUNT: {term_count} (target: 30+)")
    if review_count < 5:
        issues.append(f"  LOW QUESTION COUNT: {review_count} (target: 5+)")

    if issues:
        print("  QUALITY WARNINGS:")
        for issue in issues:
            print(issue)
    else:
        print("  ALL QUALITY CHECKS PASSED")

    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
