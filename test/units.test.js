// THE UNIT RENDERER, AND THE ASSERTION THAT NO NUMERIC LITERAL REACHES THE DOM OUTSIDE IT.
//
// This file carries the test DESIGN 7.2 item 6 names: no currency string reaches the DOM except
// through the unit aware renderer, and no chart component receives two unit kinds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UNIT_KINDS, QUANTITY_KINDS, OBLIGATIONS, AWARD_VALUE, SHARE, TALLY, UNIT_SPEC,
  formatUnit, formatUnitBare, formatTally, weldHeader, assertFiscalYear, unitA11yLabel,
  FISCAL_YEAR_FLOOR,
} from '../src/core/units.js';
import { scanForCurrencyLiteral, scanForCurrencyFormatter, scanForUnbadgedDomWrites } from '../scripts/gate-units.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every .js file under src/, as {rel, text}. */
async function sourceFiles(dir = path.join(REPO, 'src'), out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await sourceFiles(full, out);
    else if (e.name.endsWith('.js')) {
      out.push({ rel: path.relative(REPO, full).split(path.sep).join('/'), text: await readFile(full, 'utf8') });
    }
  }
  return out;
}

test('there are exactly three unit kinds and they are the three the design names', () => {
  assert.deepEqual([...UNIT_KINDS], ['obligations', 'awardValue', 'share']);
  assert.equal(UNIT_KINDS.length, 3);
  assert.deepEqual([...QUANTITY_KINDS], ['obligations', 'awardValue', 'share', 'tally']);
});

test('every unit kind has a spec with a noun, an axis label and a ramp', () => {
  for (const kind of UNIT_KINDS) {
    const spec = UNIT_SPEC[kind];
    assert.ok(spec, kind + ' has no spec');
    assert.ok(spec.noun.length > 0);
    assert.ok(spec.axisLabel.length > 0);
    assert.ok(spec.rampId.length > 0);
    assert.ok(spec.notRevenue.length > 0);
  }
});

test('formatUnit cannot be called without a unit kind', () => {
  assert.throws(() => formatUnit(65405410468.25), TypeError);
  assert.throws(() => formatUnit(65405410468.25, undefined), TypeError);
  assert.throws(() => formatUnit(65405410468.25, 'dollars'), TypeError);
  assert.throws(() => formatUnit(65405410468.25, 'USD'), TypeError);
});

test('the unit noun is welded to every formatted figure', () => {
  const obligations = formatUnit(65405410468.25, OBLIGATIONS);
  const award = formatUnit(421660000000, AWARD_VALUE);
  assert.match(obligations, /obligated$/);
  assert.match(award, /in lifetime award value$/);
  assert.equal(formatUnit(0.988, SHARE), '98.8 percent');
  // The two money kinds must be distinguishable in text alone, not only by colour.
  assert.notEqual(obligations.replace(/[\d,.]/g, ''), award.replace(/[\d,.]/g, ''));
});

test('a share is a decimal fraction and a percentage point value is refused', () => {
  assert.equal(formatUnit(0.639, SHARE), '63.9 percent');
  assert.throws(() => formatUnit(98.8, SHARE), RangeError);
  assert.throws(() => formatUnit(-0.1, SHARE), RangeError);
});

test('full form carries the cents and abbreviated form is opt in', () => {
  assert.equal(formatUnit(65405410468.25, OBLIGATIONS), '$65,405,410,468.25 obligated');
  assert.equal(formatUnit(65405410468.25, OBLIGATIONS, { form: 'abbrev' }), '$65.41B obligated');
  assert.equal(formatUnitBare(65405410468.25, OBLIGATIONS), '$65,405,410,468.25');
  assert.throws(() => formatUnit(1, OBLIGATIONS, { form: 'compact' }), TypeError);
});

