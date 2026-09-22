// THE RECONCILIATION RESIDUAL REACHES THE DOM, TO THE CENT.
//
// WHY THIS NEEDS ITS OWN FILE. src/api/reconcile.js opens with the measurement: three routes to
// the same figure for one parent at FY2025, agreeing to within one cent, and the cent is
// PUBLISHED rather than rounded away. Everything about that promise is a render layer fact. The
// analysis layer can compute a residual of 0.01 perfectly and the page can still round it to
// nothing, or abbreviate it to $0.00B on a chart axis, or drop the segment entirely because a
// tidier panel looked better, and every existing test would stay green.
//
// So these tests PLANT a residual and then assert on the text a reader would actually see. The
// plant is deliberate: a fixture whose two arms happen to agree exactly proves nothing, because a
// renderer that prints zero for everything passes it.
//
// THE CENT IS NOT A DETAIL. It is float addition over hundreds of rows and nothing else. Hiding
// it makes the panel tidier and less true, and a reader who checks the arithmetic against the
// government's own page and finds a cent we hid has every reason to distrust the other eleven
// digits.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reconcileRollup, RESIDUAL_NOTE } from '../src/api/reconcile.js';
import { rollupPanel } from '../src/ui/panels.js';
import { resolveIdentity } from '../src/contracts/identity.js';
import { OBLIGATIONS, formatUnit } from '../src/core/units.js';
import { createDocument } from './helpers/mini-dom.js';
import { TEST_AS_OF } from './helpers/ui-fixtures.js';

const FY = 2025;

/**
 * An identity whose three registered children sum to exactly `childSum`.
 * @param {number[]} amounts
 */
function identityWith(amounts) {
  return resolveIdentity({
    choice: {
      candidate: {
        recipientId: 'test-recipient-id',
        uei: 'TESTPARENT01',
        name: 'TEST PARENT ENTITY',
        level: 'PARENT',
        alternateNames: [],
      },
      how: 'picked-from-list',
    },
    children: amounts.map((obligations, i) => ({
      uei: 'TESTCHILD00' + (i + 1),
      name: 'TEST CHILD ' + (i + 1),
      obligations,
    })),
    childrenExpected: amounts.length,
    fiscalYear: FY,
    awardTypeSetId: 'all',
    rollupComplete: true,
  });
}

/**
 * Plant a residual of exactly `residual` between the child rollup and the parent total, render
 * the real panel with the real renderer, and hand back the text a reader sees.
 *
 * @param {number} residual
 * @param {number[]} [amounts]
 */
function render(residual, amounts = [400, 300, 300]) {
  const identity = identityWith(amounts);
  const childSum = amounts.reduce((a, b) => a + b, 0);
  const reconciliation = reconcileRollup({
    identity,
    parentReportedTotal: childSum - residual,
    sourceAsOf: TEST_AS_OF,
  });
  assert.equal(reconciliation.ok, true);
  const doc = createDocument([]);
  const node = rollupPanel(doc, { reconciliation, identity, onRetry: () => {} });
  doc.body.appendChild(node);
  return { doc, node, reconciliation, text: node.textContent };
}

/* ------------------------------------------------------------------------------------------ */

test('A PLANTED ONE CENT RESIDUAL REACHES THE DOM AS ONE CENT, not as a zero and not as nothing',
  () => {
    const { text, node } = render(0.01);

    assert.match(text, /Child rollup less the parent profile total/,
      'the residual has no row at all in the rendered panel');
    assert.match(text, /\$0\.01/,
      'the cent was rounded away somewhere between the arithmetic and the page');
    assert.doesNotMatch(text, /\$0\.00/,
      'the residual printed as a zero, which is the failure this panel exists to prevent');

    // And it is a BADGED figure with a unit kind, like every other number on this page, rather
    // than a bare string somebody concatenated into a sentence.
    const badged = node.querySelectorAll('[data-claim-badge]')
      .filter((n) => /less the parent profile total/.test(n.textContent));
    assert.ok(badged.length >= 1, 'the residual reached the DOM without a badge');
    // The badge, the method and the unit kind all ride on the figure node itself, which is what
    // gate-badges and gate-units read. A residual without a unit kind could be read as anything.
    assert.equal(badged[0].getAttribute('data-unit-kind'), OBLIGATIONS,
      'the residual carries unit kind ' + JSON.stringify(badged[0].getAttribute('data-unit-kind')));
    assert.equal(badged[0].getAttribute('data-claim-badge'), 'COMPUTED',
      'the residual is arithmetic this page performed, so it is badged COMPUTED and not REPORTED');
    assert.ok(String(badged[0].getAttribute('aria-label')).includes('0.01'),
      'the accessible label does not carry the cent, so a screen reader is told a different '
      + 'number from the one on the screen: ' + badged[0].getAttribute('aria-label'));
  });

