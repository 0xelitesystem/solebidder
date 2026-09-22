// ONE PERIOD IN APPLICATION STATE. Trap 2 and trap 3.
//
// Trap 2 is not hypothetical. A parent fetched at one period against children fetched at
// another produced 827,727,296,777.05 against 61,964,720,403.63 for the same company, a factor
// of more than thirteen, and both numbers looked plausible on their own. The fix is that there
// is ONE period, it is explicit, and every request builder in src/query/ throws without it.
//
// Trap 3 is the rolling window. A window that means "recent" rather than a fiscal year drifted
// by dollars and by transactions inside a single evening, and it is not a fiscal year at all:
// the rolling figure and the named fiscal year figure for the same company differ by tens of
// billions. scripts/gate-vocabulary.mjs bans that literal from src/query/ entirely, which is
// why this module deals only in integer years.
//
// A US federal fiscal year runs from 1 October of the previous calendar year to 30 September.
// FY2025 is 2024-10-01 to 2025-09-30. That is the arithmetic below and it is the only place in
// the product that knows it.
//
// Isomorphic: no node:* imports and no DOM.

import { FISCAL_YEAR_FLOOR } from '../core/constants.js';

/**
 * Assert an explicit fiscal year. Every request builder calls this first.
 * @param {unknown} fiscalYear
 * @param {string} where Name of the caller, quoted in the message.
 * @returns {number}
 */
export function requireFiscalYear(fiscalYear, where) {
  if (typeof fiscalYear !== 'number' || !Number.isInteger(fiscalYear)) {
    throw new TypeError(where + ': an explicit integer fiscalYear is required. There is no '
      + 'default period in this product, because a default period is how a parent total and a '
      + 'child rollup end up measured over different windows and published as one figure.');
  }
  const thisYear = new Date().getUTCFullYear();
  if (fiscalYear < FISCAL_YEAR_FLOOR) {
    throw new RangeError(where + ': fiscalYear must be ' + FISCAL_YEAR_FLOOR + ' or later. The '
      + 'search API holds nothing awarded before 1 October 2007.');
  }
  if (fiscalYear > thisYear + 1) {
    throw new RangeError(where + ': fiscalYear ' + fiscalYear + ' is in the future. A fiscal year '
      + 'that has not started has no obligations to report and an empty answer would be shown as '
      + 'a real zero.');
  }
  return fiscalYear;
}

/**
 * The calendar range of a federal fiscal year.
 * @param {number} fiscalYear
 * @returns {{start_date:string, end_date:string}}
 */
export function fiscalYearRange(fiscalYear) {
  requireFiscalYear(fiscalYear, 'fiscalYearRange');
  return {
    start_date: (fiscalYear - 1) + '-10-01',
    end_date: fiscalYear + '-09-30',
  };
}

/**
 * The time_period array every search endpoint takes.
 * @param {number} fiscalYear
 * @returns {{start_date:string, end_date:string}[]}
 */
export function timePeriod(fiscalYear) {
  return [fiscalYearRange(fiscalYear)];
}

/**
 * The inclusive list of fiscal years for the spine chart, oldest first, floored at the year the
 * data actually starts. DESIGN C3 asks for ten years; the floor wins where they conflict.
 * @param {number} throughFiscalYear
 * @param {number} count
 * @returns {number[]}
 */
export function fiscalYearSpan(throughFiscalYear, count) {
  requireFiscalYear(throughFiscalYear, 'fiscalYearSpan');
  if (!Number.isInteger(count) || count < 1) {
    throw new RangeError('fiscalYearSpan: count must be a positive integer, got ' + String(count));
  }
  const first = Math.max(FISCAL_YEAR_FLOOR, throughFiscalYear - count + 1);
  const out = [];
  for (let y = first; y <= throughFiscalYear; y += 1) out.push(y);
  return out;
}
