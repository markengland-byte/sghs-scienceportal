"""
Physics Key Terms Extractor — Fetches glossary terms from each section page
of a physics chapter on LibreTexts.

Physics chapters don't have a separate Key Terms page like A&P. Instead, each
section page has a Glossary section at the bottom with <dl>/<dt>/<dd> markup.
This script fetches all section pages, extracts glossary terms, deduplicates,
and inserts a === KEY TERMS === block into the extracted text file.

Usage:
    python tools/extract_physics_terms.py physics/extracted/physics-ch1-extracted.txt

Can also be run standalone for any chapter:
    python tools/extract_physics_terms.py --chapter 2
"""

import sys
import os
import re
import time
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import requests
    from bs4 import BeautifulSoup
except ImportError:
    print("Install: pip install requests beautifulsoup4")
    sys.exit(1)

HEADERS = {
    'User-Agent': 'SGHS-Portal-OER-Builder/1.0 (Educational; CC-BY-4.0 reuse)'
}
DELAY = 1.5


def extract_glossary_from_url(url):
    """Fetch a section page and extract glossary terms from <dl> under Glossary heading."""
    terms = []
    try:
        resp = requests.get(url, headers=HEADERS, timeout=90)
        resp.raise_for_status()
        time.sleep(DELAY)
    except Exception as e:
        print(f"    WARNING: Failed to fetch {url[:60]}...: {e}")
        return terms

    soup = BeautifulSoup(resp.text, 'html.parser')

    # Find Glossary heading
    glossary_heading = soup.find(['h2', 'h3', 'h4'], id='Glossary')
    if not glossary_heading:
        # Try text match
        for h in soup.find_all(['h2', 'h3', 'h4']):
            if h.get_text(strip=True).lower() == 'glossary':
                glossary_heading = h
                break

    if not glossary_heading:
        return terms

    # Find the <dl> after the glossary heading
    dl = glossary_heading.find_next('dl')
    if not dl:
        return terms

    dts = dl.find_all('dt')
    dds = dl.find_all('dd')

    for dt, dd in zip(dts, dds):
        term = dt.get_text(strip=True)
        definition = dd.get_text(strip=True)
        if term and definition:
            # Clean up
            term = term.strip().rstrip(':')
            definition = definition.strip()
            if len(term) >= 2 and len(definition) >= 5:
                terms.append({'term': term, 'definition': definition})

    return terms


def main():
    args = sys.argv[1:]

    # Option 1: Pass extracted text file path
    # Option 2: Pass --chapter N to extract standalone
    project_root = Path(__file__).parent.parent

    if '--chapter' in args:
        ch_idx = args.index('--chapter')
        ch_num = int(args[ch_idx + 1])
        extracted_path = project_root / 'physics' / 'extracted' / f'physics-ch{ch_num}-extracted.txt'
    elif args:
        extracted_path = args[0]
        if not os.path.isabs(extracted_path):
            extracted_path = project_root / extracted_path
        extracted_path = Path(extracted_path)
        ch_match = re.search(r'ch(\d+)', str(extracted_path))
        ch_num = int(ch_match.group(1)) if ch_match else None
    else:
        print("Usage: python extract_physics_terms.py <extracted-text-file>")
        print("       python extract_physics_terms.py --chapter 2")
        sys.exit(1)

    if not extracted_path.exists():
        print(f"ERROR: File not found: {extracted_path}")
        sys.exit(1)

    with open(extracted_path, 'r', encoding='utf-8') as f:
        text = f.read()

    # Find all section SOURCE URLs in the extracted text
    source_urls = re.findall(r'^SOURCE:\s*(.+)$', text, re.MULTILINE)

    if not source_urls:
        print("ERROR: No SOURCE URLs found in extracted text.")
        sys.exit(1)

    print(f"\n{'='*60}")
    print(f"  EXTRACTING PHYSICS KEY TERMS — Chapter {ch_num}")
    print(f"  Scanning {len(source_urls)} section pages for glossary terms")
    print(f"{'='*60}\n")

    all_terms = []
    seen_terms = set()

    for url in source_urls:
        url = url.strip()
        # Extract section number from URL for display
        sec_match = re.search(r'/(\d+\.\d+)%3A', url)
        sec_label = sec_match.group(1) if sec_match else url.split('/')[-1][:30]

        print(f"  Scanning {sec_label}...")
        terms = extract_glossary_from_url(url)

        for t in terms:
            key = t['term'].lower()
            if key not in seen_terms:
                seen_terms.add(key)
                all_terms.append(t)
                print(f"    + {t['term']}: {t['definition'][:60]}...")

    print(f"\n  Total unique terms: {len(all_terms)}")

    if not all_terms:
        print("  No glossary terms found. This chapter may not have glossaries.")
        print(f"{'='*60}\n")
        return

    # Build KEY TERMS block
    kt_lines = ["=== KEY TERMS ===", ""]
    for t in sorted(all_terms, key=lambda x: x['term'].lower()):
        kt_lines.append(f"{t['term']}: {t['definition']}")
    kt_lines.append("")

    kt_block = '\n'.join(kt_lines)

    # Insert into extracted text (before REVIEW QUESTIONS if present, otherwise before CRITICAL THINKING)
    if '=== KEY TERMS ===' in text:
        # Replace existing
        text = re.sub(r'=== KEY TERMS ===\n.*?(?==== |\Z)', kt_block + '\n', text, flags=re.DOTALL)
        print(f"  Replaced existing KEY TERMS block")
    elif '=== REVIEW QUESTIONS ===' in text:
        rq_pos = text.index('=== REVIEW QUESTIONS ===')
        text = text[:rq_pos] + kt_block + '\n' + text[rq_pos:]
        print(f"  Inserted KEY TERMS before REVIEW QUESTIONS")
    elif '=== CRITICAL THINKING ===' in text:
        ct_pos = text.index('=== CRITICAL THINKING ===')
        text = text[:ct_pos] + kt_block + '\n' + text[ct_pos:]
        print(f"  Inserted KEY TERMS before CRITICAL THINKING")
    else:
        text += '\n' + kt_block
        print(f"  Appended KEY TERMS at end of file")

    with open(extracted_path, 'w', encoding='utf-8') as f:
        f.write(text)

    print(f"  Updated: {extracted_path.name}")
    print(f"  Terms: {len(all_terms)}")
    print(f"\n  Re-run build_module.py to include vocab cards.")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
