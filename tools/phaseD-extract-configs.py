#!/usr/bin/env python3
"""Extract per-unit config data from PRE-MIGRATION unit-N.html files
in git history (commit f0ce122 — the checkpoint before pilot ran).

Generates sol-prep/config/unit-N.js for each of N=2..8.
"""
import re
import subprocess
from pathlib import Path

BASE = Path(r"C:\Users\Mark England\Desktop\sghs-portal-v2")
PRE_COMMIT = "f0ce122"  # checkpoint with all original unit-N.html intact


def from_git(path):
    """Return file contents at PRE_COMMIT."""
    result = subprocess.run(
        ["git", "-C", str(BASE), "show", f"{PRE_COMMIT}:{path}"],
        capture_output=True, text=True, encoding="utf-8", errors="surrogatepass"
    )
    if result.returncode != 0:
        raise RuntimeError(f"git show failed for {path}: {result.stderr}")
    return result.stdout


def extract_int(src, name):
    m = re.search(r"\b" + re.escape(name) + r"\s*=\s*(\d+)", src)
    if not m: return None
    return int(m.group(1))


def extract_string(src, name):
    """Match `name: '...'` allowing  -  or  ,  inside."""
    m = re.search(re.escape(name) + r"\s*:\s*'([^']+)'", src)
    if not m: return None
    return m.group(1)


def extract_object_literal(src, name):
    """Find `var name = { ... };` and return body dict-like region.
    Handles single-level nested objects via brace counting.
    """
    m = re.search(r"\b" + re.escape(name) + r"\s*=\s*\{", src)
    if not m: return None
    start = m.end() - 1  # position of opening {
    depth = 0
    i = start
    while i < len(src):
        if src[i] == '{': depth += 1
        elif src[i] == '}':
            depth -= 1
            if depth == 0:
                return src[start:i+1]
        i += 1
    return None


def extract_array(src, name):
    m = re.search(r"\b" + re.escape(name) + r"\s*=\s*\[", src)
    if not m: return None
    start = m.end() - 1  # position of opening [
    depth = 0
    i = start
    while i < len(src):
        if src[i] == '[': depth += 1
        elif src[i] == ']':
            depth -= 1
            if depth == 0:
                return src[start:i+1]
        i += 1
    return None


def extract_unlock_panels(src):
    m = re.search(r"unlockPanels\s*:\s*(\[[^\]]+\])", src)
    return m.group(1) if m else None


CONFIG_TEMPLATE = """/* ================================================================
   {moduleName}
   Loaded by {fname}.html immediately before UnitEngine.boot().
   Pure data: no logic. Generated from pre-migration HTML by
   tools/phaseD-extract-configs.py.
   ================================================================ */

window.UNIT_CONFIG = {{
  // Identity
  unitNumber: {unitNumber},
  unitKey:    '{unitKey}',
  standard:   '{standard}',
  moduleName: '{moduleName}',
  unitTitle:  '{unitTitle}',

  // Panel structure
  totalPanels:     {totalPanels},
  dsmPanelId:      {dsmPanelId},
  stepNames: {stepNames},
  unlockOnMastery: {unlockOnMastery},

  // Per-panel gate requirements
  gateRequired: {gateRequired},

  // Vocab gate
  vocab: {{
    total: {vqTotal},
    pass:  {vqPass},
    correct: {vqCorrect},
    explain: {vqExplain}
  }},

  // Counts
  totalCards: {totalCards},
  totalSolQ:  {totalSolQ},

  // DSM player options
  dsm: {{
    containerId: 'dsm-container',
    timeoutMs:   5000
  }}
}};
"""


def make_config(n):
    fname = f"unit-{n}"
    src = from_git(f"sol-prep/{fname}.html")

    unit_number  = n
    unit_key     = f"unit{n}"
    total_panels = extract_int(src, "TOTAL_PANELS")
    total_cards  = extract_int(src, "TOTAL_CARDS")
    total_sol_q  = extract_int(src, "TOTAL_SOL_Q")
    vq_total     = extract_int(src, "VQ_TOTAL")
    vq_pass      = extract_int(src, "VQ_PASS")
    dsm_panel    = extract_int(src, "DSM_PANEL")

    module_name  = extract_string(src, "moduleName")
    standard     = extract_string(src, "standard")
    unit_title   = (module_name.split(":", 1)[1].strip() if module_name and ":" in module_name else module_name)

    vq_correct   = extract_object_literal(src, "VQ_CORRECT")
    vq_explain   = extract_object_literal(src, "VQ_EXPLAIN")
    gate_required = extract_object_literal(src, "gateRequired")
    step_names    = extract_array(src, "stepNames")
    unlock_panels = extract_unlock_panels(src)

    missing = [k for k, v in {
        "TOTAL_PANELS": total_panels,
        "DSM_PANEL": dsm_panel,
        "moduleName": module_name,
        "VQ_CORRECT": vq_correct,
        "VQ_EXPLAIN": vq_explain,
        "gateRequired": gate_required,
        "stepNames": step_names,
        "unlockPanels": unlock_panels,
    }.items() if v is None]
    if missing:
        print(f"  unit-{n}: MISSING {missing}")
        return False

    out = CONFIG_TEMPLATE.format(
        fname=fname,
        unitNumber=unit_number,
        unitKey=unit_key,
        standard=standard,
        moduleName=module_name,
        unitTitle=unit_title,
        totalPanels=total_panels,
        dsmPanelId=dsm_panel,
        stepNames=step_names,
        unlockOnMastery=unlock_panels,
        gateRequired=gate_required,
        vqTotal=vq_total,
        vqPass=vq_pass,
        vqCorrect=vq_correct,
        vqExplain=vq_explain,
        totalCards=total_cards,
        totalSolQ=total_sol_q
    )

    out_path = BASE / f"sol-prep/config/{fname}.js"
    out_path.write_text(out, encoding="utf-8", errors="surrogatepass")
    print(f"  unit-{n}: wrote config ({len(out)} bytes)")
    return True


for n in range(2, 9):
    make_config(n)
print("done.")
