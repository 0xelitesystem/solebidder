// DESIGN 7.2 item 5: recompute the one customer share and the Herfindahl index.
//
// Two halves. The first recomputes both figures from the RECORDED category response committed
// under test/fixtures/api, which is what makes the published percentage checkable by somebody
// who clones this repository and has never spoken to us. The second pins the behaviour at the
// four awkward inputs using hand built fixtures whose arithmetic is written out in the file.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  topRowShare, herfindahlIndex, cumulativeConcentration, topAwardShare,
} from '../src/analysis/concentration.js';
import { SHARE_UNAVAILABLE } from '../src/analysis/share.js';
import { METHODS, renderClaim, isClaim } from '../src/core/claim.js';
import { validateSpendingByCategory } from '../src/query/endpoints.js';
import { hand, recorded, META, close, renderAll } from './_analysis-helpers.js';

const AGENCY_ARGS = { method: METHODS.ONE_CUSTOMER_SHARE, rowNoun: 'awarding agency', meta: META };

/* ---------------------------------------------------------------------------------------- *
 * THE RECORDED RESPONSE. This is the half that proves a published figure.
 * ---------------------------------------------------------------------------------------- */

test('RECOMPUTES THE ONE CUSTOMER SHARE FROM THE RECORDED CATEGORY RESPONSE', () => {
  const { rows } = validateSpendingByCategory(recorded('category-awarding-agency-fy2025'));
  assert.equal(rows.length, 9);

  const r = topRowShare({ rows, ...AGENCY_ARGS });
  assert.equal(r.available, true);
  assert.equal(r.topName, 'Department of Defense');

  // The nine amounts sum to 64,734,245,175.25 and the largest is 63,941,564,049.57.
  close(assert, r.totalClaim.value, 64734245175.25, 1e-4,
    'the sum of the nine recorded rows.');
  assert.equal(r.topAmountClaim.value, 63941564049.57);
  close(assert, r.topShareClaim.value, 0.9877548409881965, 1e-12,
    'the largest buyer over the sum of every buyer returned.');
  assert.equal(renderClaim(r.topShareClaim).valueText, '98.8 percent',
    'this is the figure the page prints, to the precision it prints it at');
});

test('RECOMPUTES THE HERFINDAHL INDEX FROM THE SAME RECORDED RESPONSE', () => {
  const { rows } = validateSpendingByCategory(recorded('category-awarding-agency-fy2025'));
  const h = herfindahlIndex(rows, 'awarding agency', META);
  assert.equal(h.available, true);
  close(assert, h.indexClaim.value, 0.9757721497260515, 1e-12,
    'the sum of the squares of the nine shares.');
  assert.equal(renderClaim(h.indexClaim).valueText, '97.6 percent');
  assert.ok(renderClaim(h.indexClaim).provenance.includes('Sum of the squares'),
    'the formula ships with the figure, because an index nobody can reproduce is an assertion');
});

test('THE RECORDED RESPONSE CARRIES A DEOBLIGATION AND BOTH FIGURES STILL PUBLISH', () => {
  const { rows } = validateSpendingByCategory(recorded('category-awarding-agency-fy2025'));
  const negatives = rows.filter((r) => r.amount < 0);
  assert.equal(negatives.length, 1,
    'one of the nine recorded buyer rows is negative. A rule that refused to compute in the '
    + 'presence of a negative row would suppress the headline figure of this product on its own '
    + 'flagship example, which is why the guard tests the RESULT and not the inputs.');

  const r = topRowShare({ rows, ...AGENCY_ARGS });
  const h = herfindahlIndex(rows, 'awarding agency', META);
  assert.equal(r.available, true);
  assert.equal(h.available, true);
  assert.equal(r.negativeRowCountClaim.value, 1);
  assert.equal(h.negativeRowCountClaim.value, 1);
  assert.equal(renderClaim(r.negativeRowCountClaim).valueText, '1 negative awarding agency row');
  assert.ok(renderClaim(r.negativeRowCountClaim).a11yLabel.includes('released back'),
    'the reader is told what a negative amount means rather than left to wonder');
});

/* ---------------------------------------------------------------------------------------- *
 * THE HAND BUILT FIXTURES. Arithmetic anybody can check on paper.
 * ---------------------------------------------------------------------------------------- */

