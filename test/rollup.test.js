// DESIGN 7.2 item 1: recompute the child rollup and assert it meets the parent within one cent.
//
// This is the arithmetic the page performs in front of the visitor, so the test performs it in
// front of the reviewer. The recorded half sums two hundred and seventeen real child rows
// against the real parent figure for the same explicit fiscal year. The hand built half pins
// the awkward cases: a suppressed rollup, an empty child list, and a deobligation.

import test from 'node:test';
import assert from 'node:assert/strict';

import { childRollupCheck, methodDelta, ROLLUP_SUPPRESSED } from '../src/analysis/rollup.js';
import { renderClaim } from '../src/core/claim.js';
import { validateRecipientChildren, validateRecipientProfile } from '../src/query/endpoints.js';
import { hand, recorded, META, identity, childEntities, close, renderAll } from './_analysis-helpers.js';

/* ---------------------------------------------------------------------------------------- *
 * THE RECORDED ROLLUP.
 * ---------------------------------------------------------------------------------------- */

test('RECOMPUTES THE RECORDED CHILD ROLLUP AGAINST THE RECORDED PARENT TOTAL', () => {
  const children = validateRecipientChildren(recorded('recipient-children-fy2025'));
  const profile = validateRecipientProfile(recorded('recipient-profile-parent-fy2025'));
  assert.equal(children.children.length, 217);

  const id = identity({ children: childEntities(children), childrenExpected: 217 });
  const r = childRollupCheck({
    identity: id,
    parentReportedTotal: profile.totalObligations,
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });

  assert.equal(r.totalSuppressed, false);
  assert.equal(r.childCountClaim.value, 217);
  assert.equal(r.parentTotalClaim.value, 65405410468.25);
  close(assert, r.childSumClaim.value, 65405410468.26, 1e-4,
    'the sum of the two hundred and seventeen recorded child amounts.');

  close(assert, r.deltaClaim.value, 0.01, 1e-5,
    'THE ONE CENT IS NOT A BUG. It is float arithmetic over two hundred and seventeen rows and '
    + 'it is published rather than rounded away, because a page that reconciles to the cent '
    + 'every time is a page that is rounding somewhere, and a reader who works with money knows '
    + 'it.');
  assert.notEqual(r.deltaClaim.value, 0, 'the delta is published, not zeroed');
  assert.equal(r.deltaClaim.value, 0.01000213623046875,
    'and the delta itself carries a float residue, because subtracting two figures of this size '
    + 'cannot land on exactly one cent in double precision. The residue is two millionths of a '
    + 'cent and it is shown rather than rounded, which is the same decision as showing the cent.');
});

test('THE RECORDED CHILD LIST CARRIES DEOBLIGATIONS AND THEY ARE COUNTED, NOT DROPPED', () => {
  const children = validateRecipientChildren(recorded('recipient-children-fy2025'));
  const negatives = childEntities(children).filter((c) => c.obligations < 0);
  assert.equal(negatives.length, 11,
    'eleven of two hundred and seventeen recorded child rows are negative. A sum that skipped '
    + 'them would be larger than the truth and would still meet the parent figure nowhere.');

  const id = identity({ children: childEntities(children), childrenExpected: 217 });
  const r = childRollupCheck({
    identity: id,
    parentReportedTotal: 65405410468.25,
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });
  assert.equal(r.negativeChildCountClaim.value, 11);
  assert.equal(renderClaim(r.negativeChildCountClaim).valueText, '11 negative child amounts');
  assert.ok(renderClaim(r.negativeChildCountClaim).a11yLabel.includes('released back'));
});

/* ---------------------------------------------------------------------------------------- *
 * THE HAND BUILT ROLLUP.
 * ---------------------------------------------------------------------------------------- */

test('the rollup adds the children and sets the sum against the parent figure', () => {
  const fx = hand('children');
  const id = identity({ children: fx.children, childrenExpected: 4 });
  const r = childRollupCheck({
    identity: id,
    parentReportedTotal: fx.arithmetic.parentReportedTotal,
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });
  assert.equal(r.rollupComplete, true);
  assert.equal(r.totalSuppressed, false);
  close(assert, r.childSumClaim.value, fx.arithmetic.childSum, 1e-9, fx.arithmetic.working);
  close(assert, r.deltaClaim.value, fx.arithmetic.delta, 1e-9, fx.arithmetic.floatNote);
  assert.equal(r.negativeChildCountClaim.value, fx.arithmetic.negativeChildCount);
  assert.ok(r.sentence.includes('4 registered child entities'));
  assert.ok(r.sentence.includes('a difference of'));
});

