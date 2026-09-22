// CONCENTRATION. DESIGN C2, and the cumulative curve from DESIGN 2.2.
//
// FOUR FIGURES, all of them our own arithmetic over figures the source reported, and all of
// them reproducible by hand from the rows in the fixture beside the test.
//
//   ONE CUSTOMER SHARE     the largest buyer amount over the sum of every buyer amount
//                          returned for the same fiscal year and the same award type set.
//   HERFINDAHL INDEX       the sum of the squares of those shares, taken as decimals.
//   CUMULATIVE CURVE       awards sorted by value descending, then the running share of the
//                          total, which is what shows whether a book is one contract or forty.
//   TOP AWARD SHARE        the largest award value over the sum of the same set.
//
// THE DENOMINATOR IS ALWAYS THE ROWS THAT CAME BACK, AND THE SENTENCE SAYS SO. It is not the
// company's federal money and it is not every buyer that has ever bought from this recipient.
// It is the set of rows this endpoint returned for the year and the award type set named on
// the badge. That distinction is the difference between a figure a reader can quote and a
// figure that will be quoted wrongly, so the denominator travels with the share in words.
//
// DEOBLIGATIONS ARE THE ORDINARY CASE, NOT THE EXOTIC ONE, AND THE GUARD IS SIZED ACCORDINGLY.
//
// A negative amount in this data is money committed in an earlier action and released back in
// this one. The recorded fixture for the most searched company in the dataset carries one
// negative buyer row out of nine and eleven negative child rows out of two hundred and
// seventeen. A rule that refused to compute anything in the presence of a negative row would
// therefore suppress the headline figure of this product on its own flagship example, which is
// not caution, it is a broken panel.
//
// So the test is on the RESULT, not on the inputs. A share is published when it lands between
// nought and one hundred percent, and an index is published when it lands between nought and
// one. Both do, for every set whose rows are individually smaller in magnitude than their own
// total, which covers a deobligation of any ordinary size.
//
// What a negative row CAN do is push a single row above the total: rows of 100 and -50 sum to
// 50, and the first row is then two hundred percent of the set. That quotient is arithmetically
// real and journalistically useless, the index built from it exceeds one, and the renderer
// refuses both. They are caught here instead, where the reason can still be written down, and
// the count of negative rows is published as a tally beside every panel their arithmetic
// touches so the reader learns the fact rather than losing the figure without explanation.
// See src/analysis/share.js for the full reasoning.
//
// Isomorphic: no node:* imports and no DOM.

import { computed, reported, METHODS } from '../core/claim.js';
import { OBLIGATIONS, AWARD_VALUE, formatUnit, formatUnitBare, formatTally } from '../core/units.js';
import { herfindahl } from '../contracts/analysis.js';
import {
  safeShare, SHARE_UNAVAILABLE, sumField, countNegative, tallyClaim, NEGATIVE_ROW_NOTE,
} from './share.js';

/**
 * @typedef {Object} CategoryMeta
 * @property {number} fiscalYear
 * @property {string} awardTypeSetId
 * @property {string|null} sourceAsOf
 */

/**
 * The share of one dimension taken by its largest row. DESIGN C2.
 *
 * Generic over the dimension on purpose: the buyer share and the sub buyer share are the same
 * arithmetic over different rows, and writing it twice is how the two end up disagreeing after
 * somebody fixes one of them.
 *
 * @param {Object} args
 * @param {{name:string, amount:number}[]} args.rows As returned by validateSpendingByCategory.
 * @param {string} args.method METHODS.ONE_CUSTOMER_SHARE or METHODS.SUBAGENCY_SHARE.
 * @param {string} args.rowNoun Singular noun for the tally, for example "awarding agency".
 * @param {CategoryMeta} args.meta
 * @returns {Object} Every displayed leaf is a Claim. `topShareClaim` is present only when the
 *   share is available, and absent rather than null when it is not.
 */
export function topRowShare(args) {
  const { rows, method, rowNoun, meta } = args;
  if (!Array.isArray(rows)) throw new TypeError('topRowShare: rows must be an array, even empty.');

  const total = rows.length === 0 ? 0 : sumField(rows, 'amount');
  const negatives = countNegative(rows, 'amount');
  const top = rows.reduce(
    (best, r) => (best === null || r.amount > best.amount ? r : best),
    /** @type {{name:string, amount:number}|null} */ (null),
  );

  const out = {
    topName: top === null ? null : top.name,
    rowCountClaim: tallyClaim(rows.length, rowNoun, method, meta),
    negativeRowCountClaim: tallyClaim(negatives, 'negative ' + rowNoun + ' row', method, meta,
      NEGATIVE_ROW_NOTE),
  };

  if (top === null) {
    return Object.freeze({ ...out, available: false, reason: SHARE_UNAVAILABLE.NO_ROWS });
  }

  const share = safeShare({
    numerator: top.amount,
    denominator: total,
    numeratorUnitKind: OBLIGATIONS,
    denominatorUnitKind: OBLIGATIONS,
    rowCount: rows.length,
    method,
    denominatorText: formatUnitBare(top.amount, OBLIGATIONS) + ' recorded to ' + top.name
      + ' of ' + formatUnit(total, OBLIGATIONS) + ' across '
      + formatTally(rows.length, rowNoun) + ' returned for fiscal year FY' + meta.fiscalYear
      + ' on the ' + meta.awardTypeSetId + ' award type set.',
    fiscalYear: meta.fiscalYear,
    awardTypeSetId: meta.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
  });

  const figures = {
    ...out,
    available: share.available,
    reason: share.reason,
    topAmountClaim: reported(top.amount, OBLIGATIONS, METHODS.SPENDING_BY_CATEGORY, meta),
    totalClaim: computed(total, OBLIGATIONS, method, meta),
  };
  return Object.freeze(share.available
    ? { ...figures, topShareClaim: share.shareClaim }
    : figures);
}

