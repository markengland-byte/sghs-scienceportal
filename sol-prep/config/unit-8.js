/* ================================================================
   SOL Prep — Unit 8: Ecology & Ecosystems
   Loaded by unit-8.html immediately before UnitEngine.boot().
   Pure data: no logic. Generated from pre-migration HTML by
   tools/phaseD-extract-configs.py.
   ================================================================ */

window.UNIT_CONFIG = {
  // Identity
  unitNumber: 8,
  unitKey:    'unit8',
  standard:   'BIO.8',
  moduleName: 'SOL Prep — Unit 8: Ecology & Ecosystems',
  unitTitle:  'Ecology & Ecosystems',

  // Panel structure
  totalPanels:     10,
  dsmPanelId:      6,
  stepNames: ['SOL Focus','Populations','Energy & Cycles','Succession','Human Impact','Vocab Lock-In','Mastery Module','Study Guide','Practice Test','Results'],
  unlockOnMastery: [7, 8, 9],

  // Per-panel gate requirements
  gateRequired: { 0: 5, 1: 4, 2: 4, 3: 4, 4: 4 },

  // Vocab gate
  vocab: {
    total: 10,
    pass:  8,
    correct: {1:'b',2:'a',3:'c',4:'d',5:'c',6:'b',7:'b',8:'a',9:'c',10:'d'},
    explain: {
  1:'Carrying capacity is the maximum population an environment can sustain with available resources. On a graph, it\'s where the line levels off.',
  2:'An energy pyramid shows that only ~10% of energy is transferred from one trophic level to the next. Producers have the most energy.',
  3:'Primary succession starts on bare rock with NO soil. Pioneer species (lichens, mosses) colonize first and begin creating soil.',
  4:'Eutrophication: excess nutrients cause algal bloom → algae die → bacteria decompose them → oxygen depleted → fish suffocate and die.',
  5:'Virginia\'s climax community is a deciduous oak-hickory (hardwood) forest. This is the stable endpoint of succession in most of Virginia.',
  6:'Decomposers (bacteria, fungi) break down dead organisms and recycle nutrients (carbon, nitrogen, phosphorus) back into the ecosystem.',
  7:'A community = all populations of different species interacting in an area. A population = one species only.',
  8:'Nitrogen-fixing bacteria convert atmospheric N₂ into ammonia (NH₃) that plants can absorb through their roots.',
  9:'Invasive species are non-native organisms that harm ecosystems by outcompeting, preying on, or infecting native species.',
  10:'Lichens and mosses are pioneer species — the first to colonize bare rock, breaking it down to begin soil formation.'
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