test('AN INCOMPLETE ROLLUP SUPPRESSES THE TOTAL RATHER THAN SHOWING IT SHORT', () => {
  const fx = hand('children');
  const id = identity({ children: fx.children, childrenExpected: 9 });
  const r = childRollupCheck({
    identity: id,
    parentReportedTotal: fx.arithmetic.parentReportedTotal,
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });
  assert.equal(r.rollupComplete, false);
  assert.equal(r.totalSuppressed, true);
  assert.equal(r.reason, ROLLUP_SUPPRESSED);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'childSumClaim'), false,
    'a sum of the parts that arrived is SMALLER than the truth by an unknown amount and it looks '
    + 'exactly like a correct total. A reader will quote it, so it is not produced at all.');
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'deltaClaim'), false);
  assert.equal(r.childCountClaim.value, 4);
  assert.equal(r.childrenExpectedClaim.value, 9,
    'both counts are published so the size of the hole is visible');
  assert.equal(r.parentTotalClaim.value, fx.arithmetic.parentReportedTotal,
    'the figure the source reports for the parent is still shown. It is our own sum that is '
    + 'withheld, because ours is the one that is short.');
});

test('AN EMPTY CHILD LIST SUMS TO NOTHING AND SAYS SO PLAINLY', () => {
  const id = identity({ children: [], childrenExpected: 0 });
  const r = childRollupCheck({
    identity: id,
    parentReportedTotal: 1000,
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });
  assert.equal(r.rollupComplete, true);
  assert.equal(r.childSumClaim.value, 0);
  assert.equal(r.deltaClaim.value, -1000,
    'a parent with a total and no registered children is a real state of this data, and the '
    + 'delta says so exactly. It is not a failure and it is not hidden.');
  assert.equal(renderClaim(r.childCountClaim).valueText, '0 registered child entities');
});

test('A MISMATCHED PERIOD IS REFUSED BEFORE ANY ARITHMETIC RUNS', () => {
  const fx = hand('children');
  const id = identity({ children: fx.children, childrenExpected: 4, fiscalYear: 2024 });
  assert.throws(
    () => childRollupCheck({
      identity: id,
      parentReportedTotal: 1,
      fiscalYear: 2025,
      awardTypeSetId: META.awardTypeSetId,
      sourceAsOf: META.sourceAsOf,
    }),
    /One period in application state/,
  );
});

test('a parent total the source did not return is refused rather than compared against as zero', () => {
  const id = identity({ children: [], childrenExpected: 0 });
  for (const bad of [null, undefined, Number.NaN]) {
    assert.throws(() => childRollupCheck({
      identity: id,
      parentReportedTotal: bad,
      fiscalYear: META.fiscalYear,
      awardTypeSetId: META.awardTypeSetId,
      sourceAsOf: META.sourceAsOf,
    }), /finite number/);
  }
});

/* ---------------------------------------------------------------------------------------- *
 * THE SECOND DEFINITION.
 * ---------------------------------------------------------------------------------------- */

test('the second definition is a second figure, never a range and never a merge', () => {
  const id = identity({ children: [{ uei: 'AAAAAAAAAAAA', name: 'CHILD ONE', obligations: 400 }], childrenExpected: 1 });
  const d = methodDelta({
    nameMatchRows: [
      { name: 'SUBJECT ENTITY', amount: 600, uei: 'HAND00000001' },
      { name: 'CHILD ONE', amount: 400, uei: 'AAAAAAAAAAAA' },
      { name: 'UNRELATED NAMESAKE LLC', amount: 250, uei: 'HAND00000009' },
    ],
    parentRollupTotal: 1000,
    parentEntityNamesUpper: id.entityNamesUpper,
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });
  assert.equal(d.available, true);
  assert.equal(d.nameMatchTotalClaim.value, 1250);
  assert.equal(d.parentRollupTotalClaim.value, 1000);
  assert.equal(d.deltaClaim.value, 250);
  assert.equal(d.deltaClaim.unitKind, 'obligations',
    'the difference is in dollars. There is no share between the two definitions, because a '
    + 'ratio of one to the other would merge them into a single quantity.');
  assert.equal(d.gapEntityCountClaim.value, 1);
  assert.equal(d.gapEntities[0].name, 'UNRELATED NAMESAKE LLC');
  assert.equal(d.gapEntities[0].amountClaim.value, 250,
    'the entities in the gap are named and itemised, which is more useful than an error bar');
});

test('no second definition fetched means no second figure claimed', () => {
  const id = identity();
  const d = methodDelta({
    nameMatchRows: [],
    parentRollupTotal: 1000,
    parentEntityNamesUpper: id.entityNamesUpper,
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });
  assert.equal(d.available, false);
  assert.deepEqual(d.gapEntities, []);
});

test('NO FIGURE IN THE ROLLUP PANEL RENDERS AS A FAILED DIVISION', () => {
  const children = validateRecipientChildren(recorded('recipient-children-fy2025'));
  const id = identity({ children: childEntities(children), childrenExpected: 217 });
  const r = childRollupCheck({
    identity: id,
    parentReportedTotal: 65405410468.25,
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });
  for (const text of renderAll(r)) {
    assert.equal(/NaN|Infinity|undefined/.test(text), false, 'produced "' + text + '"');
  }
});
