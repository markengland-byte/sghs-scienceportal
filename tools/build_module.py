"""
A&P Module Generator — Builds a complete interactive HTML module from extracted text.

Usage:
    python tools/build_module.py ap-ch19-extracted.txt --config tools/configs/ch19.json

The config JSON provides:
    - Chapter metadata (title, filename, emoji, accent colors)
    - Section groupings for sidebar
    - Review question correct answers
    - Term-to-section assignments (which vocab cards go in which panel)
    - Critical thinking question assignments (which becomes which checkpoint)

The extracted text provides ALL the verbatim content.

Requirements:
    pip install requests beautifulsoup4  (for extraction step only; this script needs nothing extra)
"""

import sys
import os
import re
import json
import html
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzSUJK9p5MjE5LOfQIqyRn3lQlBpALpBiQQ4OIijeAXUP5Vjy9Cj8Bz6MyIBDayqxcM8A/exec'

# ─── PARSE EXTRACTED TEXT ─────────────────────────────────────────────

def parse_extracted(filepath):
    """Parse an ap-chNN-extracted.txt file into structured data."""
    with open(filepath, 'r', encoding='utf-8') as f:
        text = f.read()

    result = {
        'sections': [],
        'key_terms': [],
        'review_questions': [],
        'critical_thinking': [],
    }

    # Split into major blocks
    parts = re.split(r'^(=== (?:SECTION|KEY TERMS|REVIEW QUESTIONS|CRITICAL THINKING) .*)$', text, flags=re.MULTILINE)

    current_block = None
    for part in parts:
        part = part.strip()
        if not part:
            continue
        if part.startswith('=== SECTION'):
            current_block = 'section'
            sec_match = re.search(r'SECTION ([\d.]+)', part)
            sec_num = sec_match.group(1) if sec_match else ''
            result['sections'].append({'num': sec_num, 'raw': ''})
        elif part.startswith('=== KEY TERMS'):
            current_block = 'key_terms'
        elif part.startswith('=== REVIEW QUESTIONS'):
            current_block = 'review_questions'
        elif part.startswith('=== CRITICAL THINKING'):
            current_block = 'critical_thinking'
        else:
            if current_block == 'section' and result['sections']:
                result['sections'][-1]['raw'] = part
            elif current_block == 'key_terms':
                result['key_terms'] = parse_key_terms(part)
            elif current_block == 'review_questions':
                result['review_questions'] = parse_review_questions(part)
            elif current_block == 'critical_thinking':
                result['critical_thinking'] = parse_critical_thinking(part)

    # Parse each section's raw text into structured elements
    for sec in result['sections']:
        sec.update(parse_section_raw(sec['raw']))

    return result


def parse_section_raw(raw):
    """Parse a section's raw text into title, objectives, paragraphs, figures, tables, callouts."""
    data = {
        'title': '',
        'source_url': '',
        'objectives': [],
        'elements': [],  # ordered list of {type: 'paragraph'|'heading'|'figure'|'table'|'callout', ...}
    }

    lines = raw.split('\n')
    i = 0
    in_table = False
    table_rows = []
    in_callout = False
    callout_title = ''
    callout_lines = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Source URL
        if stripped.startswith('SOURCE:'):
            data['source_url'] = stripped[7:].strip()
            i += 1
            continue

        # Title
        if stripped.startswith('TITLE:'):
            data['title'] = stripped[6:].strip()
            i += 1
            continue

        # Learning objectives
        if stripped == 'LEARNING OBJECTIVES':
            i += 1
            while i < len(lines) and lines[i].strip().startswith('- '):
                data['objectives'].append(lines[i].strip()[2:])
                i += 1
            continue

        # Skip "By the end of this section..." line
        if stripped.startswith('By the end of this section'):
            i += 1
            continue

        # Figure
        if stripped.startswith('FIGURE:'):
            fig_path = stripped[7:].strip()
            orig_url = ''
            caption = ''
            i += 1
            while i < len(lines):
                next_line = lines[i].strip()
                if next_line.startswith('ORIGINAL:'):
                    orig_url = next_line[9:].strip()
                elif next_line.startswith('CAPTION:'):
                    caption = next_line[8:].strip()
                elif next_line == '':
                    break
                else:
                    break
                i += 1
            data['elements'].append({
                'type': 'figure',
                'path': fig_path,
                'original': orig_url,
                'caption': caption,
            })
            continue

        # Table
        if stripped.startswith('TABLE:'):
            in_table = True
            table_rows = []
            i += 1
            continue

        if in_table:
            if stripped.startswith('|'):
                # Skip separator rows
                if re.match(r'^\|[\s\-|]+\|$', stripped):
                    i += 1
                    continue
                cells = [c.strip() for c in stripped.split('|')[1:-1]]
                table_rows.append(cells)
                i += 1
                continue
            else:
                in_table = False
                if table_rows:
                    data['elements'].append({'type': 'table', 'rows': table_rows})
                continue

        # Callout
        if stripped.startswith('CALLOUT:'):
            callout_title = stripped[8:].strip()
            callout_lines = []
            i += 1
            while i < len(lines) and lines[i].strip():
                callout_lines.append(lines[i].strip())
                i += 1
            data['elements'].append({
                'type': 'callout',
                'title': callout_title,
                'text': ' '.join(callout_lines),
            })
            continue

        # Headings
        if stripped.startswith('### '):
            data['elements'].append({'type': 'heading', 'level': 3, 'text': stripped[4:]})
            i += 1
            continue
        if stripped.startswith('## '):
            data['elements'].append({'type': 'heading', 'level': 2, 'text': stripped[3:]})
            i += 1
            continue

        # Prose paragraphs (non-empty lines that aren't metadata)
        if stripped and len(stripped) > 20:
            # Filter out junk
            if not stripped.startswith('ANSWER:') and not stripped.startswith('SOURCE:') and \
               'is shared under a' not in stripped and 'CC BY' not in stripped[:10]:
                data['elements'].append({'type': 'paragraph', 'text': stripped})

        i += 1

    # Flush any pending table
    if in_table and table_rows:
        data['elements'].append({'type': 'table', 'rows': table_rows})

    return data


def parse_key_terms(raw):
    """Parse key terms block into list of {term, definition}."""
    terms = []
    for line in raw.split('\n'):
        line = line.strip()
        if not line or 'is shared under' in line:
            continue
        # Format: "Term: definition" or "Term : definition"
        match = re.match(r'^(.+?):\s+(.+)$', line)
        if match:
            terms.append({'term': match.group(1).strip(), 'definition': match.group(2).strip()})
    return terms


