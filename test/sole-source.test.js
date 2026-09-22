// DESIGN 7.2 item 4: the sole bidder share and the one offer cross check.
//
// THE FIRST TEST IN THIS FILE IS THE MOST IMPORTANT ONE IN THE ANALYSIS LAYER. The definition
// of not competed is one exact value of one field. Widening it by a single neighbouring value
// would raise the headline percentage, and it would raise it in the direction that makes the
// story louder. So the definition is asserted directly, and then asserted again through the
// arithmetic with a fixture that contains exactly the value a substring test would wrongly
// sweep in.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NOT_COMPETED, isNotCompeted, joinAwardDetails, soleBidderShare, oneOfferShare,
  competitionRows, NO_USABLE_OFFERS_FIELD,
} from '../src/analysis/competition.js';
import { SHARE_UNAVAILABLE } from '../src/analysis/share.js';
import { renderClaim, isClaim } from '../src/core/claim.js';
import { hand, META, close, renderAll } from './_analysis-helpers.js';

/* ---------------------------------------------------------------------------------------- *
 * THE DEFINITION.
 * ---------------------------------------------------------------------------------------- */

test('NOT COMPETED IS ONE EXACT VALUE AND THE TEST IS EQUALITY, NEVER CONTAINMENT', () => {
  assert.equal(NOT_COMPETED, 'NOT COMPETED');
  assert.equal(isNotCompeted('NOT COMPETED'), true);
  assert.equal(isNotCompeted('not competed'), true, 'case is a transport artefact, not meaning');
  assert.equal(isNotCompeted('  NOT COMPETED  '), true, 'and so is surrounding whitespace');

  const neighbours = [
    'NOT COMPETED UNDER SAP',
    'NOT AVAILABLE FOR COMPETITION',
    'COMPETED UNDER SAP',
    'FULL AND OPEN COMPETITION',
    'FULL AND OPEN COMPETITION AFTER EXCLUSION OF SOURCES',
    'FOLLOW ON TO COMPETED ACTION',
    'NOT COMPETED UNDER SIMPLIFIED ACQUISITION PROCEDURES',
  ];
  for (const value of neighbours) {
    assert.equal(isNotCompeted(value), false,
      '"' + value + '" is a different value of the same field. Counting it would raise the '
      + 'headline percentage, and it would raise it in the direction that makes the story '
      + 'louder, which is the worst direction for an error to point in a product whose entire '
      + 'argument is that its numbers can be checked.');
  }
});

test('an absent competition field is not evidence either way', () => {
  for (const value of [null, undefined, '', 0, {}, []]) {
    assert.equal(isNotCompeted(value), false);
  }
});

test('the join is by generated internal id and the misses are visible', () => {
  const rows = [{ generatedInternalId: 'a' }, { generatedInternalId: 'b' }];
  const joined = joinAwardDetails(rows, [{ generatedInternalId: 'b', extentCompeted: 'NOT COMPETED' }]);
  assert.equal(joined.length, 2);
  assert.equal(joined[0].detail, null);
  assert.equal(joined[1].detail.extentCompeted, 'NOT COMPETED');
  assert.throws(() => joinAwardDetails(rows, undefined), /even empty/);
});

/* ---------------------------------------------------------------------------------------- *
 * THE HERO.
 * ---------------------------------------------------------------------------------------- */

test('THE SOLE BIDDER SHARE IS THE EXACT VALUE OVER THE WHOLE SET', () => {
  const fx = hand('awards');
  const r = soleBidderShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });

  assert.equal(r.available, true);
  assert.equal(r.notCompetedValueClaim.value, fx.arithmetic.notCompetedValue);
  assert.equal(r.totalValueClaim.value, fx.arithmetic.total);
  assert.equal(r.soleBidderShareClaim.value, fx.arithmetic.soleBidderShare);
  assert.equal(renderClaim(r.soleBidderShareClaim).valueText, fx.arithmetic.soleBidderSharePercentText);

  assert.notEqual(r.soleBidderShareClaim.value, 0.65, fx.arithmetic.theWideningTrap);
  assert.equal(r.notCompetedCountClaim.value, 1,
    'one of the four awards carries the exact value. The one reading NOT COMPETED UNDER SAP '
    + 'does not, and a substring test would have made this two.');
});

