// The render primitives: the DOM helpers, the figure, the badge and the unit key.
//
// What these tests are actually defending:
//
//   A number cannot reach the page except through renderClaim(), so every displayed figure
//   carries its badge, its unit kind and its method as attributes a build gate can find.
//   Prose cannot carry a digit, which is the same rule enforced one layer earlier, at the call
//   site, where somebody would otherwise write "40 awards" into a sentence.
//   The four badge kinds are distinguishable with NO colour at all, because a badge whose only
//   difference is a hue is a badge that disappears in greyscale, in forced colours, and for a
//   reader with no colour vision.

import test from 'node:test';
import assert from 'node:assert/strict';

import { el, svgEl, prose, clear, setAttrs, SVG_NS } from '../src/ui/dom.js';
import { figureNode, figureCell, badgeNode, neverClaimedNode, unitKeyNode, BADGE_GEOMETRY } from '../src/ui/figure.js';
import { reported, computed, METHODS, BADGE_SPEC, BADGE_KINDS } from '../src/core/claim.js';
import { OBLIGATIONS, AWARD_VALUE, SHARE, TALLY, UNIT_KINDS } from '../src/core/units.js';
import { neverClaimedById, NEVER_CLAIMED_ITEMS } from '../src/core/never-claimed.js';
import { createDocument } from './helpers/mini-dom.js';
import { META } from './helpers/ui-fixtures.js';

const doc = createDocument();

test('prose refuses a digit, and names the alternative when it does', () => {
  assert.doesNotThrow(() => prose(doc, 'p', 'Obligations are not revenue.'));
  assert.throws(() => prose(doc, 'p', 'The largest 40 contracts.'), /reported\(\) or/);
  assert.throws(() => prose(doc, 'p', 'It received 65.41B in FY2025.'), /badge/);
});

test('prose permits a FISCAL YEAR LABEL and nothing else numeric', () => {
  // A fiscal year names the period a figure belongs to. It is not a quantity, nothing computed
  // it, and it already travels inside every badge on the page.
  assert.doesNotThrow(() => prose(doc, 'p', 'Obligations recorded in FY2025 and FY2024.'));
  assert.throws(() => prose(doc, 'p', 'Obligations of 2025 dollars.'), /digit/);
  assert.throws(() => prose(doc, 'p', 'FY2025 obligations were 65.41B.'), /digit/);
  assert.throws(() => prose(doc, 'p', 'The top 10 buyers.'), /digit/);
});

test('el sets attributes rather than properties and skips absent ones', () => {
  const node = el(doc, 'div', { class: 'panel', hidden: false, title: null, 'data-x': 'y' });
  assert.equal(node.getAttribute('class'), 'panel');
  assert.equal(node.getAttribute('data-x'), 'y');
  assert.equal(node.hasAttribute('hidden'), false);
  assert.equal(node.hasAttribute('title'), false);
});

test('svgEl creates in the SVG namespace, because an HTML rect draws nothing', () => {
  assert.equal(svgEl(doc, 'rect', {}).namespaceURI, SVG_NS);
  assert.equal(el(doc, 'div', {}).namespaceURI, null);
});

test('clear empties a region without assigning markup', () => {
  const node = el(doc, 'div', {}, [el(doc, 'p', {})]);
  clear(node);
  assert.equal(node.childNodes.length, 0);
  assert.equal(node.textContent, '');
});

test('setAttrs accepts a boolean true as a valueless attribute', () => {
  const node = el(doc, 'div');
  setAttrs(node, { hidden: true });
  assert.equal(node.getAttribute('hidden'), '');
});

test('A FIGURE CARRIES ITS BADGE, ITS UNIT KIND AND ITS METHOD AS ATTRIBUTES', () => {
  const claim = reported(65405410468.25, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, META);
  const node = figureNode(doc, claim, { provenance: true });
  assert.equal(node.getAttribute('data-claim-badge'), 'REPORTED');
  assert.equal(node.getAttribute('data-unit-kind'), 'obligations');
  assert.equal(node.getAttribute('data-claim-method'), METHODS.RECIPIENT_PROFILE_TOTAL);
  assert.match(node.textContent, /obligated/);
  assert.match(node.textContent, /REPORTED/);
});

