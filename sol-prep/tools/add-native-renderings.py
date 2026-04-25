"""
Inject Chart.js configs and HTML-table configs into matching bank entries.

Phase 2: ports the 9 configs already living on unit pages (unit-1, unit-2,
unit-3) into the matching bank entries so practice-test.html renders them
natively.

Running this is idempotent — re-running replaces prior chart/table fields.

Usage:  python build-temp/add-native-renderings.py [--apply]
"""
import json
import sys
from pathlib import Path

BANK_PATH = Path(__file__).resolve().parent.parent / 'question-bank.json'

# Stroke color for all charts; matches navy used on unit pages.
NAVY = '#0f2240'

# ── CHART CONFIGS (Chart.js config objects) ──
CHARTS = {
    '2001-27': {
        'type': 'line',
        'data': {
            'labels': [0, 20, 40, 60, 80, 100],
            'datasets': [
                {'label': 'with amylase', 'data': [0, 20, 38, 48, 54, 58], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.35, 'pointRadius': 0, 'fill': False},
                {'label': 'without amylase', 'data': [0, 5, 13, 19, 23, 25], 'borderColor': NAVY, 'borderWidth': 2.5, 'borderDash': [5, 5], 'tension': 0.35, 'pointRadius': 0, 'fill': False},
            ],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Effect of Amylase Enzyme on Starch Digestion Rate', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': True, 'position': 'top', 'labels': {'boxWidth': 24}},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Time (sec)'}, 'min': 0, 'max': 100},
                'y': {'title': {'display': True, 'text': 'Rate of Digestion (mL/min)'}, 'min': 0, 'max': 70},
            },
        },
    },
    '2003-19': {
        'type': 'line',
        'data': {
            'labels': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
            'datasets': [
                {'label': 'Pepsin', 'data': [5, 30, 70, 62, 30, 5, 0, None, None, None, None, None, None, None, None], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.4, 'pointRadius': 0, 'fill': False, 'spanGaps': False},
                {'label': 'Trypsin', 'data': [None, None, None, None, None, 5, 25, 60, 85, 98, 92, 70, 40, 18, 5], 'borderColor': NAVY, 'borderWidth': 2.5, 'borderDash': [5, 5], 'tension': 0.4, 'pointRadius': 0, 'fill': False, 'spanGaps': False},
            ],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {'legend': {'display': True, 'position': 'top', 'labels': {'boxWidth': 24}}},
            'scales': {
                'x': {'title': {'display': True, 'text': 'pH'}, 'min': 0, 'max': 14},
                'y': {'title': {'display': True, 'text': 'Rate of Enzyme Action'}, 'min': 0, 'max': 110, 'ticks': {'display': False}},
            },
        },
    },
    '2003-32': {
        'type': 'bar',
        'data': {
            'labels': ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'],
            'datasets': [{'label': 'Number of Mice', 'data': [10, 20, 40, 80, None], 'backgroundColor': 'rgba(15,34,64,0.75)', 'borderColor': NAVY, 'borderWidth': 1}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Number of Mice Born by Week', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Week'}},
                'y': {'title': {'display': True, 'text': 'Number of Mice'}, 'min': 0, 'max': 90},
            },
        },
    },
    '2004-29': {
        'type': 'line',
        'data': {
            'labels': [1850, 1855, 1860, 1865, 1870, 1875, 1880, 1885, 1890, 1895, 1900, 1905, 1910, 1915, 1920, 1925],
            'datasets': [
                {'label': 'Snowshoe Hare', 'data': [40, 130, 25, 110, 30, 145, 40, 120, 35, 105, 30, 135, 35, 100, 30, 90], 'yAxisID': 'yH', 'borderColor': NAVY, 'borderWidth': 2.5, 'borderDash': [5, 5], 'tension': 0.4, 'pointRadius': 0, 'fill': False},
                {'label': 'Lynx', 'data': [2, 4, 6, 3, 7, 5, 8, 3, 7, 4, 7, 3, 6, 4, 7, 3], 'yAxisID': 'yL', 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.4, 'pointRadius': 0, 'fill': False},
            ],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Population Fluctuations', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': True, 'position': 'top', 'labels': {'boxWidth': 24}},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Year'}},
                'yH': {'type': 'linear', 'position': 'left', 'title': {'display': True, 'text': 'Thousands of Hares'}, 'min': 0, 'max': 160},
                'yL': {'type': 'linear', 'position': 'right', 'title': {'display': True, 'text': 'Thousands of Lynx'}, 'min': 0, 'max': 9, 'grid': {'drawOnChartArea': False}},
            },
        },
    },
    '2005-7': {
        'type': 'line',
        'data': {
            'labels': [1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002],
            'datasets': [{'label': 'Bluegills', 'data': [90, 80, 85, 135, 130, 145, 170, 120, 110, 95, 100, 125, 135], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.35, 'pointRadius': 3, 'pointBackgroundColor': NAVY, 'fill': False}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Bluegill Population in Farm Pond, 1990\u20132002', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Year'}},
                'y': {'title': {'display': True, 'text': 'Number of bluegills'}, 'min': 0, 'max': 200},
            },
        },
    },
    '2005-37': {
        'type': 'line',
        'data': {
            'labels': [1820, 1825, 1830, 1835, 1840, 1845, 1850, 1855, 1860, 1865, 1870, 1875, 1880, 1885, 1890, 1895, 1900, 1905, 1910, 1915, 1920],
            'datasets': [{'label': 'Sheep Population', 'data': [0.0, 0.3, 0.8, 1.3, 1.6, 1.7, 1.75, 1.7, 1.8, 1.85, 1.75, 1.9, 1.8, 1.75, 1.85, 1.7, 1.8, 1.85, 1.7, 1.75, 1.8], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.3, 'pointRadius': 0, 'fill': False}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Tasmanian Sheep Population', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Year'}},
                'y': {'title': {'display': True, 'text': 'Millions of Sheep'}, 'min': 0, 'max': 2.5},
            },
        },
    },
    # 2001-3: Animal Metabolic Rates — horizontal bar chart, no numeric scale
    # (axis labeled Low -> High). Values are visual estimates on a 0-100 scale.
    '2001-3': {
        'type': 'bar',
        'data': {
            'labels': ['Salamander', 'Rabbit', 'Dog', 'Hibernating Frog', 'Snake', 'Lion', 'Hummingbird'],
            'datasets': [{'label': 'Metabolic Rate', 'data': [15, 50, 65, 5, 25, 55, 85], 'backgroundColor': 'rgba(15,34,64,0.85)', 'borderColor': NAVY, 'borderWidth': 1}],
        },
        'options': {
            'indexAxis': 'y', 'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Animal Metabolic Rates', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Metabolic Rate (Low to High)'}, 'min': 0, 'max': 100, 'ticks': {'display': False}},
                'y': {'title': {'display': False}},
            },
        },
    },
    # 2001-8: Air Pollution Removed from One Region — monthly, multiple pollutants.
    # Peak in October for particulates (answer G). Data approximate from source page 6.
    '2001-8': {
        'type': 'line',
        'data': {
            'labels': ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'],
            'datasets': [
                {'label': 'Ozone', 'data': [40, 50, 70, 120, 180, 230, 250, 220, 190, 130, 70, 40], 'borderColor': NAVY, 'borderWidth': 2, 'tension': 0.35, 'pointRadius': 0, 'fill': False},
                {'label': 'Particulates', 'data': [120, 150, 200, 260, 310, 370, 400, 430, 440, 470, 280, 160], 'borderColor': NAVY, 'borderWidth': 2, 'borderDash': [5, 5], 'tension': 0.35, 'pointRadius': 0, 'fill': False},
                {'label': 'NO2', 'data': [60, 80, 100, 150, 210, 260, 270, 240, 200, 160, 100, 60], 'borderColor': NAVY, 'borderWidth': 2, 'borderDash': [2, 2], 'tension': 0.35, 'pointRadius': 0, 'fill': False},
                {'label': 'SO2', 'data': [30, 40, 60, 90, 130, 160, 170, 150, 130, 90, 50, 30], 'borderColor': NAVY, 'borderWidth': 2, 'borderDash': [8, 4, 2, 4], 'tension': 0.35, 'pointRadius': 0, 'fill': False},
            ],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Air Pollution Removed from One Region', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': True, 'position': 'top', 'labels': {'boxWidth': 20}},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Month'}},
                'y': {'title': {'display': True, 'text': 'Amount of Pollution Removed (Metric Tons)'}, 'min': 0, 'max': 500},
            },
        },
    },
    # 2001-26: O2 and CO2 Levels in a Pond over 24h — conceptual crossover curves.
    # No numeric scale on original; we use arbitrary 0-100 concentration units.
    '2001-26': {
        'type': 'line',
        'data': {
            'labels': ['0h', '3h', '6h', '9h', '12h', '15h', '18h', '21h', '24h'],
            'datasets': [
                {'label': 'O\u2082', 'data': [85, 75, 60, 40, 25, 35, 55, 75, 85], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.45, 'pointRadius': 0, 'fill': False},
                {'label': 'CO\u2082', 'data': [15, 25, 40, 60, 75, 65, 45, 25, 15], 'borderColor': NAVY, 'borderWidth': 2.5, 'borderDash': [5, 5], 'tension': 0.45, 'pointRadius': 0, 'fill': False},
            ],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'O\u2082 and CO\u2082 Levels in a Pond', 'font': {'size': 13, 'weight': 'bold'}},
                'subtitle': {'display': True, 'text': 'Night  \u2014  Day  \u2014  Night', 'font': {'size': 11, 'style': 'italic'}},
                'legend': {'display': True, 'position': 'top', 'labels': {'boxWidth': 20}},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Time (24-hour period)'}},
                'y': {'title': {'display': True, 'text': 'Concentration of Gases'}, 'min': 0, 'max': 100, 'ticks': {'display': False}},
            },
        },
    },
    # 2001-47: Active Periods of Some Black Beetles — bimodal activity.
    # Peaks around 8-9 AM (~17 beetles) and 6-8 PM (~40 beetles). Answer B coolest with some sunlight.
    '2001-47': {
        'type': 'line',
        'data': {
            'labels': ['6 A.M.', '7', '8', '9', '10', 'NOON', '1', '2', '3', '4', '5', '6 P.M.', '7', '8', '9', '10'],
            'datasets': [{'label': 'Number of Active Beetles', 'data': [0, 2, 17, 12, 2, 0, 0, 0, 0, 0, 5, 28, 40, 38, 12, 2], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.4, 'pointRadius': 0, 'fill': False}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Active Periods of Some Black Beetles', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Time'}},
                'y': {'title': {'display': True, 'text': 'Number of Active Beetles'}, 'min': 0, 'max': 45},
            },
        },
    },
    # 2002-48: Deer Population — classic logistic/S-curve reaching carrying capacity ~70.
    '2002-48': {
        'type': 'line',
        'data': {
            'labels': [0, 1, 2, 3, 4, 5, 6, 7],
            'datasets': [{'label': 'Deer Population', 'data': [2, 8, 25, 50, 65, 70, 70, 70], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.4, 'pointRadius': 0, 'fill': False}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {'legend': {'display': False}},
            'scales': {
                'x': {'title': {'display': True, 'text': 'Time (in years)'}},
                'y': {'title': {'display': True, 'text': 'Deer Population (in number of individuals)'}, 'min': 0, 'max': 80},
            },
        },
    },
    # 2003-25: Cardinal Population Within a State Park — exponential growth curve.
    # Answer D: food supply increased (because population is accelerating).
    '2003-25': {
        'type': 'line',
        'data': {
            'labels': [0, 1, 2, 3, 4, 5, 6, 7, 8],
            'datasets': [{'label': 'Cardinal Population', 'data': [20, 22, 25, 30, 38, 50, 68, 95, 140], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.4, 'pointRadius': 0, 'fill': False}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Cardinal Population Within a State Park', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Time (years)'}, 'ticks': {'display': False}},
                'y': {'title': {'display': True, 'text': 'Population (number of cardinals)'}, 'ticks': {'display': False}},
            },
        },
    },
    # 2006-1: Mass of Fungi Grown in Forest Leaf Litter — 4 labeled data points, #2 is
    # the invalid point (sudden dip at day 6 breaks a consistent rising trend).
    '2006-1': {
        'type': 'line',
        'data': {
            'labels': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            'datasets': [{'label': 'Mass of Fungi (g)', 'data': [30, 50, 70, 110, 150, 200, 130, 230, 240, 270, 300, 430, 440, 440, 450, 450, 460], 'borderColor': NAVY, 'borderWidth': 2, 'tension': 0.15, 'pointRadius': 4, 'pointBackgroundColor': NAVY, 'fill': False}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Mass of Fungi Grown in Forest Leaf Litter', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Days'}},
                'y': {'title': {'display': True, 'text': 'Mass of Fungi (g)'}, 'min': 0, 'max': 500},
            },
        },
    },
    # 2007-46: Ladybug and Red Mite Populations over days in June. Predator-prey
    # oscillation: mites peak, ladybugs lag 1-2 days, mites crash as ladybugs rise.
    '2007-46': {
        'type': 'line',
        'data': {
            'labels': [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29],
            'datasets': [
                {'label': 'Red Mites', 'data': [40, 80, 120, 90, 50, 30, 60, 110, 80, 40, 30, 70, 100, 70, 40], 'borderColor': NAVY, 'borderWidth': 2, 'borderDash': [5, 5], 'tension': 0.45, 'pointRadius': 0, 'fill': False},
                {'label': 'Ladybugs', 'data': [10, 12, 25, 45, 60, 50, 30, 25, 40, 55, 45, 30, 25, 40, 50], 'borderColor': NAVY, 'borderWidth': 2, 'tension': 0.45, 'pointRadius': 0, 'fill': False},
            ],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Ladybug and Red Mite Populations (June)', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': True, 'position': 'top', 'labels': {'boxWidth': 20}},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Day in June'}},
                'y': {'title': {'display': True, 'text': 'Population'}, 'min': 0, 'max': 130},
            },
        },
    },
    # 2015-3: J-shaped population growth curve (exponential). Question asks what must
    # occur for growth to continue — unlimited resources / no limiting factors.
    '2015-3': {
        'type': 'line',
        'data': {
            'labels': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            'datasets': [{'label': 'Population', 'data': [5, 7, 10, 14, 20, 30, 48, 80, 130, 220, 380], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.4, 'pointRadius': 0, 'fill': False}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Population Growth (J-curve)', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Time'}, 'ticks': {'display': False}},
                'y': {'title': {'display': True, 'text': 'Population Size'}, 'ticks': {'display': False}},
            },
        },
    },
    # 2015-10: Golden-cheeked Warbler and Juniper Tree populations at 15, 10, 5 years.
    # Both declining together — showing the warbler depends on juniper habitat.
    '2015-10': {
        'type': 'bar',
        'data': {
            'labels': ['15 years ago', '10 years ago', '5 years ago'],
            'datasets': [
                {'label': 'Golden-Cheeked Warbler', 'data': [75, 55, 30], 'backgroundColor': 'rgba(15,34,64,0.85)', 'borderColor': NAVY, 'borderWidth': 1},
                {'label': 'Juniper Trees', 'data': [90, 65, 40], 'backgroundColor': 'rgba(15,34,64,0.35)', 'borderColor': NAVY, 'borderWidth': 1},
            ],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Warbler and Juniper Tree Populations', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': True, 'position': 'top', 'labels': {'boxWidth': 20}},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Time Period'}},
                'y': {'title': {'display': True, 'text': 'Population (relative units)'}, 'min': 0, 'max': 100},
            },
        },
    },
    # 2015-13: Energy of reaction with vs without enzyme. Shows activation-energy hump,
    # lower with enzyme. Both curves start and end at same energies (enzymes don't
    # change reactants/products — only the path).
    '2015-13': {
        'type': 'line',
        'data': {
            'labels': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
            'datasets': [
                {'label': 'Without enzyme', 'data': [60, 72, 88, 100, 108, 95, 78, 60, 45, 35, 30], 'borderColor': NAVY, 'borderWidth': 2.5, 'borderDash': [5, 5], 'tension': 0.4, 'pointRadius': 0, 'fill': False},
                {'label': 'With enzyme', 'data': [60, 65, 72, 78, 70, 60, 48, 42, 38, 33, 30], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.4, 'pointRadius': 0, 'fill': False},
            ],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Reaction Energy With vs Without Enzyme', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': True, 'position': 'top', 'labels': {'boxWidth': 20}},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Reaction Progress'}, 'ticks': {'display': False}},
                'y': {'title': {'display': True, 'text': 'Energy'}, 'min': 0, 'max': 120, 'ticks': {'display': False}},
            },
        },
    },
    # 2004-10: Turkey Growth Data — weight gain vs % vitamin supplement.
    # Bell-ish curve peaking around x=10 (slight dip 11, second bump 14),
    # then declining. Question asks optimal supplement %.
    '2004-10': {
        'type': 'line',
        'data': {
            'labels': [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
            'datasets': [{'label': 'Average Weight Gain', 'data': [5, 10, 18, 30, 48, 35, 42, 38, 36, 33, 28, 22], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.35, 'pointRadius': 0, 'fill': False}],
        },
        'options': {
            'responsive': True, 'maintainAspectRatio': False,
            'plugins': {
                'title': {'display': True, 'text': 'Turkey Growth Data', 'font': {'size': 13, 'weight': 'bold'}},
                'legend': {'display': False},
            },
            'scales': {
                'x': {'title': {'display': True, 'text': 'Percent of Vitamin Supplement'}},
                'y': {'title': {'display': True, 'text': 'Average Weight Gain'}, 'ticks': {'display': False}},
            },
        },
    },
    # Review-N duplicates that match released-exam graphs. Use same configs as the
    # SOL entries so students see identical Chart.js whether random drill pulls
    # from the SOL id or the review duplicate id.
    # Mapped below via CHART_ALIASES.
}

