// THE SHARE GUARD. Every quotient in this product goes through here first.
//
// WHY THIS FILE EXISTS. shareOf() in src/contracts/analysis.js is correct and strict: it
// THROWS on a zero denominator and on a mismatch of unit kinds. That is the right behaviour
// for a programming mistake. It is the wrong behaviour for a data condition, and the two look
// identical at the call site.
//
// A fiscal year with no rows returned is not a bug. A recipient whose category rows sum to
// zero is not a bug. An agency row carrying a negative amount is not a bug either: a
// deobligation is money the government committed earlier and has now released, and it is
// recorded as a negative figure in this data. Those three conditions are ordinary, and if the
// analysis layer threw on each of them the page would show a stack trace where it should show
// a sentence.
//
// So this module answers the question in two parts. Either the share is available, and it
// arrives as a COMPUTED Claim carrying its denominator in words, or it is unavailable, and it
// arrives as a NAMED REASON that the panel prints instead of a bar. There is no third outcome
// and in particular there is no zero. A share with an empty denominator is not zero percent,
// it is unavailable, and the difference matters because a bar of length zero reads as a
// measurement.
//
// THE FOUR CONDITIONS THAT MAKE A SHARE UNAVAILABLE.
//
//   1. NO ROWS. The source returned nothing for this fiscal year and award type set.
//   2. A ZERO DENOMINATOR. The rows exist and they sum to zero, which happens when a year of
//      obligations is exactly offset by the deobligations recorded against it.
//   3. A DENOMINATOR AT OR BELOW ZERO. The parts do not sum to a positive whole, so there is
//      no whole for a part to be a share OF.
//   4. A QUOTIENT OUTSIDE [0, 1]. This is the one that only appears with negative amounts in
//      the set. Rows of 100 and -50 sum to 50, and the first row is then 200 percent of the
//      total. That figure is arithmetically real and it is journalistically useless: a reader
//      seeing "200 percent of this recipient's money came from one agency" has been given a
//      wrong impression by us. The renderer refuses it as well, because formatUnit clamps a
//      share to a decimal fraction in [0, 1], so a claim built outside that range would be a
//      claim that can be constructed and never displayed. It is caught here, where the reason
//      can still be written down.
//
// NaN NEVER SURVIVES THIS FILE. Zero over zero is the classic path to a NaN reaching a page as
// the text "NaN percent", and it is refused at condition 2 before the division happens. Every
// exit from safeShare() is either a Claim built by the claim system or a sentence.
//
// Isomorphic: no node:* imports and no DOM.

import { shareOf } from '../contracts/analysis.js';
import { computed } from '../core/claim.js';
import { TALLY, assertTallyNoun } from '../core/units.js';

/**
 * The reasons a share is unavailable. Each is a full sentence, because the panel prints it
 * where the figure would have been and a reader who gets a fragment will guess the rest.
 *
 * They are ids rather than inline strings so that two panels reporting the same condition say
 * the same thing, and so that a test can assert WHICH condition fired rather than matching
 * prose that somebody will reword.
 */
export const SHARE_UNAVAILABLE = Object.freeze({
  NO_ROWS: 'The source returned no rows for this fiscal year and award type set, so there is '
    + 'nothing to divide by. A share with no denominator is unavailable rather than zero, and '
    + 'it is left blank here rather than drawn as a bar of no length.',
  ZERO_DENOMINATOR: 'The rows returned sum to exactly zero for this fiscal year, which happens '
    + 'when the money committed is offset by the money released back. There is no denominator, '
    + 'so no share is shown.',
  NEGATIVE_DENOMINATOR: 'The rows returned sum to a negative figure for this fiscal year, '
    + 'because more money was released back than was committed. The parts do not sum to a '
    + 'positive whole, so there is no whole for a part to be a share of.',
  OUT_OF_RANGE: 'At least one row carries a negative amount, which is money committed in an '
    + 'earlier action and released back in this one. The parts therefore do not sum to the '
    + 'whole in the way a percentage assumes, and the quotient falls outside nought to one '
    + 'hundred percent. The underlying figures are shown without a share rather than printed '
    + 'as a percentage that would mislead.',
  NOT_FINITE: 'One of the two figures this share divides is missing or is not a number. A '
    + 'value this tool could not obtain is refused rather than treated as a zero.',
});

/**
 * The sentence that travels with every count of negative rows. One string, so two panels
 * reporting the same condition tell the reader the same thing.
 */
export const NEGATIVE_ROW_NOTE = 'A negative amount is money committed in an earlier action and '
  + 'released back in this one. It is ordinary in this data, it does not on its own stop any '
  + 'figure being published, and it is counted here so that a reader knows the set contains one.';

/**
 * @typedef {Object} ShareResult
 * @property {boolean} available
 * @property {string|null} reason The sentence to print when available is false, else null.
 * @property {import('../core/claim.js').Claim} [shareClaim] Present ONLY when available.
 *   The key is deliberately named with the Claim suffix so that assertAnalysisOutput demands
 *   a real Claim of it, and deliberately ABSENT rather than null when unavailable, because
 *   that same walker refuses a null under a key ending in Claim.
 */

