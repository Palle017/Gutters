// Shared educational content. Source provenance is internal; no owner authorship claimed.
export const sources = Object.freeze({
  interview: {label: 'Recorded John / Raj interview, October 25, 2026', href: 'https://github.com/Palle017/Gutters/blob/main/docs/JOHN-INTERVIEW-20261025.txt'},
  runoff: {label: 'U.S. Department of Energy: roof runoff and discharge', href: 'https://bsesc.energy.gov/energy-basics/stormwater-gutters-downspouts'},
  drainage: {label: 'PNNL: site drainage is a separate consideration', href: 'https://basc.pnnl.gov/resource-guides/swales-drains-and-site-grading-stormwater-control'}
});
export const shared = Object.freeze({
  safety: 'Observe only from a dry, safe place at ground level, or from indoors. Do not climb, open a gutter or pipe, enter standing water, or go outside in hazardous weather.',
  uncertainty: 'These observations cannot establish a cause, a repair scope, or whether gutters are needed. An appropriate on-site inspection may be needed.',
  contact: 'If you would like to discuss roof runoff, gutter repairs or underground drainage, call or text John. Contact is optional; you can read all advice without it.'
});
export const advice = Object.freeze([
  {
    id: 'between-homes',
    title: 'Wet ground between nearby homes',
    provenance: 'Recorded interview topic; advice wording proposed',
    sourceIds: ['interview', 'runoff', 'drainage'],
    observation: 'From a safe location, note where water seems to arrive, whether it follows rain, and where existing downspouts end. If you cannot see a source, say so.',
    mayHelp: 'If roof runoff contributes, gutters and an appropriate discharge route may help manage that part of the water.',
    limits: 'Wet ground alone does not establish roof runoff as the cause. Gutters will not correct site grading, irrigation or other water sources.',
    nextStep: 'For persistent or unclear wet areas, ask an appropriate drainage or landscape professional to assess the source and route. John offers underground drainage, but does not offer grading. A site assessment comes before a scope of work.'
  },
  {
    id: 'gutter-edge',
    title: 'Water spilling over an existing gutter',
    provenance: 'Proposed example; not recovered as John input',
    sourceIds: ['runoff'],
    observation: 'If visible safely from indoors or ground level, note whether water spills at one point or along a run, and whether you can see a loose or damaged section. You do not need to look inside the gutter.',
    mayHelp: 'An inspection can establish whether a cleanout or a localized repair is appropriate before considering replacement.',
    limits: 'Overflow alone does not prove that a new gutter system or leaf guards are needed. The condition, layout and discharge route need assessment.',
    nextStep: 'Ask a gutter professional to inspect the existing system and explain what can be maintained or repaired. Avoid buying a replacement from a symptom alone.'
  },
  {
    id: 'downspout',
    title: 'Water collecting near a downspout outlet',
    provenance: 'Proposed example; not recovered as John input',
    sourceIds: ['runoff', 'drainage'],
    observation: 'From a dry place, note where the outlet ends and where water appears to travel. Leave unknown or concealed pipe routes unknown.',
    mayHelp: 'An appropriate discharge arrangement may help move collected roof water to a suitable location after a property assessment.',
    limits: 'Adding gutters without considering the outlet may leave the discharge problem unresolved. Underground piping is not a universal solution to standing water.',
    nextStep: 'Have the water source and a suitable discharge location assessed. Do not redirect water toward a neighbor or assume a buried pipe has a usable outlet.'
  },
  {
    id: 'building-concern',
    title: 'Water indoors, or a wall, window, door or crack concern',
    provenance: 'Proposed routing example based on the interview’s diagnosis boundary',
    sourceIds: ['interview'],
    observation: 'Keep a note of the location and timing from a safe place. Do not test a suspected leak or investigate concealed building parts.',
    mayHelp: 'A gutter inspection may be one part of a professional assessment if roof runoff is relevant.',
    limits: 'This guide cannot diagnose water intrusion, movement, cracks, or wall, roof, window and door conditions. Gutters are not a diagnosis or a promised repair for these concerns.',
    nextStep: 'Arrange an inspection by a qualified professional appropriate to the building concern. Do not delay that assessment while shopping for gutters.'
  },
  {
    id: 'unknown',
    title: 'The water source is unclear',
    provenance: 'Proposed uncertainty route; not recovered as John input',
    sourceIds: ['interview', 'drainage'],
    observation: 'If it is safe, note whether water appears after rain, in dry weather, or at times you are unsure about. An existing photo is optional; no measurements are required.',
    mayHelp: 'Gutters may be relevant if roof runoff is established as a contributor.',
    limits: 'An uncertain source is a reason to investigate, not a reason to recommend gutters. Irrigation, site drainage or another repair may need attention.',
    nextStep: 'Ask an appropriate professional to establish the source first. John can discuss whether the roof-water portion fits his gutter or underground-drainage services; he does not offer grading.'
  }
]);
