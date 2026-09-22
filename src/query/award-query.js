// THE AWARD QUERY BUILDER. Trap 1, and it is the most dangerous trap in the product.
//
// WHAT WAS MEASURED. POST /api/v2/search/spending_by_award/ SILENTLY IGNORES THE RECIPIENT ID
// FILTER.
// Verified four ways on the same query: a parent id, no filter at all, a child id, and a bogus
// all zero UUID returned BYTE IDENTICAL results, topped by a completely unrelated health
// insurer at 51,269,205,263.03 for what was meant to be a defence prime query. The field is
// absent from the published search filter contract. The endpoint also accepts invented field
// names and returns HTTP 200 with null columns rather than erroring, so the drop is undetectable
// by checking for an error.
//
// WHAT THAT WOULD HAVE MEANT. Without this module, this page would have displayed one company's
// award under another company's headline. That is not a rendering bug, it is a false statement
// about a named business, published on the internet, with a badge on it saying we checked.
//
// THE FIX IS STRUCTURAL, NOT A REVIEW NOTE. This is a SEPARATE MODULE whose builder has no
// recipient id parameter and no code path that could add one. It filters by recipient_search_text
// with at most one item, exactly as the documented contract supports, and every row that comes
// back is validated against the resolved entity set by the caller, with non members dropped and
// COUNTED VISIBLY rather than silently.
//
// test/award-query.test.js asserts that the recipient id field name does not appear anywhere in
// this file, comments included, so the property is checked by a plain grep rather than trusted.
//
// THE COUNTER TEST THAT KEEPS THE RULE PRECISE. spending_by_category/{dimension}/ DOES honour
// that same field, verified with a bogus id returning empty and with no filter returning
// government wide results. That builder lives in ./endpoints.js and it does take the field. The
// rule is specific to the award search endpoint, and stating it loosely would cost the category
// panels their correct filter.
//
// Isomorphic: no node:* imports and no DOM.

import { SUBAWARDS, MAX_PAGE_LIMIT, AWARD_TYPE_SETS } from '../core/constants.js';
import { timePeriod, requireFiscalYear } from './fiscal-year.js';

/**
 * The fields requested from the award search endpoint. Named explicitly because the endpoint
 * returns HTTP 200 with null columns for a field name it does not recognise, so a typo here is
 * silent and a committed list is the only way to notice one.
 */
export const AWARD_FIELDS = Object.freeze([
  'Award ID',
  'Recipient Name',
  'Awarding Agency',
  'Awarding Sub Agency',
  'Award Amount',
  'Start Date',
  'End Date',
  'Award Type',
  'generated_internal_id',
]);

/**
 * Build the body for POST /api/v2/search/spending_by_award/.
 *
 * There is no recipient id parameter here. There is no options object that could carry one.
 * Adding one would be a deliberate act against a comment that explains, with a measured number,
 * what happens next.
 *
 * @param {Object} args
 * @param {string} args.recipientSearchText The resolved entity name, exactly one value.
 * @param {number} args.fiscalYear Explicit. Trap 2.
 * @param {string} args.awardTypeSetId One of AWARD_TYPE_SETS.
 * @param {number} [args.limit] Page size, capped at 100 by the API. Trap 6.
 * @param {string} [args.sort] Field to sort by.
 * @param {'desc'|'asc'} [args.order]
 * @returns {object} The request body.
 */
export function buildAwardSearchBody(args) {
  const { recipientSearchText, fiscalYear, awardTypeSetId } = args;
  if (typeof recipientSearchText !== 'string' || recipientSearchText.trim().length === 0) {
    throw new TypeError('buildAwardSearchBody: recipientSearchText is required and must be one '
      + 'non empty string. The award search endpoint ignores an id filter, so the name text is '
      + 'the only filter that does anything, and every returned row still has to be validated '
      + 'against the resolved entity set by the caller.');
  }
  requireFiscalYear(fiscalYear, 'buildAwardSearchBody');
  const set = AWARD_TYPE_SETS[awardTypeSetId];
  if (!set) {
    throw new RangeError('buildAwardSearchBody: awardTypeSetId must be one of '
      + Object.keys(AWARD_TYPE_SETS).join(', ') + ', got ' + JSON.stringify(awardTypeSetId)
      + '. The set is never a hidden default: it changes the total and it is named on the badge.');
  }
  const limit = args.limit === undefined ? MAX_PAGE_LIMIT : args.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new RangeError('buildAwardSearchBody: limit must be an integer in [1, ' + MAX_PAGE_LIMIT
      + ']. The API answers HTTP 422 above that, and deep pagination on this endpoint was '
      + 'measured at tens of seconds per page, so award lists here are top N and never a full '
      + 'enumeration.');
  }

  /** @type {Record<string, unknown>} */
  const filters = {
    recipient_search_text: [recipientSearchText],
    time_period: timePeriod(fiscalYear),
    subawards: SUBAWARDS,
  };
  if (set.codes !== null) filters.award_type_codes = [...set.codes];

  return {
    filters,
    fields: [...AWARD_FIELDS],
    page: 1,
    limit,
    sort: args.sort === undefined ? 'Award Amount' : args.sort,
    order: args.order === undefined ? 'desc' : args.order,
    subawards: SUBAWARDS,
  };
}

/**
 * Drop every row whose recipient is not in the resolved entity set, and COUNT what was dropped.
 *
 * DESIGN 6.4 and trap 1: the excluded tally is shown on the page. A filter that silently removes
 * rows is the same class of problem as a filter the server silently ignores, so the count is
 * part of the return value rather than a log line.
 *
 * @param {{['Recipient Name']?:string, recipient_name?:string, recipientName?:string}[]} rows
 * @param {Set<string>} allowedNames Upper case names of the resolved parent and its children.
 * @returns {{kept:object[], excluded:object[], excludedCount:number}}
 */
export function filterRowsToEntitySet(rows, allowedNames) {
  if (!Array.isArray(rows)) {
    throw new TypeError('filterRowsToEntitySet: rows must be an array.');
  }
  if (!(allowedNames instanceof Set) || allowedNames.size === 0) {
    throw new TypeError('filterRowsToEntitySet: allowedNames must be a non empty Set. An empty '
      + 'set would keep nothing and an absent set would keep everything, and the second of those '
      + 'is how another company award reaches this page.');
  }
  const kept = [];
  const excluded = [];
  for (const row of rows) {
    // ALL THREE SPELLINGS, and the third one is the one that matters.
    //
    // The award search endpoint labels this column with the display name "Recipient Name"; other
    // endpoints use the snake case field; and validateSpendingByAward in ./endpoints.js PROJECTS
    // that column to camel case "recipientName" before anything else sees it. Handing validated
    // rows straight to this function while it only knew the first two spellings dropped EVERY
    // row, and it did not present as a bug: it presented as an entity set that matched nothing,
    // which is the same shape as an incomplete rollup. The caller then has to decide whether the
    // page is broken or the company really has no contracts, from the same evidence.
    //
    // An absent name still resolves to the empty string and is therefore excluded, which is the
    // safe direction: a row whose recipient cannot be read is a row we cannot prove belongs to
    // the entity the headline names.
    let raw;
    if (row['Recipient Name'] !== undefined) raw = row['Recipient Name'];
    else if (row.recipientName !== undefined) raw = row.recipientName;
    else raw = row.recipient_name;
    const name = typeof raw === 'string' ? raw.toUpperCase() : '';
    if (allowedNames.has(name)) kept.push(row);
    else excluded.push(row);
  }
  return { kept, excluded, excludedCount: excluded.length };
}
