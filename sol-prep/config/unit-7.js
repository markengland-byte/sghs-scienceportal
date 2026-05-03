/* ================================================================
   SOL Prep — Unit 7: Evolution
   Loaded by unit-7.html immediately before UnitEngine.boot().
   Pure data: no logic. Generated from pre-migration HTML by
   tools/phaseD-extract-configs.py.
   ================================================================ */

window.UNIT_CONFIG = {
  // Identity
  unitNumber: 7,
  unitKey:    'unit7',
  standard:   'BIO.7',
  moduleName: 'SOL Prep — Unit 7: Evolution',
  unitTitle:  'Evolution',

  // Panel structure
  totalPanels:     10,
  dsmPanelId:      6,
  stepNames: ['SOL Focus','Fossil & DNA Evidence','Variation & Selection','Adaptations & Speciation','Scientific Evidence','Vocab Lock-In','Mastery Module','Study Guide','Practice Test','Results'],
  unlockOnMastery: [7, 8, 9],

  // Per-panel gate requirements
  gateRequired: { 0: 5, 1: 4, 2: 4, 3: 4, 4: 4 },

  // Vocab gate
  vocab: {
    total: 10,
    pass:  8,
    correct: {1:'b',2:'a',3:'c',4:'d',5:'c',6:'b',7:'d',8:'a',9:'a',10:'b'},
    explain: {
  1:'Natural selection = organisms with favorable inherited traits survive and reproduce more, passing those traits to the next generation.',
  2:'Absolute dating uses radioactive decay to determine the EXACT age of a fossil in years. Relative dating only tells you which is older/younger.',
  3:'Homologous structures have the same underlying bone structure but different functions (arm/wing/flipper). They indicate a common ancestor.',
  4:'Speciation occurs when populations become so different they can no longer interbreed and produce fertile offspring.',
  5:'Punctuated equilibrium = long periods of no change (stasis) interrupted by rapid bursts of evolutionary change.',
  6:'Gene flow = movement of genes between populations through migration, introducing new alleles.',
  7:'Convergent evolution = unrelated species evolve similar traits because they face similar environmental pressures.',
  8:'Vestigial structures are reduced body parts with no current function (human appendix, whale hip bones), showing ancestral traits.',
  9:'Overproduction = species produce MORE offspring than can survive, creating competition where favorable traits are selected.',
  10:'An adaptation is an INHERITED trait that increases an organism\'s ability to survive and reproduce in its environment.'
}
  },

  // Counts
  totalCards: 24,
  totalSolQ:  20,

  // DSM player options
  dsm: {
    containerId: 'dsm-container',
    timeoutMs:   5000
  }
};
