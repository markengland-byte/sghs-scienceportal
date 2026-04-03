"""
Answer Key Generator — Uses Google Gemini to determine correct answers for OpenStax review questions.

Reads the extracted text file, sends each review question + relevant chapter content to Gemini,
and outputs a JSON answer key + explanations for use in the config file and build script.

Usage:
    python tools/generate_answers.py ap-ch19-extracted.txt

Output:
    tools/configs/ch19-answers.json

Requires:
    pip install google-generativeai
    GEMINI_API_KEY in backend/.env or as environment variable
"""

import sys
import os
import re
import json
import time
import io
from pathlib import Path
# dotenv not used — manual .env parsing instead (dotenv mangles multi-value lines)

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import google.generativeai as genai
except ImportError:
    print("Install: pip install google-generativeai")
    sys.exit(1)

# Load API key — manual parse from backend .env (dotenv mangles the value)
API_KEY = os.environ.get('GEMINI_API_KEY', '')
if not API_KEY or len(API_KEY) > 50:
    # Parse manually — the .env line may have trailing content
    env_path = Path(__file__).parent.parent.parent / 'biology_sol_platform' / 'backend' / '.env'
    if env_path.exists():
        with open(env_path, 'r') as f:
            for line in f:
                if line.startswith('GEMINI_API_KEY='):
                    raw = line.strip().split('=', 1)[1].strip().strip('"').strip("'")
                    # Gemini API keys are 39 chars starting with AIza
                    if raw.startswith('AIza'):
                        API_KEY = raw[:39]
                    else:
                        API_KEY = raw.split()[0]  # Take first word only
                    break

if not API_KEY:
    print("ERROR: GEMINI_API_KEY not found.")
    print("Set it as an environment variable or ensure it's in backend/.env")
    sys.exit(1)

genai.configure(api_key=API_KEY)
MODEL = genai.GenerativeModel('gemini-3-flash-preview')

DELAY = 2  # seconds between API calls


def parse_extracted_for_answers(filepath):
    """Parse extracted text to get prose content and review questions."""
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    # Extract all prose content (for context)
    prose_lines = []
    for line in text.split('\n'):
        stripped = line.strip()
        # Skip metadata lines, figure references, section markers
        if not stripped:
            continue
        if stripped.startswith(('===', 'SOURCE:', 'TITLE:', 'FIGURE:', 'ORIGINAL:', 'CAPTION:',
                               'LEARNING OBJECTIVES', 'TABLE:', 'CALLOUT:', 'ANSWER:', '---')):
            continue
        if stripped.startswith(('- ', '### ', '## ', '| ')):
            continue
        if 'is shared under' in stripped:
            continue
        if len(stripped) > 30:
            prose_lines.append(stripped)

    prose_context = '\n'.join(prose_lines[:300])  # First ~300 meaningful lines for context

    # Extract review questions
    questions = []
    in_review = False
    lines = text.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if '=== REVIEW QUESTIONS ===' in line:
            in_review = True
            i += 1
            continue
        if in_review and line.startswith('=== '):
            break
        if in_review:
            q_match = re.match(r'^(\d+)\.\s+(.+)$', line)
            if q_match:
                q_num = int(q_match.group(1))
                q_text = q_match.group(2)
                options = []
                i += 1
                while i < len(lines):
                    opt_line = lines[i].strip()
                    opt_match = re.match(r'^([a-d])\)\s+(.+)$', opt_line)
                    if opt_match:
                        options.append({'letter': opt_match.group(1), 'text': opt_match.group(2)})
                    elif opt_line.startswith('ANSWER:'):
                        pass  # Skip existing answer placeholders
                    else:
                        break
                    i += 1
                questions.append({
                    'num': q_num,
                    'text': q_text,
                    'options': options,
                })
                continue
        i += 1

    return prose_context, questions