test('both sides of the hero quotient are lifetime award value and never fiscal year money', () => {
  const fx = hand('awards');
  const r = soleBidderShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });
  assert.equal(r.notCompetedValueClaim.unitKind, 'awardValue');
  assert.equal(r.totalValueClaim.unitKind, 'awardValue');
  const provenance = renderClaim(r.soleBidderShareClaim).provenance;
  assert.ok(provenance.includes('lifetime award value'));
  assert.ok(provenance.includes('not a share of the money obligated'),
    'the denominator sentence says what this is a share OF, because it is the single easiest '
    + 'figure on this page to quote out of context');
  assert.ok(provenance.includes('FY2025'));
});

test('AN AWARD WITH NO COMPETITION FIELD STAYS IN THE DENOMINATOR AND MAKES THE SHARE A FLOOR', () => {
  const fx = hand('awards-missing-field');
  const r = soleBidderShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });

  assert.equal(r.available, true);
  assert.equal(r.totalValueClaim.value, fx.arithmetic.total,
    'the denominator is the whole set, because the sentence the page prints names the whole set. '
    + 'Shrinking it to the rows that happened to carry a field would make that sentence false.');
  assert.equal(r.soleBidderShareClaim.value, fx.arithmetic.soleBidderShare);
  assert.equal(r.isFloor, true);
  assert.equal(r.noCompetitionFieldCountClaim.value, fx.arithmetic.fieldAbsentCount);
  assert.ok(renderClaim(r.soleBidderShareClaim).a11yLabel.includes('floor'),
    'the claim carries a note saying the figure is a floor, in those words');
});

test('a complete set carries no floor note, because it is not a floor', () => {
  const fx = hand('awards');
  const r = soleBidderShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });
  assert.equal(r.isFloor, false);
  assert.equal(r.soleBidderShareClaim.note, null);
  assert.equal(r.noCompetitionFieldCountClaim.value, 0);
});

test('AN EMPTY AWARD SET PRODUCES NO HERO FIGURE AND NO ZERO', () => {
  const r = soleBidderShare({ awardRows: [], awardDetails: [], meta: META });
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.NO_ROWS);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'soleBidderShareClaim'), false);
  assert.equal(r.awardCountClaim.value, 0);
});

test('an award set that sums to nothing has no denominator', () => {
  const r = soleBidderShare({
    awardRows: [
      { awardId: 'HAND-9101', awardValue: 100, generatedInternalId: 'h9101' },
      { awardId: 'HAND-9102', awardValue: -100, generatedInternalId: 'h9102' },
    ],
    awardDetails: [],
    meta: META,
  });
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.ZERO_DENOMINATOR);
});

/* ---------------------------------------------------------------------------------------- *
 * THE CROSS CHECK.
 * ---------------------------------------------------------------------------------------- */

test('THE ONE OFFER SHARE IS A COUNT OVER A COUNT, WITH THE EXCLUSIONS PUBLISHED', () => {
  const fx = hand('awards');
  const r = oneOfferShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });

  assert.equal(r.available, true);
  assert.equal(r.oneOfferCountClaim.value, fx.arithmetic.oneOfferNumerator);
  assert.equal(r.fieldPresentCountClaim.value, fx.arithmetic.oneOfferDenominator);
  close(assert, r.oneOfferShareClaim.value, fx.arithmetic.oneOfferShare, 1e-15,
    fx.arithmetic.oneOfferWorking);
  assert.equal(renderClaim(r.oneOfferShareClaim).valueText, '66.7 percent');
  assert.equal(r.inconsistentCountClaim.value, fx.arithmetic.inconsistentCount);
  assert.equal(r.fieldAbsentCountClaim.value, fx.arithmetic.fieldAbsentCount);
});

