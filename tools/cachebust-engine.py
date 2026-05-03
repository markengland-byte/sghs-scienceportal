#!/usr/bin/env python3
"""Bump cache-bust query strings on engine + per-unit script tags
across all migrated unit-N.html files."""
import re
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2\sol-prep")
TARGETS = [f"unit-{n}.html" for n in range(1, 9)]
NEW_VERSION = "2026-05-03-phaseD-dsm"

PAT = re.compile(r'(\?v=)\d{4}-\d{2}-\d{2}-phaseD[^"]*')

for fname in TARGETS:
    path = BASE / fname
    text = path.read_text(encoding="utf-8", errors="surrogatepass")
    new_text, n = PAT.subn(rf'\1{NEW_VERSION}', text)
    if n > 0:
        path.write_text(new_text, encoding="utf-8", errors="surrogatepass")
        print(f"  {fname}: bumped {n} cache-bust strings")
    else:
        print(f"  {fname}: no cache-bust strings to bump")
