#!/usr/bin/env python3
"""Bump cache-bust query string on the sol-api.js script tag across
all 9 entry pages, so students fetch the new FERPA-Phase-2 client on
their next page load.
"""
import re
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2\sol-prep")
TARGETS = [
    "unit-1.html","unit-2.html","unit-3.html","unit-4.html","unit-5.html",
    "unit-6.html","unit-7.html","unit-8.html","practice-test.html"
]
VERSION = "2026-05-03-phaseD-dsm"

PAT = re.compile(r'<script src="sol-api\.js(\?v=[^"]*)?"></script>')

for fname in TARGETS:
    path = BASE / fname
    text = path.read_text(encoding="utf-8", errors="surrogatepass")
    new_text, n = PAT.subn(f'<script src="sol-api.js?v={VERSION}"></script>', text, count=1)
    if n != 1:
        print(f"  {fname}: NO MATCH")
        continue
    path.write_text(new_text, encoding="utf-8", errors="surrogatepass")
    print(f"  {fname}: bumped")
