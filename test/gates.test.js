// THE GATES THEMSELVES. Each gate's positive controls run here as well as in CI, so a gate that
// stops detecting its own violation fails the test suite rather than passing quietly forever.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selftest as badgeSelftest, scanHtmlForBadges, scanJsForBadges, scanJsForEstimates } from '../scripts/gate-badges.mjs';
import { selftest as unitSelftest } from '../scripts/gate-units.mjs';
import { selftest as vocabSelftest } from '../scripts/gate-vocabulary.mjs';
import { selftest as contrastSelftest, checkPairs, checkRamps } from '../scripts/gate-contrast.mjs';
import { scanText } from '../scripts/banned-vocabulary.mjs';
import { contrastRatio, THEMES, PAIRS, UNIT_RAMPS, MONEY_RAMP_PAIR, AA_NORMAL, AA_NON_TEXT, MIN_RAMP_SEPARATION } from '../src/core/tokens.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('gate-badges positive controls all pass', () => {
  assert.equal(badgeSelftest(), 0);
});

test('gate-units positive controls all pass', () => {
  assert.equal(unitSelftest(), 0);
});

test('gate-vocabulary positive controls all pass', () => {
  assert.equal(vocabSelftest(), 0);
});

test('gate-contrast positive controls all pass', () => {
  assert.equal(contrastSelftest(), 0);
});

test('every declared text pair clears AA in both themes', () => {
  assert.equal(checkPairs(), 0);
  // And independently, without the gate, so a broken gate cannot hide a broken palette.
  for (const [, theme] of Object.entries(THEMES)) {
    for (const pair of PAIRS) {
      const r = contrastRatio(theme.text[pair.text], theme.surface[pair.surface]);
      assert.ok(r >= AA_NORMAL, pair.text + ' on ' + pair.surface + ' is ' + r.toFixed(2));
    }
  }
});

test('the ramps separate by math and by pattern, in both themes', () => {
  assert.equal(checkRamps(), 0);
  const [a, b] = MONEY_RAMP_PAIR.map((id) => UNIT_RAMPS[id]);
  for (const theme of ['dark', 'light']) {
    assert.ok(contrastRatio(a[theme], b[theme]) >= MIN_RAMP_SEPARATION);
    assert.ok(contrastRatio(a[theme], THEMES[theme].surface.base) >= AA_NON_TEXT);
    assert.ok(contrastRatio(b[theme], THEMES[theme].surface.base) >= AA_NON_TEXT);
  }
  assert.notEqual(a.pattern, b.pattern, 'the pattern is what survives greyscale and high contrast');
  assert.notEqual(a.forcedColors, b.forcedColors);
});

test('the badge gate catches an unbadged figure in the page', () => {
  const { hits } = scanHtmlForBadges('<p>Lockheed received 65,405,410,468.25 last year.</p>', 'control');
  assert.ok(hits.length > 0);
});

test('the badge gate catches a number written straight into the DOM', () => {
  assert.ok(scanJsForBadges('el.textContent = v.toFixed(2);', 'control').length > 0);
  assert.equal(scanJsForBadges('el.textContent = renderClaimText(c);', 'control').length, 0);
});

test('the badge gate catches an attempt to publish an estimate', () => {
  assert.ok(scanJsForEstimates('const c = estimated(0.5, SHARE, m, x);', 'control').length > 0);
  assert.equal(scanJsForEstimates('const c = computed(0.5, SHARE, m, x);', 'control').length, 0);
});

test('the vocabulary gate catches each NEVER CLAIMED item stated as a claim', () => {
  const attempts = [
    'Lockheed Martin revenue for the year.',
    'Outlays by fiscal year.',
    'See everything the company gets.',
    'The audited corporate tree.',
    'The losing bidders on this contract.',
    'A complete record of federal contracting.',
    'All-time totals for this recipient.',
    'Backlog against obligations.',
    'Keyed on the DUNS number.',
  ];
  for (const text of attempts) {
    assert.ok(scanText(text, 'control', 'shipped').length > 0, 'not caught: ' + text);
  }
});

test('the shipped page carries the one host allowlist and nothing else', async () => {
  const raw = await readFile(path.join(REPO, 'index.html'), 'utf8');
  // The policy is written with the keyword quotes as character references, because the
  // authoritative runner gate reads them that way. Decode before parsing, or the entity's own
  // semicolon truncates the directive.
  const html = raw.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const m = /connect-src ([^;"]+)/.exec(html);
  assert.ok(m, 'no connect-src allowlist in the page');
  const hosts = m[1].trim().split(/\s+/).filter((h) => h.startsWith('http'));
  assert.deepEqual(hosts, ['https://api.usaspending.gov']);
  assert.ok(/connect-src 'self'/.test(html), "the page itself must stay in the allowlist");
});

test('no dash of either long form appears anywhere in the shipped tree', async () => {
  for (const rel of ['index.html', 'README.md']) {
    const text = await readFile(path.join(REPO, rel), 'utf8');
    assert.ok(!/[—–]/.test(text), rel + ' carries a long dash');
  }
});
