// THE SHARE GUARD. src/analysis/share.js.
//
// One rule, tested from every side: a share is either a Claim or a named sentence, and it is
// never a zero, never a blank and never the text a failed division produces.

import test from 'node:test';
import assert from 'node:assert/strict';

import { safeShare, SHARE_UNAVAILABLE, sumField, countNegative, tallyClaim } from '../src/analysis/share.js';
import { METHODS, renderClaim, isClaim } from '../src/core/claim.js';
import { OBLIGATIONS, AWARD_VALUE, TALLY } from '../src/core/units.js';
import { META } from './_analysis-helpers.js';

/** @param {object} over */
function args(over = {}) {
  return {
    numerator: 1,
    denominator: 2,
    numeratorUnitKind: OBLIGATIONS,
    denominatorUnitKind: OBLIGATIONS,
    rowCount: 2,
    method: METHODS.ONE_CUSTOMER_SHARE,
    denominatorText: 'One of two, in a hand built fixture.',
    fiscalYear: META.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
    ...over,
  };
}

test('an ordinary share arrives as a COMPUTED Claim carrying its denominator', () => {
  const r = safeShare(args({ numerator: 3, denominator: 4 }));
  assert.equal(r.available, true);
  assert.equal(r.reason, null);
  assert.ok(isClaim(r.shareClaim));
  assert.equal(r.shareClaim.value, 0.75);
  assert.equal(r.shareClaim.badge, 'COMPUTED');
  assert.equal(r.shareClaim.unitKind, 'share');
  assert.match(renderClaim(r.shareClaim).valueText, /^75\.0 percent$/);
  assert.ok(renderClaim(r.shareClaim).provenance.includes('hand built fixture'));
});

test('AN EMPTY RESULT SET IS NOT ZERO PERCENT, IT IS UNAVAILABLE', () => {
  const r = safeShare(args({ numerator: 0, denominator: 0, rowCount: 0 }));
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.NO_ROWS);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'shareClaim'), false,
    'a suppressed share is an ABSENT key, never a null under a key ending in Claim, because the '
    + 'output walker demands a real Claim of any such key and a panel must ask available first');
});

test('ZERO OVER ZERO NEVER BECOMES A NUMBER', () => {
  const r = safeShare(args({ numerator: 0, denominator: 0, rowCount: 3 }));
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.ZERO_DENOMINATOR);
  assert.equal(Number.isNaN(0 / 0), true,
    'the quotient this guard exists to intercept is the one that produces a value which is not '
    + 'a number, and which formats as three letters a reader will read as a broken page');
});

test('a denominator below zero has no whole for a part to be a share of', () => {
  const r = safeShare(args({ numerator: 10, denominator: -40, rowCount: 3 }));
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.NEGATIVE_DENOMINATOR);
});

test('A QUOTIENT ABOVE ONE HUNDRED PERCENT IS REFUSED, NOT PRINTED', () => {
  const r = safeShare(args({ numerator: 100, denominator: 50, rowCount: 2 }));
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.OUT_OF_RANGE);
});

test('a negative quotient is refused for the same reason', () => {
  const r = safeShare(args({ numerator: -10, denominator: 50, rowCount: 2 }));
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.OUT_OF_RANGE);
});

test('a share of exactly nought and a share of exactly one both publish', () => {
  const zero = safeShare(args({ numerator: 0, denominator: 50, rowCount: 2 }));
  assert.equal(zero.available, true);
  assert.equal(renderClaim(zero.shareClaim).valueText, '0.0 percent');
  const one = safeShare(args({ numerator: 50, denominator: 50, rowCount: 2 }));
  assert.equal(one.available, true);
  assert.equal(renderClaim(one.shareClaim).valueText, '100.0 percent');
});

