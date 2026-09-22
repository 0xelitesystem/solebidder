// THE CATEGORY QUERIES. DESIGN C2, C5, traps 1, 6 and 11.
//
// THE COUNTER TEST THAT KEEPS THE HARD RULE PRECISE. The award search endpoint silently ignores
// a recipient id filter, which is trap 1 and the most dangerous thing in this product. These
// category endpoints DO honour it, verified with a bogus id control that comes back empty and a
// no filter control that comes back government wide. So the rule is specific to the award search
// endpoint. Stating it loosely would cost these panels their only correct filter and hand the
// page a government wide agency mix under one company's name.
//
// MEASURED LIVE ON 2026-09-22, parent UEI ZFN2JJXBLZT3, FY2025, contract type codes A to D:
// Department of Defense 63,941,564,049.57, NASA 682,909,341.09, Department of Homeland Security
// 64,994,361.73. Every row also carried a total outlays field of null, on every row, which is
// exactly why the validator drops that field by name before it can reach arithmetic here.
//
// TWO DEFINITIONS OF THE COMPANY, NEVER MERGED. DESIGN C5. Filtering by the resolved recipient
// id is the parent UEI rollup. Filtering by the typed name is a DIFFERENT definition that
// catches entities registered under no parent at all. The request builder refuses to take both
// at once, and this module keeps the two totals in separate functions with separate methods on
// their badges, because a range between them would imply the truth lies in the middle and it
// does not: they are two different questions.
//
// PAGING IS BOUNDED AND A SHORT READ IS A SUPPRESSION, NOT A TOTAL. Trap 6: deep pagination on
// this API was measured at tens of seconds per page. The recipient dimension for a large prime
// came back complete in ONE page of 60 rows in 600 ms on 2026-09-22, so the cap below is
// generous rather than tight. If the pages run out before the source says it is done, or if a
// page fails, the total is SUPPRESSED and a named incomplete failure is returned. A sum over
// some of the pages is smaller than the truth and a reader would quote it.
//
// Isomorphic: no node:* imports and no DOM.

import { spendingByCategoryRequest, validateSpendingByCategory } from '../query/endpoints.js';
import { failure, INCOMPLETE_ROLLUP } from '../query/failure.js';
import { computed, reported, METHODS } from '../core/claim.js';
import { OBLIGATIONS } from '../core/units.js';
import { MAX_PAGE_LIMIT } from '../core/constants.js';

/**
 * How many pages a category total may take before it is treated as unbounded. Trap 6: a full
 * enumeration on this API is tens of seconds per page and is never attempted here.
 */
export const MAX_CATEGORY_PAGES = 5;

/**
 * Fetch one page of one category dimension. This is the shape the agency, sub agency, product
 * code and industry code panels use, because each of them reads the ranked rows rather than a
 * sum over all of them.
 *
 * @param {{request:Function}} client
 * @param {Object} args
 * @param {string} args.dimension
 * @param {string} args.recipientId
 * @param {number} args.fiscalYear
 * @param {import('../core/constants.js').AwardTypeSetId} args.awardTypeSetId
 * @param {number} [args.limit]
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold]
 * @returns {Promise<{ok:true, dimension:string, rows:object[], hasNextPage:boolean, attempts:number}
 *   |{ok:false, failure:import('../query/failure.js').Failure}>}
 */
export async function fetchCategory(client, args) {
  const result = await client.request(
    spendingByCategoryRequest({
      dimension: args.dimension,
      recipientId: args.recipientId,
      // The name match definition, DESIGN C5. fetchCategoryTotal below has always accepted it;
      // this one page form did not, which meant the only way to ask a ranked category question
      // about a NAME was to page the whole thing. spendingByCategoryRequest refuses both
      // filters at once, so passing it through here cannot produce a merged definition.
      recipientSearchText: args.recipientSearchText,
      fiscalYear: args.fiscalYear,
      awardTypeSetId: args.awardTypeSetId,
      limit: args.limit === undefined ? MAX_PAGE_LIMIT : args.limit,
      page: 1,
    }),
    validateSpendingByCategory,
    { what: 'the ' + describeDimension(args.dimension), signal: args.signal, onCold: args.onCold },
  );
  if (!result.ok) return { ok: false, failure: result.failure };
  return {
    ok: true,
    dimension: result.value.dimension,
    rows: result.value.rows,
    hasNextPage: result.value.hasNextPage,
    attempts: result.attempts,
  };
}

/**
 * Page a category dimension to completion and sum it.
 *
 * Either the whole thing arrives or nothing is returned. There is no partial total on this page.
 *
 * @param {{request:Function}} client
 * @param {Object} args
 * @param {string} args.dimension
 * @param {string} [args.recipientId] The parent UEI rollup definition.
 * @param {string} [args.recipientSearchText] The name match definition. DESIGN C5.
 * @param {number} args.fiscalYear
 * @param {import('../core/constants.js').AwardTypeSetId} args.awardTypeSetId
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold]
 * @returns {Promise<{ok:true, rows:object[], total:number, pages:number}
 *   |{ok:false, failure:import('../query/failure.js').Failure}>}
 */
