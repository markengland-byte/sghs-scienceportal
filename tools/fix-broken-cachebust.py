#!/usr/bin/env python3
"""HOTFIX: cachebust-engine.py corrupted script-tag URLs in unit-N.html.

The replacement `rf'\\1{NEW_VERSION}'` became literal `\\12026-05-03-phaseD-dsm`,
where `\\12` got interpreted as an octal escape (\\120 = ASCII 'P') by Python
re's replacement parser, eating "?v=2026" and replacing it with "P26".

Visible damage:
  <script src="unit-engine.jsP26-05-03-phaseD-dsm"></script>
  <script src="config/unit-1.jsP26-05-03-phaseD-dsm"></script>

Fix all 8 unit-N.html: literal find+replace `P26-05-03-phaseD-dsm` ->
`?v=2026-05-03-phaseD-dsm`. Conservative: only matches our exact corruption.
"""
import re
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2\sol-prep")
TARGETS = [f"unit-{n}.html" for n in range(1, 9)]

BROKEN = "P26-05-03-phaseD-dsm"
FIXED  = "?v=2026-05-03-phaseD-dsm"

for fname in TARGETS:
    path = BASE / fname
    text = path.read_text(encoding="utf-8", errors="surrogatepass")
    n = text.count(BROKEN)
    if n == 0:
        print(f"  {fname}: no broken cache-bust strings (already clean)")
        continue
    text = text.replace(BROKEN, FIXED)
    path.write_text(text, encoding="utf-8", errors="surrogatepass")
    print(f"  {fname}: fixed {n} broken cache-bust strings")