# ── CHART ALIASES ──
# Some review-N entries duplicate SOL questions and should reuse the same config.
# Key = alias ID, value = canonical chart ID to copy from.
CHART_ALIASES = {
    'review-36': '2003-32',   # mice bar chart
    'review-38': '2003-19',   # pepsin/trypsin pH
    'review-39': '2005-37',   # Tasmanian sheep
    # review-37 describes a generic "population leveling off" S-curve.
    # (review-328 was a duplicate of review-37 in the old buggy bank;
    # consolidated into review-37 during the 2026-04-25 review re-extraction.)
}
# Generic S-curve for "population leveling off" questions.
GENERIC_S_CURVE = {
    'type': 'line',
    'data': {
        'labels': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        'datasets': [{'label': 'Population', 'data': [5, 8, 15, 30, 55, 80, 95, 100, 102, 102, 102], 'borderColor': NAVY, 'borderWidth': 2.5, 'tension': 0.4, 'pointRadius': 0, 'fill': False}],
    },
    'options': {
        'responsive': True, 'maintainAspectRatio': False,
        'plugins': {
            'title': {'display': True, 'text': 'Population Growth Leveling Off', 'font': {'size': 13, 'weight': 'bold'}},
            'legend': {'display': False},
        },
        'scales': {
            'x': {'title': {'display': True, 'text': 'Time'}, 'ticks': {'display': False}},
            'y': {'title': {'display': True, 'text': 'Population Size'}, 'ticks': {'display': False}},
        },
    },
}
CHARTS['review-37'] = GENERIC_S_CURVE