test('the one customer share is the top row over the sum of the rows', () => {
  const fx = hand('agency');
  const r = topRowShare({ rows: fx.rows, ...AGENCY_ARGS });
  assert.equal(r.available, true);
  assert.equal(r.topName, fx.arithmetic.topName);
  assert.equal(r.totalClaim.value, fx.arithmetic.total);
  assert.equal(r.topShareClaim.value, fx.arithmetic.topShare);
  assert.equal(renderClaim(r.topShareClaim).valueText, fx.arithmetic.topSharePercentText);
  assert.equal(r.rowCountClaim.value, 3);
  assert.equal(r.negativeRowCountClaim.value, 0);
});

test('the Herfindahl index is the sum of the squares of the shares', () => {
  const fx = hand('agency');
  const h = herfindahlIndex(fx.rows, 'awarding agency', META);
  assert.equal(h.available, true);
  close(assert, h.indexClaim.value, fx.arithmetic.herfindahl, 1e-12, fx.arithmetic.herfindahlWorking);
  assert.equal(renderClaim(h.indexClaim).valueText, '60.5 percent');
});

test('A SINGLE CUSTOMER AT ONE HUNDRED PERCENT PUBLISHES AT BOTH BOUNDARIES', () => {
  const fx = hand('agency-single');
  const r = topRowShare({ rows: fx.rows, ...AGENCY_ARGS });
  const h = herfindahlIndex(fx.rows, 'awarding agency', META);
  assert.equal(r.topShareClaim.value, 1);
  assert.equal(renderClaim(r.topShareClaim).valueText, fx.arithmetic.topSharePercentText);
  assert.equal(h.indexClaim.value, 1);
  assert.equal(r.rowCountClaim.value, 1);
});

test('AN EMPTY RESULT SET PRODUCES A SENTENCE, NOT A ZERO', () => {
  const fx = hand('agency-empty');
  const r = topRowShare({ rows: fx.rows, ...AGENCY_ARGS });
  const h = herfindahlIndex(fx.rows, 'awarding agency', META);
  for (const panel of [r, h]) {
    assert.equal(panel.available, false);
    assert.equal(panel.reason, SHARE_UNAVAILABLE.NO_ROWS);
    assert.equal(Object.prototype.hasOwnProperty.call(panel, 'topShareClaim'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(panel, 'indexClaim'), false);
  }
  assert.equal(r.topName, null);
  assert.equal(r.rowCountClaim.value, 0);
});

test('AN ORDINARY DEOBLIGATION DOES NOT SUPPRESS ANYTHING', () => {
  const fx = hand('agency-deobligation');
  const r = topRowShare({ rows: fx.rows, ...AGENCY_ARGS });
  const h = herfindahlIndex(fx.rows, 'awarding agency', META);
  assert.equal(r.available, true);
  assert.equal(r.totalClaim.value, fx.arithmetic.total);
  close(assert, r.topShareClaim.value, fx.arithmetic.topShare, 1e-12, 'nine hundred over one thousand.');
  assert.equal(renderClaim(r.topShareClaim).valueText, fx.arithmetic.topSharePercentText);
  assert.equal(h.available, true);
  close(assert, h.indexClaim.value, fx.arithmetic.herfindahl, 1e-12, fx.arithmetic.herfindahlWorking);
  assert.notEqual(h.indexClaim.value, fx.arithmetic.herfindahl,
    'and this one lands a few parts in ten to the sixteenth ABOVE 0.86, because 0.2 and 0.1 have '
    + 'no exact binary representation. The residue is real, it is asserted rather than tolerated '
    + 'silently, and it is the same arithmetic that puts the rollup panel one cent out.');
  assert.equal(r.negativeRowCountClaim.value, fx.arithmetic.negativeRowCount);
});

test('A ROW LARGER THAN ITS OWN TOTAL IS REFUSED RATHER THAN PRINTED AS TWO HUNDRED PERCENT', () => {
  const fx = hand('agency-negative');
  const r = topRowShare({ rows: fx.rows, ...AGENCY_ARGS });
  const h = herfindahlIndex(fx.rows, 'awarding agency', META);
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.OUT_OF_RANGE);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'topShareClaim'), false);
  assert.equal(h.available, false);
  assert.equal(h.reason, SHARE_UNAVAILABLE.OUT_OF_RANGE);

  assert.equal(r.topAmountClaim.value, 100,
    'the underlying figures are still shown. Only the quotient is withheld.');
  assert.equal(r.totalClaim.value, fx.arithmetic.total);
  assert.equal(r.negativeRowCountClaim.value, 1);
});

/* ---------------------------------------------------------------------------------------- *
 * THE CUMULATIVE CURVE AND THE TOP AWARD SHARE.
 * ---------------------------------------------------------------------------------------- */

