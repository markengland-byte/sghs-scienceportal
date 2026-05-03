/* ================================================================
   Unit 1 Config — SOL Prep / BIO.1 — Scientific Investigation
   Loaded by unit-1.html immediately before UnitEngine.boot().
   Pure data: no logic. Engine reads every field documented in
   /PHASE-D-DESIGN-DOC.md.
   ================================================================ */

window.UNIT_CONFIG = {
  // Identity
  unitNumber: 1,
  unitKey:    'unit1',
  standard:   'BIO.1',
  moduleName: 'SOL Prep — Unit 1: Scientific Investigation',
  unitTitle:  'Scientific Investigation',

  // Panel structure
  totalPanels:     12,
  dsmPanelId:      8,
  stepNames: [
    'SOL Focus',
    'Hypotheses & Variables',
    'Planning Investigations',
    'Data Tables & Graphs',
    'Conclusions & Evidence',
    'Scientific Models',
    'Evaluating Sources',
    'Vocab Lock-In',
    'Mastery Module',
    'Study Guide',
    'Practice Test',
    'Results'
  ],
  unlockOnMastery: [9, 10, 11],

  // Per-panel gate requirements (panel 3 also requires 2 graph answers
  // tracked separately via UnitEngine.markAnswered('graph1'/'graph2', ...))
  gateRequired: { 0: 5, 1: 5, 2: 5, 3: 6, 4: 6, 5: 4, 6: 4 },

  // Vocab gate
  vocab: {
    total: 10,
    pass:  8,
    correct: { 1:'b', 2:'c', 3:'b', 4:'c', 5:'b', 6:'c', 7:'d', 8:'c', 9:'b', 10:'a' },
    explain: {
      1:  'The INDEPENDENT variable is what the scientist changes. The scientist set different fertilizer amounts — this is the IV.',
      2:  'Quantitative data has numbers and units. "4.2 cm" is a measurement — quantitative. All others describe qualities without numbers.',
      3:  'All readings are at 93°C (consistent = precise) but all are wrong by 7°C (inaccurate). Precise but NOT accurate.',
      4:  'The control group receives NO treatment. Group B with no fertilizer = control group = baseline for comparison.',
      5:  'Two variables correlating does NOT prove causation. City size explains both. Correlation ≠ causation.',
      6:  'A theory explains WHY (well-tested explanation). A law describes WHAT happens consistently. Theories do NOT become laws — they serve different purposes.',
      7:  'An observation is what you directly see/measure. An inference is a CONCLUSION drawn from observations. "The solution is acidic" is inferred from the red color, not directly seen.',
      8:  'Peer-reviewed journal articles are the gold standard. They are reviewed by expert scientists before publication.',
      9:  'Peer review allows other scientists to check methods, catch errors, and verify conclusions BEFORE publication. It does not guarantee perfection but increases reliability.',
      10: 'Small sample size is the issue. 10 students (5 per group) is far too few to draw reliable conclusions.'
    }
  },

  // Counts
  totalCards: 18,
  totalSolQ:  20,

  // DSM player options
  dsm: {
    containerId: 'dsm-container',
    timeoutMs:   5000
  }
};
