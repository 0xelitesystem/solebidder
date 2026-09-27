// THE PARENT DETAIL PANEL. DESIGN 2.1, C6, 6.6.
//
// This is the first money on the page, so it is the place three things have to be got right.
//
// ONE. THE PROFILE TOTAL IS NOT FILTERED BY THE AWARD TYPE CONTROL, AND THE BADGE SAYS SO.
// GET /api/v2/recipient/{id}/?year=YYYY takes a year and nothing else. There is no award type
// parameter on it, so the figure it returns covers EVERY award type whatever the visible control
// says. Measured live on 2026-09-22 for the parent UEI ZFN2JJXBLZT3 at FY2025: the profile
// reports 65,405,410,468.25, which is the all award types figure, while the same year restricted
// to contract type codes A to D is a different and smaller number. Labelling this figure with
// the visitor's selected set would be a quiet lie about what produced it, so the claim carries
// the all award types set and a note whenever the control says something else.
//
// TWO. NO FEDERAL AWARDS IS A REAL ANSWER, NOT AN ERROR AND NOT AN EMPTY CHART. An entity that
// is registered and recorded nothing in the year asked about gets a sentence saying exactly
// that. The zero is REPORTED, because the endpoint reported it, and it is not charted, because a
// chart of one zero column reads as a failed fetch. What never happens is the other direction: a
// value the endpoint could not give us is refused by the validator rather than arriving here as
// a zero.
//
// THREE. A COUNT IS NOT MONEY. The transaction count and the award count are tallies, and a
// tally in this product physically cannot become a currency string: the tally formatter has no
// path to the currency formatter. They are labelled with what they count, because "32,424" on
// its own beside a money panel invites a reader to take it for dollars.
//
// Isomorphic: no node:* imports and no DOM.

import { spendingByAwardCountRequest, validateSpendingByAwardCount } from '../query/endpoints.js';
import { reported, METHODS } from '../core/claim.js';
import { OBLIGATIONS, TALLY } from '../core/units.js';
import { AWARD_TYPE_SETS } from '../core/constants.js';

/**
 * The note that rides on the profile total whenever the visible award type control is not the
 * all award types set. DESIGN C6 makes that control visible precisely so a reader who gets a
 * different number from the government's own page can see why.
 */
export const PROFILE_TOTAL_SET_NOTE = 'This endpoint takes a fiscal year and no award type '
  + 'filter, so this figure covers every award type, whatever award type set was chosen. '
  + 'The category and award figures use the chosen set, which is why their totals differ '
  + 'from this one.';

/** What the page says when the answer is nothing. */
export const NO_FEDERAL_AWARDS_SENTENCE = 'This entity has no federal prime award obligations '
  + 'recorded against it for the fiscal year selected. That is the answer the source gave, not a '
  + 'failed request and not a missing panel. Awards recorded against entities that are not '
  + 'registered under this parent are invisible to this view, and actions that are withheld from '
  + 'public reporting are absent from it.';

/**
 * Build the parent detail claims from an already fetched profile projection.
 *
 * The profile is fetched once, during identity hydration, and passed in here. Fetching it twice
 * would double the cost of the first paint for no gain.
 *
 * @param {Object} args
 * @param {{name:string, uei:string, totalObligations:number, totalTransactions:number,
 *   alternateNames:string[]}} args.profile
 * @param {number} args.fiscalYear
 * @param {import('../core/constants.js').AwardTypeSetId} args.awardTypeSetId
 * @param {string|null} args.sourceAsOf
 * @param {number|null} [args.awardCount] From the award count endpoint, when it arrived.
 * @returns {{totalClaim:object, transactionsClaim:object, alternateNamesClaim:object,
 *   awardCountClaim:object|null, noFederalAwards:boolean, sentence:string|null}}
 */
export function parentDetailClaims(args) {
  const { profile, fiscalYear, sourceAsOf } = args;
  if (!profile || typeof profile !== 'object') {
    throw new TypeError('parentDetailClaims: the validated profile projection is required.');
  }
  if (!AWARD_TYPE_SETS[args.awardTypeSetId]) {
    throw new RangeError('parentDetailClaims: awardTypeSetId must be one of '
      + Object.keys(AWARD_TYPE_SETS).join(', '));
  }
  const setIsAll = args.awardTypeSetId === 'all';

  const totalClaim = reported(profile.totalObligations, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, {
    fiscalYear,
    // Always the all award types set, because that is what this endpoint measures. See note one
    // at the top of this file.
    awardTypeSetId: 'all',
    sourceAsOf,
    note: setIsAll ? null : PROFILE_TOTAL_SET_NOTE,
  });

  const transactionsClaim = reported(profile.totalTransactions, TALLY, METHODS.RECIPIENT_PROFILE_TRANSACTIONS, {
    fiscalYear,
    awardTypeSetId: 'all',
    sourceAsOf,
    tallyNoun: 'transaction record',
    note: 'A transaction is one modification or one action on an award, so this counts records '
      + 'rather than contracts. It is a count, not money.',
  });

  const alternateNamesClaim = reported(profile.alternateNames.length, TALLY, METHODS.ALTERNATE_NAMES, {
    fiscalYear,
    awardTypeSetId: 'all',
    sourceAsOf,
    tallyNoun: 'declared name',
    note: 'Names the registrant declared for itself in its own registration. They are how a '
      + 'reader recognises which of several similar records this one is.',
  });

  const awardCountClaim = typeof args.awardCount === 'number' && Number.isFinite(args.awardCount)
    ? reported(args.awardCount, TALLY, METHODS.SPENDING_BY_AWARD_COUNT, {
      fiscalYear,
      awardTypeSetId: args.awardTypeSetId,
      sourceAsOf,
      tallyNoun: 'award',
      note: 'A count of awards in the ' + AWARD_TYPE_SETS[args.awardTypeSetId].label.toLowerCase()
        + ' set for the fiscal year selected. Changing that control changes this count, which is '
        + 'why the control is visible rather than a hidden default.',
    })
    : null;

  const noFederalAwards = profile.totalObligations === 0
    && (args.awardCount === undefined || args.awardCount === null || args.awardCount === 0);

  return {
    totalClaim,
    transactionsClaim,
    alternateNamesClaim,
    awardCountClaim,
    noFederalAwards,
    sentence: noFederalAwards ? NO_FEDERAL_AWARDS_SENTENCE : null,
  };
}

/**
 * Fetch the award count for the selected award type set.
 *
 * Returned as its own result rather than folded into the parent panel, because this call is one
 * of the heavy search endpoints and the parent panel is wave one. DESIGN 6.3: wave one is under
 * half a second and it blocks nothing.
 *
 * @param {{request:Function}} client
 * @param {Object} args
 * @param {string} args.recipientId
 * @param {number} args.fiscalYear
 * @param {import('../core/constants.js').AwardTypeSetId} args.awardTypeSetId
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold]
 * @returns {Promise<{ok:true, awardCount:number, attempts:number}
 *   |{ok:false, failure:import('../query/failure.js').Failure}>}
 */
export async function fetchAwardCount(client, args) {
  const result = await client.request(
    spendingByAwardCountRequest({
      recipientId: args.recipientId,
      fiscalYear: args.fiscalYear,
      awardTypeSetId: args.awardTypeSetId,
    }),
    validateSpendingByAwardCount,
    { what: 'the count of awards in the selected award type set', signal: args.signal, onCold: args.onCold },
  );
  if (!result.ok) return { ok: false, failure: result.failure };
  return { ok: true, awardCount: result.value.awardCount, attempts: result.attempts };
}