/**
 * The Herfindahl index over a set of category rows. DESIGN C2 and DESIGN 2.2.
 *
 * herfindahl() in the contract does the arithmetic and carries the formula in the provenance.
 * This wrapper decides whether the arithmetic may be RUN, and then whether its answer may be
 * SHOWN, which are two different questions.
 *
 * It may be run when the rows sum to a positive total. It may be shown when the index it
 * produces lands between nought and one, which is the range the share renderer accepts. Every
 * set whose individual rows are smaller in magnitude than their own total satisfies that,
 * including a set carrying a deobligation of ordinary size. A set where one row exceeds the
 * total does not, and the index it produces is above one and is therefore a figure nobody
 * could display. It is refused here, with the reason, rather than at the moment somebody tries
 * to put it on screen.
 *
 * @param {{name:string, amount:number}[]} rows
 * @param {string} rowNoun
 * @param {CategoryMeta} meta
 * @returns {Object}
 */
export function herfindahlIndex(rows, rowNoun, meta) {
  if (!Array.isArray(rows)) throw new TypeError('herfindahlIndex: rows must be an array.');
  const negatives = countNegative(rows, 'amount');
  const base = {
    rowCountClaim: tallyClaim(rows.length, rowNoun, METHODS.HERFINDAHL_INDEX, meta),
    negativeRowCountClaim: tallyClaim(negatives, 'negative ' + rowNoun + ' row',
      METHODS.HERFINDAHL_INDEX, meta, NEGATIVE_ROW_NOTE),
  };

  if (rows.length === 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.NO_ROWS });
  }
  const total = sumField(rows, 'amount');
  if (total === 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.ZERO_DENOMINATOR });
  }
  if (total < 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.NEGATIVE_DENOMINATOR });
  }
  // The formula lives in the contract and is written down once. The range check reads the value
  // back off the claim rather than recomputing it, because a second copy of an arithmetic rule
  // is a second copy that can drift away from the first.
  const indexClaim = herfindahl(rows, meta);
  const index = indexClaim.value;
  if (!Number.isFinite(index) || index < 0 || index > 1) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.OUT_OF_RANGE });
  }
  return Object.freeze({
    ...base,
    available: true,
    reason: null,
    indexClaim,
    totalClaim: computed(total, OBLIGATIONS, METHODS.HERFINDAHL_INDEX, meta),
  });
}

/**
 * The cumulative concentration curve. DESIGN 2.2: awards sorted by value descending, then the
 * running share of the total.
 *
 * The curve is the figure that answers "is this book one contract or forty", and it answers it
 * without a single number having to be trusted on its own: the reader sees the shape.
 *
 * WHAT IT IS A SHARE OF, precisely: lifetime award value across the N awards handed in, and
 * nothing else. It is not a share of the fiscal year obligations and it never shares an axis
 * with them.
 *
 * The final point is exactly one, because the running total after the last award IS the total.
 * That is asserted rather than assumed, because a curve that ends at 0.999 has lost a row
 * somewhere between the sort and the running total.
 *
 * A negative award value does not disqualify the curve. It sorts to the end and it makes the
 * curve dip on its last step, which is an honest picture of a book containing a release. What
 * does disqualify it is a running share landing outside nought to one hundred percent at any
 * point, which happens when one award is larger than the set it sits in. Then the whole curve
 * is suppressed rather than drawn with a gap, because a concentration curve missing a point in
 * the middle is read as a curve, not as a warning.
 *
 * @param {Object} args
 * @param {{awardId:string, awardValue:number, generatedInternalId:string}[]} args.awardRows
 * @param {CategoryMeta} args.meta
 * @returns {Object}
 */
