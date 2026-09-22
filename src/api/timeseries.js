// OBLIGATIONS BY FISCAL YEAR. DESIGN C3, traps 5, 7 and 14.
//
// THE FIELD THAT IS NOT HERE IS THE POINT OF THIS FILE. The aggregate endpoints return an
// outlay field on every row and it is null on every row. Verified live on 2026-09-22 across ten
// fiscal years: every bucket carried a figure for obligations and null for the matching outlay
// bucket. A null that reaches arithmetic becomes a zero, a zero that reaches a chart becomes a
// point on the axis, and a point on the axis is a published claim that a company was paid
// nothing that year. The validator drops the field by name before it leaves the query layer, and
// assertObligationsOnly below refuses any point that carries anything except a fiscal year and
// an obligations figure, so a future response shape cannot smuggle one back in.
//
// ONE CALL, NOT TEN. Ten fiscal years came back in a single response of a few kilobytes in 6.7
// seconds cold and under half a second warm. A per year fan out would be ten times the requests
// for the same answer against an API with no published rate limit, which is trap 11.
//
// THE FLOOR IS REAL AND IT IS LABELLED. Trap 14: the search API holds nothing awarded before
// 1 October 2007, so the span is clamped at the floor rather than quietly producing empty years
// that a reader would take for years of no work.
//
// Isomorphic: no node:* imports and no DOM.

import { spendingOverTimeRequest, validateSpendingOverTime } from '../query/endpoints.js';
import { fiscalYearSpan } from '../query/fiscal-year.js';
import { reported, METHODS } from '../core/claim.js';
import { OBLIGATIONS } from '../core/units.js';
import { FISCAL_YEAR_FLOOR } from '../core/constants.js';

/** DESIGN C3 asks for ten fiscal years. The floor wins where they conflict. */
export const DEFAULT_SPAN_YEARS = 10;

/** The axis note, so the reader knows the series starts where the data starts. */
export const FLOOR_NOTICE = 'This series starts at fiscal year ' + FISCAL_YEAR_FLOOR
  + ' because the search API holds nothing awarded before 1 October 2007. An earlier year is '
  + 'absent from the source, not empty.';

/**
 * Refuse a point that carries anything except a fiscal year and an obligations figure.
 * @param {readonly object[]} points
 * @returns {readonly object[]}
 */
export function assertObligationsOnly(points) {
  if (!Array.isArray(points)) throw new TypeError('assertObligationsOnly: points must be an array.');
  points.forEach((p, i) => {
    const keys = Object.keys(p).sort();
    if (keys.length !== 2 || keys[0] !== 'fiscalYear' || keys[1] !== 'obligations') {
      throw new TypeError('assertObligationsOnly: points[' + i + '] carries ' + keys.join(', ')
        + '. A point on this chart is a fiscal year and an obligations figure. Any other quantity '
        + 'on this axis is a second unit kind, and the one that keeps trying to appear comes back '
        + 'null on every row of every aggregate response measured for this product.');
    }
    if (!Number.isInteger(p.fiscalYear)) {
      throw new TypeError('assertObligationsOnly: points[' + i + '] has a non integer fiscal year.');
    }
    if (typeof p.obligations !== 'number' || !Number.isFinite(p.obligations)) {
      throw new TypeError('assertObligationsOnly: points[' + i + '] has a figure that is not a '
        + 'finite number. It is refused here rather than rendered as a zero.');
    }
  });
  return points;
}

/**
 * Fetch the spine chart series.
 *
 * @param {{request:Function}} client
 * @param {Object} args
 * @param {string} args.recipientId
 * @param {number} args.fiscalYear The year in application state. The span ends here.
 * @param {import('../core/constants.js').AwardTypeSetId} args.awardTypeSetId
 * @param {number} [args.spanYears]
 * @param {string|null} [args.sourceAsOf]
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold]
 * @returns {Promise<{ok:true, years:number[], points:{fiscalYear:number, obligations:number}[],
 *   claims:{fiscalYear:number, claim:object}[], floorNotice:string, attempts:number}
 *   |{ok:false, failure:import('../query/failure.js').Failure}>}
 */
export async function fetchObligationsByFiscalYear(client, args) {
  const span = args.spanYears === undefined ? DEFAULT_SPAN_YEARS : args.spanYears;
  const years = fiscalYearSpan(args.fiscalYear, span);

  const result = await client.request(
    spendingOverTimeRequest({
      recipientId: args.recipientId,
      fiscalYears: years,
      awardTypeSetId: args.awardTypeSetId,
    }),
    validateSpendingOverTime,
    { what: 'obligations by fiscal year', signal: args.signal, onCold: args.onCold },
  );
  if (!result.ok) return { ok: false, failure: result.failure };

  // Keep only the years asked for, in the order asked for. The source returns the buckets its
  // filter produced and a stray year outside the span would widen the axis without being asked.
  const wanted = new Set(years);
  const points = result.value.points
    .filter((p) => wanted.has(p.fiscalYear))
    .map((p) => ({ fiscalYear: p.fiscalYear, obligations: p.obligations }))
    .sort((a, b) => a.fiscalYear - b.fiscalYear);
  assertObligationsOnly(points);

  const sourceAsOf = args.sourceAsOf === undefined ? null : args.sourceAsOf;
  const claims = points.map((p) => ({
    fiscalYear: p.fiscalYear,
    claim: reported(p.obligations, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, {
      fiscalYear: p.fiscalYear,
      awardTypeSetId: args.awardTypeSetId,
      sourceAsOf,
    }),
  }));

  return { ok: true, years, points, claims, floorNotice: FLOOR_NOTICE, attempts: result.attempts };
}
