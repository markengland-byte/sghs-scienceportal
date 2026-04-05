"""
Physics Config Generator — Auto-generates config JSON files for all 34 physics chapters.

Usage:
    python tools/generate_physics_configs.py

Generates tools/configs/physics-chN.json for chapters that don't already have one.
All physics chapters use the indigo theme. Sidebar groups are auto-generated from
section titles in the extracted text files.
"""

import sys
import os
import re
import json
import io
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

CHAPTER_INFO = {
    1:  ("The Nature of Science and Physics", "intro-physics.html", "🔬"),
    2:  ("Kinematics", "kinematics.html", "🏃"),
    3:  ("Two-Dimensional Kinematics", "2d-kinematics.html", "🎯"),
    4:  ("Dynamics: Force and Newton's Laws", "dynamics.html", "🚀"),
    5:  ("Friction, Drag, and Elasticity", "friction-drag.html", "🧊"),
    6:  ("Circular Motion and Gravitation", "circular-motion.html", "🌍"),
    7:  ("Work, Energy, and Energy Resources", "work-energy.html", "⚡"),
    8:  ("Linear Momentum and Collisions", "momentum.html", "💥"),
    9:  ("Statics and Torque", "statics-torque.html", "⚖️"),
    10: ("Rotational Motion and Angular Momentum", "rotational-motion.html", "🔄"),
    11: ("Fluid Statics", "fluid-statics.html", "💧"),
    12: ("Fluid Dynamics", "fluid-dynamics.html", "🌊"),
    13: ("Temperature, Kinetic Theory, and Gas Laws", "temperature-gas.html", "🌡️"),
    14: ("Heat and Heat Transfer Methods", "heat-transfer.html", "🔥"),
    15: ("Thermodynamics", "thermodynamics.html", "♨️"),
    16: ("Oscillatory Motion and Waves", "waves.html", "〰️"),
    17: ("Physics of Hearing", "hearing.html", "🔊"),
    18: ("Electric Charge and Electric Field", "electric-charge.html", "⚡"),
    19: ("Electric Potential and Electric Field", "electric-potential.html", "🔋"),
    20: ("Electric Current, Resistance, and Ohm's Law", "electric-current.html", "💡"),
    21: ("Circuits, Bioelectricity, and DC Instruments", "circuits.html", "🔌"),
    22: ("Magnetism", "magnetism.html", "🧲"),
    23: ("Electromagnetic Induction, AC Circuits", "em-induction.html", "🔁"),
    24: ("Electromagnetic Waves", "em-waves.html", "📡"),
    25: ("Geometric Optics", "geometric-optics.html", "🔍"),
    26: ("Vision and Optical Instruments", "vision-optics.html", "👁️"),
    27: ("Wave Optics", "wave-optics.html", "🌈"),
    28: ("Special Relativity", "special-relativity.html", "🚄"),
    29: ("Introduction to Quantum Physics", "quantum-physics.html", "⚛️"),
    30: ("Atomic Physics", "atomic-physics.html", "🔵"),
    31: ("Radioactivity and Nuclear Physics", "nuclear-physics.html", "☢️"),
    32: ("Medical Applications of Nuclear Physics", "medical-nuclear.html", "🏥"),
    33: ("Particle Physics", "particle-physics.html", "🔬"),
    34: ("Frontiers of Physics", "frontiers-physics.html", "🌌"),
}

# Sidebar group templates by chapter range (topic clusters)
SIDEBAR_GROUPS = {
    1:  {"Introduction": ["1.0", "1.1"], "Measurement": ["1.2", "1.3"], "Estimation": ["1.4"]},
}


def auto_sidebar_groups(ch_num, extracted_path):
    """Auto-generate sidebar groups from section titles in extracted text."""
    if not extracted_path.exists():
        return {}

    with open(extracted_path, 'r', encoding='utf-8') as f:
        text = f.read()

    sections = re.findall(r'^=== SECTION ([\d.]+) ===\n.*?TITLE:\s*(.+)', text, re.MULTILINE)
    if not sections:
        return {}

    # Group sections into chunks of 2-3 for sidebar
    groups = {}
    sec_list = []
    for num, title in sections:
        # Clean title
        title = re.sub(r'^[\d.]+:\s*', '', title).strip()
        # Remove "Prelude to..." prefix
        title = re.sub(r'^Prelude to\s+', '', title)
        sec_list.append((num, title))

    if len(sec_list) <= 3:
        # Small chapter — one group
        groups["Content"] = [s[0] for s in sec_list]
    else:
        # Split into groups of 2-3
        chunk_size = 3 if len(sec_list) > 6 else 2
        for i in range(0, len(sec_list), chunk_size):
            chunk = sec_list[i:i + chunk_size]
            # Use first section's short title as group name
            group_name = chunk[0][1]
            # Shorten to ~30 chars
            if len(group_name) > 35:
                group_name = group_name[:32] + '...'
            groups[group_name] = [s[0] for s in chunk]

    return groups


def main():
    project_root = Path(__file__).parent.parent
    configs_dir = project_root / 'tools' / 'configs'
    extracted_dir = project_root / 'physics' / 'extracted'

    print(f"\n{'='*60}")
    print(f"  GENERATING PHYSICS CONFIGS")
    print(f"{'='*60}\n")

    created = 0
    skipped = 0

    for ch_num in range(1, 35):
        config_path = configs_dir / f'physics-ch{ch_num}.json'
        extracted_path = extracted_dir / f'physics-ch{ch_num}-extracted.txt'

        if config_path.exists():
            print(f"  Ch. {ch_num:2d}: SKIP (config exists)")
            skipped += 1
            continue

        title, filename, emoji = CHAPTER_INFO[ch_num]

        # Try to get sidebar groups from extracted text, or use defaults
        if ch_num in SIDEBAR_GROUPS:
            sidebar = SIDEBAR_GROUPS[ch_num]
        else:
            sidebar = auto_sidebar_groups(ch_num, extracted_path)
            if not sidebar:
                sidebar = {"Content": []}  # Placeholder

        config = {
            "chapter": ch_num,
            "title": title,
            "filename": filename,
            "emoji": emoji,
            "accent": "#4f46e5",
            "accent_light": "#6366f1",
            "accent_pale": "#eef2ff",
            "sidebar_groups": sidebar,
        }

        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)

        groups_str = f"{len(sidebar)} groups" if sidebar else "placeholder"
        print(f"  Ch. {ch_num:2d}: CREATED ({groups_str})")
        created += 1

    print(f"\n  Created: {created}, Skipped: {skipped}")
    print(f"{'='*60}\n")


if __name__ == '__main__':
    main()