def parse_review_questions(raw):
    """Parse review questions into structured list."""
    questions = []
    lines = raw.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        # Look for question number
        q_match = re.match(r'^(\d+)\.\s+(.+)$', line)
        if q_match:
            q_num = int(q_match.group(1))
            q_text = q_match.group(2)
            options = []
            answer = None
            i += 1
            while i < len(lines):
                opt_line = lines[i].strip()
                opt_match = re.match(r'^([a-d])\)\s+(.+)$', opt_line)
                if opt_match:
                    options.append({'letter': opt_match.group(1), 'text': opt_match.group(2)})
                elif opt_line.startswith('ANSWER:'):
                    ans_text = opt_line[7:].strip()
                    if ans_text and ans_text != '[determine from content]':
                        answer = ans_text.lower()[0]
                else:
                    break
                i += 1
            questions.append({
                'num': q_num,
                'text': q_text,
                'options': options,
                'answer': answer,
            })
        else:
            i += 1
    return questions


def parse_critical_thinking(raw):
    """Parse critical thinking questions."""
    questions = []
    for line in raw.split('\n'):
        line = line.strip()
        if not line or 'is shared under' in line:
            continue
        match = re.match(r'^(\d+)\.\s+(.+)$', line)
        if match:
            questions.append(match.group(2))
    return questions


# ─── HTML GENERATION ──────────────────────────────────────────────────

def esc(text):
    """HTML-escape text."""
    return html.escape(text, quote=True)


