// THE HERO AND THE CONCENTRATION VIEW, ASSEMBLED WITHOUT A DOCUMENT. DESIGN C1 and C7, trap 1.
//
// This used to live inside the boot() closure in src/ui/app.js. It lives here so that the page
// and the command line build the hero from the same rows through the same code, and a rule
// changed in one place cannot quietly go on meaning something else in the other. The page
// decides WHERE each result lands and how it is drawn. This module decides WHAT the figures are,
// and nothing in it formats a number, touches the DOM or swallows a failure.
//
// THREE STEPS, AND THE SEAMS BETWEEN THEM ARE DELIBERATE.
//
//   searchLargestAwards      one heavy request, then trap 1: every returned row is checked
//                            against the resolved entity set, and the rows that did not belong
//                            are counted in the open.
//   fetchCompetitionRecords  the fan out, one award detail per kept row, capped at six in flight.
//   assembleHero             pure arithmetic over what arrived: the two shares, the receipts with
//                            their award links, the two tallies and the concentration view.
//
// A seam is where a caller may stop. The page stops at one when the reader has moved to a
// different period, so a stale search never spends forty more requests; the command line stops
// at one when it is interrupted.
//
// EACH VIEW FAILS ON ITS OWN. The hero and the concentration view are drawn from the same rows,
// but a defect in one costs that one and not the other, so they are assembled in two separate
// try blocks and handed back as two separate results.
//
// Isomorphic: no node:* imports and no DOM.

import { url, awardDetailRequest, validateAwardDetail, validateSpendingByAward } from '../query/endpoints.js';
import { buildAwardSearchBody, filterRowsToEntitySet } from '../query/award-query.js';
import {
  soleBidderShare, oneOfferShare, competitionRows, cumulativeConcentration, topAwardShare,
} from '../analysis/index.js';
import { tallyClaim } from '../analysis/share.js';
import { METHODS } from '../core/claim.js';
import { HERO_AWARD_COUNT, MAX_CONCURRENCY } from '../core/constants.js';
import { failure, INCOMPLETE_ROLLUP, MALFORMED_RESPONSE } from '../query/failure.js';

/**
 * The names each part of this assembly goes by in a failure sentence, so the page and the
 * command line say which part is missing in the same words.
 */
export const HERO_WHAT = Object.freeze({
  search: 'the largest contracts active in the fiscal year',
  detail: 'the competition record for one contract',
  emptied: 'the competition split for the largest contracts',
  hero: 'the competition split',
  concentration: 'the concentration view',
});

/** The note on the tally of award rows that were not this entity's. */
export const DROPPED_ROW_NOTE = 'Rows the award search endpoint returned whose recipient is not in '
  + 'the resolved entity set. That endpoint ignores a recipient filter entirely, so the rows are '
  + 'checked here against the parent and its registered children, and the ones that did not '
  + 'belong are dropped from every figure here and counted in the open rather than swallowed.';

/** The note on the tally of competition records that answered. */
export const ARRIVED_RECORD_NOTE = 'Contracts in the set whose own competition record answered. A '
  + 'contract whose record did not arrive is counted in neither direction rather than assumed '
  + 'either way.';

/**
 * The provenance triple every claim shares, taken from ONE resolved identity, so no figure can
 * carry a fiscal year, an award type set or a source date that differs from its neighbours.
 * @param {{fiscalYear:number, awardTypeSetId:string, sourceAsOf?:string|null}} identity
 * @returns {{fiscalYear:number, awardTypeSetId:string, sourceAsOf:string|null}}
 */
export function metaOf(identity) {
  return {
    fiscalYear: identity.fiscalYear,
    awardTypeSetId: identity.awardTypeSetId,
    sourceAsOf: identity.sourceAsOf === undefined ? null : identity.sourceAsOf,
  };
}

/**
 * The award search request. The body builder lives in its own module ON PURPOSE: that module has
 * no recipient id parameter at all, and the field name does not appear anywhere in it. The award
 * search endpoint SILENTLY IGNORES a recipient id filter, and four different filters returned
 * byte identical results topped by an entirely different company, so the only filter that does
 * anything is the name text and every returned row is validated against the resolved entity set
 * afterwards.
 *
 * @param {any} identity
 * @param {number} [limit]
 * @returns {{id:string, method:'POST', url:string, body:object, weight:'heavy'}}
 */
export function awardSearchRequest(identity, limit = HERO_AWARD_COUNT) {
  return {
    id: 'spendingByAward',
    method: 'POST',
    url: url('/api/v2/search/spending_by_award/'),
    body: buildAwardSearchBody({
      recipientSearchText: identity.name,
      fiscalYear: identity.fiscalYear,
      awardTypeSetId: identity.awardTypeSetId,
      limit,
    }),
    weight: 'heavy',
  };
}

/**
 * TRAP 1, handled where the rows land. Every returned row is validated against the resolved
 * entity set, and the count that did not belong is a tally with its own note. The rows have
 * already been through the response validator, which projects the recipient column to a camel
 * case name; filterRowsToEntitySet reads that spelling directly. A row whose recipient cannot be
 * read is excluded, which is the safe direction.
 *
 * When NO row survives, the result is a named failure rather than an empty hero. It is marked
 * `emptied` because it is not a request that failed: asking again returns the same rows and
 * drops them again, so a caller offers no retry for it.
 *
 * @param {any} identity A ResolvedIdentity.
 * @param {readonly any[]} rows The validated award rows.
 * @returns {{ok:true, kept:any[], excludedCount:number, excludedRowCountClaim:object, meta:object}
 *   |{ok:false, emptied:true, failure:any, excludedRowCountClaim:object, meta:object}}
 */
