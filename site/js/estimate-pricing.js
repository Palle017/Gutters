export const UNKNOWN_ANSWER = '__unknown__';

export function formatMoney(cents) {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(cents / 100);
}

function rateCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

function knownNumber(answers, key) {
  const value = answers[key];
  if (value === UNKNOWN_ANSWER || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function knownCount(answers, key) {
  const value = knownNumber(answers, key);
  return Number.isInteger(value) ? value : null;
}

export function validatePricingCatalog(catalog) {
  if (!catalog || catalog.schemaVersion !== 1 || typeof catalog.catalogVersion !== 'string' || catalog.currency !== 'USD' || !Array.isArray(catalog.services) || !catalog.rates) throw Error('The price catalog format is not supported.');
  if (!catalog.services.length || catalog.services.some(service => !service || typeof service.id !== 'string' || typeof service.label !== 'string') || new Set(catalog.services.map(service => service.id)).size !== catalog.services.length) throw Error('The price catalog services are invalid.');
  const paths = [
    ['gutters', 'singleStoryUnder100PerFoot'],
    ['gutters', 'singleStoryOver100PerFoot'],
    ['gutters', 'twoStoryPerFoot'],
    ['gutters', 'singleStoryDownspout'],
    ['gutters', 'twoStoryDownspout'],
    ['gutters', 'thresholdFeet'],
    ['gutters', 'standardDownspoutApproxFeet'],
    ['standardScreens', 'lowerWallPanel'],
    ['standardScreens', 'upperWallPanel'],
    ['standardScreens', 'lowerFloridaGlassPanel'],
    ['standardScreens', 'lowerPetScreenPanel'],
    ['standardScreens', 'pictureWindowPerSquareFoot'],
    ['standardScreens', 'superScreenMultiplier'],
    ['standardScreens', 'oversizedApproximateWidthFeet'],
    ['standardScreens', 'oversizedApproximateHeightFeet'],
    ['poolPanels', 'lower', 'standard'],
    ['poolPanels', 'lower', 'superScreen'],
    ['poolPanels', 'upper', 'standard'],
    ['poolPanels', 'upper', 'superScreen'],
    ['poolPanels', 'roof', 'standard'],
    ['poolPanels', 'roof', 'superScreen'],
    ['poolRestoration', 'rescreeningStartingReference'],
    ['poolRestoration', 'cleaningMinimum'],
    ['poolRestoration', 'cleaningMaximum'],
    ['poolRestoration', 'hurricaneCable'],
    ['poolRestoration', 'paintRescreeningPerRunReference'],
    ['windowRescreen', 'wholeHomePerScreen'],
    ['patioDoor', 'perDoorMinimum'],
    ['patioDoor', 'perDoorMaximum'],
    ['aluminumDoor', 'perDoorReference'],
    ['regularDoor', 'bottomSection'],
    ['regularDoor', 'topSection'],
    ['regularDoor', 'bothSections']
  ];
  for (const path of paths) {
    const value = path.reduce((current, key) => current?.[key], catalog.rates);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error('The price catalog contains an invalid rate.');
  }
  if (catalog.rates.gutters.thresholdFeet <= 0 || catalog.rates.standardScreens.superScreenMultiplier <= 0 || catalog.rates.poolRestoration.cleaningMinimum > catalog.rates.poolRestoration.cleaningMaximum || catalog.rates.patioDoor.perDoorMinimum > catalog.rates.patioDoor.perDoorMaximum || typeof catalog.rates.aluminumDoor.materialAndHardwareConfirmed !== 'boolean') throw Error('The price catalog contains an invalid pricing rule.');
  return catalog;
}

export function calculateEstimate(answers, catalog) {
  const rates = catalog.rates;
  const lines = [];
  const references = [];
  const review = [];
  const addReview = value => { if (!review.includes(value)) review.push(value); };
  const addFixed = (label, quantity, rate, detail) => {
    const amount = Math.round(rateCents(rate) * quantity);
    lines.push({label, detail: detail || quantity + ' × ' + formatMoney(rateCents(rate)) + ' = ' + formatMoney(amount), minimum: amount, maximum: amount});
  };
  const addRange = (label, quantity, minimumRate, maximumRate, detail) => {
    const minimum = Math.round(rateCents(minimumRate) * quantity);
    const maximum = Math.round(rateCents(maximumRate) * quantity);
    lines.push({label, detail: detail || quantity + ' × ' + formatMoney(rateCents(minimumRate)) + ' to ' + formatMoney(rateCents(maximumRate)) + ' each = ' + formatMoney(minimum) + ' to ' + formatMoney(maximum), minimum, maximum});
  };
  const addReference = (value, reason) => {
    references.push(value);
    addReview(reason);
  };

  if (answers.service === 'gutters') {
    const layout = answers.gutterLayout;
    const hasSingle = layout === 'one_story' || layout === 'mixed';
    const hasTwo = layout === 'two_story' || layout === 'mixed';
    const singleFeet = hasSingle ? knownNumber(answers, 'singleStoryFeet') : 0;
    const twoFeet = hasTwo ? knownNumber(answers, 'twoStoryFeet') : 0;
    const totalFeet = singleFeet === null || twoFeet === null ? null : singleFeet + twoFeet;
    if (!layout || layout === UNKNOWN_ANSWER) addReview('Gutter story layout needs clarification.');
    if (hasSingle && singleFeet === null) addReview('One-story gutter footage is unknown; John needs a measurement.');
    if (hasTwo && twoFeet === null) addReview('Two-story gutter footage is unknown; John needs a measurement.');
    if (totalFeet !== null && hasSingle && singleFeet > 0) {
      if (Math.abs(totalFeet - rates.gutters.thresholdFeet) < 0.0000001) {
        addReview('Exactly 100 total qualifying feet has no assigned one-story rate.');
      } else {
        const perFoot = totalFeet < rates.gutters.thresholdFeet ? rates.gutters.singleStoryUnder100PerFoot : rates.gutters.singleStoryOver100PerFoot;
        addFixed('One-story gutter installation', singleFeet, perFoot, singleFeet + ' linear feet × ' + formatMoney(rateCents(perFoot)) + ' per foot = ' + formatMoney(Math.round(rateCents(perFoot) * singleFeet)));
      }
    }
    if (twoFeet !== null && twoFeet > 0) addFixed('Two-story gutter installation', twoFeet, rates.gutters.twoStoryPerFoot, twoFeet + ' linear feet × ' + formatMoney(rateCents(rates.gutters.twoStoryPerFoot)) + ' per foot = ' + formatMoney(Math.round(rateCents(rates.gutters.twoStoryPerFoot) * twoFeet)));
    const downspoutQuestions = {
      one_story: [['singleDownspouts', 'One-story downspouts', rates.gutters.singleStoryDownspout]],
      two_story: [['twoDownspouts', 'Two-story downspouts', rates.gutters.twoStoryDownspout]],
      mixed: [
        ['singleDownspouts', 'One-story downspouts', rates.gutters.singleStoryDownspout],
        ['twoDownspouts', 'Two-story downspouts', rates.gutters.twoStoryDownspout]
      ]
    }[layout] || [];
    for (const [key, label, rate] of downspoutQuestions) {
      const quantity = knownCount(answers, key);
      if (quantity === null) addReview(label + ' quantity is unknown.');
      else if (quantity > 0) addFixed(label + ' (approximately ' + rates.gutters.standardDownspoutApproxFeet + ' feet each)', quantity, rate, quantity + ' × ' + formatMoney(rateCents(rate)) + ' = ' + formatMoney(Math.round(rateCents(rate) * quantity)) + '; one standard downspout is approximately ' + rates.gutters.standardDownspoutApproxFeet + ' feet.');
    }
    if (answers.removeExistingGutters === 'yes') addReview('Existing gutter removal has no approved rate.');
    if (answers.removeExistingGutters === UNKNOWN_ANSWER) addReview('Confirm whether existing gutter removal is needed.');
  } else if (answers.service === 'standard_screens') {
    const panelType = answers.screenPanelType;
    const count = knownCount(answers, 'panelCount');
    const frameOk = answers.frameCondition === 'ok';
    if (panelType === 'oversized') addReview('Oversized or custom screen panels need an owner quote.');
    else if (panelType === 'picture_window') {
      const width = knownNumber(answers, 'pictureWidth');
      const height = knownNumber(answers, 'pictureHeight');
      if (count === null || width === null || height === null || width <= 0 || height <= 0) addReview('Picture-window screen dimensions and quantity need confirmation.');
      else if (!frameOk) addReview('Picture-window frame condition needs owner review.');
      else if (answers.screenMaterial !== 'standard') addReview('Super Screen or unknown picture-window material pricing is not defined in the catalog.');
      else {
        const area = width * height * count;
        const totalAmount = Math.round(rateCents(rates.standardScreens.pictureWindowPerSquareFoot) * area);
          addFixed('Picture-window screen', area, rates.standardScreens.pictureWindowPerSquareFoot, count + ' × ' + width + ' ft × ' + height + ' ft × ' + formatMoney(rateCents(rates.standardScreens.pictureWindowPerSquareFoot)) + ' per sq ft = ' + formatMoney(totalAmount));
        if (width >= rates.standardScreens.oversizedApproximateWidthFeet && height >= rates.standardScreens.oversizedApproximateHeightFeet) addReview('This picture window may need additional oversized-panel pricing.');
      }
    } else {
      const sizeOk = answers.panelSize === 'normal';
      const baseRates = {
        lower_standard: rates.standardScreens.lowerWallPanel,
        upper_standard: rates.standardScreens.upperWallPanel,
        florida_glass: rates.standardScreens.lowerFloridaGlassPanel,
        pet_screen: rates.standardScreens.lowerPetScreenPanel
      };
      const baseRate = baseRates[panelType];
      if (!baseRate) addReview('The selected screen panel has no approved rate.');
      else if (count === null) addReview('Screen panel quantity is unknown.');
      else if (!sizeOk) addReview('Panel size needs confirmation; the standard panel rates apply only to normal-sized panels.');
      else if (!frameOk) addReview('Screen frame condition needs owner review.');
      else if (answers.screenMaterial !== 'standard' && answers.screenMaterial !== 'superScreen') addReview('Screen material is unknown and needs owner review.');
      else if (answers.screenMaterial === 'superScreen' && (panelType === 'florida_glass' || panelType === 'pet_screen')) addReview('Do not apply the Super Screen multiplier to Florida Glass or pet screen.');
      else if (answers.screenMaterial === 'superScreen' && panelType !== 'lower_standard' && panelType !== 'upper_standard') addReview('Super Screen pricing is not defined for this panel type.');
      else {
        const rate = answers.screenMaterial === 'superScreen' ? baseRate * rates.standardScreens.superScreenMultiplier : baseRate;
        addFixed(panelType === 'lower_standard' ? 'Standard lower wall panel' : panelType === 'upper_standard' ? 'Standard upper wall panel' : panelType === 'florida_glass' ? 'Lower Florida Glass panel' : 'Lower pet screen panel', count, rate);
      }
    }
  } else if (answers.service === 'pool_panels') {
    const count = knownCount(answers, 'poolPanelCount');
    const panelType = answers.poolPanelType;
    if (count === null) addReview('Pool enclosure panel quantity is unknown.');
    else if (answers.poolPanelSize !== 'normal') addReview('Unusually large or uncertain pool panels need an owner quote.');
    else if (answers.frameCondition !== 'ok') addReview('Pool enclosure frame condition needs owner review.');
    else if (answers.poolScreenMaterial !== 'standard' && answers.poolScreenMaterial !== 'superScreen') addReview('Pool screen material is unknown and needs owner review.');
    else if (!rates.poolPanels[panelType]) addReview('The selected pool enclosure panel has no approved rate.');
    else {
      const material = answers.poolScreenMaterial;
      const rate = rates.poolPanels[panelType][material];
      addFixed((panelType === 'lower' ? 'Lower' : panelType === 'upper' ? 'Upper' : 'Roof') + ' pool enclosure panel (' + (material === 'superScreen' ? 'Super Screen' : 'standard mesh') + ')', count, rate);
    }
  } else if (answers.service === 'pool_restoration') {
    const selected = Array.isArray(answers.restorationServices) ? answers.restorationServices : [];
    if (selected.includes('rescreening')) addReference('Enclosure rescreening: approximately ' + formatMoney(rateCents(rates.poolRestoration.rescreeningStartingReference)) + ' starting reference; not a guaranteed price.', 'Pool enclosure rescreening needs owner review.');
    if (selected.includes('cleaning')) {
      addRange('Enclosure cleaning', 1, rates.poolRestoration.cleaningMinimum, rates.poolRestoration.cleaningMaximum);
      addReview('John selects the enclosure cleaning amount within the range based on job conditions.');
    }
    if (selected.includes('hurricane_cables')) {
      const count = knownCount(answers, 'cableCount');
      if (count === null) addReview('Hurricane cable quantity is unknown.');
      else if (count > 0) addFixed('Hurricane cable installation', count, rates.poolRestoration.hurricaneCable);
    }
    if (selected.includes('paint_rescreening')) {
      const count = knownCount(answers, 'runCount');
      const runText = count === null ? 'one run' : count + (count === 1 ? ' run' : ' runs');
      addReference('Painting, rescrewing, and new screening: ' + formatMoney(rateCents(rates.poolRestoration.paintRescreeningPerRunReference)) + ' per ' + runText + ' reference; excluded until John defines each run.', 'The per-run restoration scope must be defined by John before calculating a total.');
    }
    if (answers.frameCondition !== 'ok') addReview('Pool enclosure frame condition or structural concerns need owner review.');
    if (!selected.length) addReview('Choose the restoration services or ask John to review the scope.');
  } else if (answers.service === 'window_rescreen') {
    const count = knownCount(answers, 'windowCount');
    if (answers.wholeHome !== 'yes') addReview('The $30 rate applies only when all window screens at the home are serviced.');
    else if (count === null) addReview('Window screen quantity is unknown.');
    else if (answers.framesReusable !== 'yes') addReview('Frame repairs or uncertain frame reuse need owner pricing.');
    else if (answers.customWindowSizes !== 'no') addReview('Custom or unusual window sizes need owner pricing.');
    else addFixed('Whole-home window rescreening', count, rates.windowRescreen.wholeHomePerScreen);
  } else if (answers.service === 'patio_door') {
    const count = knownCount(answers, 'patioDoorCount');
    if (answers.rescreenExistingDoor !== 'yes') addReview('Complete sliding-door replacement is not priced by the rescreening rate.');
    else if (count === null) addReview('Sliding patio door quantity is unknown.');
    else if (answers.frameCondition !== 'ok') addReview('Sliding patio door frame condition needs owner review.');
    else {
      addRange('Sliding patio screen door rescreening', count, rates.patioDoor.perDoorMinimum, rates.patioDoor.perDoorMaximum);
      addReview('John confirms the price within the per-door range based on size and screen type.');
    }
  } else if (answers.service === 'aluminum_door') {
    const count = knownCount(answers, 'aluminumDoorCount');
    const amount = rates.aluminumDoor.perDoorReference;
    if (rates.aluminumDoor.materialAndHardwareConfirmed && count !== null && answers.aluminumFrameCondition === 'ok') {
      addFixed('Aluminum screen door replacement', count, amount);
    } else {
      addReference((count === null ? 'Aluminum screen door replacement: ' : count + ' aluminum screen door' + (count === 1 ? '' : 's') + ': ') + formatMoney(rateCents(amount)) + ' per-door reference; excluded until door, material, and hardware inclusion is confirmed.', 'The $420 aluminum door scope needs owner confirmation before it can be totaled.');
    }
    if (answers.aluminumFrameCondition !== 'ok') addReview('Surrounding aluminum door frame condition needs owner review.');
    if (count === null) addReview('Aluminum screen door quantity is unknown.');
  } else if (answers.service === 'regular_door') {
    const count = knownCount(answers, 'regularDoorCount');
    if (answers.rescreenExistingDoor !== 'yes') addReview('Complete screen door replacement is not priced by the rescreening rate.');
    else if (count === null) addReview('Screen door quantity is unknown.');
    else {
      const sectionRates = {
        bottom: rates.regularDoor.bottomSection,
        top: rates.regularDoor.topSection,
        both: rates.regularDoor.bothSections
      };
      const rate = sectionRates[answers.doorSections];
      if (rate === undefined) addReview('Choose which screen door sections need rescreening.');
      else addFixed((answers.doorSections === 'bottom' ? 'Bottom' : answers.doorSections === 'top' ? 'Top' : 'Both') + ' screen door section' + (count === 1 ? '' : 's'), count, rate);
    }
  } else {
    addReview('This service is not in the approved price catalog.');
  }

  if (answers.additionalWork && answers.additionalWork !== UNKNOWN_ANSWER && answers.additionalWork.trim()) addReview('Additional work needs owner review because it is not part of the selected price rules.');
  const minimum = lines.reduce((sum, line) => sum + line.minimum, 0);
  const maximum = lines.reduce((sum, line) => sum + line.maximum, 0);
  return {lines, references, review, minimum, maximum};
}