/**
 * The one place a quotient is taken in this product.
 *
 * @param {Object} args
 * @param {number} args.numerator
 * @param {number} args.denominator
 * @param {string} args.numeratorUnitKind Unit kind of BOTH figures. shareOf refuses a mismatch.
 * @param {string} args.denominatorUnitKind
 * @param {number} args.rowCount How many rows produced the denominator. Zero is condition 1.
 * @param {string} args.method One of METHODS, from the COMPUTED tier.
 * @param {string} args.denominatorText The numerator and the denominator in words.
 * @param {number} args.fiscalYear
 * @param {string} args.awardTypeSetId
 * @param {string|null} args.sourceAsOf
 * @param {string} [args.note]
 * @returns {ShareResult}
 */
export function safeShare(args) {
  const { numerator, denominator, rowCount } = args;

  if (!Number.isInteger(rowCount) || rowCount < 0) {
    throw new TypeError('safeShare: rowCount must be a non negative integer. It is how the '
      + 'difference between "no rows came back" and "the rows came back and they sum to zero" '
      + 'stays visible, and those two conditions read very differently to somebody deciding '
      + 'whether to trust the panel.');
  }
  if (rowCount === 0) return unavailable(SHARE_UNAVAILABLE.NO_ROWS);

  if (typeof numerator !== 'number' || !Number.isFinite(numerator)
    || typeof denominator !== 'number' || !Number.isFinite(denominator)) {
    return unavailable(SHARE_UNAVAILABLE.NOT_FINITE);
  }
  if (denominator === 0) return unavailable(SHARE_UNAVAILABLE.ZERO_DENOMINATOR);
  if (denominator < 0) return unavailable(SHARE_UNAVAILABLE.NEGATIVE_DENOMINATOR);

  const ratio = numerator / denominator;
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    return unavailable(SHARE_UNAVAILABLE.OUT_OF_RANGE);
  }

  return Object.freeze({
    available: true,
    reason: null,
    shareClaim: shareOf({
      numerator,
      denominator,
      numeratorUnitKind: args.numeratorUnitKind,
      denominatorUnitKind: args.denominatorUnitKind,
      method: args.method,
      denominatorText: args.denominatorText,
      fiscalYear: args.fiscalYear,
      awardTypeSetId: args.awardTypeSetId,
      sourceAsOf: args.sourceAsOf,
      note: args.note,
    }),
  });
}

/** @param {string} reason @returns {ShareResult} */
function unavailable(reason) {
  return Object.freeze({ available: false, reason });
}

/**
 * Sum one numeric field over a set of rows, refusing a row whose field is not a finite number.
 *
 * It refuses rather than skipping, because a row that silently contributes nothing to a
 * denominator is a denominator that quietly shrank, and a denominator that quietly shrank is a
 * wrong denominator. A malformed row is a bug in the validator upstream and it should surface
 * there.
 *
 * @param {object[]} rows
 * @param {string} key
 * @returns {number}
 */
export function sumField(rows, key) {
  if (!Array.isArray(rows)) throw new TypeError('sumField: rows must be an array.');
  let total = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const v = rows[i] ? rows[i][key] : undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      throw new TypeError('sumField: rows[' + i + '].' + key + ' is ' + String(v) + ' where a '
        + 'finite number was contracted. A row that contributes nothing to a total is a total '
        + 'that is quietly short, so this refuses rather than skipping it.');
    }
    total += v;
  }
  return total;
}

/**
 * How many rows carry a negative amount. A deobligation is real, it is in this data, and the
 * count of them is shown beside any panel whose arithmetic they affect rather than mentioned
 * in a caveat nobody reads.
 *
 * @param {object[]} rows
 * @param {string} key
 * @returns {number}
 */
export function countNegative(rows, key) {
  if (!Array.isArray(rows)) throw new TypeError('countNegative: rows must be an array.');
  return rows.filter((r) => r && typeof r[key] === 'number' && r[key] < 0).length;
}

/**
 * Words that turn a noun phrase into a clause. A tally noun containing one of these has its
 * head somewhere other than the end, and formatTally inflects the end.
 */
/**
 * Refuse a tally noun whose head is not its last word.
 *
 * THE RULE ITSELF LIVES IN src/core/units.js, next to the pluraliser it protects and inside the
 * Claim constructor, so that a figure built through reported() or computed() directly cannot
 * walk past it. One did, and it reached a real browser reading "2 offer receiveds". This is the
 * name the analysis layer calls it by; there is only one implementation.
 *
 * @param {string} noun
 */
function assertHeadFinalNoun(noun) {
  assertTallyNoun(noun, 'tallyClaim');
}

/**
 * A count of records as a COMPUTED tally Claim, so a number that is our own arithmetic over the
 * rows carries a badge like every other figure on the page.
 *
 * THE NOUN IS SHORT AND ITS HEAD IS THE LAST WORD. formatTally pluralises by inflecting the end
 * of the string, so "not competed award" becomes "not competed awards" while "award with no
 * competition field" would become "award with no competition fields", which counts the wrong
 * thing in the reader's ear. Anything longer than a noun phrase belongs in the note, where it
 * is read out beside the figure rather than conjugated into it.
 *
 * @param {number} count
 * @param {string} noun Singular, head last. What is being counted.
 * @param {string} method One of METHODS.
 * @param {{fiscalYear:number, awardTypeSetId:string, sourceAsOf:string|null}} meta
 * @param {string} [note] The sentence shown beside the count.
 * @returns {import('../core/claim.js').Claim}
 */
export function tallyClaim(count, noun, method, meta, note) {
  assertHeadFinalNoun(noun);
  return computed(count, TALLY, method, {
    tallyNoun: noun,
    fiscalYear: meta.fiscalYear,
    awardTypeSetId: meta.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
    note,
  });
}
