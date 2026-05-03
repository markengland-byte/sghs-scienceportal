/* ================================================================
   SOL Prep — Unit 6: Classification & Diversity
   Loaded by unit-6.html immediately before UnitEngine.boot().
   Pure data: no logic. Generated from pre-migration HTML by
   tools/phaseD-extract-configs.py.
   ================================================================ */

window.UNIT_CONFIG = {
  // Identity
  unitNumber: 6,
  unitKey:    'unit6',
  standard:   'BIO.6',
  moduleName: 'SOL Prep — Unit 6: Classification & Diversity',
  unitTitle:  'Classification & Diversity',

  // Panel structure
  totalPanels:     10,
  dsmPanelId:      6,
  stepNames: ['SOL Focus','Taxonomy','Cladograms','Domains & Kingdoms','Eukarya Diversity','Vocab Lock-In','Mastery Module','Study Guide','Practice Test','Results'],
  unlockOnMastery: [7, 8, 9],

  // Per-panel gate requirements
  gateRequired: { 0: 5, 1: 4, 2: 4, 3: 4, 4: 4 },

  // Vocab gate
  vocab: {
    total: 10,
    pass:  8,
    correct: {1:'b',2:'a',3:'c',4:'c',5:'b',6:'c',7:'b',8:'a',9:'d',10:'b'},
    explain: {
  1:'In binomial nomenclature, the first word is the Genus (capitalized). The second word is the species (lowercase).',
  2:'A cladogram is a branching diagram showing evolutionary relationships based on shared derived characteristics.',
  3:'A species is defined as organisms that can interbreed and produce FERTILE offspring.',
  4:'Fungi have cell walls (chitin), are heterotrophs that absorb nutrients, and do NOT photosynthesize. Plants photosynthesize.',
  5:'Domain is the broadest (most general) level. Species is the most specific.',
  6:'Both Archaea and Bacteria are prokaryotic. They lack a membrane-bound nucleus.',
  7:'Animalia = eukaryotic, multicellular, NO cell wall, heterotrophs that ingest food.',
  8:'Similar embryonic stages across species suggest shared evolutionary ancestry (common ancestor).',
  9:'A dichotomous key uses paired choices at each step to narrow down identification of an organism.',
  10:'Classification systems are adaptable — they change as new evidence (DNA analysis, fossil discoveries) emerges.'
}
  },

  // Counts
  totalCards: 22,
  totalSolQ:  20,

  // DSM player options
  dsm: {
    containerId: 'dsm-container',
    timeoutMs:   5000
  }
};