export async function fetchCategoryTotal(client, args) {
  const what = 'the paged ' + describeDimension(args.dimension);
  /** @type {object[]} */
  const rows = [];
  let page = 1;

  for (;;) {
    const result = await client.request(
      spendingByCategoryRequest({
        dimension: args.dimension,
        recipientId: args.recipientId,
        recipientSearchText: args.recipientSearchText,
        fiscalYear: args.fiscalYear,
        awardTypeSetId: args.awardTypeSetId,
        limit: MAX_PAGE_LIMIT,
        page,
      }),
      validateSpendingByCategory,
      { what, signal: args.signal, onCold: args.onCold },
    );

    if (!result.ok) {
      // Some pages arrived and one did not. The total is suppressed and the panel says how many
      // of the pages it asked for came back.
      return {
        ok: false,
        failure: failure(INCOMPLETE_ROLLUP, what, {
          parts: { arrived: page - 1, expected: page },
          attempts: result.failure.attempts,
          detail: 'page ' + page + ' did not arrive, so the sum over the pages that did is '
            + 'smaller than the truth and is not published.',
        }),
      };
    }

    rows.push(...result.value.rows);
    if (!result.value.hasNextPage) {
      return { ok: true, rows, total: sumRows(rows), pages: page };
    }
    if (page >= MAX_CATEGORY_PAGES) {
      return {
        ok: false,
        failure: failure(INCOMPLETE_ROLLUP, what, {
          parts: { arrived: page, expected: page + 1 },
          detail: 'the source still had more pages after ' + MAX_CATEGORY_PAGES + ', which is '
            + 'the page ceiling this product sets against an endpoint measured at tens of '
            + 'seconds per page. The total is suppressed rather than published short.',
        }),
      };
    }
    page += 1;
  }
}

/**
 * Sum category row amounts, in the order the source returned them.
 * @param {readonly {amount:number}[]} rows
 * @returns {number}
 */
export function sumRows(rows) {
  if (!Array.isArray(rows)) throw new TypeError('sumRows: rows must be an array.');
  let total = 0;
  for (const row of rows) {
    if (typeof row.amount !== 'number' || !Number.isFinite(row.amount)) {
      throw new TypeError('sumRows: every row must carry a finite amount. A row whose figure '
        + 'could not be read is refused rather than counted as a zero.');
    }
    total += row.amount;
  }
  return total;
}

/**
 * One reported claim per category row. The share arithmetic over these belongs to the analysis
 * layer; what this does is make sure every row that reaches a chart is already a badged figure
 * with its unit welded on.
 *
 * @param {readonly {name:string, amount:number}[]} rows
 * @param {{fiscalYear:number, awardTypeSetId:string, sourceAsOf:string|null}} meta
 * @returns {{name:string, claim:object}[]}
 */
export function categoryRowClaims(rows, meta) {
  return rows.map((row) => ({
    name: row.name,
    claim: reported(row.amount, OBLIGATIONS, METHODS.SPENDING_BY_CATEGORY, {
      fiscalYear: meta.fiscalYear,
      awardTypeSetId: meta.awardTypeSetId,
      sourceAsOf: meta.sourceAsOf,
    }),
  }));
}

/**
 * THE SECOND DEFINITION. DESIGN C5.
 *
 * A paged sum under the typed NAME rather than the resolved parent id. It catches entities that
 * carry the name and are registered under no parent, so it is larger than the parent rollup and
 * it is a different question, not a better answer to the same one. It is published beside the
 * parent figure as a second named figure and the two are never merged, added or presented as a
 * range.
 *
 * @param {number} total
 * @param {{fiscalYear:number, awardTypeSetId:string, sourceAsOf:string|null, entityCount:number}} meta
 * @returns {object} A COMPUTED claim.
 */
export function nameMatchTotalClaim(total, meta) {
  return computed(total, OBLIGATIONS, METHODS.NAME_MATCH_TOTAL, {
    fiscalYear: meta.fiscalYear,
    awardTypeSetId: meta.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
    note: 'A DIFFERENT DEFINITION of the company from the parent UEI rollup. This is the sum '
      + 'over every entity whose recorded name matches the text searched, across '
      + meta.entityCount + ' entities, including entities registered under no parent at all. It '
      + 'is never added to the parent figure and the two are never shown as a range, because '
      + 'they answer two different questions rather than estimating one answer.',
  });
}

/**
 * The panel name used in a failure sentence, in the words the page uses.
 * @param {string} dimension
 * @returns {string}
 */
export function describeDimension(dimension) {
  switch (dimension) {
    case 'awarding_agency': return 'agency breakdown';
    case 'awarding_subagency': return 'sub agency breakdown';
    case 'psc': return 'product and service code breakdown';
    case 'naics': return 'industry code breakdown';
    case 'recipient': return 'entity breakdown';
    default: return 'category breakdown';
  }
}
