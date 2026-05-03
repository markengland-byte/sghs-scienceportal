#!/usr/bin/env python3
"""One-shot CSS fix: center the .lc lesson container horizontally
by adding `margin:0 auto`. Applies to all 9 unit-N.html + practice-test.

Original rule (visible on all 9 pages):
  .lc{padding:36px 48px 56px;max-width:860px;}

After fix:
  .lc{padding:36px 48px 56px;max-width:860px;margin:0 auto;}

Idempotent: skips files that already have the margin clause.
"""
import re
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2\sol-prep")
TARGETS = [
    "unit-1.html","unit-2.html","unit-3.html","unit-4.html","unit-5.html",
    "unit-6.html","unit-7.html","unit-8.html","practice-test.html"
]

OLD = ".lc{padding:36px 48px 56px;max-width:860px;}"
NEW = ".lc{padding:36px 48px 56px;max-width:860px;margin:0 auto;}"

for fname in TARGETS:
    path = BASE / fname
    text = path.read_text(encoding="utf-8", errors="surrogatepass")
    if NEW in text:
        print(f"  {fname}: already fixed")
        continue
    if OLD not in text:
        print(f"  {fname}: original .lc rule not found; skip")
        continue
    text = text.replace(OLD, NEW)
    path.write_text(text, encoding="utf-8", errors="surrogatepass")
    print(f"  {fname}: layout fixed")