def generate_css(config):
    """Generate the full inline CSS block."""
    accent = config.get('accent', '#c0392b')
    accent_light = config.get('accent_light', '#e74c3c')
    accent_pale = config.get('accent_pale', '#fdecea')

    return f""":root{{--navy:#0f2240;--navy-mid:#1a3560;--teal:#0b8f8c;--teal-light:#12c4c0;--teal-pale:#e0f6f6;--amber:#e8920e;--amber-pale:#fff7ea;--green:#1a7a4a;--green-pale:#eaf7f0;--red:#c0392b;--red-pale:#fdecea;--purple:#6c3fa0;--purple-pale:#f3eeff;--cream:#f8f6f1;--text:#1c2333;--muted:#5e6e8a;--border:#dde3ef;--sidebar-w:272px;--header-h:62px;--accent:{accent};--accent-light:{accent_light};--accent-pale:{accent_pale};}}
*,*::before,*::after{{box-sizing:border-box;margin:0;padding:0;}}
html{{scroll-behavior:smooth;}}
body{{font-family:"Source Sans 3",sans-serif;background:var(--cream);color:var(--text);line-height:1.75;font-size:16px;}}
.top-bar{{position:fixed;top:0;left:0;right:0;z-index:200;height:var(--header-h);background:var(--navy);display:flex;align-items:center;padding:0 24px;box-shadow:0 2px 16px rgba(0,0,0,.35);}}
.tb-back{{color:rgba(255,255,255,.5);text-decoration:none;font-size:.8rem;display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.1);margin-right:8px;transition:all .2s;}}
.tb-back:hover{{color:#fff;border-color:rgba(255,255,255,.3);}}
.tb-logo{{width:36px;height:36px;background:var(--accent);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:18px;margin-right:12px;flex-shrink:0;}}
.tb-name{{font-size:.85rem;font-weight:700;color:#fff;}}
.tb-sub{{font-size:.7rem;color:rgba(255,255,255,.5);}}
.tb-badge{{margin-left:auto;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:5px 16px;font-size:.77rem;color:rgba(255,255,255,.75);font-weight:500;}}
.prog-wrap{{position:fixed;top:var(--header-h);left:0;right:0;z-index:199;height:4px;background:rgba(255,255,255,.08);}}
#prog-bar{{height:100%;background:var(--accent);width:0%;transition:width .4s;}}
.sidebar{{position:fixed;top:calc(var(--header-h)+4px);left:0;bottom:0;width:var(--sidebar-w);background:var(--navy-mid);overflow-y:auto;z-index:100;}}
.sb-label{{font-size:.62rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,.3);padding:18px 18px 6px;}}
.sb-link{{display:flex;align-items:flex-start;gap:10px;padding:9px 18px;text-decoration:none;cursor:pointer;transition:background .2s;border-right:3px solid transparent;}}
.sb-link:hover{{background:rgba(255,255,255,.06);}}
.sb-link.active{{background:rgba(192,57,43,.2);border-right-color:var(--accent);}}
.sb-link.done .sb-num{{background:var(--green)!important;color:#fff!important;}}
.sb-num{{width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.1);font-size:.68rem;font-weight:700;color:rgba(255,255,255,.45);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px;}}
.sb-link.active .sb-num{{background:var(--accent);color:#fff;}}
.sb-txt{{font-size:.8rem;color:rgba(255,255,255,.6);font-weight:500;line-height:1.4;}}
.sb-link.active .sb-txt{{color:#fff;}}
.sb-div{{height:1px;background:rgba(255,255,255,.07);margin:6px 18px;}}
.main{{margin-left:var(--sidebar-w);padding-top:calc(var(--header-h)+4px);min-height:100vh;}}
.panel{{display:none;animation:fadeIn .3s ease;}}
.panel.active{{display:block;}}
@keyframes fadeIn{{from{{opacity:0;transform:translateY(10px);}}to{{opacity:1;transform:translateY(0);}}}}
.hero{{padding:48px 56px 40px;position:relative;overflow:hidden;}}
.hero::before{{content:"";position:absolute;top:-80px;right:-80px;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.06),transparent 70%);}}
.h-crumb{{font-size:.72rem;font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:rgba(255,255,255,.5);margin-bottom:10px;}}
.h-crumb span{{color:rgba(255,255,255,.85);}}
.h-title{{font-family:"Playfair Display",serif;font-size:clamp(1.8rem,3vw,2.6rem);font-weight:900;color:#fff;line-height:1.15;margin-bottom:10px;}}
.h-desc{{font-size:1rem;color:rgba(255,255,255,.7);max-width:600px;line-height:1.65;}}
.h-meta{{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px;}}
.h-chip{{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.15);border-radius:20px;padding:4px 14px;font-size:.76rem;color:rgba(255,255,255,.82);}}
.hero-ov{{background:linear-gradient(135deg,#2a0a0a,#8b1a1a);}}
.hero-sec{{background:linear-gradient(135deg,#1a0a2a,#6a1a2a);}}
.hero-rev{{background:linear-gradient(135deg,#1a1a2a,#3a3a6a);}}
.lc{{padding:40px 56px 64px;max-width:900px;}}
.cs{{margin-bottom:44px;}}
.eyebrow{{font-size:.67rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--accent);margin-bottom:8px;display:flex;align-items:center;gap:8px;}}
.eyebrow::after{{content:"";flex:1;height:1px;background:var(--border);}}
.sh2{{font-family:"Playfair Display",serif;font-size:1.5rem;font-weight:700;color:var(--navy);margin-bottom:14px;}}
.sh3{{font-size:1.05rem;font-weight:700;color:var(--navy);margin:22px 0 10px;padding-left:12px;border-left:3px solid var(--accent);}}
.prose{{font-size:.96rem;line-height:1.85;color:#2a3245;margin-bottom:14px;}}
.prose strong{{color:var(--navy);}}
.obj-box{{background:var(--navy);color:#fff;border-radius:14px;padding:26px 32px;margin-bottom:30px;}}
.obj-label{{font-size:.68rem;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--accent-light);margin-bottom:14px;}}
.obj-list{{list-style:none;}}
.obj-list li{{padding:6px 0 6px 28px;position:relative;font-size:.9rem;color:rgba(255,255,255,.87);border-bottom:1px solid rgba(255,255,255,.06);line-height:1.55;}}
.obj-list li:last-child{{border-bottom:none;}}
.obj-list li::before{{content:"\\2713";position:absolute;left:0;color:var(--accent-light);font-weight:700;}}
.vocab-grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(215px,1fr));gap:11px;margin-bottom:4px;}}
.vocab-hint{{font-size:.76rem;color:var(--muted);margin-bottom:10px;font-style:italic;}}
.vcard{{height:140px;cursor:pointer;perspective:1000px;}}
.vcard-inner{{position:relative;width:100%;height:100%;transition:transform .5s;transform-style:preserve-3d;}}
.vcard.flipped .vcard-inner{{transform:rotateY(180deg);}}
.vfront,.vback{{position:absolute;width:100%;height:100%;backface-visibility:hidden;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:14px;text-align:center;}}
.vfront{{background:var(--navy);border:1px solid rgba(255,255,255,.1);}}
.vterm{{font-family:"JetBrains Mono",monospace;font-size:.84rem;font-weight:600;color:var(--accent-light);line-height:1.3;}}
.vhint{{font-size:.64rem;color:rgba(255,255,255,.26);margin-top:8px;}}
.vback{{background:var(--accent-pale);border:1px solid var(--accent);transform:rotateY(180deg);}}
.vdef{{font-size:.79rem;color:var(--navy);line-height:1.55;}}
.callout{{border-radius:10px;padding:18px 22px;margin:18px 0;display:flex;gap:14px;}}
.ci{{font-size:1.25rem;flex-shrink:0;margin-top:1px;}}
.cb{{flex:1;}}
.ct{{font-weight:700;font-size:.9rem;margin-bottom:4px;}}
.cx{{font-size:.89rem;line-height:1.7;}}
.callout.info{{background:#eaf4ff;border-left:4px solid #3a86e0;}}
.callout.info .ct{{color:#1a4a9a;}}
.callout.key{{background:var(--teal-pale);border-left:4px solid var(--teal);}}
.callout.key .ct{{color:var(--navy);}}
.callout.openstax{{background:#f0f4ff;border-left:4px solid #2563eb;}}
.callout.openstax .ct{{color:#1e3a8a;}}
.dt{{width:100%;border-collapse:collapse;font-size:.87rem;margin:16px 0;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.07);}}
.dt th{{background:var(--navy);color:#fff;padding:12px 16px;text-align:left;font-size:.76rem;font-weight:600;letter-spacing:.5px;}}
.dt td{{padding:10px 16px;border-bottom:1px solid var(--border);vertical-align:top;line-height:1.55;}}
.dt tr:nth-child(even) td{{background:#f3f6fc;}}
.dt tr:last-child td{{border-bottom:none;}}
.diagram{{margin:20px 0;text-align:center;}}
.diagram img{{max-width:100%;border-radius:10px;border:1px solid var(--border);box-shadow:0 2px 10px rgba(0,0,0,.08);}}
.d-cap{{font-size:.8rem;color:var(--muted);margin-top:8px;font-style:italic;line-height:1.5;}}
.checkpoint-box{{background:#fff;border:2px solid var(--accent);border-radius:14px;padding:28px 32px;margin:28px 0;}}
.cp-header{{display:flex;align-items:center;gap:12px;margin-bottom:16px;}}
.cp-icon{{width:40px;height:40px;background:var(--accent-pale);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;}}
.cp-title{{font-family:"Playfair Display",serif;font-size:1.1rem;color:var(--navy);}}
.cp-sub{{font-size:.8rem;color:var(--muted);margin-top:2px;}}
.cp-question{{font-size:.95rem;font-weight:600;color:var(--navy);margin-bottom:12px;line-height:1.6;}}
.cp-textarea{{width:100%;min-height:110px;padding:14px;border:2px solid var(--border);border-radius:10px;font-size:.9rem;font-family:"Source Sans 3",sans-serif;resize:vertical;line-height:1.65;transition:border .2s;outline:none;}}
.cp-textarea:focus{{border-color:var(--accent);}}
.cp-footer{{display:flex;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap;gap:10px;}}
.cp-counter{{font-size:.8rem;color:var(--muted);}}
.cp-counter span{{font-weight:700;color:var(--amber);}}
.cp-btn{{padding:10px 26px;border-radius:8px;border:none;font-size:.88rem;font-weight:700;font-family:"Source Sans 3",sans-serif;cursor:pointer;transition:all .2s;background:#ccc;color:#fff;pointer-events:none;}}
.cp-btn.ready{{background:var(--accent);color:#fff;pointer-events:all;}}
.cp-btn.ready:hover{{opacity:.9;}}
.cp-done{{display:none;padding:10px 18px;background:var(--accent-pale);border:1px solid var(--accent);border-radius:8px;font-size:.85rem;color:var(--accent);font-weight:600;}}
.quiz-box{{background:#fff;border:1px solid var(--border);border-radius:14px;padding:30px;margin:24px 0;box-shadow:0 2px 10px rgba(0,0,0,.05);}}
.qh{{display:flex;align-items:center;gap:12px;margin-bottom:24px;}}
.q-icon{{width:42px;height:42px;background:var(--accent-pale);border:2px solid var(--accent);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;}}
.qh h3{{font-family:"Playfair Display",serif;font-size:1.15rem;color:var(--navy);}}
.qh p{{font-size:.8rem;color:var(--muted);margin-top:2px;}}
.qq{{margin-bottom:24px;}}
.qt{{font-size:.94rem;font-weight:600;color:var(--navy);margin-bottom:12px;display:flex;align-items:flex-start;}}
.qnum{{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:50%;background:var(--navy);color:#fff;font-size:.72rem;font-weight:700;margin-right:8px;flex-shrink:0;}}
.qt-inner{{flex:1;}}
.qopts{{list-style:none;display:flex;flex-direction:column;gap:8px;}}
.qo{{display:flex;align-items:flex-start;gap:10px;padding:11px 15px;border:2px solid var(--border);border-radius:8px;cursor:pointer;font-size:.88rem;transition:border-color .2s,background .2s;line-height:1.55;}}
.qo:hover{{border-color:var(--teal);background:var(--teal-pale);}}
.qo.correct{{border-color:var(--teal);background:var(--teal-pale);}}
.qo.incorrect{{border-color:var(--red);background:var(--red-pale);}}
.qo.revealed{{pointer-events:none;}}
.ol{{width:22px;height:22px;border-radius:50%;background:var(--border);font-size:.72rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;color:var(--muted);}}
.qo.correct .ol{{background:var(--teal);color:#fff;}}
.qo.incorrect .ol{{background:var(--red);color:#fff;}}
.qexp{{display:none;margin-top:10px;padding:12px 15px;background:var(--teal-pale);border-radius:8px;font-size:.85rem;color:var(--navy);line-height:1.65;border-left:3px solid var(--teal);}}
.qexp.show{{display:block;}}
.qscore{{display:none;background:var(--navy);color:#fff;border-radius:10px;padding:20px 24px;margin-top:18px;text-align:center;}}
.qscore.show{{display:block;}}
.score-n{{font-family:"Playfair Display",serif;font-size:2.6rem;color:var(--accent-light);}}
.score-l{{font-size:.9rem;color:rgba(255,255,255,.65);margin-top:4px;}}
.lnav{{display:flex;justify-content:space-between;align-items:center;padding:22px 56px;border-top:1px solid var(--border);background:#fff;}}
.nbtn{{display:flex;align-items:center;gap:8px;padding:10px 22px;border-radius:8px;border:none;font-size:.88rem;font-weight:600;cursor:pointer;transition:all .2s;font-family:"Source Sans 3",sans-serif;}}
.nbtn.prev{{background:#fff;border:2px solid var(--border);color:var(--muted);}}
.nbtn.prev:hover{{border-color:var(--navy);color:var(--navy);}}
.nbtn.next{{background:var(--navy);color:#fff;}}
.nbtn.next:hover{{background:var(--navy-mid);}}
.nbtn:disabled{{opacity:.35;cursor:not-allowed;}}
.lnav-info{{font-size:.78rem;color:var(--muted);text-align:center;}}
.mc-btn{{display:flex;align-items:center;gap:6px;padding:7px 16px;border-radius:20px;border:2px solid var(--accent);background:transparent;color:var(--accent);font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;font-family:"Source Sans 3",sans-serif;}}
.mc-btn:hover,.mc-btn.done{{background:var(--accent);color:#fff;}}
.os-credit{{font-size:.72rem;color:var(--muted);font-style:italic;margin-top:24px;padding-top:14px;border-top:1px solid var(--border);}}"""


