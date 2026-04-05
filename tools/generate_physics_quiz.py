"""
Physics MC Quiz Generator — Uses Gemini to generate multiple-choice review questions
from physics chapter content. Physics doesn't have MC questions on LibreTexts
(only open-ended conceptual questions + numerical problems), so we generate them.

Usage:
    python tools/generate_physics_quiz.py physics/extracted/physics-ch1-extracted.txt

Reads the extracted text, generates MC questions via Gemini, and appends them to
the extracted text file as === REVIEW QUESTIONS === section.
Also generates the answers JSON file for the build pipeline.
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
        print("Usage: python generate_physics_quiz.py <extracted-text-file>")
        print("Example: python generate_physics_quiz.py physics/extracted/physics-ch1-extracted.txt")
        sys.exit(1)

    extracted_path = sys.argv[1]
    project_root = Path(__file__).parent.parent
    if not os.path.isabs(extracted_path):
        extracted_path = project_root / extracted_path

    with open(extracted_path, 'r', encoding='utf-8') as f:
        text = f.read()

    # Get chapter number
    ch_match = re.search(r'ch(\d+)', str(extracted_path))
    ch_num = ch_match.group(1) if ch_match else '?'

    # Count content sections
    sections = re.findall(r'^=== SECTION ([\d.]+) ===', text, re.MULTILINE)
    num_sections = len(sections)

    # Target: ~4 questions per content section (similar to A&P density)
    num_questions = max(15, num_sections * 4)
    num_questions = min(num_questions, 30)  # Cap at 30

    # Get section titles for context
    section_info = []
    for sec_num in sections:
        title_match = re.search(rf'=== SECTION {re.escape(sec_num)} ===.*?TITLE:\s*(.+)', text, re.DOTALL)
        if title_match:
            section_info.append(f"{sec_num}: {title_match.group(1).strip()}")

    # Get prose context (first ~8000 chars)
    prose_lines = []
    for line in text.split('\n'):
        stripped = line.strip()
        if not stripped or len(stripped) < 20:
            continue
        if stripped.startswith(('===', 'SOURCE:', 'TITLE:', 'FIGURE:', 'ORIGINAL:', 'CAPTION:',
                               'LEARNING OBJECTIVES', 'TABLE:', 'CALLOUT:', 'ANSWER:', '---', '| ')):
            continue
        if 'is shared under' in stripped:
            continue
        prose_lines.append(stripped)

    context = '\n'.join(prose_lines[:300])

    print(f"\n{'='*60}")
    print(f"  GENERATING PHYSICS MC QUIZ — Chapter {ch_num}")
    print(f"  Sections: {num_sections}")
    print(f"  Target questions: {num_questions}")
    print(f"{'='*60}\n")

    prompt = f"""You are a college physics professor creating a multiple-choice quiz for OpenStax College Physics Chapter {ch_num}.

Sections in this chapter:
{chr(10).join(f'- {s}' for s in section_info)}

Generate exactly {num_questions} multiple-choice questions based on this chapter content.

Requirements:
- Each question must have exactly 4 answer options (a, b, c, d)
- Include a mix of conceptual understanding and simple calculations
- Distribute questions across all sections (roughly equal)
- Questions should test comprehension, not just memorization
- For calculation questions, include reasonable numerical distractors
- Make wrong answers plausible but clearly wrong to someone who understands the material
- IMPORTANT: Distribute correct answers roughly equally across a, b, c, and d (about 5 each for 20 questions). Do NOT cluster answers on one letter.
- Include a 1-sentence explanation for why each answer is correct

Chapter content:
{context[:8000]}

Respond in EXACTLY this format, with no other text:

1. Question text here?
   a) First option
   b) Second option
   c) Third option
   d) Fourth option
   ANSWER: b
   EXPLANATION: Brief explanation of why b is correct.

2. Next question?
   a) Option A
   b) Option B
   c) Option C
   d) Option D
   ANSWER: c
   EXPLANATION: Brief explanation.
"""

    print(f"  Sending to Gemini...")
    try:
        response = MODEL.generate_content(prompt)
        response_text = response.text.strip()

        # Parse MC questions
        questions = []
        answers = {}
        explanations = {}

        lines = response_text.split('\n')
        i = 0
        q_num = 0
        while i < len(lines):
            line = lines[i].strip()
            q_match = re.match(r'^(\d+)\.\s+(.+)$', line)
            if q_match:
                q_num = int(q_match.group(1))
                q_text = q_match.group(2)
                options = []
                answer = None
                explanation = ''
                i += 1
                while i < len(lines):
                    opt_line = lines[i].strip()
                    opt_match = re.match(r'^([a-d])\)\s+(.+)$', opt_line)
                    if opt_match:
                        options.append(f"   {opt_match.group(1)}) {opt_match.group(2)}")
                    elif opt_line.upper().startswith('ANSWER:'):
                        ans = opt_line.split(':', 1)[1].strip().lower()
                        if ans and ans[0] in 'abcd':
                            answer = ans[0]
                    elif opt_line.upper().startswith('EXPLANATION:'):
                        explanation = opt_line.split(':', 1)[1].strip()
                    else:
                        break
                    i += 1
                if options and answer:
                    questions.append({'num': q_num, 'text': q_text, 'options': options, 'answer': answer})
                    answers[str(q_num)] = answer
                    if explanation:
                        explanations[str(q_num)] = explanation
            else:
                i += 1

        print(f"  Generated {len(questions)} valid MC questions\n")

        if not questions:
            print("  ERROR: No valid questions parsed from Gemini response.")
            print(f"  Raw response (first 500 chars): {response_text[:500]}")
            return

        # Build REVIEW QUESTIONS block
        rq_lines = ["=== REVIEW QUESTIONS ===", ""]
        for q in questions:
            rq_lines.append(f"{q['num']}. {q['text']}")
            rq_lines.extend(q['options'])
            rq_lines.append(f"   ANSWER: {q['answer']}")
            rq_lines.append("")

        # Insert REVIEW QUESTIONS before CRITICAL THINKING (or at end)
        if '=== CRITICAL THINKING ===' in text:
            ct_pos = text.index('=== CRITICAL THINKING ===')
            text = text[:ct_pos] + '\n'.join(rq_lines) + '\n\n' + text[ct_pos:]
        elif '=== PROBLEMS AND EXERCISES ===' in text:
            p_pos = text.index('=== PROBLEMS AND EXERCISES ===')
            text = text[:p_pos] + '\n'.join(rq_lines) + '\n\n' + text[p_pos:]
        else:
            text += '\n' + '\n'.join(rq_lines)

        # Write updated extracted text
        with open(extracted_path, 'w', encoding='utf-8') as f:
            f.write(text)
        print(f"  Added {len(questions)} MC questions to {Path(extracted_path).name}")

        # Write answers JSON (compatible with generate_answers.py output)
        answers_path = project_root / 'tools' / 'configs' / f'physics-ch{ch_num}-answers.json'
        answers_json = {
            'chapter': int(ch_num),
            'review_answers': answers,
            'explanations': explanations,
        }
        with open(answers_path, 'w', encoding='utf-8') as f:
            json.dump(answers_json, f, indent=2)
        print(f"  Saved answers to {answers_path.name}")

        # Print summary
        print(f"\n  Questions by answer distribution:")
        for letter in 'abcd':
            count = sum(1 for a in answers.values() if a == letter)
            print(f"    {letter}) {count}")

    except Exception as e:
        print(f"  ERROR: {e}")
        import traceback
        traceback.print_exc()

    print(f"\n{'='*60}\n")


if __name__ == '__main__':
    main()
