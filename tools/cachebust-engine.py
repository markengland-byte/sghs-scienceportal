#!/usr/bin/env python3
"""Bump cache-bust query strings on engine + per-unit script tags
across all migrated unit-N.html files."""
import re
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2\sol-prep")
TARGETS = [f"unit-{n}.html" for n in range(1, 9)]
NEW_VERSION = "2026-05-03-phaseD-nav"

PAT = re.compile(r'\?v=\d{4}-\d{2}-\d{2}-phaseD[^"]*')

# DO NOT use rf'\1{NEW_VERSION}' as the replacement — when NEW_VERSION
# starts with digits, Python re's replacement parser interprets `\1`
# followed by digit `2` as `\12` (a group reference / octal escape),
# eating the `?v=2026` and replacing it with ASCII char `P`. Stick
# to a literal replacement string with no backref.
for fname in TARGETS:
    path = BASE / fname
    text = path.read_text(encoding="utf-8", errors="surrogatepass")
    new_text, n = PAT.subn(f"?v={NEW_VERSION}", text)
    if n > 0:
        path.write_text(new_text, encoding="utf-8", errors="surrogatepass")
        print(f"  {fname}: bumped {n} cache-bust strings")
    else:
        print(f"  {fname}: no cache-bust strings to bump")
