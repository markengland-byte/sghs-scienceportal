/* ================================================================
   SOL Prep — Unit 2: Biochemistry & Energy
   Loaded by unit-2.html immediately before UnitEngine.boot().
   Pure data: no logic. Generated from pre-migration HTML by
   tools/phaseD-extract-configs.py.
   ================================================================ */

window.UNIT_CONFIG = {
  // Identity
  unitNumber: 2,
  unitKey:    'unit2',
  standard:   'BIO.2',
  moduleName: 'SOL Prep — Unit 2: Biochemistry & Energy',
  unitTitle:  'Biochemistry & Energy',

  // Panel structure
  totalPanels:     11,
  dsmPanelId:      7,
  stepNames: ['SOL Focus','Water Chemistry','Macromolecules','Enzymes','Protein Synthesis','Photo. & Resp.','Vocab Lock-In','Mastery Module','Study Guide','Practice Test','Results'],
  unlockOnMastery: [8, 9, 10],

  // Per-panel gate requirements
  gateRequired: { 0: 5, 1: 4, 2: 4, 3: 5, 4: 4, 5: 5 },

  // Vocab gate
  vocab: {
    total: 10,
    pass:  8,
    correct: {1:'c',2:'b',3:'b',4:'b',5:'c',6:'b',7:'c',8:'c',9:'c',10:'b'},
    explain: {
  1:'Amino acids are the monomers of proteins. Nucleotides are monomers of nucleic acids. Fatty acids are part of lipids. Monosaccharides are monomers of carbohydrates.',
  2:'Surface tension is caused by cohesion (water molecules sticking together via hydrogen bonds). This creates a "skin" strong enough to support lightweight insects.',
  3:'The active site is the specific region on the enzyme where the substrate binds. It has a unique shape that matches only its specific substrate (lock-and-key model).',
  4:'Transcription (DNA → mRNA) occurs in the nucleus where DNA is located. Translation occurs at the ribosome.',
  5:'Lipids (fats) provide both long-term energy storage AND insulation in animals. Carbohydrates provide quick energy but not insulation.',
  6:'ATP (adenosine triphosphate) is the cell\'s main energy currency. Glucose stores energy but must be broken down into ATP before cells can use it.',
  7:'Denaturation is the loss of an enzyme\'s 3D shape due to extreme temperature or pH. Once denatured, the active site is distorted and the substrate can no longer bind.',
  8:'A codon is a 3-nucleotide sequence on mRNA that codes for one amino acid. An anticodon is on tRNA. A nucleotide is a single unit. A gene is a longer DNA sequence.',
  9:'Photosynthesis occurs in chloroplasts, which contain chlorophyll to capture light energy. Mitochondria are where cellular respiration occurs.',
  10:'Water\'s polarity (unequal charge distribution) allows it to surround and dissolve ionic and polar substances, making it the "universal solvent."'
}
  },

  // Counts
  totalCards: 26,
  totalSolQ:  20,

  // DSM player options
  dsm: {
    containerId: 'dsm-container',
    timeoutMs:   5000
  }
};
