"""
Checkpoint Generator — Uses Gemini to generate critical thinking checkpoint questions
for chapters that don't have enough from OpenStax.

Usage:
    python tools/generate_checkpoints.py ap-ch7-extracted.txt

Reads the extracted text, identifies how many sections need checkpoints,
and generates thoughtful critical thinking questions via Gemini.
Appends them to the CRITICAL THINKING section of the extracted text file.
"""

import sys
import os
import re
import json
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import google.generativeai as genai
except ImportError:
    print("Install: pip install google-generativeai")
    sys.exit(1)

# Load API key
API_KEY = os.environ.get('GEMINI_API_KEY', '')
if not API_KEY or len(API_KEY) > 50:
    env_path = Path(__file__).parent.parent.parent / 'biology_sol_platform' / 'backend' / '.env'
    if env_path.exists():
        with open(env_path, 'r') as f:
            for line in f:
                if line.startswith('GEMINI_API_KEY='):
                    raw = line.strip().split('=', 1)[1].strip().strip('"').strip("'")
                    API_KEY = raw[:39] if raw.startswith('AIza') else raw.split()[0]
                    break

if not API_KEY:
    print("ERROR: GEMINI_API_KEY not found.")
    sys.exit(1)

genai.configure(api_key=API_KEY)
MODEL = genai.GenerativeModel('gemini-3-flash-preview')


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_checkpoints.py <extracted-text-file>")
        sys.exit(1)

    extracted_path = sys.argv[1]
    project_root = Path(__file__).parent.parent
    if not os.path.isabs(extracted_path):
        extracted_path = project_root / extracted_path

    with open(extracted_path, 'r', encoding='utf-8') as f:
        text = f.read()

    # Count sections
    sections = re.findall(r'^=== SECTION ([\d.]+) ===', text, re.MULTILINE)
    # Skip intro section (X.1) — it becomes the overview panel, not a content panel
    content_sections = [s for s in sections if not s.endswith('.1') or len(sections) <= 2]
    num_needed = len(content_sections)

    # Count existing critical thinking questions
    ct_block = ''
    ct_match = re.search(r'=== CRITICAL THINKING ===\n(.*)', text, re.DOTALL)
    if ct_match:
        ct_block = ct_match.group(1)
    existing_qs = re.findall(r'^\d+\.\s+(.+)', ct_block, re.MULTILINE)
    existing_qs = [q for q in existing_qs if 'is shared under' not in q]

    shortfall = num_needed - len(existing_qs)

    ch_match = re.search(r'ch(\d+)', str(extracted_path))
    ch_num = ch_match.group(1) if ch_match else '?'

    print(f"\n{'='*60}")
    print(f"  CHECKPOINT GENERATOR — Chapter {ch_num}")
    print(f"  Content sections: {num_needed}")
    print(f"  Existing CT Qs:   {len(existing_qs)}")
    print(f"  Need to generate: {shortfall}")
    print(f"{'='*60}\n")

    if shortfall <= 0:
        print("  No additional checkpoints needed.")
        return

    # Get section titles for context
    section_titles = []
    for sec_num in content_sections:
        title_match = re.search(rf'=== SECTION {re.escape(sec_num)} ===.*?TITLE:\s*(.+)', text, re.DOTALL)
        if title_match:
            section_titles.append(f"{sec_num}: {title_match.group(1).strip()}")
        else:
            section_titles.append(sec_num)

    # Get prose context
    prose_lines = []
    for line in text.split('\n'):
        stripped = line.strip()
        if not stripped or len(stripped) < 30:
            continue
        if stripped.startswith(('===', 'SOURCE:', 'TITLE:', 'FIGURE:', 'ORIGINAL:', 'CAPTION:',
                               'LEARNING OBJECTIVES', 'TABLE:', 'CALLOUT:', 'ANSWER:', '---', '- ', '### ', '## ', '| ')):
            continue
        if 'is shared under' in stripped:
            continue
        prose_lines.append(stripped)

    context = '\n'.join(prose_lines[:200])

    # Which sections need questions? (ones beyond the existing CT count)
    sections_needing = section_titles[len(existing_qs):]

    prompt = f"""You are an anatomy and physiology professor creating checkpoint questions for students.

I need {shortfall} critical thinking questions for the following sections of OpenStax A&P 2e Chapter {ch_num}:

Sections needing questions:
{chr(10).join(f'- {s}' for s in sections_needing)}

These questions should:
- Require students to explain concepts in their own words (not just recall facts)
- Be answerable in 2-4 sentences (80+ characters)
- Connect concepts from the section to real-world or clinical applications where possible
- Be specific to the section content, not generic

Chapter content context:
{context[:6000]}

Respond with ONLY the questions, one per line, numbered starting from {len(existing_qs) + 1}. No other text.
Example format:
{len(existing_qs) + 1}. Why is the structure of X important for its function in Y?
"""

    print(f"  Sending to Gemini...")
    try:
        response = MODEL.generate_content(prompt)
        response_text = response.text.strip()

        # Parse questions
        new_qs = re.findall(r'^\d+\.\s+(.+)', response_text, re.MULTILINE)
        print(f"  Generated {len(new_qs)} checkpoint questions\n")

        for i, q in enumerate(new_qs):
            print(f"  {len(existing_qs) + i + 1}. {q[:80]}...")

        # Append to extracted text file
        # Find the CRITICAL THINKING section and append
        if '=== CRITICAL THINKING ===' in text:
            # Remove trailing junk after last question
            ct_end = text.rfind('=== CRITICAL THINKING ===')
            before_ct = text[:ct_end]
            ct_section = text[ct_end:]

            # Clean up existing CT section (remove license junk at end)
            ct_lines = ct_section.split('\n')
            clean_ct = []
            for line in ct_lines:
                if 'is shared under' in line:
                    continue
                clean_ct.append(line)

            # Append new questions
            clean_ct.append('')
            for i, q in enumerate(new_qs):
                clean_ct.append(f"{len(existing_qs) + i + 1}. {q}")
                clean_ct.append('')

            text = before_ct + '\n'.join(clean_ct)
        else:
            # No CT section exists — create one
            text += '\n=== CRITICAL THINKING ===\n\n'
            for i, q in enumerate(new_qs):
                text += f"{i + 1}. {q}\n\n"

        with open(extracted_path, 'w', encoding='utf-8') as f:
            f.write(text)

        print(f"\n  Appended {len(new_qs)} questions to {Path(extracted_path).name}")
        print(f"  Re-run build_module.py to include them.")

    except Exception as e:
        print(f"  ERROR: {e}")

    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
