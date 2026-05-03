#!/usr/bin/env python3
"""One-shot: convert manual `?v=<date>-<tag>` cache-bust strings in
HTML files to the `?v=__HASH__` placeholder, ready for the new
content-hash build step (tools/build-cache-bust.js).

Affects every <script src="..."> and <link href="..."> with a
local (non-http) URL that has any `?v=...` query.

Idempotent: leaves `?v=__HASH__` alone, only converts dated/tagged
versions. After conversion + push, Vercel's buildCommand will
substitute the real hash at deploy time.
"""
import re
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2")

# Match any <script src="x.js?v=anything-but-__HASH__">
# OR    any <link href="x.css?v=anything-but-__HASH__">
# Skip external URLs (https://, http://, //)
PAT = re.compile(
    r'(<(?:script|link)[^>]*?(?:src|href)=")(?!https?://|//)([^"]+?)\?v=(?!__HASH__)[^"]+(")',
    re.IGNORECASE
)

def convert(text):
    return PAT.subn(lambda m: f'{m.group(1)}{m.group(2)}?v=__HASH__{m.group(3)}', text)

# Walk and convert
for html in BASE.rglob('*.html'):
    parts = html.parts
    if 'node_modules' in parts or '.git' in parts:
        continue
    text = html.read_text(encoding='utf-8', errors='surrogatepass')
    new_text, n = convert(text)
    if n > 0:
        html.write_text(new_text, encoding='utf-8', errors='surrogatepass')
        print(f"  {html.relative_to(BASE)}: converted {n} reference(s) to __HASH__ placeholder")
