// THE HERO ARITHMETIC. DESIGN C1, DESIGN 2.2, DESIGN C7.
//
// TWO FIGURES THAT CHECK EACH OTHER.
//
//   THE SOLE BIDDER SHARE is a share of DOLLARS. It is the sum of lifetime award value across
//   the awards whose record says the award was not competed, over the sum of lifetime award
//   value across the whole set handed in.
//
//   THE ONE OFFER SHARE is a share of COUNTS. It is the number of awards reporting exactly one
//   offer received, over the number of awards where that field is present and internally
//   consistent.
//
// They come from different fields, they are different units, and they are shown side by side
// precisely because a reader should be able to see them agree. If they ever diverge sharply
// that is a fact about the record and it belongs on the page, not smoothed away.
//
// THE DEFINITION OF NOT COMPETED IS EXACTLY ONE STRING AND IT IS NEVER WIDENED.
//
// The field is extent_competed_description and the only value that counts is the exact value
// NOT COMPETED. This is the single most load bearing line in this module, so it is worth
// saying why it is an equality test and never a substring test.
//
// The procurement vocabulary contains several neighbouring values whose text CONTAINS the
// words that the exact value is made of. A substring test would sweep those in, the figure
// would rise, and it would rise in the direction that makes the headline more dramatic. That
// is the worst possible direction for an error to point in a product whose entire argument is
// that its numbers can be checked. An equality test cannot drift that way: a value the
// procurement system spells differently is simply not counted, and the count of awards whose
// record carries no competition field at all is published beside the figure so the reader can
// see the size of what was left out.
//
// A row whose extent field is absent stays in the DENOMINATOR and can never enter the
// numerator. The denominator is the sentence the page prints, "the total value across the N
// largest awards active in the fiscal year", and quietly shrinking it to the rows that
// happened to carry a field would make the printed sentence false. The consequence is that the
// share is a FLOOR when any row lacks the field, and when that happens the claim carries a note
// saying so in those words.
//
// THE INTERNALLY INCONSISTENT ROW IS SHOWN, NOT CORRECTED. DESIGN C1 records a real award that
// reports full and open competition with zero offers received. The response validator flags it,
// this module excludes it from the COUNT share and counts it visibly, and nobody rewrites the
// government record to make the arithmetic tidier.
//
// Isomorphic: no node:* imports and no DOM.

import { computed, reported, METHODS } from '../core/claim.js';
import { AWARD_VALUE, TALLY, formatUnit, formatUnitBare, formatTally } from '../core/units.js';
import {
  safeShare, SHARE_UNAVAILABLE, sumField, countNegative, tallyClaim, NEGATIVE_ROW_NOTE,
} from './share.js';

/**
 * The one value of extent_competed_description that counts as not competed. DESIGN C1.
 *
 * Exported so that the test can assert the definition itself rather than a figure computed
 * from it, and so that any future widening of it is a visible diff to this constant with a
 * paragraph attached rather than a quiet change to a comparison somewhere in a loop.
 */
export const NOT_COMPETED = 'NOT COMPETED';

/**
 * The reason the count share is unavailable when awards came back but none of them carries a
 * usable offers figure. It is separate from the no rows reason because the two say different
 * things about the source: one is an empty result set and the other is a result set whose
 * competition fields did not arrive, and a reader deciding whether to trust the panel needs to
 * know which of those happened.
 */
export const NO_USABLE_OFFERS_FIELD = 'Awards came back for this fiscal year, but none of them '
  + 'carries a number of offers received that can be counted. Either the field is absent from '
  + 'the record or it contradicts the competition field beside it. The count share is left '
  + 'blank rather than computed over a denominator of nothing.';

/**
 * True only for the exact value. Case and surrounding whitespace are normalised, because those
 * are transport artefacts rather than meaning. Nothing else is.
 *
 * @param {string|null|undefined} extentCompeted
 * @returns {boolean}
 */
export function isNotCompeted(extentCompeted) {
  if (typeof extentCompeted !== 'string') return false;
  return extentCompeted.trim().toUpperCase() === NOT_COMPETED;
}

/**
 * Join the award rows to their detail records by the generated internal id.
 *
 * The two come from different endpoints and a detail call can fail on its own, so the join is
 * explicitly partial and the misses are counted. A missing detail is not an error state for
 * the page: it is one award out of N whose competition record did not arrive, and the honest
 * treatment is to say how many.
 *
 * @param {{generatedInternalId:string}[]} awardRows
 * @param {{generatedInternalId:string}[]} awardDetails
 * @returns {{row:object, detail:object|null}[]}
 */
export function joinAwardDetails(awardRows, awardDetails) {
  if (!Array.isArray(awardRows)) throw new TypeError('joinAwardDetails: awardRows must be an array.');
  if (!Array.isArray(awardDetails)) {
    throw new TypeError('joinAwardDetails: awardDetails must be an array, even empty. An absent '
      + 'array would be indistinguishable from every detail call having failed.');
  }
  const byId = new Map();
  for (const d of awardDetails) {
    if (d && typeof d.generatedInternalId === 'string') byId.set(d.generatedInternalId, d);
  }
  return awardRows.map((row) => ({
    row,
    detail: byId.has(row.generatedInternalId) ? byId.get(row.generatedInternalId) : null,
  }));
}