test('the unit noun is inseparable from the figure, in every kind that has one', () => {
  const cases = [
    [reported(1000, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, META), /obligated/],
    [reported(2000, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, META), /lifetime award value/],
    [computed(0.639, SHARE, METHODS.SOLE_BIDDER_SHARE, { ...META, denominatorText: 'x of y.' }), /percent/],
    [reported(217, TALLY, METHODS.RECIPIENT_CHILDREN, { ...META, tallyNoun: 'registered child entity' }), /registered child entities/],
  ];
  for (const [claim, pattern] of cases) {
    assert.match(figureNode(doc, claim).textContent, pattern);
  }
});

test('the badge is VISIBLE text and a SHAPE, so it survives greyscale and forced colours', () => {
  const shapes = new Set();
  for (const kind of BADGE_KINDS) {
    const spec = BADGE_SPEC[kind];
    assert.ok(BADGE_GEOMETRY[spec.shape], 'no geometry for badge shape ' + spec.shape);
    shapes.add(spec.shape);
  }
  assert.equal(shapes.size, BADGE_KINDS.length, 'two badge kinds share a silhouette');

  const claim = computed(0.988, SHARE, METHODS.ONE_CUSTOMER_SHARE, {
    ...META, denominatorText: 'x of y.',
  });
  const badge = badgeNode(doc, claim);
  assert.match(badge.textContent, /COMPUTED/, 'the badge word must be readable text');
  const svg = badge.querySelector('svg');
  assert.ok(svg, 'the badge must draw its own shape');
  assert.equal(svg.getAttribute('aria-hidden'), 'true', 'the shape is decoration over the word');
});

test('the provenance names the endpoint, the year, the award type set and the as-of date', () => {
  const claim = reported(1, OBLIGATIONS, METHODS.SPENDING_BY_CATEGORY, META);
  const text = figureNode(doc, claim, { provenance: true }).textContent;
  assert.match(text, /spending_by_category/);
  assert.match(text, /FY2025/);
  assert.match(text, /contracts/);
  assert.match(text, /09\/21\/2026/);
});

test('a figure with no as-of date says so rather than asserting one', () => {
  const claim = reported(1, OBLIGATIONS, METHODS.SPENDING_BY_CATEGORY, { ...META, sourceAsOf: null });
  assert.match(figureNode(doc, claim, { provenance: true }).textContent,
    /Source as of date unavailable/);
});

test('a table cell carries the FULL value to the cent, never an abbreviation', () => {
  const claim = reported(65405410468.25, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, META);
  const cell = figureCell(doc, claim);
  assert.match(cell.textContent, /65,405,410,468\.25/);
  assert.doesNotMatch(cell.textContent, /65\.41B/);
  assert.equal(cell.getAttribute('data-unit-kind'), 'obligations');
});

test('a NEVER CLAIMED statement renders verbatim, because the gate compares it character for character', () => {
  for (const item of NEVER_CLAIMED_ITEMS) {
    const node = neverClaimedNode(doc, neverClaimedById(item.id));
    assert.equal(node.getAttribute('data-claim-badge'), 'NEVER_CLAIMED');
    assert.equal(node.getAttribute('data-unit-kind'), 'none');
    assert.ok(node.textContent.includes(item.sentence), 'paraphrased: ' + item.id);
  }
});

test('the unit key states what each quantity is and what it is not', () => {
  for (const kind of UNIT_KINDS) {
    const node = unitKeyNode(doc, kind);
    assert.equal(node.getAttribute('data-unit-kind'), kind);
    assert.ok(node.textContent.length > 40);
  }
  assert.match(unitKeyNode(doc, OBLIGATIONS).textContent, /not revenue/i);
  assert.match(unitKeyNode(doc, AWARD_VALUE).textContent, /lifetime/i);
  assert.throws(() => unitKeyNode(doc, 'dollars'), /three and there is no fourth/);
});

test('a bare number cannot be rendered as a figure at all', () => {
  assert.throws(() => figureNode(doc, 65405410468.25), /expected a Claim/);
  assert.throws(() => figureNode(doc, { value: 1, unitKind: 'obligations', badge: 'REPORTED' }),
    /expected a Claim/);
});
