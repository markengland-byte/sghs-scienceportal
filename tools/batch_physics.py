"""
Physics Batch Builder — Runs the full pipeline for a range of physics chapters.

Usage:
    python tools/batch_physics.py 2 10       # Chapters 2-10
    python tools/batch_physics.py 2 34       # All remaining chapters
    python tools/batch_physics.py 5          # Just chapter 5
    python tools/batch_physics.py --build-only 2 34  # Skip extraction, just build

Stages per chapter:
    1. Extract content + images from LibreTexts
    2. Extract glossary key terms
    3. Generate MC quiz questions via Gemini
    4. Generate checkpoints if needed
    5. Auto-generate config if missing
    6. Build HTML module

Run update_hub_stats.py and update_portal_stats.py separately after batch completes.
"""

import sys
import os
import re
import subprocess
import io
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

PROJECT_ROOT = Path(__file__).parent.parent
TOOLS_DIR = Path(__file__).parent
PYTHON = sys.executable


def run_tool(script, args, label=""):
    """Run a Python tool script and return success/failure."""
    cmd = [PYTHON, str(TOOLS_DIR / script)] + args
    print(f"\n  >>> {label or script} {' '.join(args)}")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600,
                                encoding='utf-8', errors='replace', cwd=str(PROJECT_ROOT))
        # Print key output lines
        for line in result.stdout.split('\n'):
            line = line.strip()
            if any(kw in line for kw in ['REPORT', 'Generated', 'Extracted', 'Built', 'Loaded',
                                          'QUALITY', 'LOW', 'PASS', 'ERROR', 'WARNING',
                                          'Total unique', 'Added', 'Saved', 'Created',
                                          'File size', 'Prose', 'Images', 'Vocab', 'Quiz']):
                print(f"      {line}")
        if result.returncode != 0:
            print(f"      ERROR (exit code {result.returncode})")
            if result.stderr:
                for line in result.stderr.strip().split('\n')[-5:]:
                    print(f"      STDERR: {line}")
            return False
        return True
    except subprocess.TimeoutExpired:
        print(f"      TIMEOUT after 600s")
        return False
    except Exception as e:
        print(f"      EXCEPTION: {e}")
        return False


def chapter_needs_extraction(ch_num):
    extracted = PROJECT_ROOT / 'physics' / 'extracted' / f'physics-ch{ch_num}-extracted.txt'
    return not extracted.exists()


def chapter_has_quiz(ch_num):
    extracted = PROJECT_ROOT / 'physics' / 'extracted' / f'physics-ch{ch_num}-extracted.txt'
    if not extracted.exists():
        return False
    with open(extracted, 'r', encoding='utf-8') as f:
        text = f.read()
    # Check for MC questions with a/b/c/d options
    return bool(re.search(r'=== REVIEW QUESTIONS ===.*?[a-d]\)', text, re.DOTALL))


def chapter_has_terms(ch_num):
    extracted = PROJECT_ROOT / 'physics' / 'extracted' / f'physics-ch{ch_num}-extracted.txt'
    if not extracted.exists():
        return False
    with open(extracted, 'r', encoding='utf-8') as f:
        return '=== KEY TERMS ===' in f.read()


def chapter_needs_checkpoints(ch_num):
    extracted = PROJECT_ROOT / 'physics' / 'extracted' / f'physics-ch{ch_num}-extracted.txt'
    if not extracted.exists():
        return False
    with open(extracted, 'r', encoding='utf-8') as f:
        text = f.read()
    sections = re.findall(r'^=== SECTION', text, re.MULTILINE)
    ct_match = re.search(r'=== CRITICAL THINKING ===\n(.*?)(?:=== |\Z)', text, re.DOTALL)
    ct_count = 0
    if ct_match:
        ct_count = len(re.findall(r'^\d+\.', ct_match.group(1), re.MULTILINE))
    return ct_count < len(sections)


def chapter_has_config(ch_num):
    return (PROJECT_ROOT / 'tools' / 'configs' / f'physics-ch{ch_num}.json').exists()


def chapter_has_module(ch_num):
    import json
    config_path = PROJECT_ROOT / 'tools' / 'configs' / f'physics-ch{ch_num}.json'
    if not config_path.exists():
        return False
    with open(config_path, 'r') as f:
        config = json.load(f)
    return (PROJECT_ROOT / 'physics' / config['filename']).exists()