/**
 * @typedef {Object} CompetitionMeta
 * @property {number} fiscalYear
 * @property {string} awardTypeSetId
 * @property {string|null} sourceAsOf
 */

/**
 * THE HERO. The share of lifetime award value whose record says the award was not competed.
 * DESIGN C1.
 *
 * @param {Object} args
 * @param {{awardId:string, awardValue:number, generatedInternalId:string}[]} args.awardRows
 *   Already filtered to the resolved entity set by filterRowsToEntitySet. Trap 1.
 * @param {object[]} args.awardDetails One per award row where the detail call succeeded.
 * @param {CompetitionMeta} args.meta
 * @returns {Object}
 */
export function soleBidderShare(args) {
  const { awardRows, awardDetails, meta } = args;
  const joined = joinAwardDetails(awardRows, awardDetails);

  const notCompeted = joined.filter((j) => j.detail !== null && isNotCompeted(j.detail.extentCompeted));
  const noField = joined.filter((j) => j.detail === null
    || typeof j.detail.extentCompeted !== 'string');

  const negatives = countNegative(awardRows, 'awardValue');
  const base = {
    awardCountClaim: tallyClaim(awardRows.length, 'award', METHODS.SOLE_BIDDER_SHARE, meta),
    notCompetedCountClaim: tallyClaim(notCompeted.length, 'not competed award',
      METHODS.SOLE_BIDDER_SHARE, meta,
      'Counted only where the competition field holds the exact value NOT COMPETED. A '
      + 'neighbouring value spelled differently by the procurement system is not counted.'),
    noCompetitionFieldCountClaim: tallyClaim(noField.length, 'missing competition field',
      METHODS.SOLE_BIDDER_SHARE, meta,
      'One per award whose record carries no competition field at all. Such an award can never '
      + 'enter the numerator while its value remains in the total, so the share is a floor.'),
    negativeRowCountClaim: tallyClaim(negatives, 'negative award value',
      METHODS.SOLE_BIDDER_SHARE, meta, NEGATIVE_ROW_NOTE),
  };

  if (awardRows.length === 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.NO_ROWS });
  }

  const denominator = sumField(awardRows, 'awardValue');
  const numerator = sumField(notCompeted.map((j) => j.row), 'awardValue');

  const floorNote = noField.length === 0 ? undefined
    : formatTally(noField.length, 'award') + ' of ' + formatTally(awardRows.length, 'award')
      + ' in this set carries no competition field in the record, so that value can never enter '
      + 'the numerator while it remains in the total. This share is therefore a floor for the '
      + 'set and not the whole of it.';

  const share = safeShare({
    numerator,
    denominator,
    numeratorUnitKind: AWARD_VALUE,
    denominatorUnitKind: AWARD_VALUE,
    rowCount: awardRows.length,
    method: METHODS.SOLE_BIDDER_SHARE,
    denominatorText: formatUnitBare(numerator, AWARD_VALUE) + ' where the record says the award '
      + 'was not competed, of ' + formatUnit(denominator, AWARD_VALUE) + ' across the '
      + formatTally(awardRows.length, 'largest award') + ' active in fiscal year FY'
      + meta.fiscalYear + ' on the ' + meta.awardTypeSetId + ' award type set. This is a share '
      + 'of lifetime award value across those awards and it is not a share of the money '
      + 'obligated to this recipient in that year.',
    fiscalYear: meta.fiscalYear,
    awardTypeSetId: meta.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
    note: floorNote,
  });

  const figures = {
    ...base,
    available: share.available,
    reason: share.reason,
    isFloor: noField.length > 0,
    notCompetedValueClaim: computed(numerator, AWARD_VALUE, METHODS.SOLE_BIDDER_SHARE, meta),
    totalValueClaim: computed(denominator, AWARD_VALUE, METHODS.SOLE_BIDDER_SHARE, meta),
  };
  return Object.freeze(share.available
    ? { ...figures, soleBidderShareClaim: share.shareClaim }
    : figures);
}

/**
 * The independent cross check. The share of awards reporting exactly one offer received.
 * DESIGN C1 and DESIGN 2.2.
 *
 * THE DENOMINATOR IS DIFFERENT FROM THE HERO'S, ON PURPOSE. Here it is the count of awards
 * where the offers field is present AND the record is not internally inconsistent with itself,
 * because DESIGN 2.2 fixes it that way: rows missing the field are excluded and counted
 * visibly. The two exclusions are counted separately, since one is an absent field and the
 * other is a field that contradicts the field beside it, and a reader deciding how much to
 * trust the panel wants to know which.
 *
 * @param {Object} args
 * @param {{generatedInternalId:string}[]} args.awardRows
 * @param {object[]} args.awardDetails
 * @param {CompetitionMeta} args.meta
 * @returns {Object}
 */
