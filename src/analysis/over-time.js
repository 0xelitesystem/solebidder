// OBLIGATIONS BY FISCAL YEAR, AND THE YEAR OVER YEAR CHANGE. DESIGN C3, DESIGN 2.2.
//
// THE ARITHMETIC IS ONE LINE: the figure for a fiscal year, minus the figure for the year
// before it, divided by the year before it. Everything else in this file is about the cases
// where that line has no answer, and there are four of them.
//
//   NO PRIOR YEAR. The first year in the set, or a gap in the set where the year before is
//   simply not present. There is nothing to compare against and no change is shown.
//   A PRIOR YEAR OF ZERO. A year with no awards is a real result from this endpoint. Dividing
//   by it is a division by zero and the answer is not infinity, it is unavailable.
//   A NEGATIVE PRIOR YEAR. A year whose deobligations outweigh its obligations comes back
//   negative. The quotient is then arithmetically defined and semantically meaningless: a move
//   from minus one hundred to plus fifty is not growth of one hundred and fifty percent, and
//   printing it as such would be a fabricated statistic wearing a real formula.
//   A CHANGE OUTSIDE PLUS OR MINUS ONE HUNDRED PERCENT. This one is a constraint of the
//   renderer rather than of the data, and it is documented here rather than worked around.
//
// ON THAT LAST CASE, WHICH IS THE INTERESTING ONE. The share unit kind in src/core/units.js is
// a decimal fraction in nought to one, and formatUnit refuses anything outside that range
// because a share arriving as 98.8 where 0.988 was meant is a hundredfold error in a money
// product. That guard is right and this module does not weaken it. The consequence is that a
// year over year change of plus one hundred and forty percent has no share kind it can be
// rendered as. So the change is carried by three figures instead of one:
//
//   the two years themselves, each a REPORTED figure in dollars obligated,
//   the delta between them, a COMPUTED figure in the same unit, signed, which is defined for
//   every pair including the ones above, and
//   the magnitude of the change as a share, present ONLY when it lands inside the range the
//   renderer will print.
//
// A reader therefore always gets the whole of the change in dollars and a direction word, and
// gets the percentage whenever a percentage can be printed honestly. Nothing is ever shown as
// zero because it could not be computed. The gap is recorded in the handover notes so the
// foundation team can decide whether a signed ratio kind is worth adding; widening the share
// range to paper over it here would remove a guard that protects every other figure on the
// page, which is the wrong trade.
//
// Isomorphic: no node:* imports and no DOM.

import { computed, reported, METHODS } from '../core/claim.js';
import { OBLIGATIONS, formatUnit, formatUnitBare } from '../core/units.js';
import { safeShare } from './share.js';

/**
 * The reasons a year over year change has no percentage beside it. Full sentences, printed
 * where the percentage would have been.
 */
export const CHANGE_UNAVAILABLE = Object.freeze({
  NO_PRIOR_YEAR: 'The fiscal year before this one is not in the set returned, so there is '
    + 'nothing to compare this year against.',
  ZERO_PRIOR_YEAR: 'The fiscal year before this one recorded no obligations at all, so a '
    + 'percentage change has no denominator. The change is shown in dollars instead.',
  NEGATIVE_PRIOR_YEAR: 'The fiscal year before this one recorded a negative total, because more '
    + 'money was released back than was committed. A percentage change measured against a '
    + 'negative base has no useful meaning, so the change is shown in dollars only.',
  BEYOND_RENDERABLE_RANGE: 'The change is larger than one hundred percent of the year before. '
    + 'This page prints a share as a proportion between nought and one hundred percent, so the '
    + 'change is shown in dollars alongside both years rather than as a percentage.',
});

/** @typedef {{fiscalYear:number, obligations:number}} OverTimePoint */

/**
 * @typedef {Object} OverTimeMeta
 * @property {string} awardTypeSetId
 * @property {string|null} sourceAsOf
 */

/**
 * Index the points by fiscal year, refusing a duplicate.
 *
 * A duplicated year is the shape a mismatched period takes when it reaches this layer: two
 * rows claiming the same year from two different windows. It is refused loudly here rather
 * than silently resolved to whichever came last.
 *
 * @param {OverTimePoint[]} points
 * @returns {Map<number, number>} Fiscal year to obligations.
 */
export function indexByFiscalYear(points) {
  if (!Array.isArray(points)) throw new TypeError('indexByFiscalYear: points must be an array.');
  const byYear = new Map();
  for (const p of points) {
    if (!p || !Number.isInteger(p.fiscalYear)) {
      throw new TypeError('indexByFiscalYear: every point must carry an integer fiscalYear. A '
        + 'rolling window is not a fiscal year and it does not reach this layer.');
    }
    if (typeof p.obligations !== 'number' || !Number.isFinite(p.obligations)) {
      throw new TypeError('indexByFiscalYear: FY' + p.fiscalYear + ' carries a non finite '
        + 'figure. A value the source did not return is refused rather than read as a zero.');
    }
    if (byYear.has(p.fiscalYear)) {
      throw new RangeError('indexByFiscalYear: FY' + p.fiscalYear + ' appears twice in the set. '
        + 'Two rows for one year is the shape a mismatched period takes by the time it gets '
        + 'here, and a parent measured over one window against a comparison measured over '
        + 'another produced a published figure more than thirteen times too large.');
    }
    byYear.set(p.fiscalYear, p.obligations);
  }
  return byYear;
}