def main():
    args = sys.argv[1:]
    build_only = False

    if '--build-only' in args:
        build_only = True
        args.remove('--build-only')

    if len(args) == 1:
        start = end = int(args[0])
    elif len(args) == 2:
        start, end = int(args[0]), int(args[1])
    else:
        print("Usage: python batch_physics.py [--build-only] <start> [end]")
        print("  python batch_physics.py 2 10       # Chapters 2-10")
        print("  python batch_physics.py 2 34       # All remaining")
        print("  python batch_physics.py --build-only 2 34  # Build only")
        sys.exit(1)

    chapters = list(range(start, end + 1))
    total = len(chapters)

    print(f"\n{'='*60}")
    print(f"  PHYSICS BATCH BUILDER")
    print(f"  Chapters: {start}-{end} ({total} chapters)")
    print(f"  Mode: {'BUILD ONLY' if build_only else 'FULL PIPELINE'}")
    print(f"{'='*60}")

    results = {'extracted': 0, 'terms': 0, 'quiz': 0, 'checkpoints': 0,
               'configs': 0, 'built': 0, 'failed': [], 'skipped': []}

    for i, ch in enumerate(chapters):
        print(f"\n{'─'*60}")
        print(f"  CHAPTER {ch} ({i+1}/{total})")
        print(f"{'─'*60}")

        extracted_path = f'physics/extracted/physics-ch{ch}-extracted.txt'
        config_path = f'tools/configs/physics-ch{ch}.json'

        if not build_only:
            # Stage 1: Extract
            if chapter_needs_extraction(ch):
                ok = run_tool('extract_chapter.py', ['--physics', str(ch)], 'EXTRACT')
                if not ok:
                    results['failed'].append((ch, 'extraction'))
                    print(f"  *** SKIPPING Ch. {ch} — extraction failed")
                    continue
                results['extracted'] += 1
                # Brief pause between extractions
                time.sleep(2)
            else:
                print(f"  [EXTRACT] Already done")

            # Stage 2: Key terms
            if not chapter_has_terms(ch):
                ok = run_tool('extract_physics_terms.py', [extracted_path], 'TERMS')
                if ok:
                    results['terms'] += 1
                # Non-fatal if terms fail
            else:
                print(f"  [TERMS] Already done")

            # Stage 3: MC Quiz
            if not chapter_has_quiz(ch):
                ok = run_tool('generate_physics_quiz.py', [extracted_path], 'QUIZ')
                if ok:
                    results['quiz'] += 1
                else:
                    results['failed'].append((ch, 'quiz generation'))
                # Pause for Gemini rate limits
                time.sleep(3)
            else:
                print(f"  [QUIZ] Already done")

            # Stage 4: Checkpoints
            if chapter_needs_checkpoints(ch):
                ok = run_tool('generate_checkpoints.py', [extracted_path], 'CHECKPOINTS')
                if ok:
                    results['checkpoints'] += 1
                time.sleep(2)
            else:
                print(f"  [CHECKPOINTS] Sufficient")

        # Stage 5: Config
        if not chapter_has_config(ch):
            run_tool('generate_physics_configs.py', [], 'CONFIGS')
            results['configs'] += 1

        # Stage 6: Build
        if not chapter_has_config(ch):
            print(f"  *** SKIPPING build — no config for Ch. {ch}")
            results['skipped'].append(ch)
            continue

        ok = run_tool('build_module.py', [extracted_path, '--config', config_path], 'BUILD')
        if ok:
            results['built'] += 1
        else:
            results['failed'].append((ch, 'build'))

    # Summary
    print(f"\n{'='*60}")
    print(f"  BATCH COMPLETE — Chapters {start}-{end}")
    print(f"{'='*60}")
    print(f"  Extracted:    {results['extracted']}")
    print(f"  Terms:        {results['terms']}")
    print(f"  Quizzes:      {results['quiz']}")
    print(f"  Checkpoints:  {results['checkpoints']}")
    print(f"  Configs:      {results['configs']}")
    print(f"  Built:        {results['built']}")
    if results['failed']:
        print(f"\n  FAILURES ({len(results['failed'])}):")
        for ch, stage in results['failed']:
            print(f"    Ch. {ch}: {stage}")
    if results['skipped']:
        print(f"\n  SKIPPED: {results['skipped']}")
    print(f"\n  Next: python tools/update_hub_stats.py && python tools/update_portal_stats.py")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