export function oneOfferShare(args) {
  const { awardRows, awardDetails, meta } = args;
  const joined = joinAwardDetails(awardRows, awardDetails);

  const present = joined.filter((j) => j.detail !== null
    && typeof j.detail.offersReceived === 'number' && Number.isFinite(j.detail.offersReceived));
  const inconsistent = present.filter((j) => j.detail.inconsistent === true);
  const eligible = present.filter((j) => j.detail.inconsistent !== true);
  const oneOffer = eligible.filter((j) => j.detail.offersReceived === 1);
  const absent = joined.length - present.length;

  const base = {
    awardCountClaim: tallyClaim(awardRows.length, 'award', METHODS.ONE_OFFER_SHARE, meta),
    oneOfferCountClaim: tallyClaim(oneOffer.length, 'one offer award',
      METHODS.ONE_OFFER_SHARE, meta,
      'An award whose record reports exactly one offer received. This is the numerator of the '
      + 'count share.'),
    fieldPresentCountClaim: tallyClaim(eligible.length, 'countable award',
      METHODS.ONE_OFFER_SHARE, meta,
      'An award where the number of offers received is present and does not contradict the '
      + 'competition field beside it. This is the denominator of the count share.'),
    fieldAbsentCountClaim: tallyClaim(absent, 'missing offers received field',
      METHODS.ONE_OFFER_SHARE, meta,
      'One per award where the number of offers received is absent from the record. These are '
      + 'excluded from the count share and shown here rather than swallowed.'),
    inconsistentCountClaim: tallyClaim(inconsistent.length, 'internally inconsistent award',
      METHODS.ONE_OFFER_SHARE, meta,
      'An award whose record reports full and open competition alongside fewer than two offers '
      + 'received. Both fields are shown as the source published them, the record is not '
      + 'corrected, and the award is excluded from the count share.'),
  };

  if (awardRows.length === 0) {
    return Object.freeze({ ...base, available: false, reason: SHARE_UNAVAILABLE.NO_ROWS });
  }
  if (eligible.length === 0) {
    return Object.freeze({ ...base, available: false, reason: NO_USABLE_OFFERS_FIELD });
  }

  const share = safeShare({
    numerator: oneOffer.length,
    denominator: eligible.length,
    numeratorUnitKind: TALLY,
    denominatorUnitKind: TALLY,
    rowCount: eligible.length,
    method: METHODS.ONE_OFFER_SHARE,
    denominatorText: formatTally(oneOffer.length, 'award') + ' reporting exactly one offer '
      + 'received, of ' + formatTally(eligible.length, 'award') + ' where that field is present '
      + 'and does not contradict the competition field beside it, within the '
      + formatTally(awardRows.length, 'largest award') + ' active in fiscal year FY'
      + meta.fiscalYear + '. The number of offers received is published for each award. The '
      + 'identity of anybody who did not win is not in this data and never will be.',
    fiscalYear: meta.fiscalYear,
    awardTypeSetId: meta.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
  });

  const figures = { ...base, available: share.available, reason: share.reason };
  return Object.freeze(share.available
    ? { ...figures, oneOfferShareClaim: share.shareClaim }
    : figures);
}

/**
 * The per award competition record, straight from the government field, for the table under
 * the hero. DESIGN C7. Nothing here is our arithmetic: every figure is REPORTED, and the row
 * that contradicts itself is marked rather than mended.
 *
 * @param {Object} args
 * @param {{awardId:string, awardValue:number, generatedInternalId:string}[]} args.awardRows
 * @param {object[]} args.awardDetails
 * @param {CompetitionMeta} args.meta
 * @returns {object[]}
 */
export function competitionRows(args) {
  const { awardRows, awardDetails, meta } = args;
  return Object.freeze(joinAwardDetails(awardRows, awardDetails).map((j, i) => {
    const d = j.detail;
    const row = {
      index: i,
      rank: i + 1,
      awardId: j.row.awardId,
      awardValueClaim: reported(j.row.awardValue, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, meta),
      extentCompeted: d === null ? null : d.extentCompeted,
      solicitationProcedures: d === null ? null : d.solicitationProcedures,
      setAside: d === null ? null : d.setAside,
      notCompeted: d === null ? false : isNotCompeted(d.extentCompeted),
      inconsistent: d === null ? false : d.inconsistent === true,
      detailAvailable: d !== null,
      offersReceivedRaw: d === null ? null : d.offersReceivedRaw,
    };
    if (d !== null && typeof d.offersReceived === 'number' && Number.isFinite(d.offersReceived)) {
      return Object.freeze({
        ...row,
        offersReceivedClaim: reported(d.offersReceived, TALLY, METHODS.AWARD_COMPETITION_FIELDS, {
          ...meta,
          tallyNoun: 'received offer',
          note: d.inconsistent === true
            ? 'The record reports full and open competition alongside this figure, so the two '
              + 'fields contradict each other. Both are shown as the source published them and '
              + 'this award is excluded from the one offer count share.'
            : undefined,
        }),
      });
    }
    return Object.freeze(row);
  }));
}
