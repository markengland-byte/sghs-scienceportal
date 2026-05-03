#!/usr/bin/env python3
"""Update onclick="gradeVocab()" -> onclick="UnitEngine.gradeVocab()"
across all 8 unit-N.html. Phase D migration script missed this name."""
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2\sol-prep")
TARGETS = [f"unit-{n}.html" for n in range(1, 9)]

OLD = 'onclick="gradeVocab()"'
NEW = 'onclick="UnitEngine.gradeVocab()"'

for fname in TARGETS:
    path = BASE / fname
    text = path.read_text(encoding="utf-8", errors="surrogatepass")
    n = text.count(OLD)
    if n == 0:
        print(f"  {fname}: no bare gradeVocab onclick")
        continue
    text = text.replace(OLD, NEW)
    path.write_text(text, encoding="utf-8", errors="surrogatepass")
    print(f"  {fname}: updated {n} gradeVocab onclick(s)")
