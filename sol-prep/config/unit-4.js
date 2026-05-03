/* ================================================================
   SOL Prep — Unit 4: Bacteria & Viruses
   Loaded by unit-4.html immediately before UnitEngine.boot().
   Pure data: no logic. Generated from pre-migration HTML by
   tools/phaseD-extract-configs.py.
   ================================================================ */

window.UNIT_CONFIG = {
  // Identity
  unitNumber: 4,
  unitKey:    'unit4',
  standard:   'BIO.4',
  moduleName: 'SOL Prep — Unit 4: Bacteria & Viruses',
  unitTitle:  'Bacteria & Viruses',

  // Panel structure
  totalPanels:     10,
  dsmPanelId:      6,
  stepNames: ['SOL Focus','Viruses','Bacteria','Disease & Germ Theory','Vaccines & Antibiotics','Vocab Lock-In','Mastery Module','Study Guide','Practice Test','Results'],
  unlockOnMastery: [7, 8, 9],

  // Per-panel gate requirements
  gateRequired: { 0: 5, 1: 4, 2: 4, 3: 4, 4: 4 },

  // Vocab gate
  vocab: {
    total: 10,
    pass:  8,
    correct: {1:'b',2:'c',3:'c',4:'d',5:'b',6:'c',7:'b',8:'c',9:'d',10:'c'},
    explain: {
  1:'The capsid is the protein coat that surrounds and protects the viral nucleic acid. Cell walls are found in bacteria and plants, not viruses.',
  2:'In the lytic cycle, the virus hijacks the host cell, replicates, and the host cell BURSTS (lyses), releasing hundreds of new viruses.',
  3:'Antibiotics kill bacteria only. They have NO effect on viruses because viruses lack the cellular structures that antibiotics target.',
  4:'Photoautotrophs use sunlight to make their own food. Photo = light, auto = self. Cyanobacteria are the classic example.',
  5:'Binary fission is asexual reproduction where one bacterium splits into two identical cells. Conjugation is sexual (rare). Mitosis is in eukaryotes.',
  6:'Pasteur\'s swan-neck flask experiment proved that microorganisms come from other microorganisms, disproving the theory of spontaneous generation.',
  7:'Bacteria reproduce every ~20 minutes. When antibiotics kill susceptible bacteria, resistant ones survive and quickly become the dominant population.',
  8:'The ONLY characteristic viruses share with living cells is containing nucleic acids (DNA or RNA). Viruses lack ribosomes, membranes, and metabolism.',
  9:'Vaccines contain dead or weakened pathogens that trigger an immune response and create memory cells, providing protection against future infection.',
  10:'Quarantine isolates infected organisms to prevent disease from spreading to healthy populations. It\'s a direct application of germ theory.'
}
  },

  // Counts
  totalCards: 25,
  totalSolQ:  20,

  // DSM player options
  dsm: {
    containerId: 'dsm-container',
    timeoutMs:   5000
  }
};