/**
 * The change from the year before, for one fiscal year. DESIGN C3.
 *
 * @param {Object} args
 * @param {OverTimePoint[]} args.points From validateSpendingOverTime.
 * @param {number} args.fiscalYear The year to report the change FOR.
 * @param {OverTimeMeta} args.meta
 * @returns {Object}
 */
export function yearOverYear(args) {
  const { points, fiscalYear, meta } = args;
  if (!Number.isInteger(fiscalYear)) {
    throw new TypeError('yearOverYear: fiscalYear must be an explicit integer year.');
  }
  const byYear = indexByFiscalYear(points);
  const priorYear = fiscalYear - 1;

  if (!byYear.has(fiscalYear)) {
    return Object.freeze({
      available: false,
      fiscalYear,
      priorLabel: 'FY' + priorYear,
    priorFiscalYear: priorYear,
      priorFiscalYear: priorYear,
      direction: null,
      reason: 'FY' + fiscalYear + ' is not in the set returned for this recipient, so there is '
        + 'no figure to report a change for.',
    });
  }

  const current = byYear.get(fiscalYear);
  const currentMeta = { fiscalYear, awardTypeSetId: meta.awardTypeSetId, sourceAsOf: meta.sourceAsOf };
  const currentClaim = reported(current, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, currentMeta);

  if (!byYear.has(priorYear)) {
    return Object.freeze({
      available: false,
      fiscalYear,
      priorLabel: 'FY' + priorYear,
    priorFiscalYear: priorYear,
      priorFiscalYear: priorYear,
      direction: null,
      reason: CHANGE_UNAVAILABLE.NO_PRIOR_YEAR,
      currentClaim,
    });
  }

  const prior = byYear.get(priorYear);
  const delta = current - prior;
  const direction = delta > 0 ? 'increase' : (delta < 0 ? 'decrease' : 'unchanged');

  const base = {
    fiscalYear,
    priorLabel: 'FY' + priorYear,
    priorFiscalYear: priorYear,
    direction,
    currentClaim,
    priorClaim: reported(prior, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, {
      fiscalYear: priorYear,
      awardTypeSetId: meta.awardTypeSetId,
      sourceAsOf: meta.sourceAsOf,
    }),
    deltaClaim: computed(delta, OBLIGATIONS, METHODS.YEAR_OVER_YEAR, {
      ...currentMeta,
      note: 'FY' + fiscalYear + ' obligations of ' + formatUnitBare(current, OBLIGATIONS)
        + ' against FY' + priorYear + ' obligations of ' + formatUnit(prior, OBLIGATIONS)
        + '. The difference is shown as a signed figure in the same unit as both years.',
    }),
  };

  if (prior === 0) {
    return Object.freeze({ ...base, available: false, reason: CHANGE_UNAVAILABLE.ZERO_PRIOR_YEAR });
  }
  if (prior < 0) {
    return Object.freeze({ ...base, available: false, reason: CHANGE_UNAVAILABLE.NEGATIVE_PRIOR_YEAR });
  }

  const share = safeShare({
    numerator: Math.abs(delta),
    denominator: prior,
    numeratorUnitKind: OBLIGATIONS,
    denominatorUnitKind: OBLIGATIONS,
    rowCount: 2,
    method: METHODS.YEAR_OVER_YEAR,
    denominatorText: 'A ' + direction + ' of ' + formatUnitBare(Math.abs(delta), OBLIGATIONS)
      + ' against FY' + priorYear + ' obligations of ' + formatUnit(prior, OBLIGATIONS)
      + ', on the ' + meta.awardTypeSetId + ' award type set. The direction is stated in words '
      + 'because the figure beside it is a magnitude.',
    fiscalYear,
    awardTypeSetId: meta.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
  });

  if (!share.available) {
    return Object.freeze({ ...base, available: false, reason: CHANGE_UNAVAILABLE.BEYOND_RENDERABLE_RANGE });
  }
  return Object.freeze({ ...base, available: true, reason: null, changeShareClaim: share.shareClaim });
}

/**
 * The spine. Every year in the set as a REPORTED figure, plus the change into each year where
 * one can be computed. DESIGN C3.
 *
 * The points are returned in ascending fiscal year order regardless of the order the endpoint
 * used, because a chart drawn in response order is a chart whose shape depends on the server.
 *
 * @param {Object} args
 * @param {OverTimePoint[]} args.points
 * @param {OverTimeMeta} args.meta
 * @returns {Object}
 */
export function obligationsByYear(args) {
  const { points, meta } = args;
  const byYear = indexByFiscalYear(points);
  const years = [...byYear.keys()].sort((a, b) => a - b);

  const rows = years.map((fy, i) => Object.freeze({
    index: i,
    fiscalYear: fy,
    label: 'FY' + fy,
    obligationsClaim: reported(byYear.get(fy), OBLIGATIONS, METHODS.SPENDING_OVER_TIME, {
      fiscalYear: fy,
      awardTypeSetId: meta.awardTypeSetId,
      sourceAsOf: meta.sourceAsOf,
    }),
    change: yearOverYear({ points, fiscalYear: fy, meta }),
  }));

  return Object.freeze({
    available: years.length > 0,
    reason: years.length > 0 ? null : 'The source returned no fiscal years for this recipient '
      + 'on the award type set selected, so there is nothing to plot.',
    firstLabel: years.length > 0 ? 'FY' + years[0] : null,
    lastLabel: years.length > 0 ? 'FY' + years[years.length - 1] : null,
    points: Object.freeze(rows),
  });
}
