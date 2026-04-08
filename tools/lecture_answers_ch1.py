"""
Answer key for Campbell Biology Ch. 1 lecture slides.
Maps detected underscore blanks to their answers.

Each page: list of answer strings in order (top-to-bottom, left-to-right).
The scanner detects blanks in that same order, so answers[i] matches blank[i].

Use None to skip a detected blank that isn't a real fill-in (e.g., decorative lines).
"""

ANSWERS = {
    1: [
        'Biology',          # ___: the scientific study of life
        'bio',              # Prefix "___" means
        'life',             # means ___
        'ology',            # Suffix "___"
        'small',            # too ___ for our eyes
        'Cell',             # ___: the smallest unit
        'Organism',         # ___: any individual form
        None,               # decorative line in "bio"/"ology" box
        None,               # decorative line in "bio"/"ology" box
        None,               # decorative line under images
        'uni',              # ___ cellular or
        'multi',            # ___ cellular
        'single',           # consist of a ___ cell
        'many / multiple',  # consist of ___ cells
        None,               # ___ cellular Organism (left diagram label)
        None,               # ___ cellular Organism (right diagram label)
        None,               # decorative underline
        None,               # decorative underline
        'either uni- or multi',  # All living organisms are ___
    ],
    2: [
        'eight',            # share ___ characteristics
        'Reproduction',     # Box 5: ___: capacity to produce life
        'cells',            # Box 1: Composed of ___
        'Organization',     # Box 2: ___: use smaller structures
        'energy',           # Box 6: Acquires & utilizes ___
        'Genetic',          # Box 7: ___ information
        'stimuli',          # Box 3: Respond to environmental ___
        'Evolution',        # Box 8: ___: changes in
        'DNA',              # Box 8: changes in ___ over time
        'homeostasis',      # Box 4: Maintain ___
        'Viruses',          # NOTE: ___ are NOT considered alive
    ],
    3: [
        'atoms',            # composed of ___
        'biosphere',        # largest scale is the ___
        'Molecules',        # (table label row 2)
        'structures',       # Specialized ___ within cells
        'Cells',            # (table label row 4)
        'cells',            # Group of ___ performing
        'tissues',          # Group of ___ that perform
        'Organs',           # (table label row 6)
        'organs',           # Group of ___ working together
        'Organism',         # (table label row 8)
        'same',             # All organisms of the ___ species
        'different',        # Multiple populations of ___ species
        'Community',        # (table label row 10)
        'nonliving',        # the ___ surroundings
        'Biosphere',        # (table label row 12)
        None,               # hierarchy diagram 2)?
        None,               # hierarchy diagram - decorative
    ],
    4: [
        None,               # word bank box border
        None,               # word bank box border
        None,               # word bank box border
        None,               # word bank box border
        None,               # word bank box border
        None,               # word bank box border
        None,               # pyramid decorative line
        'arise',            # properties that ___ upon combining
        'greater',          # the whole is ___ than the sum
        None,               # decorative
        None,               # decorative
        None,               # emergent properties diagram
        None,               # decorative
        None,               # decorative
    ],
    5: [],  # No blanks
    6: [
        None,               # header decorative line
        'adaptation',       # well suited due to ___
        'improve',          # enables organisms to ___ survival
        'Fitness',          # ___: ability to
        'survive',          # ability to ___ &
        'reproduce',        # & ___
        None,               # decorative (giraffe diagram border)
        None,               # decorative (giraffe diagram border)
        None,               # decorative line
        None,               # Natural ___ (detected blank is wrong - use manual)
        'selects',          # environment ___ for organisms
        'fit',              # organisms that are more "___"
        'fittest',          # Survival of the ___
        'two',              # ___ requirements
        'variation',        # 1) Genetic ___
        'pressure',         # 2) Selective ___
        None,               # Genetic ___ in giraffes (diagram - use manual)
        None,               # decorative
        None,               # decorative
        None,               # decorative
        None,               # decorative
        None,               # decorative
        None,               # decorative
    ],
    # Manual overrides for blanks inside images (not detected by scanner)
    '6_manual': [
        # Natural ___ in text (Adaptation is a result of Natural ___) — from calibrator
        (515, 617, 'Selection', 18),
        # Natural ___ above giraffe diagram — from calibrator
        (591, 828, 'Selection', 18),
        # Genetic ___ in giraffes (bottom of diagram) — from calibrator
        (189, 1211, 'variation', 18),
    ],
    '7_manual': [
        (198, 953, 'Green', 18),
        (935, 954, 'Brown', 18),
    ],
    7: [
        'DNA',              # changes in the ___ of a population
        'number',           # can occur in a ___ of ways
        'diversity',        # responsible for life's ___
        None,               # cricket diagram - Mostly ___ crickets (table header)
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # cricket diagram
        None,               # decorative
        None,               # decorative
    ],
    '8_manual': [
        (831, 1170, 'Uni', 18),
        (825, 1328, 'Single', 18),
        (819, 1368, 'Multi', 18),
    ],
    8: [
        'Taxonomy',         # ___: the branch of science
        'Eight',            # ___ categories
        'Most',             # ___ Inclusive (left)
        'Least',            # ___ Inclusive (right)
        None,               # mnemonic letter
        None,               # mnemonic letter
        None,               # mnemonic letter
        None,               # mnemonic letter
        None,               # mnemonic letter
        None,               # mnemonic letter
        None,               # mnemonic letter
        None,               # mnemonic letter
        None,               # decorative line
        'Bacteria',         # 1) ___
        'prokaryotic',      # Consist of ___ cells
        'lack',             # (___ a nucleus)
        'Archaea',          # 2) ___
        'Eukarya',          # 3) ___
        'eukaryotic',       # Consist of ___ cells
        None,               # domain tree diagram
        None,               # domain tree diagram
        None,               # domain tree diagram
        None,               # domain tree diagram
        None,               # domain tree diagram
        None,               # domain tree diagram
        None,               # Prokaryotes label
        'Uni',              # ___-cellular organisms
        None,               # decorative
        None,               # decorative
        None,               # decorative
        None,               # decorative
        None,               # decorative
        None,               # Eukaryotes label
        None,               # decorative
        None,               # decorative
    ],
    # Page 9: ALL manual — auto-detected blanks are question blanks, not teaching blanks
    '9_manual': [
        (639, 492, 'kingdoms', 18),
        (390, 534, '4', 18),
        (726, 653, 'Fungi', 18),
        (882, 785, 'Unicellular', 18),
        (225, 818, 'Multi', 18),
    ],
    9: [
        None, None, None, None, None, None, None,
        None, None, None, None, None, None, None,
    ],
    10: [
        'three',            # ___ classes based on energy
        'Producers',        # 1) ___ (___trophs)
        'Auto',             # (___trophs)
        'Consumers',        # 2) ___
        'Hetero',           # (___trophs)
        'Decomposers',      # 3) ___
        'sun',              # Most energy from the ___
        'heat',             # some energy lost as ___
        None,               # energy diagram label
        None,               # energy diagram label
        None,               # energy diagram label
        None,               # decorative
        None,               # decorative
    ],
    # Page 11: ALL manual — auto-detection misaligned answers
    '11_manual': [
        (840, 248, 'Scientific', 18),
        (452, 290, 'investigate', 18),
        (692, 288, 'test', 18),
        (872, 288, 'build', 18),
        (434, 648, 'data', 18),
        (887, 648, 'hypothesis', 18),
        (687, 764, 'experiments', 18),
        (107, 948, 'Predictions', 18),
        (545, 990, 'what', 18),
        (123, 1029, 'Hypothesis', 18),
        (720, 1073, 'why', 18),
        (453, 1113, 'includes', 18),
        (123, 1151, 'Theory', 18),
        (392, 1154, 'broad', 18),
    ],
    11: [
        None, None, None, None, None, None, None,
        None, None, None, None, None, None, None,
        None, None, None, None, None, None, None,
        None, None, None, None, None, None, None,
        None, None, None, None, None, None,
    ],
    12: [
        None,               # header decorative line
        'Prediction',       # label: ___
        'Hypothesis',       # label: ___
        'Theory',           # label: ___
        None,               # theories table decorative
        'three',            # ___ basic theories
        'Cell Theory',      # 1) ___
        'Homeostasis',      # 2) ___
        'Evolution',        # 3) ___
    ],
    '13_manual': [
        (144, 485, 'Independent', 18),
        (504, 486, 'changed', 18),
        (149, 543, 'Dependent', 18),
        (497, 540, 'measured', 18),
    ],
    13: [
        None,               # header decorative line
        None,               # Variables header decorative
        'Experiment',       # ___: a scientific investigation
        'Variable',         # ___: a changeable element
        'two',              # ___ main types of variables
        None,               # variable table (use manual)
        None,               # variable table (use manual)
        None,               # variable table (use manual)
        None,               # paper airplane IV/DV
    ],
    # Page 14: ALL manual — auto-detection misaligned
    '14_manual': [
        (413, 534, 'control', 18),
        (237, 576, 'positives', 18),
        (728, 576, 'presence', 18),
        (248, 662, 'negatives', 18),
        (740, 659, 'absence', 18),
        (107, 824, 'Two', 18),
        (807, 866, 'one', 18),
        (143, 980, 'Negative', 18),
        (530, 980, 'no', 18),
        (149, 1032, 'Positive', 18),
    ],
    14: [
        None, None, None, None, None, None, None, None, None,
        None, None, None, None, None, None, None, None, None,
    ],
    15: [
        None,               # header decorative
        '1',                # Negative Control ___
        '3',                # Positive Control ___
        '4',                # False Positive ___
        '2',                # False Negative ___
    ],
}