def generate_name_modal(config):
    emoji = config.get('emoji', '📖')
    title = esc(config['title'])
    accent = config.get('accent', '#c0392b')
    return f'''<div id="name-modal" style="position:fixed;inset:0;background:rgba(0,0,0,.72);z-index:9999;display:flex;align-items:center;justify-content:center;"><div style="background:#fff;border-radius:18px;padding:40px 44px;max-width:440px;width:90%;box-shadow:0 24px 60px rgba(0,0,0,.4);"><div style="font-size:2rem;margin-bottom:10px;">{emoji}</div><h2 style="font-family:'Playfair Display',serif;font-size:1.5rem;color:#0f2240;margin-bottom:6px;">{title}</h2><p style="font-size:.9rem;color:#5e6e8a;margin-bottom:24px;line-height:1.6;">Your quiz scores will be sent to Mr. England automatically. Enter your full name to get started.</p><label style="font-size:.8rem;font-weight:700;color:#0f2240;letter-spacing:.5px;display:block;margin-bottom:6px;">YOUR FULL NAME</label><input id="student-name" type="text" placeholder="First Last" autocomplete="name" style="width:100%;padding:12px 16px;border:2px solid #dde3ef;border-radius:10px;font-size:1rem;font-family:'Source Sans 3',sans-serif;outline:none;transition:border .2s;" onfocus="this.style.borderColor='{accent}'" onblur="this.style.borderColor='#dde3ef'"><div id="name-err" style="color:#c0392b;font-size:.8rem;margin-top:6px;display:none;">Please enter your first and last name.</div><button onclick="startModule()" style="margin-top:18px;width:100%;padding:13px;background:#0f2240;color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;font-family:'Source Sans 3',sans-serif;cursor:pointer;">Start Learning \\u2192</button></div></div>
<div id="submit-toast" style="position:fixed;bottom:24px;right:24px;background:var(--accent);color:#fff;padding:12px 20px;border-radius:10px;font-size:.85rem;font-weight:600;box-shadow:0 4px 18px rgba(0,0,0,.25);z-index:8000;display:none;align-items:center;gap:10px;max-width:320px;"><span style="font-size:1.1rem;">\\U0001F4E4</span><span id="toast-msg">Score sent!</span></div>'''


def generate_topbar(config):
    emoji = config.get('emoji', '📖')
    title = esc(config['title'])
    return f'''<header class="top-bar"><a class="tb-back" href="../ap/index.html">\\u2190 A&amp;P</a><div class="tb-logo">{emoji}</div><div><div class="tb-name">Southern Gap High School \\u00B7 A&amp;P</div><div class="tb-sub">Mr. England</div></div><div class="tb-badge" id="student-badge">{title}</div></header>
<div class="prog-wrap"><div id="prog-bar"></div></div>'''