test('THE CONTROL FOR THE TEST ABOVE: the two ways of printing a cent are actually different, so '
  + 'the assertion can tell them apart', () => {
  // Without this, "the page says $0.01" is an assertion nobody has watched fail. The abbreviated
  // form is what a chart axis uses and what a tidier panel would reach for, and it is exactly
  // what would hide the cent.
  assert.equal(formatUnit(0.01, OBLIGATIONS, { form: 'full' }), '$0.01 obligated');
  assert.equal(formatUnit(0.01, OBLIGATIONS, { form: 'abbrev' }), '$0.01 obligated');
  // At the scale the real reconciliation runs at, the two forms diverge completely, which is the
  // case that matters: 65.41 billion abbreviated loses eleven digits and every cent with them.
  assert.equal(formatUnit(65405410468.25, OBLIGATIONS, { form: 'full' }), '$65,405,410,468.25 obligated');
  assert.equal(formatUnit(65405410468.25, OBLIGATIONS, { form: 'abbrev' }), '$65.41B obligated');

  // And the panel uses the full form. If somebody switches it to the abbreviated one, the arms
  // table stops carrying the digits the residual is a difference between.
  const { text } = render(0.01, [65405410468.26, 0, 0]);
  assert.match(text, /\$65,405,410,468\.26/, 'the arms table abbreviated an eleven digit figure');
  assert.doesNotMatch(text, /\$65\.41B/, 'the arms table abbreviated an eleven digit figure');
  assert.match(text, /\$0\.01/);
});

test('THE RESIDUAL IS RENDERED WHEN IT IS EXACTLY ZERO TOO, because a panel that only shows a '
  + 'difference when there is one teaches a reader nothing about the runs where there is not', () => {
  const { text } = render(0);
  assert.match(text, /Child rollup less the parent profile total/);
  assert.match(text, /\$0\.00/);
});

test('A RESIDUAL LARGER THAN A CENT IS PRINTED IN FULL, to the cent, and never abbreviated', () => {
  const { text } = render(1234.56, [1000000, 234.56, 0]);
  assert.match(text, /\$1,234\.56/, 'the residual was abbreviated or rounded');
  assert.doesNotMatch(text, /\$1\.23K/);
});

test('A NEGATIVE RESIDUAL KEEPS ITS SIGN, because which way the two figures miss is the whole '
  + 'information in it', () => {
  const { text } = render(-0.01);
  assert.match(text, /-\$0\.01|\(\$0\.01\)|\$-0\.01/,
    'a residual in the other direction lost its sign: ' + text.slice(0, 400));
});

test('THE NOTE THAT SAYS WHY THE CENT IS SHOWN TRAVELS WITH IT', () => {
  const { text } = render(0.01);
  const firstClause = RESIDUAL_NOTE.split('.')[0];
  assert.ok(text.includes(firstClause),
    'the residual is on the page with no statement of what it is, which is how a reader concludes '
    + 'the arithmetic is broken rather than that it was shown on purpose');
});

test('THE THIRD ARM ADDS A SECOND RESIDUAL WHEN IT IS COMPARABLE, and both reach the page', () => {
  const identity = identityWith([400, 300, 300]);
  const reconciliation = reconcileRollup({
    identity,
    parentReportedTotal: 999.99,
    categoryBreakdown: { rows: [{ amount: 1000.02 }], total: 1000.02 },
    sourceAsOf: TEST_AS_OF,
  });
  assert.equal(reconciliation.ok, true);
  assert.equal(reconciliation.residuals.length, 2);

  const doc = createDocument([]);
  const node = rollupPanel(doc, { reconciliation, identity, onRetry: () => {} });
  const text = node.textContent;
  assert.match(text, /Child rollup less the parent profile total/);
  assert.match(text, /Entity breakdown less the parent profile total/);
  assert.match(text, /\$0\.01/, 'the child rollup residual is missing from the page');
  assert.match(text, /\$0\.03/, 'the entity breakdown residual is missing from the page');
});

test('AN INCOMPLETE ROLLUP PUBLISHES NO RESIDUAL AT ALL, because a difference against a short sum '
  + 'is not a residual, it is a made up number', () => {
  const identity = resolveIdentity({
    choice: {
      candidate: {
        recipientId: 'test-recipient-id',
        uei: 'TESTPARENT01',
        name: 'TEST PARENT ENTITY',
        level: 'PARENT',
        alternateNames: [],
      },
      how: 'picked-from-list',
    },
    children: [{ uei: 'TESTCHILD001', name: 'TEST CHILD 1', obligations: 400 }],
    childrenExpected: 3,
    fiscalYear: FY,
    awardTypeSetId: 'all',
    rollupComplete: false,
  });
  const reconciliation = reconcileRollup({
    identity,
    parentReportedTotal: 999.99,
    sourceAsOf: TEST_AS_OF,
  });
  assert.equal(reconciliation.ok, false);

  const doc = createDocument([]);
  const node = rollupPanel(doc, { reconciliation, identity, onRetry: () => {} });
  const text = node.textContent;
  assert.doesNotMatch(text, /less the parent profile total/);
  assert.match(text, /1 of 3 expected parts arrived/);
  assert.doesNotMatch(text, /\$/, 'a currency figure survived a suppressed rollup');
});