# ── HTML TABLE CONFIGS ──
TABLES = {
    '2006-32': {
        'title': 'Bird Sightings at Willow Point',
        'headers': ['Date', '# Sparrows', '# Wrens', '# Jays'],
        'rows': [
            ['May 12', '43', '12', '10'],
            ['May 13', '54', '13', '8'],
            ['May 14', '44', '11', '13'],
            ['May 15', '52', '14', '9'],
            ['May 16', '47', '10', '10'],
        ],
    },
    '2002-16': {
        'title': 'Effects of Ultraviolet Light on Wheat Crop Production',
        'headers': ['Experimental Plot (4m \u00d7 15m)', 'Wavelength (nm)', 'Wave Intensity (Joules/m\u00b2)', 'Crop Yield (g/m\u00b2)'],
        'rows': [
            ['A', '357.6', '0', '110'],
            ['B', '357.6', '8', '110'],
            ['C', '357.6', '20', '30'],
            ['D', '357.6', '25', '20'],
        ],
    },
    '2001-17': {
        'title': 'Cell Organelles and Functions',
        'headers': ['Kingdom', 'Metabolism', 'Control', 'Covering', 'Food Production'],
        'rows': [
            ['Fungi', 'mitochondria', 'nucleus', 'cell wall', 'none'],
            ['Animalia', 'mitochondria', 'nucleus', 'cell membrane', 'none'],
            ['Plantae', 'mitochondria', 'nucleus', 'cell wall', 'chloroplasts'],
            ['Protista', 'mitochondria', 'nucleus', 'cell membrane', 'some with chloroplasts'],
            ['Monera', 'ribosomes', 'DNA strand', 'cell wall', 'none'],
        ],
    },
    # 2005-24: Structures Present in Vertebrate Embryos.
    '2005-24': {
        'title': 'Structures Present in Vertebrate Embryos',
        'headers': ['Stage', 'Structure', 'Frog', 'Fish', 'Pig', 'Bird', 'Turtle', 'Human'],
        'rows': [
            ['early', 'tail', '\u2713', '\u2713', '\u2713', '\u2713', '\u2713', '\u2713'],
            ['early', 'gill slits', '\u2713', '\u2713', '\u2713', '\u2713', '\u2713', '\u2713'],
            ['early', 'notochord', '\u2713', '\u2713', '\u2713', '\u2713', '\u2713', '\u2713'],
            ['late', 'external ears', '', '', '\u2713', '', '', '\u2713'],
            ['late', 'limbs', '\u2713', '', '\u2713', '\u2713', '\u2713', '\u2713'],
        ],
    },
    # 2007-9: Island Species Distribution (originally misclassified as a bar graph in
    # the audit; source image shows a data table, not a graph).
    '2007-9': {
        'title': 'Island Species Distribution',
        'headers': ['Island', 'Number of species common to mainland and island', 'Number of species unique to island'],
        'rows': [
            ['1', '82', '2'],
            ['2', '16', '84'],
            ['3', '4', '98'],
            ['4', '53', '11'],
        ],
    },
    # 2005-31: Flower Characteristics.
    '2005-31': {
        'title': 'Flower Characteristics',
        'headers': ['Characteristics', 'Insect-Pollinated Plants', 'Wind- or Water-Pollinated Plants'],
        'rows': [
            ['Appearance', 'often colorful', 'plain'],
            ['Reproductive parts', 'sometimes hidden', 'exposed'],
        ],
    },
    # 2005-44: Field Data (duckweed pH study).
    '2005-44': {
        'title': 'Field Data',
        'headers': ['Pond', 'pH of Pond Water', 'Number of Duckweed Plants'],
        'rows': [
            ['A', '6', '150'],
            ['B', '12', '300'],
            ['C', '8', '500'],
            ['D', '4', '80'],
        ],
    },
    # 2006-14: Heart Chambers in Different Animals.
    '2006-14': {
        'title': 'Heart Chambers in Different Animals',
        'headers': ['', 'Fish', 'Bird', 'Turtle', 'Frog', 'Dog'],
        'rows': [
            ['Number of atria', '1', '2', '2', '2', '2'],
            ['Number of ventricles', '1', '2', '2', '1', '2'],
            ['Separation of ventricles', '\u2014', 'Total', 'Partial', '\u2014', 'Total'],
        ],
    },
    # 2006-39: Representative Animals from a Local Ecosystem.
    '2006-39': {
        'title': 'Representative Animals from a Local Ecosystem',
        'headers': ['Type of Organism', 'Number of Individual Species Collected'],
        'rows': [
            ['Grasses', '11'],
            ['Trees', '1'],
            ['Fish', '16'],
            ['Amphibians', '12'],
            ['Reptiles', '8'],
            ['Mammals', '3'],
        ],
    },
    # 2007-17: Amino-Acid Differences Compared with Human Hemoglobin.
    '2007-17': {
        'title': 'Amino-Acid Differences Compared with Human Hemoglobin',
        'headers': ['Species', 'Number of amino-acid differences'],
        'rows': [
            ['Lamprey', '125'],
            ['Frog', '67'],
            ['Dog', '32'],
            ['Macaque', '8'],
        ],
    },
    # 2001-33: Photosynthesis vs Respiration comparison.
    '2001-33': {
        'title': 'Comparison of Photosynthesis and Respiration',
        'headers': ['', 'Photosynthesis', 'Respiration'],
        'rows': [
            ['Raw Materials', 'water and CO\u2082', 'glucose and oxygen'],
            ['Products', 'glucose and oxygen', 'water and CO\u2082'],
            ['Purpose', 'store energy', 'release energy'],
        ],
    },
    # 2002-32: Experimental Results (bean plants + fertilizers).
    '2002-32': {
        'title': 'Experimental Results',
        'headers': ['Fertilizer', 'Plant 1', 'Plant 2'],
        'rows': [
            ['1', '10 mm', '8 mm'],
            ['2', '6 mm', '3 mm'],
            ['3', '13 mm', '10 mm'],
            ['4', '9 mm', '4 mm'],
        ],
    },
    # 2003-15: Test Paper Results — Chart A (pH calibration) + Chart B (substance
    # results). Using two rows merged with a section header convention.
    '2003-15': {
        'title': 'Test Paper Results \u2014 Chart A (calibration) & Chart B (substances)',
        'headers': ['Row', 'Red Litmus', 'Blue Litmus', 'pH Paper'],
        'rows': [
            ['Chart A: Acid pH 2', 'red', 'red', 'red'],
            ['Chart A: Acid pH 4', 'red', 'red', 'orange'],
            ['Chart A: Acid pH 6', 'red', 'red', 'yellow'],
            ['Chart A: Base pH 8', 'blue', 'blue', 'green'],
            ['Chart A: Base pH 10', 'blue', 'blue', 'blue'],
            ['Chart B: Water', 'red', 'blue', 'yellow-green'],
            ['Chart B: Apples', 'red', 'red', 'red-orange'],
            ['Chart B: Beans', 'red', 'red', 'yellow'],
            ['Chart B: Milk', 'red', 'blue', 'yellow'],
        ],
    },
    # 2003-23: Planaria stimulus responses.
    '2003-23': {
        'title': 'Planaria Responses to Stimuli',
        'headers': ['Stimuli', 'Movements Toward', 'Movements Away From', 'No Response'],
        'rows': [
            ['light', '0', '10', '0'],
            ['sound', '5', '4', '1'],
            ['magnetism', '4', '4', '2'],
            ['gravity', '7', '2', '1'],
        ],
    },
    # 2004-26: Sandy Beach and Dune Wildlife Locator Chart (feeds x nests).
    '2004-26': {
        'title': 'Sandy Beach and Dune Wildlife Locator Chart',
        'headers': ['Species', 'Feeds in Dunes', 'Feeds on Wet Sand or Beach', 'Feeds at High-tide Mark', 'Nests in Tree Canopy or Shrubs'],
        'rows': [
            ['Yellow-billed Cuckoo', '', '', '', '\u2713'],
            ['American Robin', '\u2713', '', '', '\u2713'],
            ['Cedar Waxwing', '', '', '', '\u2713'],
            ['Fish Crow', '', '\u2713', '\u2713', '\u2713'],
        ],
    },
    # 2004-50: Plant Growth Conditions.
    '2004-50': {
        'title': 'Plant Growth Conditions',
        'headers': ['Seedlings', 'Water (mL/week)', 'Temp (\u00b0C)', 'Daylight Hours', 'Relative Humidity', 'Avg New Leaves / Week'],
        'rows': [
            ['50', '50', '19', '12', '85', '4'],
            ['50', '50', '20', '12', '85', '8'],
            ['50', '50', '21', '12', '85', '10'],
            ['50', '50', '22', '12', '85', '5'],
        ],
    },
    # 2005-15: Flea shampoo brand comparison (Brand X/Y/Z, before/after for 4 sets).
    # The source image shows 4 data sets labeled A, B, C, D; each compares number
    # of dogs with fleas before/after using each brand.
    '2005-15': {
        'title': 'Flea Shampoo Effectiveness \u2014 Number of Dogs With Fleas',
        'headers': ['Set', 'Brand X Before', 'Brand X After', 'Brand Y Before', 'Brand Y After', 'Brand Z Before', 'Brand Z After'],
        'rows': [
            ['A', '25', '4', '25', '1', '25', '10'],
            ['B', '25', '2', '25', '12', '25', '5'],
            ['C', '25', '10', '25', '4', '25', '12'],
            ['D', '25', '15', '25', '18', '25', '20'],
        ],
    },
    # 2005-35: DNA Base Sequence Comparison (3 primates, 7 codons).
    '2005-35': {
        'title': 'DNA Base Sequence Comparison',
        'headers': ['Species', '1', '2', '3', '4', '5', '6', '7'],
        'rows': [
            ['Human', 'AGG', 'CAT', 'AAA', 'CCA', 'ACG', 'GAT', 'TAA'],
            ['Chimpanzee', 'AGG', 'CCC', 'CTT', 'CCA', 'ACC', 'GAT', 'TAA'],
            ['Gorilla', 'AGG', 'CCC', 'TTT', 'CCA', 'ACC', 'AGG', 'CCA'],
        ],
    },
    # 2015-44: Length of Elodea Stems. Question asks which trial has
    # questionable data. Source page is "46 of 46" in BiologySOL2015.pdf
    # (page 49 of the PDF) — bank's "2015-44" ID does not match VDOE
    # sequence numbering, but its stem/answer/std are internally
    # consistent. Trial Z jumps 4->7->17->13, breaking monotonic growth.
    '2015-44': {
        'title': 'Length of Elodea Stems (cm)',
        'headers': ['Trial', 'Day 1', 'Day 8', 'Day 15', 'Day 22'],
        'rows': [
            ['W', '3', '6', '10', '14'],
            ['X', '5', '7', '10', '14'],
            ['Y', '2', '4', '9',  '12'],
            ['Z', '4', '7', '17', '13'],
        ],
    },
}


