/* ================================================================
   SOL Prep — Unit 5: Genetics & Inheritance
   Loaded by unit-5.html immediately before UnitEngine.boot().
   Pure data: no logic. Generated from pre-migration HTML by
   tools/phaseD-extract-configs.py.
   ================================================================ */

window.UNIT_CONFIG = {
  // Identity
  unitNumber: 5,
  unitKey:    'unit5',
  standard:   'BIO.5',
  moduleName: 'SOL Prep — Unit 5: Genetics & Inheritance',
  unitTitle:  'Genetics & Inheritance',

  // Panel structure
  totalPanels:     11,
  dsmPanelId:      7,
  stepNames: ['SOL Focus','DNA Structure','Meiosis','Mendelian Genetics','Non-Mendelian','Genetic Engineering','Vocab Lock-In','Mastery Module','Study Guide','Practice Test','Results'],
  unlockOnMastery: [8, 9, 10],

  // Per-panel gate requirements
  gateRequired: { 0: 5, 1: 4, 2: 4, 3: 4, 4: 4, 5: 4 },

  // Vocab gate
  vocab: {
    total: 10,
    pass:  8,
    correct: {1:'b',2:'b',3:'c',4:'c',5:'b',6:'b',7:'c',8:'c',9:'b',10:'c'},
    explain: {
  1:'Bb has two DIFFERENT alleles = heterozygous. BB = homozygous dominant, bb = homozygous recessive.',
  2:'Meiosis produces 4 genetically different cells with half the chromosomes (haploid). Mitosis produces 2 identical diploid cells.',
  3:'Incomplete dominance: heterozygote shows a BLEND of both parental phenotypes. Codominance would show BOTH traits separately.',
  4:'PCR (Polymerase Chain Reaction) copies a specific DNA segment millions of times. CRISPR edits DNA. Gel electrophoresis separates DNA.',
  5:'In RNA, uracil (U) replaces thymine (T). So DNA\'s A pairs with RNA\'s U during transcription.',
  6:'Phenotype = the observable physical trait (what you see). Genotype = the genetic letters (BB, Bb, bb).',
  7:'Crossing over exchanges DNA segments between homologous chromosomes during meiosis, creating new gene combinations = more genetic diversity.',
  8:'CRISPR precisely edits DNA at specific locations — like find-and-replace for genes. PCR copies, gel electrophoresis separates.',
  9:'A dihybrid cross examines TWO traits at once using a 4×4 Punnett square (16 boxes).',
  10:'Only mutations in sex cells (gametes) are passed to offspring. Somatic cell mutations affect only that individual.'
}
  },

  // Counts
  totalCards: 31,
  totalSolQ:  20,

  // DSM player options
  dsm: {
    containerId: 'dsm-container',
    timeoutMs:   5000
  }
};