def generate_sidebar(config, content_sections):
    """Generate sidebar navigation."""
    lines = ['<nav class="sidebar" id="sidebar">']
    lines.append('  <div class="sb-label">Overview</div>')
    lines.append('  <a class="sb-link active" onclick="goTo(0)" href="#"><div class="sb-num">0</div><div class="sb-txt">Chapter Overview</div></a>')

    sidebar_groups = config.get('sidebar_groups', {})
    panel_idx = 1

    if sidebar_groups:
        for group_name, section_nums in sidebar_groups.items():
            lines.append('  <div class="sb-div"></div>')
            lines.append(f'  <div class="sb-label">{esc(group_name)}</div>')
            for sec_num in section_nums:
                # Find section title
                sec_title = sec_num
                for s in content_sections:
                    if s['num'] == sec_num:
                        sec_title = s.get('title', sec_num)
                        break
                lines.append(f'  <a class="sb-link" onclick="goTo({panel_idx})" href="#"><div class="sb-num">{panel_idx}</div><div class="sb-txt">{esc(sec_title)}</div></a>')
                panel_idx += 1
    else:
        # Auto-generate from sections
        lines.append('  <div class="sb-div"></div>')
        lines.append('  <div class="sb-label">Sections</div>')
        for sec in content_sections:
            if sec['num'].endswith('.1') and 'Introduction' in sec.get('title', ''):
                continue  # Skip intro, it's the overview
            lines.append(f'  <a class="sb-link" onclick="goTo({panel_idx})" href="#"><div class="sb-num">{panel_idx}</div><div class="sb-txt">{esc(sec.get("title", sec["num"]))}</div></a>')
            panel_idx += 1

    lines.append('  <div class="sb-div"></div>')
    lines.append('  <div class="sb-label">Review</div>')
    lines.append(f'  <a class="sb-link" onclick="goTo({panel_idx})" href="#"><div class="sb-num">{panel_idx}</div><div class="sb-txt">Chapter Review &amp; Practice Test</div></a>')
    lines.append('</nav>')
    return '\n'.join(lines)


def generate_vocab_cards(terms):
    """Generate vocab flip card HTML from a list of {term, definition}."""
    if not terms:
        return ''
    lines = ['<div class="cs"><div class="eyebrow">Key Vocabulary</div><div class="sh2">Click Every Card to Flip It</div>']
    lines.append('<div class="vocab-hint">👆 Click each card — then complete the checkpoint to unlock the quiz</div>')
    lines.append('<div class="vocab-grid">')
    for t in terms:
        lines.append(f'<div class="vcard" onclick="this.classList.toggle(\'flipped\')"><div class="vcard-inner"><div class="vfront"><div><div class="vterm">{esc(t["term"])}</div><div class="vhint">tap</div></div></div><div class="vback"><div class="vdef">{esc(t["definition"])}</div></div></div></div>')
    lines.append('</div></div>')
    return '\n'.join(lines)


def generate_content_elements(elements):
    """Generate HTML for a section's content elements (paragraphs, headings, figures, tables, callouts)."""
    lines = []
    for el in elements:
        if el['type'] == 'paragraph':
            text = el['text']
            # Convert **bold** patterns if present
            text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
            lines.append(f'<p class="prose">{text}</p>')

        elif el['type'] == 'heading':
            if el['level'] == 2:
                lines.append(f'<div class="sh2">{esc(el["text"])}</div>')
            else:
                lines.append(f'<div class="sh3">{esc(el["text"])}</div>')

        elif el['type'] == 'figure':
            path = el['path']
            # Strip 'ap/' prefix since HTML file lives inside ap/
            if path.startswith('ap/'):
                path = path[3:]
            caption = el.get('caption', '')
            lines.append(f'<div class="diagram"><img src="{esc(path)}" alt="{esc(caption)}"><div class="d-cap">{esc(caption)} (OpenStax A&amp;P 2e, CC BY 4.0)</div></div>')

        elif el['type'] == 'table':
            rows = el['rows']
            if rows:
                lines.append('<table class="dt">')
                # First row as header
                lines.append('<tr>' + ''.join(f'<th>{esc(c)}</th>' for c in rows[0]) + '</tr>')
                for row in rows[1:]:
                    lines.append('<tr>' + ''.join(f'<td>{esc(c)}</td>' for c in row) + '</tr>')
                lines.append('</table>')

        elif el['type'] == 'callout':
            title = el.get('title', 'Note')
            text = el.get('text', '')
            icon = '💼' if 'career' in title.lower() else '🔗' if 'interactive' in title.lower() else '📌' if 'everyday' in title.lower() else 'ℹ️'
            lines.append(f'<div class="callout info"><div class="ci">{icon}</div><div class="cb"><div class="ct">{esc(title)}</div><div class="cx">{esc(text)}</div></div></div>')

    return '\n'.join(lines)


def generate_quiz_question(q, display_num, explanations=None):
    """Generate HTML for a single quiz question."""
    ans = q.get('answer', 'a') or 'a'
    q_num_str = str(q.get('num', ''))
    explanation = 'See the textbook section for a detailed explanation.'
    if explanations and q_num_str in explanations:
        explanation = explanations[q_num_str]
    lines = [f'<div class="qq" data-ans="{ans}"><div class="qt"><span class="qnum">{display_num}</span><span class="qt-inner">{esc(q["text"])}</span></div><ul class="qopts">']
    for opt in q.get('options', []):
        letter = opt['letter']
        lines.append(f'<li class="qo" data-v="{letter}" onclick="pick(this)"><div class="ol">{letter.upper()}</div>{esc(opt["text"])}</li>')
    lines.append(f'</ul><div class="qexp">{esc(explanation)}</div></div>')
    return '\n'.join(lines)


def generate_checkpoint(panel_idx, question_text, min_chars=80):
    """Generate checkpoint HTML."""
    label = 'Final Checkpoint' if min_chars > 80 else 'Checkpoint — Before the Quiz'
    unlock_text = 'Unlock Practice Test →' if min_chars > 80 else 'Unlock Quiz →'
    return f'''<div class="checkpoint-box" id="cp{panel_idx}"><div class="cp-header"><div class="cp-icon">✍️</div><div><div class="cp-title">{label}</div><div class="cp-sub">{min_chars}+ characters required</div></div></div><div class="cp-question">{esc(question_text)}</div><textarea class="cp-textarea" id="cpt{panel_idx}" placeholder="Write your answer here..." oninput="cpCheck({panel_idx})"></textarea><div class="cp-footer"><div class="cp-counter" id="cpc{panel_idx}">Characters: <span id="cpn{panel_idx}">0</span> / {min_chars} required</div><button class="cp-btn" id="cpb{panel_idx}" onclick="cpUnlock({panel_idx})">{unlock_text}</button></div><div class="cp-done" id="cpd{panel_idx}">✅ Unlocked!</div></div>'''