test('THE ROW THAT CONTRADICTS ITSELF IS EXCLUDED AND COUNTED, NOT CORRECTED', () => {
  const fx = hand('awards');
  const r = oneOfferShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });
  assert.equal(r.fieldPresentCountClaim.value, 3,
    'four awards carry an offers figure, and the one reporting full and open competition '
    + 'alongside zero offers is excluded from the denominator rather than counted or rewritten');
  assert.equal(renderClaim(r.inconsistentCountClaim).valueText, '1 internally inconsistent award');
  assert.ok(renderClaim(r.inconsistentCountClaim).a11yLabel.includes('full and open competition'),
    'the note beside the count names the contradiction in the words of the record');
});

test('the one offer denominator is DIFFERENT from the hero denominator, on purpose', () => {
  const fx = hand('awards-missing-field');
  const hero = soleBidderShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });
  const cross = oneOfferShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });
  assert.equal(hero.totalValueClaim.value, 1000, 'dollars across the whole set');
  assert.equal(cross.fieldPresentCountClaim.value, 1, 'counts across the rows that carry the field');
  assert.equal(cross.oneOfferShareClaim.value, 1);
});

test('awards with no usable offers field produce a sentence naming that specific condition', () => {
  const r = oneOfferShare({
    awardRows: [{ awardId: 'HAND-9201', awardValue: 10, generatedInternalId: 'h9201' }],
    awardDetails: [],
    meta: META,
  });
  assert.equal(r.available, false);
  assert.equal(r.reason, NO_USABLE_OFFERS_FIELD);
  assert.notEqual(r.reason, SHARE_UNAVAILABLE.NO_ROWS,
    'an empty result set and a result set whose competition fields did not arrive say different '
    + 'things about the source, and a reader deciding whether to trust the panel needs to know '
    + 'which of the two happened');
});

test('no awards at all reports the empty set reason rather than the field reason', () => {
  const r = oneOfferShare({ awardRows: [], awardDetails: [], meta: META });
  assert.equal(r.available, false);
  assert.equal(r.reason, SHARE_UNAVAILABLE.NO_ROWS);
});

/* ---------------------------------------------------------------------------------------- *
 * THE PER AWARD TABLE.
 * ---------------------------------------------------------------------------------------- */

test('the per award rows report the government fields verbatim', () => {
  const fx = hand('awards');
  const rows = competitionRows({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].extentCompeted, 'NOT COMPETED');
  assert.equal(rows[0].notCompeted, true);
  assert.equal(rows[2].extentCompeted, 'NOT COMPETED UNDER SAP');
  assert.equal(rows[2].notCompeted, false);
  assert.equal(rows[3].inconsistent, true);
  assert.equal(rows[3].offersReceivedClaim.value, 0);
  assert.equal(rows[3].offersReceivedClaim.badge, 'REPORTED',
    'the contradictory figure is REPORTED, because the government record says it. Our arithmetic '
    + 'is what excludes it from the count share, and that exclusion is a separate COMPUTED tally.');
  assert.ok(renderClaim(rows[3].offersReceivedClaim).a11yLabel.includes('contradict'));
});

test('an award whose detail never arrived is marked, not guessed', () => {
  const fx = hand('awards-missing-field');
  const rows = competitionRows({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META });
  assert.equal(rows[1].detailAvailable, false);
  assert.equal(rows[1].extentCompeted, null);
  assert.equal(rows[1].notCompeted, false);
  assert.equal(Object.prototype.hasOwnProperty.call(rows[1], 'offersReceivedClaim'), false);
  assert.equal(isClaim(rows[1].awardValueClaim), true, 'the award value is still known and shown');
});

test('NO FIGURE IN THE HERO PANELS RENDERS AS A FAILED DIVISION', () => {
  for (const name of ['awards', 'awards-missing-field']) {
    const fx = hand(name);
    const panels = [
      soleBidderShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META }),
      oneOfferShare({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META }),
      competitionRows({ awardRows: fx.awardRows, awardDetails: fx.awardDetails, meta: META }),
    ];
    for (const text of renderAll(panels)) {
      assert.equal(/NaN|Infinity|undefined/.test(text), false, name + ' produced "' + text + '"');
    }
  }
});
