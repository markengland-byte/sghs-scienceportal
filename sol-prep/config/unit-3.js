/* ================================================================
   SOL Prep — Unit 3: Cell Structure & Function
   Loaded by unit-3.html immediately before UnitEngine.boot().
   Pure data: no logic. Generated from pre-migration HTML by
   tools/phaseD-extract-configs.py.
   ================================================================ */

window.UNIT_CONFIG = {
  // Identity
  unitNumber: 3,
  unitKey:    'unit3',
  standard:   'BIO.3',
  moduleName: 'SOL Prep — Unit 3: Cell Structure & Function',
  unitTitle:  'Cell Structure & Function',

  // Panel structure
  totalPanels:     11,
  dsmPanelId:      7,
  stepNames: ['SOL Focus','Cell Theory','Organelles','Cell Cycle','Membrane & Transport','Specialization','Vocab Lock-In','Mastery Module','Study Guide','Practice Test','Results'],
  unlockOnMastery: [8, 9, 10],

  // Per-panel gate requirements
  gateRequired: { 0: 5, 1: 4, 2: 6, 3: 4, 4: 6, 5: 4 },

  // Vocab gate
  vocab: {
    total: 10,
    pass:  8,
    correct: {1:'b',2:'b',3:'c',4:'b',5:'d',6:'c',7:'c',8:'c',9:'b',10:'c'},
    explain: {
  1:'Mitochondria are the "powerhouse" of the cell. They perform cellular respiration, converting glucose + O2 into ATP energy.',
  2:'Prokaryotic cells lack a membrane-bound nucleus. Their DNA floats freely in the cytoplasm. Bacteria and archaea are prokaryotes.',
  3:'Osmosis is specifically the diffusion of WATER across a semipermeable membrane, from high water concentration to low water concentration.',
  4:'PMAT: Prophase, Metaphase, Anaphase, Telophase. Remember: Please Make Another Taco.',
  5:'Active transport is the ONLY type that requires ATP energy because it moves substances AGAINST the concentration gradient (low to high).',
  6:'The Golgi apparatus receives proteins from the ER, modifies and packages them, then ships them to their destination inside or outside the cell.',
  7:'Plant cells have cell walls (rigid support) and chloroplasts (photosynthesis) that animal cells lack. Both have cell membranes, mitochondria, and ribosomes.',
  8:'Interphase is the longest phase (~90% of the cell cycle). The cell grows, carries out normal functions, and copies its DNA before dividing.',
  9:'Ribosomes are found in ALL cells — both prokaryotes and eukaryotes — because every cell needs to make proteins.',
  10:'Homeostasis is the maintenance of stable internal conditions (temperature, pH, glucose levels) despite changes in the external environment.'
}
  },

  // Counts
  totalCards: 29,
  totalSolQ:  20,

  // DSM player options
  dsm: {
    containerId: 'dsm-container',
    timeoutMs:   5000
  }
};