test('a null or a non finite figure is refused rather than rendered as a zero', () => {
  assert.throws(() => formatUnit(null, OBLIGATIONS), TypeError);
  assert.throws(() => formatUnit(undefined, OBLIGATIONS), TypeError);
  assert.throws(() => formatUnit(NaN, OBLIGATIONS), TypeError);
  assert.throws(() => formatUnit(Infinity, OBLIGATIONS), TypeError);
});

test('a tally names what it counts and can never be currency', () => {
  assert.equal(formatTally(217, 'registered child entity'), '217 registered child entities');
  assert.equal(formatTally(1, 'award'), '1 award');
  assert.equal(formatTally(40, 'award'), '40 awards');
  assert.throws(() => formatTally(3), TypeError);
  assert.throws(() => formatTally(3.5, 'award'), RangeError);
  assert.ok(!formatTally(217, 'child').includes('$'));
});

test('the header string carries the entity, the unit and the fiscal year as one string', () => {
  const header = weldHeader('Lockheed Martin', 65405410468.25, OBLIGATIONS, 2025);
  assert.equal(header, 'Lockheed Martin, $65.41B obligated in FY2025');
  assert.ok(header.includes('obligated'));
  assert.ok(header.includes('FY2025'));
  assert.throws(() => weldHeader('', 1, OBLIGATIONS, 2025), TypeError);
  assert.throws(() => weldHeader('X', 1, OBLIGATIONS), TypeError);
});

test('a fiscal year is explicit, integral and at or after the floor', () => {
  assert.equal(assertFiscalYear(2025, 't'), 2025);
  assert.throws(() => assertFiscalYear('2025', 't'), TypeError);
  assert.throws(() => assertFiscalYear(2025.5, 't'), TypeError);
  assert.throws(() => assertFiscalYear(FISCAL_YEAR_FLOOR - 1, 't'), RangeError);
});

test('the accessible label states the value, the unit and the badge kind', () => {
  const label = unitA11yLabel(65405410468.25, OBLIGATIONS, 'REPORTED', { context: 'FY2025' });
  assert.ok(label.startsWith('FY2025, '));
  assert.ok(label.includes('obligated'));
  assert.ok(label.endsWith('REPORTED'));
});

test('THE CURRENCY SYMBOL APPEARS IN EXACTLY ONE SOURCE FILE', async () => {
  const files = await sourceFiles();
  const offenders = [];
  for (const f of files) {
    if (f.rel === 'src/core/units.js') continue;
    const hits = scanForCurrencyLiteral(f.text, f.rel);
    if (hits.length) offenders.push(f.rel + ':' + hits[0].line + ' ' + hits[0].match);
  }
  assert.deepEqual(offenders, [], 'a second path from a number to a currency string exists, and '
    + 'nobody made that one take a unit kind');
});

test('no second currency formatter exists', async () => {
  const files = await sourceFiles();
  const offenders = [];
  for (const f of files) {
    if (f.rel === 'src/core/units.js') continue;
    const hits = scanForCurrencyFormatter(f.text);
    if (hits.length) offenders.push(f.rel + ':' + hits[0].line);
  }
  assert.deepEqual(offenders, []);
});

test('NO NUMERIC LITERAL REACHES THE DOM OUTSIDE THE UNIT RENDERER', async () => {
  const files = await sourceFiles();
  const offenders = [];
  for (const f of files) {
    for (const h of scanForUnbadgedDomWrites(f.text, f.rel)) {
      offenders.push(f.rel + ':' + h.line + '  ' + h.detail);
    }
  }
  assert.deepEqual(offenders, [], 'every figure reaches the DOM through renderClaim or the unit '
    + 'renderer, or it reaches a reader with no statement of what it is');
});

test('the shipped page never carries a unit kind outside the declared set', async () => {
  const html = await readFile(path.join(REPO, 'index.html'), 'utf8');
  const valid = new Set([...UNIT_KINDS, TALLY, 'none']);
  const re = /data-unit-kind\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    assert.ok(valid.has(m[1]), 'index.html declares unit kind ' + JSON.stringify(m[1]));
  }
});