test('THE CUMULATIVE CURVE IS THE RUNNING SHARE OF A DESCENDING SORT', () => {
  const fx = hand('awards');
  const c = cumulativeConcentration({ awardRows: fx.awardRows, meta: META });
  assert.equal(c.available, true);
  assert.equal(c.points.length, 4);
  assert.deepEqual(c.points.map((p) => p.rank), [1, 2, 3, 4]);
  assert.deepEqual(c.points.map((p) => p.label), ['HAND-0001', 'HAND-0002', 'HAND-0003', 'HAND-0004']);
  fx.arithmetic.cumulativeShares.forEach((expected, i) => {
    close(assert, c.points[i].cumulativeShareClaim.value, expected, 1e-12,
      'the running share after rank ' + (i + 1) + '.');
  });
  assert.equal(c.points[3].cumulativeShareClaim.value, 1,
    'the last point is exactly one, because the running total after the last award IS the '
    + 'total. A curve ending at 0.999 has lost a row between the sort and the running total.');
  assert.equal(c.totalClaim.unitKind, 'awardValue',
    'the curve is a share of lifetime award value and it never shares an axis with the fiscal '
    + 'year obligations figure');
});

test('the curve sorts descending regardless of the order the rows arrived in', () => {
  const fx = hand('awards');
  const shuffled = [fx.awardRows[2], fx.awardRows[0], fx.awardRows[3], fx.awardRows[1]];
  const c = cumulativeConcentration({ awardRows: shuffled, meta: META });
  assert.deepEqual(c.points.map((p) => p.label), ['HAND-0001', 'HAND-0002', 'HAND-0003', 'HAND-0004']);
});

test('an empty award set draws no curve and reports why', () => {
  const c = cumulativeConcentration({ awardRows: [], meta: META });
  assert.equal(c.available, false);
  assert.equal(c.reason, SHARE_UNAVAILABLE.NO_ROWS);
  assert.deepEqual(c.points, []);
  assert.equal(c.awardCountClaim.value, 0);
});

test('a curve with an award larger than its own set is suppressed whole, not drawn with a gap', () => {
  const c = cumulativeConcentration({
    awardRows: [
      { awardId: 'HAND-9001', awardValue: 100, generatedInternalId: 'h9001' },
      { awardId: 'HAND-9002', awardValue: -50, generatedInternalId: 'h9002' },
    ],
    meta: META,
  });
  assert.equal(c.available, false);
  assert.equal(c.reason, SHARE_UNAVAILABLE.OUT_OF_RANGE);
  assert.deepEqual(c.points, [],
    'a concentration curve missing a point in the middle is read as a curve, not as a warning');
});

test('the top award share is the largest award over the sum of the same set', () => {
  const fx = hand('awards');
  const t = topAwardShare({ awardRows: fx.awardRows, meta: META });
  assert.equal(t.available, true);
  assert.equal(t.topAwardId, 'HAND-0001');
  assert.equal(t.topShareClaim.value, fx.arithmetic.topAwardShare);
  assert.equal(t.totalClaim.value, fx.arithmetic.total);
  assert.ok(renderClaim(t.topShareClaim).provenance.includes('HAND-0001'),
    'the denominator sentence names the award, so the figure cannot be quoted without its subject');
});

test('an empty award set produces no top award share and no zero', () => {
  const t = topAwardShare({ awardRows: [], meta: META });
  assert.equal(t.available, false);
  assert.equal(t.reason, SHARE_UNAVAILABLE.NO_ROWS);
  assert.equal(t.topAwardId, null);
});

/* ---------------------------------------------------------------------------------------- *
 * The property that must hold across every one of these.
 * ---------------------------------------------------------------------------------------- */

test('NO FIGURE IN ANY CONCENTRATION PANEL RENDERS AS A FAILED DIVISION', () => {
  const sets = ['agency', 'agency-single', 'agency-empty', 'agency-negative', 'agency-deobligation'];
  for (const name of sets) {
    const fx = hand(name);
    const panels = [
      topRowShare({ rows: fx.rows, ...AGENCY_ARGS }),
      herfindahlIndex(fx.rows, 'awarding agency', META),
    ];
    for (const text of renderAll(panels)) {
      assert.equal(/NaN|Infinity|undefined|null/.test(text), false,
        name + ' produced the text "' + text + '", which is what a failed division looks like '
        + 'by the time it reaches a reader');
    }
    for (const c of [panels[0].topShareClaim, panels[1].indexClaim]) {
      if (c !== undefined) assert.equal(isClaim(c), true);
    }
  }
});