def ask_gemini_for_answers(prose_context, questions):
    """Send questions to Gemini in batches and get answers + explanations."""
    results = {}

    # Build question text for the prompt
    q_text_block = ""
    for q in questions:
        q_text_block += f"\n{q['num']}. {q['text']}\n"
        for opt in q['options']:
            q_text_block += f"   {opt['letter']}) {opt['text']}\n"

    prompt = f"""You are an anatomy and physiology professor. Below is textbook content from OpenStax Anatomy & Physiology 2e, followed by review questions from that chapter.

For each question, provide:
1. The correct answer letter (a, b, c, or d)
2. A brief explanation (1-2 sentences) of why that answer is correct and why the other key options are wrong.

IMPORTANT: Base your answers strictly on the OpenStax A&P 2e textbook content. These are the official review questions from the textbook.

Respond in this EXACT JSON format (no markdown, no code fences, just raw JSON):
{{
  "answers": [
    {{
      "num": 1,
      "answer": "d",
      "explanation": "The endocardium lines the chambers but does not prevent backflow. Chordae tendineae, papillary muscles, and AV valves all work together to prevent backflow."
    }},
    ...
  ]
}}

=== TEXTBOOK CONTENT (excerpts) ===
{prose_context[:8000]}

=== REVIEW QUESTIONS ===
{q_text_block}
"""

    print(f"  Sending {len(questions)} questions to Gemini...")

    try:
        response = MODEL.generate_content(prompt)
        response_text = response.text.strip()

        # Clean up response — remove markdown code fences if present
        response_text = re.sub(r'^```json\s*', '', response_text)
        response_text = re.sub(r'^```\s*', '', response_text)
        response_text = re.sub(r'\s*```$', '', response_text)

        data = json.loads(response_text)

        for item in data.get('answers', []):
            q_num = item['num']
            results[str(q_num)] = {
                'answer': item['answer'].lower().strip(),
                'explanation': item['explanation'].strip(),
            }

        print(f"  Got {len(results)} answers from Gemini")
        return results

    except json.JSONDecodeError as e:
        print(f"  ERROR: Failed to parse Gemini response as JSON: {e}")
        print(f"  Raw response (first 500 chars): {response_text[:500]}")
        return {}
    except Exception as e:
        print(f"  ERROR: Gemini API call failed: {e}")
        return {}


def main():
    if len(sys.argv) < 2:
        print("Usage: python generate_answers.py <extracted-text-file>")
        print("Example: python generate_answers.py ap-ch19-extracted.txt")
        sys.exit(1)

    extracted_path = sys.argv[1]
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    if not os.path.isabs(extracted_path):
        extracted_path = project_root / extracted_path

    # Determine chapter number from filename
    ch_match = re.search(r'ch(\d+)', str(extracted_path))
    if not ch_match:
        print("ERROR: Could not determine chapter number from filename")
        sys.exit(1)
    ch_num = ch_match.group(1)

    output_path = project_root / 'tools' / 'configs' / f'ch{ch_num}-answers.json'
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"\n{'='*60}")
    print(f"  GENERATING ANSWER KEY — Chapter {ch_num}")
    print(f"  Input:  {extracted_path}")
    print(f"  Output: {output_path}")
    print(f"  Model:  gemini-3-flash-preview")
    print(f"{'='*60}\n")

    # Parse extracted text
    prose_context, questions = parse_extracted_for_answers(str(extracted_path))
    print(f"  Found {len(questions)} review questions")
    print(f"  Context: {len(prose_context)} chars of prose")
    print()

    if not questions:
        print("  ERROR: No review questions found in extracted text")
        sys.exit(1)

    # Get answers from Gemini
    results = ask_gemini_for_answers(prose_context, questions)

    if not results:
        print("  ERROR: No answers generated")
        sys.exit(1)

    # Build output
    output = {
        'chapter': int(ch_num),
        'question_count': len(questions),
        'review_answers': {k: v['answer'] for k, v in results.items()},
        'explanations': {k: v['explanation'] for k, v in results.items()},
    }

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Print results
    print(f"\n{'='*60}")
    print(f"  ANSWER KEY — Chapter {ch_num}")
    print(f"{'='*60}")
    for q in questions:
        q_num = str(q['num'])
        if q_num in results:
            ans = results[q_num]['answer']
            expl = results[q_num]['explanation'][:80]
            print(f"  Q{q_num}: {ans.upper()}  — {expl}...")
        else:
            print(f"  Q{q_num}: ??? (no answer generated)")

    print(f"\n  Saved to: {output_path}")
    print(f"{'='*60}\n")

    # Print the review_answers block ready to paste into config
    print("  Copy this into your config JSON:")
    print('  "review_answers": {')
    for q_num, data in sorted(results.items(), key=lambda x: int(x[0])):
        print(f'    "{q_num}": "{data["answer"]}",')
    print('  }')
    print()


if __name__ == '__main__':
    main()
