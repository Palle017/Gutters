import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateEstimate, UNKNOWN_ANSWER, validatePricingCatalog} from '../site/js/estimate-pricing.js';

const catalog = validatePricingCatalog(JSON.parse(await readFile(new URL('../site/pricing-catalog.json', import.meta.url), 'utf8')));

test('catalog is explicit, bounded data and keeps unresolved rates marked for owner review', () => {
  assert.equal(catalog.rates.aluminumDoor.materialAndHardwareConfirmed, false);
  assert.ok(catalog.ownerReviewRules.some(rule => rule.includes('Exactly 100')));
  assert.throws(() => validatePricingCatalog({...catalog, rates: {...catalog.rates, gutters: {...catalog.rates.gutters, twoStoryPerFoot: -1}}}));
});

test('gutter calculations use total footage, separate story rates and explicit downspout counts', () => {
  const result = calculateEstimate({
    service: 'gutters',
    gutterLayout: 'mixed',
    singleStoryFeet: '30',
    twoStoryFeet: '80',
    singleDownspouts: '1',
    twoDownspouts: '2',
    removeExistingGutters: 'no'
  }, catalog);
  assert.deepEqual(result.lines.map(line => line.minimum), [24000, 96000, 10000, 40000]);
  assert.equal(result.minimum, 170000);
  assert.equal(result.review.length, 0);
});

test('exactly 100 feet leaves the one-story portion unpriced and flags owner review', () => {
  const result = calculateEstimate({
    service: 'gutters',
    gutterLayout: 'mixed',
    singleStoryFeet: '40',
    twoStoryFeet: '60',
    singleDownspouts: '0',
    twoDownspouts: '0',
    removeExistingGutters: 'no'
  }, catalog);
  assert.deepEqual(result.lines.map(line => line.minimum), [72000]);
  assert.ok(result.review.some(item => item.includes('Exactly 100')));
});

test('standard Super Screen doubles only standard lower and upper panel rates', () => {
  const lower = calculateEstimate({
    service: 'standard_screens',
    screenPanelType: 'lower_standard',
    panelCount: '2',
    panelSize: 'normal',
    screenMaterial: 'superScreen',
    frameCondition: 'ok'
  }, catalog);
  assert.equal(lower.minimum, 14000);
  assert.equal(lower.review.length, 0);
  const pet = calculateEstimate({
    service: 'standard_screens',
    screenPanelType: 'pet_screen',
    panelCount: '1',
    panelSize: 'normal',
    screenMaterial: 'superScreen',
    frameCondition: 'ok'
  }, catalog);
  assert.equal(pet.lines.length, 0);
  assert.ok(pet.review.some(item => item.includes('Do not apply')));
});

test('unknown mesh never defaults to standard pricing', () => {
  const result = calculateEstimate({
    service: 'pool_panels',
    poolPanelCount: '1',
    poolPanelType: 'roof',
    poolPanelSize: 'normal',
    poolScreenMaterial: UNKNOWN_ANSWER,
    frameCondition: 'ok'
  }, catalog);
  assert.equal(result.lines.length, 0);
  assert.ok(result.review.some(item => item.includes('material is unknown')));
});

test('pool panel catalog applies explicit Super Screen rates and holds unusual panels', () => {
  const roof = calculateEstimate({
    service: 'pool_panels',
    poolPanelCount: '2',
    poolPanelType: 'roof',
    poolPanelSize: 'normal',
    poolScreenMaterial: 'superScreen',
    frameCondition: 'ok'
  }, catalog);
  assert.equal(roof.minimum, 40000);
  const unusual = calculateEstimate({
    service: 'pool_panels',
    poolPanelCount: '1',
    poolPanelType: 'lower',
    poolPanelSize: 'unusual',
    poolScreenMaterial: 'standard',
    frameCondition: 'ok'
  }, catalog);
  assert.equal(unusual.lines.length, 0);
  assert.ok(unusual.review.length);
});

test('picture-window screen pricing uses supplied dimensions and the per-square-foot rate', () => {
  const result = calculateEstimate({
    service: 'standard_screens',
    screenPanelType: 'picture_window',
    panelCount: '1',
    pictureWidth: '10',
    pictureHeight: '5',
    screenMaterial: 'standard',
    frameCondition: 'ok'
  }, catalog);
  assert.equal(result.minimum, 17500);
});

test('fractional panel quantities are sent for owner review without a calculated price', () => {
  const result = calculateEstimate({
    service: 'standard_screens',
    screenPanelType: 'lower_standard',
    panelCount: '1.5',
    panelSize: 'normal',
    screenMaterial: 'standard',
    frameCondition: 'ok'
  }, catalog);
  assert.equal(result.lines.length, 0);
  assert.ok(result.review.some(item => item.includes('quantity is unknown')));
});

test('whole-home window rate is withheld for partial homes or unreusable frames', () => {
  const partial = calculateEstimate({
    service: 'window_rescreen',
    wholeHome: 'no',
    windowCount: '8',
    framesReusable: 'yes',
    customWindowSizes: 'no'
  }, catalog);
  assert.equal(partial.lines.length, 0);
  const damaged = calculateEstimate({
    service: 'window_rescreen',
    wholeHome: 'yes',
    windowCount: '8',
    framesReusable: 'no',
    customWindowSizes: 'no'
  }, catalog);
  assert.equal(damaged.lines.length, 0);
});

test('restoration keeps starting and per-run references out of subtotal while pricing cable count and cleaning range', () => {
  const result = calculateEstimate({
    service: 'pool_restoration',
    restorationServices: ['rescreening', 'cleaning', 'hurricane_cables', 'paint_rescreening'],
    cableCount: '2',
    runCount: '1',
    frameCondition: 'ok'
  }, catalog);
  assert.equal(result.lines.length, 2);
  assert.equal(result.minimum, 45000);
  assert.equal(result.maximum, 55000);
  assert.equal(result.references.length, 2);
  assert.ok(result.review.some(item => item.includes('per-run')));
});

test('patio doors show a size-based range while the aluminum-door reference stays out of subtotal', () => {
  const patio = calculateEstimate({
    service: 'patio_door',
    patioDoorCount: '2',
    rescreenExistingDoor: 'yes',
    frameCondition: 'ok'
  }, catalog);
  assert.equal(patio.minimum, 8000);
  assert.equal(patio.maximum, 9000);
  const aluminum = calculateEstimate({
    service: 'aluminum_door',
    aluminumDoorCount: '1',
    aluminumFrameCondition: 'ok'
  }, catalog);
  assert.equal(aluminum.lines.length, 0);
  assert.equal(aluminum.minimum, 0);
  assert.ok(aluminum.references.some(item => item.includes('$420.00')));
});

test('screen door section rates are kept separate from full door replacement', () => {
  const both = calculateEstimate({
    service: 'regular_door',
    doorSections: 'both',
    regularDoorCount: '2',
    rescreenExistingDoor: 'yes'
  }, catalog);
  assert.equal(both.minimum, 13000);
  const replacement = calculateEstimate({
    service: 'regular_door',
    doorSections: 'both',
    regularDoorCount: '1',
    rescreenExistingDoor: 'no'
  }, catalog);
  assert.equal(replacement.lines.length, 0);
  assert.ok(replacement.review.length);
});
