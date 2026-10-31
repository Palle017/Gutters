import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const site = new URL('../site/', import.meta.url);
const tagline = 'We make custom screen door installation a breeze.';
const alt = 'Decorative fish, dolphin, bird, and palm screen doors visualized in coastal house entryways, with a flowing breeze effect through the featured door.';

test('approved coastal breeze section replaces the standalone door gallery on the home and Screens pages', async () => {
  for (const page of ['index.html', 'screens.html']) {
    const source = await readFile(new URL(page, site), 'utf8');
    const document = new JSDOM(source).window.document;
    const section = document.querySelector('#custom-screen-doors');
    assert.equal(document.querySelectorAll('#custom-screen-doors').length, 1, page);
    assert.equal(section.querySelector('.custom-doors-breeze__tagline')?.textContent, tagline);
    assert.equal(section.querySelector('a.button-red')?.getAttribute('href'), 'estimate.html');
    assert.equal(section.querySelector('a[href="tel:+12393553686"]')?.textContent, 'Call John · (239) 355-3686');
    const image = section.querySelector('img');
    assert.equal(image.getAttribute('src'), 'assets/photos/custom-screen-doors/coastal-breeze-approved.png');
    assert.equal(image.getAttribute('width'), '1672');
    assert.equal(image.getAttribute('height'), '941');
    assert.equal(image.getAttribute('loading'), 'lazy');
    assert.equal(image.getAttribute('alt'), alt);
    assert.equal(image.parentElement.querySelector('source')?.getAttribute('srcset'), 'assets/photos/custom-screen-doors/coastal-breeze-approved.webp');
    assert.equal(image.closest('a')?.getAttribute('href'), 'assets/photos/custom-screen-doors/coastal-breeze-approved.png');
    assert.match(section.querySelector('figcaption').textContent, /Design visualizations, not completed-project photographs/);
    assert.doesNotMatch(source, /door-gallery|door-feature|sailfish\.webp|heron-right\.webp|Explore all six design previews/);
    assert.doesNotMatch(source, /fixingfortmyers\.com|239\.397\.2048/);
    assert.ok(document.querySelector('link[href="css/custom-screen-doors-breeze.css"]'));
    assert.equal(document.querySelector('body > a.skip-link:first-child')?.getAttribute('href'), '#main');
  }
  const css = await readFile(new URL('css/styles.css', site), 'utf8');
  const color = name => css.match(new RegExp('--' + name + ':\\s*(#[0-9a-fA-F]{6})'))[1];
  const luminance = hex => {
    const rgb = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const contrast = (first, second) => {
    const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  };
  assert.ok(Math.abs(contrast(color('accent'), color('white')) - 5) < 0.01, 'orange accent on white stays 5.00:1');
});