def main(apply: bool) -> None:
    bank = json.loads(BANK_PATH.read_text(encoding='utf-8'))
    by_id = {q['id']: q for q in bank}

    # Resolve aliases — use the canonical chart config from the alias target.
    for alias, canonical in CHART_ALIASES.items():
        if canonical in CHARTS:
            CHARTS[alias] = CHARTS[canonical]

    applied_charts = []
    applied_tables = []
    missing = []

    for qid, cfg in CHARTS.items():
        if qid not in by_id:
            missing.append(qid)
            continue
        if apply:
            by_id[qid]['chart'] = cfg
        applied_charts.append(qid)

    for qid, cfg in TABLES.items():
        if qid not in by_id:
            missing.append(qid)
            continue
        if apply:
            by_id[qid]['table'] = cfg
        applied_tables.append(qid)

    print(f'Charts to add:  {len(applied_charts)} -> {applied_charts}')
    print(f'Tables to add:  {len(applied_tables)} -> {applied_tables}')
    if missing:
        print(f'MISSING (id not in bank): {missing}')

    if not apply:
        print('\n(preview only; pass --apply to write bank)')
        return

    with BANK_PATH.open('w', encoding='utf-8') as f:
        json.dump(bank, f, indent=2, ensure_ascii=False)
        f.write('\n')
    print(f'\nWrote {len(bank)} entries to {BANK_PATH.name}')


if __name__ == '__main__':
    main('--apply' in sys.argv)