def generate_panel(panel_idx, section, vocab_terms, quiz_questions, checkpoint_question, ch_num, total_content_panels, is_first_content=False, explanations=None):
    """Generate a complete content panel."""
    title = section.get('title', f'Section {section["num"]}')
    # Clean up title duplication like "19.2: 19.2: Heart Anatomy"
    title = re.sub(r'^[\d.]+:\s*[\d.]+:\s*', '', title)
    if not title:
        title = f'Section {section["num"]}'

    desc_text = ''
    for el in section.get('elements', []):
        if el['type'] == 'paragraph':
            desc_text = el['text'][:200] + '...' if len(el['text']) > 200 else el['text']
            break

    prev_btn = f'<button class="nbtn prev" onclick="goTo({panel_idx - 1})">← Previous</button>' if panel_idx > 0 else '<button class="nbtn prev" disabled>← Previous</button>'
    next_panel = panel_idx + 1
    is_last_content = (panel_idx == total_content_panels)
    next_btn = f'<button class="nbtn next" onclick="goTo({next_panel})">Next →</button>'

    lines = []
    lines.append(f'<div class="panel" id="p{panel_idx}">')
    lines.append(f'  <div class="hero hero-sec"><div class="h-crumb">Chapter {ch_num} · <span>Section {section["num"]}</span></div><div class="h-title">{esc(title)}</div><div class="h-desc">{esc(desc_text)}</div><div class="h-meta"><div class="h-chip">📖 OpenStax A&amp;P 2e, {section["num"]}</div></div></div>')
    lines.append('  <div class="lc">')

    # Learning objectives
    if section.get('objectives'):
        lines.append('    <div class="obj-box"><div class="obj-label">🎯 Learning Objectives</div><ul class="obj-list">')
        for obj in section['objectives']:
            lines.append(f'      <li>{esc(obj)}</li>')
        lines.append('    </ul></div>')

    # Vocab cards
    if vocab_terms:
        lines.append(generate_vocab_cards(vocab_terms))

    # Core content
    lines.append(f'    <div class="cs"><div class="eyebrow">Core Content — OpenStax A&amp;P 2e, {section["num"]}</div>')
    lines.append(generate_content_elements(section.get('elements', [])))
    lines.append(f'    <p class="os-credit">📖 OpenStax Anatomy &amp; Physiology 2e, Section {section["num"]}. openstax.org · CC BY 4.0</p>')
    lines.append('    </div>')

    # Checkpoint
    if checkpoint_question:
        lines.append(generate_checkpoint(panel_idx, checkpoint_question))

    # Quiz
    if quiz_questions:
        q_count = len(quiz_questions)
        lines.append(f'    <div id="quiz-wrap{panel_idx}" style="display:none;"><div class="quiz-box"><div class="qh"><div class="q-icon">📝</div><div><h3>Section {section["num"]} Quiz</h3><p>{q_count} questions</p></div></div><div id="q{panel_idx}">')
        for i, q in enumerate(quiz_questions):
            lines.append(generate_quiz_question(q, i + 1, explanations))
        lines.append(f'    </div><div class="qscore" id="sc{panel_idx}"><div class="score-n" id="scn{panel_idx}">-</div><div class="score-l">out of {q_count} correct</div></div></div></div>')

    lines.append('  </div>')  # close .lc
    lines.append(f'  <div class="lnav">{prev_btn}<button class="mc-btn" onclick="markDone({panel_idx},this)">✓ Mark Complete</button>{next_btn}</div>')
    lines.append('</div>')
    return '\n'.join(lines)


def generate_overview_panel(config, data, ch_num, total_sections, total_questions):
    """Generate the p0 overview panel."""
    title = esc(config['title'])
    emoji = config.get('emoji', '📖')
    intro_section = data['sections'][0] if data['sections'] else None

    # Get intro text
    intro_text = ''
    if intro_section:
        for el in intro_section.get('elements', []):
            if el['type'] == 'paragraph':
                intro_text += el['text'] + ' '
        intro_text = intro_text.strip()[:600]

    # Get objectives from intro callout or first section
    objectives = []
    if intro_section:
        for el in intro_section.get('elements', []):
            if el['type'] == 'callout' and 'objective' in el.get('title', '').lower():
                # Parse objectives from callout text
                obj_text = el['text']
                for obj in re.split(r'(?=[A-Z][a-z])', obj_text):
                    obj = obj.strip()
                    if len(obj) > 15:
                        objectives.append(obj)
        if not objectives:
            objectives = intro_section.get('objectives', [])

    lines = []
    lines.append('<div class="panel active" id="p0">')
    lines.append(f'  <div class="hero hero-ov"><div class="h-crumb">A&amp;P · Chapter {ch_num} · <span>Overview</span></div><div class="h-title">{title}</div><div class="h-desc">{esc(intro_text)}</div>')
    lines.append(f'    <div class="h-meta"><div class="h-chip">📚 {total_sections} Lessons</div><div class="h-chip">{emoji} OpenStax A&amp;P 2e Ch. {ch_num}</div><div class="h-chip">✍️ Checkpoints Required</div><div class="h-chip">📝 {total_questions} Review Questions</div></div>')
    lines.append('  </div>')
    lines.append('  <div class="lc">')

    # Objectives
    if objectives:
        lines.append('    <div class="obj-box"><div class="obj-label">🎯 Chapter Objectives</div><ul class="obj-list">')
        for obj in objectives:
            lines.append(f'      <li>{esc(obj)}</li>')
        lines.append('    </ul></div>')

    # OpenStax attribution
    lines.append(f'    <div class="callout openstax"><div class="ci">📖</div><div class="cb"><div class="ct">OpenStax Anatomy &amp; Physiology 2e — Chapter {ch_num}</div><div class="cx">All content is from OpenStax A&amp;P 2e, Chapter {ch_num}: {title}. CC BY 4.0. Access free at openstax.org.</div></div></div>')

    # Intro image if available
    if intro_section:
        for el in intro_section.get('elements', []):
            if el['type'] == 'figure':
                fig_path = el["path"]
                if fig_path.startswith('ap/'):
                    fig_path = fig_path[3:]
                lines.append(f'    <div class="diagram"><img src="{esc(fig_path)}" alt="{esc(el.get("caption", ""))}"><div class="d-cap">{esc(el.get("caption", ""))} (OpenStax A&amp;P 2e, CC BY 4.0)</div></div>')
                break

    lines.append('  </div>')
    lines.append(f'  <div class="lnav"><button class="nbtn prev" disabled>← Previous</button><div class="lnav-info">Overview · 0 of {total_sections}</div><button class="nbtn next" onclick="goTo(1)">Begin →</button></div>')
    lines.append('</div>')
    return '\n'.join(lines)


