"""
Answer map for Campbell Biology Ch. 1 — maps each blank to its answer.
Coordinates are in 2x PDF pixels (1224x1584 image).

Each page entry: list of (x, y, w, h, answer_text, font_size)
x,y = top-left of blank in 2x pixels
w,h = width/height of answer overlay
"""

ANSWERS = {
    1: [
        # "___: the scientific study of life"
        (86, 193, 164, 28, 'Biology', 11),
        # Prefix "___" means ___
        (226, 234, 66, 28, 'bio', 11),
        (390, 234, 98, 28, 'life', 11),
        # Suffix "___" means
        (657, 234, 98, 28, 'ology', 11),
        # most life is too ___ for our eyes
        (857, 275, 99, 28, 'small', 11),
        # ___: the smallest, most basic unit
        (164, 316, 98, 28, 'Cell', 11),
        # ___: any individual form of life
        (164, 358, 197, 28, 'Organism', 11),
        # ___ cellular or ___ cellular
        (359, 895, 66, 28, 'uni', 10),
        (526, 895, 99, 28, 'multi', 10),
        # consist of a ___ cell
        (614, 936, 131, 28, 'single', 10),
        # consist of ___ cells
        (609, 977, 197, 28, 'many / multiple', 9),
        # All living organisms are ___
        (392, 1391, 160, 28, 'either uni- or multi', 8),
    ],
    2: [
        # share ___ characteristics
        (315, 193, 66, 28, 'eight', 11),
        # 1) Composed of ___
        (289, 234, 98, 28, 'cells', 11),
        # 2) ___ (use smaller structures)
        (167, 275, 230, 28, 'Organization', 10),
        # 3) Respond to environmental ___
        (402, 316, 164, 28, 'stimuli', 10),
        # 4) Maintain ___
        (247, 358, 230, 28, 'homeostasis', 10),
        # 5) ___ (sexually or asexually)
        (167, 399, 230, 28, 'Reproduction', 10),
        # 6) A dynamic ___ (sum of chemical reactions)
        (264, 440, 164, 28, 'metabolism', 10),
        # relies on environmentally acquired ___
        (1022, 440, 98, 28, 'energy', 10),
        # 7) ___ information
        (167, 482, 164, 28, 'Genetic', 10),
        # 8) ___ (changes in DNA)
        (167, 523, 197, 28, 'Evolution', 10),
        # NOTE: ___ are NOT considered alive
        (230, 647, 131, 28, 'Viruses', 11),
    ],
    3: [
        # composed of ___
        (549, 234, 98, 28, 'atoms', 11),
        # largest scale is the ___
        (931, 234, 131, 28, 'biosphere', 10),
        # Note: The hierarchy labels in the table are images, not text blanks
        # We add them as overlays on the table rows
        # Molecules (row 2 label)
        (120, 366, 140, 26, 'Molecules', 10),
        # Organelles: Specialized ___ within cells
        (620, 410, 130, 24, 'structures', 9),
        # Cells (row 4 label)
        (120, 454, 110, 26, 'Cells', 10),
        # Tissues: Group of ___ performing
        (570, 496, 80, 24, 'cells', 9),
        # Organs (row 6 label)
        (120, 540, 110, 26, 'Organs', 10),
        # Group of ___ that perform
        (574, 542, 90, 24, 'tissues', 9),
        # Organ System: Group of ___ working together
        (574, 586, 90, 24, 'organs', 9),
        # Organism (row 8 label)
        (120, 632, 120, 26, 'Organism', 10),
        # All organisms of the ___ species
        (612, 672, 80, 24, 'same', 9),
        # Community (row 10 label)
        (120, 720, 130, 26, 'Community', 10),
        # Multiple populations of ___ species
        (566, 720, 120, 24, 'different', 9),
        # Ecosystem: Living community & the ___ surroundings
        (660, 764, 120, 24, 'nonliving', 9),
        # Biosphere (row 12 label)
        (120, 808, 130, 26, 'Biosphere', 10),
    ],
    4: [
        # properties that ___ upon combining
        (407, 1019, 99, 28, 'arise', 11),
        # the whole is ___ than the sum
        (580, 1060, 131, 28, 'greater', 11),
    ],
    5: [
        # No blanks — practice questions only
    ],
    6: [
        # well suited due to ___
        (620, 234, 197, 28, 'adaptation', 10),
        # enables organisms to ___ survival
        (574, 275, 131, 28, 'improve', 10),
        # ___: ability to ___ & ___
        (164, 316, 131, 28, 'Fitness', 11),
        (523, 316, 131, 28, 'survive', 10),
        (700, 316, 197, 28, 'reproduce', 10),
        # Natural ___
        (496, 606, 197, 28, 'Selection', 11),
        # environment ___ for organisms more "___"
        (537, 647, 131, 28, 'selects', 10),
        (1061, 647, 66, 28, 'fit', 10),
        # Survival of the ___
        (475, 688, 164, 28, 'fittest', 10),
        # ___ requirements
        (279, 730, 66, 28, 'two', 10),
        # 1) Genetic ___
        (240, 771, 131, 28, 'variation', 10),
        # 2) Selective ___
        (701, 771, 131, 28, 'pressure', 10),
    ],
    7: [
        # changes in the ___ of a population
        (312, 482, 66, 28, 'DNA', 11),
        # can occur in a ___ of ways
        (378, 523, 131, 28, 'number', 10),
        # responsible for life's ___
        (711, 565, 131, 28, 'diversity', 10),
    ],
    8: [
        # ___: the branch of science that classifies
        (86, 193, 164, 28, 'Taxonomy', 11),
        # ___ categories
        (164, 234, 66, 28, 'Eight', 10),
        # 1) ___  2) ___  3) ___
        (167, 895, 197, 28, 'Bacteria', 10),
        (167, 936, 197, 28, 'Archaea', 10),
        (167, 991, 197, 28, 'Eukarya', 10),
        # Consist of ___ cells (___ a nucleus)
        (506, 991, 164, 28, 'eukaryotic', 9),
        (508, 914, 164, 28, 'prokaryotic', 9),
        (751, 914, 66, 28, 'lack', 9),
    ],
    9: [
        # subdivided into ___
        (462, 193, 131, 28, 'kingdoms', 10),
        # ___ kingdoms
        (667, 193, 131, 28, 'four', 10),
        # Kingdom ___ (Fungi)
        (620, 482, 164, 28, 'Fungi', 10),
        # ___ cellular or Multicellular (Protista)
        (352, 523, 66, 28, 'Uni', 10),
    ],
    10: [
        # ___ classes based on energy
        (493, 234, 66, 28, 'three', 10),
        # 1) ___ (___trophs)
        (167, 275, 164, 28, 'Producers', 10),
        (343, 275, 66, 28, 'Auto', 10),
        # 2) ___ (___trophs)
        (167, 316, 164, 28, 'Consumers', 10),
        (343, 316, 98, 28, 'Hetero', 10),
        # 3) ___
        (167, 358, 197, 28, 'Decomposers', 10),
        # Most energy from the ___
        (492, 399, 66, 28, 'sun', 10),
        # some energy lost as ___
        (629, 440, 98, 28, 'heat', 10),
    ],
    11: [
        # subject to the ___ method
        (804, 234, 197, 28, 'scientific', 10),
        # procedure to ___ questions, ___ ideas, & ___ knowledge
        (428, 275, 131, 28, 'investigate', 9),
        (671, 275, 98, 28, 'test', 9),
        (851, 275, 98, 28, 'build', 9),
        # starts with an ___ & a ___
        (441, 316, 230, 28, 'observation', 9),
        (722, 316, 197, 28, 'question', 9),
        # ___: an expected outcome
        (86, 936, 230, 28, 'Prediction', 10),
        # "___" will happen?
        (514, 977, 131, 28, 'what', 10),
        # ___: a proposed & testable explanation
        (86, 1019, 230, 28, 'Hypothesis', 10),
        # "___" it will happen?
        (683, 1060, 98, 28, 'why', 10),
        # hypothesis ___ a prediction
        (425, 1101, 164, 28, 'includes', 10),
        # ___: a testable & ___ hypothesis
        (86, 1142, 164, 28, 'Theory', 10),
        (371, 1142, 98, 28, 'broad', 10),
    ],
    12: [
        # Label: prediction
        (72, 730, 164, 28, 'Prediction', 10),
        # Label: hypothesis
        (72, 771, 164, 28, 'Hypothesis', 10),
        # Label: theory
        (72, 812, 164, 28, 'Theory', 10),
        # ___ basic theories
        (177, 977, 66, 28, 'three', 10),
    ],
    13: [
        # ___: a scientific investigation
        (86, 234, 230, 28, 'Experiment', 11),
        # ___: a changeable element
        (86, 275, 197, 28, 'Variable', 11),
        # ___ main types of variables
        (572, 316, 66, 28, 'two', 10),
        # IV: ___
        (342, 1222, 394, 28, 'Style/model of paper airplane', 8),
        # DV: ___
        (329, 1263, 427, 28, 'Distance each plane travels', 8),
    ],
    14: [
        # contain ___ groups
        (535, 234, 66, 28, 'control', 10),
        # Well-designed experiments contain ___ groups
        # False ___: outcomes that falsely indicate the ___
        (398, 523, 131, 28, 'control', 10),
        (218, 565, 164, 28, 'Positives', 10),
        (711, 565, 164, 28, 'presence', 10),
        (218, 647, 164, 28, 'Negatives', 10),
        (711, 647, 164, 28, 'absence', 10),
        # ___ main types of controls
        (86, 812, 66, 28, 'Two', 10),
        # only differ in the ___ factor
        (791, 854, 66, 28, 'one', 10),
    ],
    15: [
        # Matching exercise: a-1, b-3, c-4, d-2
        (296, 275, 66, 28, '1', 12),
        (287, 316, 66, 28, '3', 12),
        (272, 358, 66, 28, '4', 12),
        (281, 399, 66, 28, '2', 12),
    ],
}
