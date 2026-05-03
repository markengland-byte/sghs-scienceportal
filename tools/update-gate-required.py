#!/usr/bin/env python3
"""For each sol-prep/unit-N.html, count visible .gate-q elements per
panel and rewrite the corresponding sol-prep/config/unit-N.js
gateRequired field to match. Special case: unit-1 panel 3 adds 2
for the graph-q items.

Per Mark's call 2026-05-03: students must answer every question on
a page before the gate unlocks.
"""
import re
import json
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2")

def count_gate_q_per_panel(html_text):
    """Return {panel_id: count} for every .gate-q element grouped by data-panel."""
    counts = {}
    for m in re.finditer(r'<div\s+class="qq\s+gate-q"\s+data-ans="[^"]*"\s+data-panel="(\d+)"', html_text):
        pid = int(m.group(1))
        counts[pid] = counts.get(pid, 0) + 1
    return counts


def count_graph_q(html_text):
    """Count graph-q1 / graph-q2 sections (unit-1 panel 3 only)."""
    return len(re.findall(r'id="graph-q\d+"', html_text))


def update_config(unit_n, new_gate_required):
    """Rewrite the gateRequired line in sol-prep/config/unit-N.js."""
    cfg_path = BASE / f"sol-prep/config/unit-{unit_n}.js"
    text = cfg_path.read_text(encoding="utf-8", errors="surrogatepass")
    # Pretty-print the new gateRequired in compact form on one line.
    items = ", ".join(f"{k}: {v}" for k, v in sorted(new_gate_required.items()))
    new_line = f"  gateRequired: {{ {items} }},"
    text, n = re.subn(r"  gateRequired:\s*\{[^}]*\},", new_line, text)
    if n != 1:
        print(f"  unit-{unit_n}: WARN gateRequired line not matched")
        return
    cfg_path.write_text(text, encoding="utf-8", errors="surrogatepass")
    print(f"  unit-{unit_n}: gateRequired updated -> {items}")


for n in range(1, 9):
    html_path = BASE / f"sol-prep/unit-{n}.html"
    text = html_path.read_text(encoding="utf-8", errors="surrogatepass")
    counts = count_gate_q_per_panel(text)
    # Unit-1 panel 3 has 2 graph questions in addition to .gate-q.
    if n == 1 and 3 in counts:
        counts[3] += 2  # graph-q1 + graph-q2
    print(f"unit-{n}: panel counts = {sorted(counts.items())}")
    update_config(n, counts)