def generate_review_panel(panel_idx, ch_num, all_questions, config, content_sections, explanations=None):
    """Generate the chapter review panel with all questions."""
    title = esc(config['title'])
    q_count = len(all_questions)

    lines = []
    lines.append(f'<div class="panel" id="p{panel_idx}">')
    lines.append(f'  <div class="hero hero-rev"><div class="h-crumb">Review · <span>Chapter {ch_num}</span></div><div class="h-title">Chapter Review &amp; Practice Test</div><div class="h-desc">Comprehensive review of Chapter {ch_num}: {title}.</div><div class="h-meta"><div class="h-chip">📝 {q_count} Questions</div><div class="h-chip">⏱ ~40 min</div></div></div>')
    lines.append('  <div class="lc">')

    # Summary table
    lines.append('    <div class="cs"><div class="eyebrow">Review Summary</div><div class="sh2">Chapter at a Glance</div>')
    lines.append('    <table class="dt"><tr><th>Section</th><th>Title</th></tr>')
    for sec in content_sections:
        sec_title = sec.get('title', sec['num'])
        sec_title = re.sub(r'^[\d.]+:\s*[\d.]+:\s*', '', sec_title)
        lines.append(f'    <tr><td><strong>{esc(sec["num"])}</strong></td><td>{esc(sec_title)}</td></tr>')
    lines.append('    </table></div>')

    # Final checkpoint
    cp_question = "Pick any three sections from this chapter and write one key concept from each that you found most important. Explain why."
    lines.append(generate_checkpoint(panel_idx, cp_question, min_chars=100))

    # Practice test
    lines.append(f'    <div id="quiz-wrap{panel_idx}" style="display:none;"><div class="quiz-box"><div class="qh"><div class="q-icon">📝</div><div><h3>Chapter {ch_num} Practice Test</h3><p>{q_count} questions · All OpenStax Review Questions</p></div></div><div id="q{panel_idx}">')
    lines.append(f'    <div class="callout info"><div class="ci">📋</div><div class="cb"><div class="ct">About This Test</div><div class="cx">This practice test contains all {q_count} review questions from OpenStax A&amp;P 2e, Chapter {ch_num}. Take your time — there is no time limit.</div></div></div>')

    for i, q in enumerate(all_questions):
        lines.append(generate_quiz_question(q, i + 1, explanations))

    lines.append(f'    </div><div class="qscore" id="sc{panel_idx}"><div class="score-n" id="scn{panel_idx}">-</div><div class="score-l">out of {q_count} correct</div></div></div></div>')
    lines.append('  </div>')

    # Nav
    lines.append(f'  <div class="lnav"><button class="nbtn prev" onclick="goTo({panel_idx - 1})">← Previous</button><button class="mc-btn" onclick="markDone({panel_idx},this)">✓ Mark Complete</button><button class="nbtn next" disabled>End of Chapter →</button></div>')
    lines.append('</div>')
    return '\n'.join(lines)


def generate_module_config(config, panel_count, lesson_names):
    """Generate the MODULE_CONFIG and JS block."""
    title = config['title'].replace("'", "\\'")
    lessons_str = ','.join(f"'{n}'" for n in lesson_names)
    review_panel = panel_count - 1

    return f'''<script src="../shared/portal-quiz.js"></script>
<script>
window.MODULE_CONFIG={{name:'{title}',appsScriptUrl:'{APPS_SCRIPT_URL}',panelCount:{panel_count},lessonCount:{panel_count - 1},cpMin:80,lessons:[{lessons_str}]}};

window.cpCheck=function(id){{
  var min=id==={review_panel}?100:80;
  var ta=document.getElementById('cpt'+id);
  var n=ta.value.length;
  document.getElementById('cpc'+id).innerHTML='Characters: <span id="cpn'+id+'" style="font-weight:700;color:'+(n>=min?'var(--teal)':'var(--amber)')+'">'+n+'</span> / '+min+' required';
  var btn=document.getElementById('cpb'+id);
  if(n>=min){{btn.classList.add('ready');}}else{{btn.classList.remove('ready');}}
}};
</script>'''


# ─── MAIN ASSEMBLY ────────────────────────────────────────────────────