export function keepEntityRows(identity, rows) {
  const filtered = filterRowsToEntitySet(rows, identity.entityNamesUpper);
  const meta = metaOf(identity);
  const excludedRowCountClaim = tallyClaim(filtered.excludedCount, 'dropped award row',
    METHODS.SOLE_BIDDER_SHARE, meta, DROPPED_ROW_NOTE);
  if (filtered.kept.length === 0) {
    return {
      ok: false,
      emptied: true,
      failure: failure(INCOMPLETE_ROLLUP, HERO_WHAT.emptied,
        { parts: { arrived: 0, expected: rows.length } }),
      excludedRowCountClaim,
      meta,
    };
  }
  return {
    ok: true,
    kept: filtered.kept,
    excludedCount: filtered.excludedCount,
    excludedRowCountClaim,
    meta,
  };
}

/**
 * Step one. The largest contracts active in the fiscal year, filtered to the entity set.
 *
 * @param {{request:Function}} client
 * @param {any} identity A ResolvedIdentity.
 * @param {{limit?:number, signal?:AbortSignal, onCold?:Function}} [options]
 * @returns {Promise<ReturnType<typeof keepEntityRows>|{ok:false, emptied:false, failure:any}>}
 */
export async function searchLargestAwards(client, identity, options = {}) {
  const result = await client.request(
    awardSearchRequest(identity, options.limit),
    validateSpendingByAward,
    { what: HERO_WHAT.search, signal: options.signal, onCold: options.onCold },
  );
  if (!result.ok) return { ok: false, emptied: false, failure: result.failure };
  return keepEntityRows(identity, result.value.rows);
}

/**
 * Step two. One competition record per kept row, never more than MAX_CONCURRENCY in flight. A
 * record that did not answer is left out of the list rather than invented; the shares downstream
 * treat a missing record as a floor and say so.
 *
 * @param {{request:Function, mapWithCap:Function}} client
 * @param {readonly any[]} kept The rows step one kept.
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<any[]>} The award details that arrived.
 */
export async function fetchCompetitionRecords(client, kept, options = {}) {
  const tasks = kept.map((row) => () => client.request(
    awardDetailRequest(row.generatedInternalId),
    validateAwardDetail,
    { what: HERO_WHAT.detail, signal: options.signal },
  ));
  const settled = await client.mapWithCap(tasks, MAX_CONCURRENCY);
  return settled.filter((d) => d && d.ok).map((d) => d.value);
}

/**
 * A figure that could not be assembled from rows that did arrive. That is a defect in the
 * arithmetic or in a shape it was handed, never a reason to show a partial figure.
 * @param {string} what
 * @param {unknown} e
 * @returns {any} A MALFORMED_RESPONSE Failure.
 */
export function assemblyFailure(what, e) {
  const err = /** @type {any} */ (e);
  return failure(MALFORMED_RESPONSE, what, { detail: String(err && err.message) });
}

/**
 * Step three, pure. The hero and the concentration view from the kept rows and the records that
 * arrived.
 *
 * THE AWARD LINKS ARE RE-ATTACHED BY INDEX. competitionRows keeps the order of the rows it was
 * handed and does not carry the internal award id, so each receipt row gets the id of the kept row
 * at the same position. Without that step every receipt would link to the wrong award record.
 *
 * @param {{kept:readonly any[], awardDetails:readonly any[], meta:object}} args
 * @returns {{
 *   detailCountClaim:object,
 *   hero:{ok:true, soleBidder:any, oneOffer:any, awards:any[]}|{ok:false, failure:any},
 *   concentration:{ok:true, cumulative:any, topAward:any, awardRows:any}|{ok:false, failure:any},
 * }}
 */
export function assembleHero({ kept, awardDetails, meta }) {
  // COMPUTED, not REPORTED. The competition FIELDS are reported; how many of them arrived is our
  // own count over the fan out, and it has its own method so that the provenance line states
  // what was counted rather than borrowing the wording of the share it sits beside.
  const detailCountClaim = tallyClaim(awardDetails.length, 'arrived competition record',
    METHODS.RESPONSE_COVERAGE_COUNT, meta, ARRIVED_RECORD_NOTE);

  let hero;
  try {
    const soleBidder = soleBidderShare({ awardRows: kept, awardDetails, meta });
    const oneOffer = oneOfferShare({ awardRows: kept, awardDetails, meta });
    const awards = competitionRows({ awardRows: kept, awardDetails, meta }).map((row, i) => ({
      ...row,
      generatedInternalId: kept[i].generatedInternalId,
    }));
    hero = { ok: true, soleBidder, oneOffer, awards };
  } catch (e) {
    hero = { ok: false, failure: assemblyFailure(HERO_WHAT.hero, e) };
  }

  let concentration;
  try {
    concentration = {
      ok: true,
      cumulative: cumulativeConcentration({ awardRows: kept, meta }),
      topAward: topAwardShare({ awardRows: kept, meta }),
      awardRows: competitionRows({ awardRows: kept, awardDetails, meta }),
    };
  } catch (e) {
    concentration = { ok: false, failure: assemblyFailure(HERO_WHAT.concentration, e) };
  }

  return { detailCountClaim, hero, concentration };
}