export function cumulativeConcentration(args) {
  const { awardRows, meta } = args;
  if (!Array.isArray(awardRows)) {
    throw new TypeError('cumulativeConcentration: awardRows must be an array, even empty.');
  }
  const negatives = countNegative(awardRows, 'awardValue');
  const base = {
    awardCountClaim: tallyClaim(awardRows.length, 'award', METHODS.CUMULATIVE_CONCENTRATION, meta),
    negativeRowCountClaim: tallyClaim(negatives, 'negative award value',
      METHODS.CUMULATIVE_CONCENTRATION, meta, NEGATIVE_ROW_NOTE),
    points: [],
  };

  if (awardRows.length === 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.NO_ROWS });
  }
  const total = sumField(awardRows, 'awardValue');
  if (total === 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.ZERO_DENOMINATOR });
  }
  if (total < 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.NEGATIVE_DENOMINATOR });
  }

  const sorted = [...awardRows].sort((a, b) => b.awardValue - a.awardValue);
  let running = 0;
  let refused = null;
  const points = sorted.map((row, i) => {
    running += row.awardValue;
    const share = safeShare({
      numerator: running,
      denominator: total,
      numeratorUnitKind: AWARD_VALUE,
      denominatorUnitKind: AWARD_VALUE,
      rowCount: awardRows.length,
      method: METHODS.CUMULATIVE_CONCENTRATION,
      denominatorText: 'The ' + (i + 1) + ' largest of '
        + formatTally(awardRows.length, 'award') + ' by lifetime award value sum to '
        + formatUnitBare(running, AWARD_VALUE) + ' of ' + formatUnit(total, AWARD_VALUE)
        + ' across that set, for awards active in fiscal year FY' + meta.fiscalYear + '.',
      fiscalYear: meta.fiscalYear,
      awardTypeSetId: meta.awardTypeSetId,
      sourceAsOf: meta.sourceAsOf,
    });
    if (!share.available) {
      if (refused === null) refused = share.reason;
      return null;
    }
    return Object.freeze({
      index: i,
      rank: i + 1,
      label: row.awardId,
      awardValueClaim: reported(row.awardValue, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, meta),
      cumulativeShareClaim: share.shareClaim,
    });
  });

  if (refused !== null) {
    return Object.freeze({ ...base, available: false, reason: refused });
  }
  return Object.freeze({
    ...base,
    available: true,
    reason: null,
    points: Object.freeze(points),
    totalClaim: computed(total, AWARD_VALUE, METHODS.CUMULATIVE_CONCENTRATION, meta),
  });
}

/**
 * The largest award as a share of the same set. DESIGN 2.2.
 *
 * @param {Object} args
 * @param {{awardId:string, awardValue:number}[]} args.awardRows
 * @param {CategoryMeta} args.meta
 * @returns {Object}
 */
export function topAwardShare(args) {
  const { awardRows, meta } = args;
  if (!Array.isArray(awardRows)) {
    throw new TypeError('topAwardShare: awardRows must be an array, even empty.');
  }
  const negatives = countNegative(awardRows, 'awardValue');
  const base = {
    topAwardId: null,
    awardCountClaim: tallyClaim(awardRows.length, 'award', METHODS.TOP_AWARD_SHARE, meta),
    negativeRowCountClaim: tallyClaim(negatives, 'negative award value',
      METHODS.TOP_AWARD_SHARE, meta, NEGATIVE_ROW_NOTE),
  };
  if (awardRows.length === 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.NO_ROWS });
  }

  const total = sumField(awardRows, 'awardValue');
  const top = awardRows.reduce((best, r) => (r.awardValue > best.awardValue ? r : best), awardRows[0]);
  const share = safeShare({
    numerator: top.awardValue,
    denominator: total,
    numeratorUnitKind: AWARD_VALUE,
    denominatorUnitKind: AWARD_VALUE,
    rowCount: awardRows.length,
    method: METHODS.TOP_AWARD_SHARE,
    denominatorText: 'The largest award, ' + top.awardId + ', at '
      + formatUnitBare(top.awardValue, AWARD_VALUE) + ' of ' + formatUnit(total, AWARD_VALUE)
      + ' across ' + formatTally(awardRows.length, 'award') + ' active in fiscal year FY'
      + meta.fiscalYear + '.',
    fiscalYear: meta.fiscalYear,
    awardTypeSetId: meta.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
  });

  const figures = {
    ...base,
    topAwardId: top.awardId,
    available: share.available,
    reason: share.reason,
    topAwardValueClaim: reported(top.awardValue, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, meta),
    totalClaim: computed(total, AWARD_VALUE, METHODS.TOP_AWARD_SHARE, meta),
  };
  // topShareClaim is the name every ranked share on this page uses, so it stays. The alias is
  // here because reading `topAwardShare(...).topShareClaim` at a call site is a guess that has
  // already cost one panel: the function is named for the award and the key was not. Both names
  // hold the SAME frozen Claim object, so there is one figure and one badge, not two.
  return Object.freeze(share.available
    ? { ...figures, topShareClaim: share.shareClaim, topAwardShareClaim: share.shareClaim }
    : figures);
}