def build_module(extracted_path, config_path):
    """Build a complete HTML module from extracted text + config."""
    project_root = Path(__file__).parent.parent

    # Load config
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    # Parse extracted text
    data = parse_extracted(extracted_path)

    ch_num = config['chapter']
    content_sections = [s for s in data['sections'] if not s['num'].endswith('.1') or len(data['sections']) <= 2]
    # If the first section is just an intro with <5 paragraphs, skip it as content and use for overview
    intro_section = data['sections'][0] if data['sections'] else None
    if intro_section:
        intro_paras = len([e for e in intro_section.get('elements', []) if e['type'] == 'paragraph'])
        if intro_paras <= 5 and len(data['sections']) > 2:
            content_sections = data['sections'][1:]
        else:
            content_sections = data['sections']

    total_content_panels = len(content_sections)
    total_panels = total_content_panels + 2  # overview + content + review
    review_panel_idx = total_panels - 1

    # Distribute terms across sections — smart matching by prose content
    section_terms = config.get('section_terms', {})
    # If not specified, match each term to the section where it appears in the prose
    if not section_terms:
        # Build prose text per section for matching
        section_prose = {}
        for sec in content_sections:
            prose_text = ' '.join(
                el['text'].lower() for el in sec.get('elements', [])
                if el['type'] == 'paragraph'
            )
            section_prose[sec['num']] = prose_text

        # For each term, find which section mentions it most
        for sec in content_sections:
            section_terms[sec['num']] = []

        # Filter junk terms
        junk_terms = {'page id', 'page', ''}
        clean_terms = [t for t in data['key_terms'] if t['term'].lower().strip() not in junk_terms and len(t['term']) >= 2 and 'shared under' not in t['term'].lower()]

        unmatched = []
        for term_obj in clean_terms:
            term_lower = term_obj['term'].lower()
            # Also check for partial matches (e.g., "cardiac output" matches "cardiac" and "output")
            term_words = [w for w in term_lower.split() if len(w) > 3]

            best_section = None
            best_score = 0
            for sec in content_sections:
                prose = section_prose[sec['num']]
                # Score: exact term match = 10, each word match = 1
                score = 0
                if term_lower in prose:
                    score += 10
                for w in term_words:
                    if w in prose:
                        score += 1
                if score > best_score:
                    best_score = score
                    best_section = sec['num']

            if best_section and best_score > 0:
                section_terms[best_section].append(term_obj)
            else:
                unmatched.append(term_obj)

        # Distribute unmatched terms to sections with fewest terms
        for term_obj in unmatched:
            min_sec = min(content_sections, key=lambda s: len(section_terms[s['num']]))
            section_terms[min_sec['num']].append(term_obj)
    else:
        # Convert term names to term objects
        for sec_num, term_names in section_terms.items():
            if term_names and isinstance(term_names[0], str):
                matched = []
                for name in term_names:
                    for t in data['key_terms']:
                        if t['term'].lower() == name.lower():
                            matched.append(t)
                            break
                section_terms[sec_num] = matched

    # Distribute quiz questions across sections
    section_quizzes = config.get('section_quizzes', {})
    review_answers = config.get('review_answers', {})

    # Load answers file if it exists (generated by generate_answers.py)
    explanations = {}
    answers_file = project_root / 'tools' / 'configs' / f'ch{ch_num}-answers.json'
    if answers_file.exists():
        with open(answers_file, 'r', encoding='utf-8') as f:
            answers_data = json.load(f)
        # Merge answers from answers file into review_answers (answers file takes precedence)
        for k, v in answers_data.get('review_answers', {}).items():
            if k not in review_answers:
                review_answers[k] = v
        explanations = answers_data.get('explanations', {})
        print(f"  Loaded {len(explanations)} explanations from {answers_file.name}")

    # Apply answers to questions
    for q in data['review_questions']:
        q_num_str = str(q['num'])
        if q_num_str in review_answers:
            q['answer'] = review_answers[q_num_str]

    if not section_quizzes:
        # Auto-distribute evenly
        qs_per_section = max(1, len(data['review_questions']) // max(1, len(content_sections)))
        idx = 0
        for sec in content_sections:
            section_quizzes[sec['num']] = data['review_questions'][idx:idx + qs_per_section]
            idx += qs_per_section
    else:
        # Convert question numbers to question objects
        for sec_num, q_nums in section_quizzes.items():
            if q_nums and isinstance(q_nums[0], int):
                matched = [q for q in data['review_questions'] if q['num'] in q_nums]
                section_quizzes[sec_num] = matched

    # Distribute critical thinking as checkpoints
    section_checkpoints = config.get('section_checkpoints', {})
    if not section_checkpoints:
        for i, sec in enumerate(content_sections):
            if i < len(data['critical_thinking']):
                section_checkpoints[sec['num']] = data['critical_thinking'][i]
            else:
                section_checkpoints[sec['num']] = f"Summarize the key concepts from section {sec['num']} in your own words."

    # Build lesson names for MODULE_CONFIG
    lesson_names = ['Overview']
    for sec in content_sections:
        title = sec.get('title', sec['num'])
        title = re.sub(r'^[\d.]+:\s*[\d.]+:\s*', '', title)
        lesson_names.append(f"{sec['num']} {title}")
    lesson_names.append('Chapter Review')

    # ─── ASSEMBLE HTML ───
    out = []

    # Head
    out.append(f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>A&amp;P · {esc(config["title"])} | Southern Gap High School</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900&family=Source+Sans+3:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<style>
{generate_css(config)}
</style>
</head>
<body>''')

    # Name modal + toast
    out.append(generate_name_modal(config))

    # Top bar
    out.append(generate_topbar(config))

    # Sidebar
    out.append(generate_sidebar(config, content_sections))

    # Main content
    out.append('<main class="main" id="main">')
    out.append('')

    # Panel 0: Overview
    out.append(generate_overview_panel(config, data, ch_num, total_content_panels, len(data['review_questions'])))
    out.append('')

    # Content panels
    for i, sec in enumerate(content_sections):
        panel_idx = i + 1
        vocab = section_terms.get(sec['num'], [])
        quizzes = section_quizzes.get(sec['num'], [])
        checkpoint = section_checkpoints.get(sec['num'], '')
        out.append(generate_panel(panel_idx, sec, vocab, quizzes, checkpoint, ch_num, total_content_panels, explanations=explanations))
        out.append('')

    # Review panel
    out.append(generate_review_panel(review_panel_idx, ch_num, data['review_questions'], config, content_sections, explanations))
    out.append('')

    out.append('</main>')

    # JS
    out.append(generate_module_config(config, total_panels, lesson_names))

    out.append('</body>')
    out.append('</html>')

    return '\n'.join(out)


# ─── CLI ──────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 3:
        print("Usage: python build_module.py <extracted-text-file> --config <config-json>")
        print("Example: python build_module.py ap-ch19-extracted.txt --config tools/configs/ch19.json")
        sys.exit(1)

    extracted_path = sys.argv[1]
    config_path = None

    for i, arg in enumerate(sys.argv):
        if arg == '--config' and i + 1 < len(sys.argv):
            config_path = sys.argv[i + 1]

    if not config_path:
        print("ERROR: --config <path> is required")
        sys.exit(1)

    # Resolve paths
    script_dir = Path(__file__).parent
    project_root = script_dir.parent

    if not os.path.isabs(extracted_path):
        extracted_path = project_root / extracted_path
    if not os.path.isabs(config_path):
        config_path = project_root / config_path

    # Load config to get output filename
    with open(config_path, 'r', encoding='utf-8') as f:
        config = json.load(f)

    output_path = project_root / 'ap' / config['filename']

    print(f"\n{'='*60}")
    print(f"  BUILDING MODULE: {config['title']}")
    print(f"  Input:  {extracted_path}")
    print(f"  Config: {config_path}")
    print(f"  Output: {output_path}")
    print(f"{'='*60}\n")

    html_content = build_module(str(extracted_path), str(config_path))

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(html_content)

    # Stats
    para_count = html_content.count('class="prose"')
    img_count = html_content.count('<img ')
    vcard_count = html_content.count('class="vcard"')
    qq_count = html_content.count('class="qq"')
    file_size = len(html_content.encode('utf-8'))

    print(f"  ✅ Module built successfully!")
    print(f"  File size:        {file_size // 1024} KB")
    print(f"  Prose paragraphs: {para_count}")
    print(f"  Images:           {img_count}")
    print(f"  Vocab cards:      {vcard_count}")
    print(f"  Quiz questions:   {qq_count}")
    print(f"  Output:           {output_path}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