test('a value the source did not return is refused rather than read as a zero', () => {
  for (const bad of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = safeShare(args({ numerator: bad, denominator: 50, rowCount: 2 }));
    assert.equal(r.available, false, 'numerator ' + String(bad));
    assert.equal(r.reason, SHARE_UNAVAILABLE.NOT_FINITE);
  }
});

test('TWO DIFFERENT UNIT KINDS IN ONE QUOTIENT THROW RATHER THAN SUPPRESS', () => {
  assert.throws(
    () => safeShare(args({ denominatorUnitKind: AWARD_VALUE })),
    /SAME unit kind/,
    'this one is a programming mistake, not a data condition, so it fails loudly at the call '
    + 'site. Obligations divided by lifetime award value is a percentage of nothing.',
  );
});

test('a missing row count is a programming mistake and throws', () => {
  assert.throws(() => safeShare(args({ rowCount: undefined })), /rowCount/);
  assert.throws(() => safeShare(args({ rowCount: -1 })), /rowCount/);
});

test('sumField refuses a row it cannot add rather than skipping it', () => {
  assert.equal(sumField([{ a: 1 }, { a: 2.5 }], 'a'), 3.5);
  assert.equal(sumField([], 'a'), 0);
  assert.throws(() => sumField([{ a: 1 }, { a: null }], 'a'), /finite number was contracted/);
  assert.throws(() => sumField([{ a: 1 }, {}], 'a'), /rows\[1\]\.a/);
});

test('sumField adds a deobligation rather than dropping it', () => {
  assert.equal(sumField([{ a: 100 }, { a: -40 }], 'a'), 60);
});

test('countNegative counts the releases a panel has to disclose', () => {
  assert.equal(countNegative([{ a: 1 }, { a: -1 }, { a: 0 }, { a: -0.01 }], 'a'), 2);
  assert.equal(countNegative([], 'a'), 0);
});

test('a tally names what it counts and can never be a currency string', () => {
  const c = tallyClaim(3, 'excluded award row', METHODS.SOLE_BIDDER_SHARE, META);
  assert.equal(c.unitKind, TALLY);
  assert.equal(renderClaim(c).valueText, '3 excluded award rows');
  const one = tallyClaim(1, 'excluded award row', METHODS.SOLE_BIDDER_SHARE, META);
  assert.equal(renderClaim(one).valueText, '1 excluded award row');
  const none = tallyClaim(0, 'excluded award row', METHODS.SOLE_BIDDER_SHARE, META);
  assert.equal(renderClaim(none).valueText, '0 excluded award rows',
    'a tally of nought is a real measurement and it is published. It is a share that is '
    + 'unavailable rather than zero, not a count.');
});

test('A TALLY NOUN THAT IS A CLAUSE IS REFUSED, BECAUSE THE PLURALISER INFLECTS ITS LAST WORD', () => {
  assert.throws(
    () => tallyClaim(3, 'award row dropped by the entity set filter', METHODS.SOLE_BIDDER_SHARE, META),
    /Move the explanation into the note/,
    'that noun would be announced as "3 award row dropped by the entity set filters", which '
    + 'counts filters rather than rows in the reader ear. The explanation goes in the note.',
  );
  assert.throws(
    () => tallyClaim(3, 'award with a gap', METHODS.SOLE_BIDDER_SHARE, META),
    /clause rather than a noun phrase/,
    'and a short phrase whose head is not last is caught by the same rule',
  );
  assert.doesNotThrow(() => tallyClaim(3, 'excluded award row', METHODS.SOLE_BIDDER_SHARE, META,
    'A row the award search endpoint returned whose recipient is not in the resolved set.'));
});

test('the note travels with the tally into the accessible label', () => {
  const c = tallyClaim(2, 'not competed award', METHODS.SOLE_BIDDER_SHARE, META,
    'Counted only where the competition field holds the exact value.');
  assert.equal(renderClaim(c).valueText, '2 not competed awards');
  assert.ok(renderClaim(c).a11yLabel.includes('exact value'));
});
