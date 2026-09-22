// CONTRACT 2 OF 3: THE ANALYSIS INPUT AND OUTPUT. Owned by the analysis team.
//
// THE RULE THAT SHAPES THIS WHOLE FILE: the analysis layer takes REPORTED projections in and
// hands CLAIMS out. Not numbers. Claims. Every leaf of AnalysisOutput that a reader will see is
// an object built by reported() or computed() from src/core/claim.js, which means it already
// carries its badge, its unit kind, its fiscal year, its award type set and the exact method
// that produced it. assertAnalysisOutput below walks the whole structure and throws on a bare
// number, so "we forgot to badge that one" fails a test rather than shipping.
//
// WHAT GOES IN. Only projections from src/query/endpoints.js validators. The analysis layer
// never fetches, so it can be tested entirely from committed fixtures, which is what makes
// every published figure reproducible by anybody who clones the repo.
//
// THE THREE ARITHMETIC RULES THAT ARE NOT NEGOTIABLE.
//
//   1. NEVER MIX UNIT KINDS IN ONE QUOTIENT. A share is a ratio of two figures of the same unit
//      kind. Obligations divided by lifetime award value is not a percentage of anything.
//      shareOf() below enforces it.
//   2. EVERY SHARE CARRIES ITS DENOMINATOR IN WORDS. The claim system already refuses a share
//      without one. It is restated here because the sole bidder figure is the single easiest
//      number on this page to quote out of context, and the sentence that protects it is
//      "of the total value across the largest N contracts", not "of the company money".
//   3. EXCLUDED ROWS ARE COUNTED AND SHOWN. Rows dropped because they are not in the resolved
//      entity set, and rows dropped because a competition field was absent, are both tallied
//      into the output. A denominator that quietly shrank is a wrong denominator.
//
// THE ONE CENT IS NOT A BUG. The child rollup and the parent total have been measured one cent
// apart. That delta is published rather than rounded away, because it is float arithmetic over
// hundreds of rows and saying so is more convincing than hiding it.
//
// Isomorphic: no node:* imports and no DOM.

import { isClaim, computed, METHODS } from '../core/claim.js';
import { SHARE, OBLIGATIONS, AWARD_VALUE, TALLY } from '../core/units.js';
import { isResolvedIdentity } from './identity.js';

/**
 * Everything the analysis layer is allowed to read. Every field is a validated projection from
 * src/query/endpoints.js, never a raw response.
 *
 * @typedef {Object} AnalysisInput
 * @property {import('./identity.js').ResolvedIdentity} identity
 * @property {number} fiscalYear Same value as identity.fiscalYear. Both are required so a
 *   mismatch is detectable rather than assumed away. Trap 2.
 * @property {import('../core/constants.js').AwardTypeSetId} awardTypeSetId
 * @property {string|null} sourceAsOf
 * @property {{name:string, amount:number}[]} agencyRows From spending_by_category/awarding_agency.
 * @property {{name:string, amount:number}[]} subagencyRows
 * @property {{name:string, code:string|null, amount:number}[]} pscRows
 * @property {{name:string, code:string|null, amount:number}[]} naicsRows
 * @property {{fiscalYear:number, obligations:number}[]} overTimePoints From spending_over_time.
 * @property {{awardId:string, recipientName:string, awardValue:number,
 *   generatedInternalId:string}[]} awardRows The largest N awards, already filtered to the
 *   resolved entity set.
 * @property {number} awardRowsExcluded How many rows the entity set filter dropped. Trap 1.
 * @property {import('../query/endpoints.js').validateAwardDetail extends never ? never : any[]} awardDetails
 *   One per award row, from the award detail validator.
 * @property {{uei:string, name:string, obligations:number}[]} childRows
 * @property {number} parentReportedTotal The parent total_transaction_amount for this year.
 * @property {number} [entityBreakdownTotal] The paged entity breakdown summed under the resolved
 *   parent IDENTIFIER, on the same fiscal year and the same award type set as nameMatchRows.
 *   Required alongside nameMatchRows for the second definition to be computed at all, because
 *   the parent profile total covers every award type and is not comparable to a name match that
 *   honours the award type control.
 * @property {{name:string, amount:number, uei:string|null}[]} [nameMatchRows] The second
 *   definition. DESIGN C5. Optional, because it is a separate panel and a separate call.
 */

/**
 * What the analysis layer hands the render layer. Every displayed leaf is a Claim.
 *
 * @typedef {Object} AnalysisOutput
 * @property {import('./identity.js').ResolvedIdentity} identity
 * @property {Object} soleBidder DESIGN C1, the hero.
 * @property {Object} concentration DESIGN C2.
 * @property {Object} overTime DESIGN C3.
 * @property {Object} rollup DESIGN C4.
 * @property {Object|null} methodDelta DESIGN C5, null when the second definition was not fetched.
 * @property {string[]} notices Sentences the page must show beside these figures, for example
 *   the self declared parent tree caveat.
 * @property {boolean} totalSuppressed True when a rollup was incomplete and no total may show.
 */

/**
 * A share of one quantity by another of the SAME unit kind, as a COMPUTED claim carrying its
 * denominator in words.
 *
 * @param {Object} args
 * @param {number} args.numerator
 * @param {number} args.denominator
 * @param {string} args.numeratorUnitKind Unit kind of BOTH figures. They must match.
 * @param {string} args.denominatorUnitKind
 * @param {string} args.method One of METHODS, the COMPUTED tier.
 * @param {string} args.denominatorText The numerator and denominator in words, shown beside it.
 * @param {number} args.fiscalYear
 * @param {string} args.awardTypeSetId
 * @param {string|null} args.sourceAsOf
 * @param {string} [args.note]
 * @returns {import('../core/claim.js').Claim}
 */
export function shareOf(args) {
  const { numerator, denominator, numeratorUnitKind, denominatorUnitKind } = args;
  if (numeratorUnitKind !== denominatorUnitKind) {
    throw new TypeError('shareOf: a share is a ratio of two figures of the SAME unit kind. This '
      + 'one divides ' + numeratorUnitKind + ' by ' + denominatorUnitKind + ', and that quotient '
      + 'has no meaning. Obligations are money committed in a fiscal year; award value is the '
      + 'lifetime value of an award. Dividing one by the other produces a percentage of nothing.');
  }
  if (typeof denominator !== 'number' || !Number.isFinite(denominator) || denominator === 0) {
    throw new RangeError('shareOf: the denominator must be a finite non zero number. A share '
      + 'with an empty denominator is not zero percent, it is unavailable, and it is refused '
      + 'here rather than rendered as a bar of length zero.');
  }
  if (typeof numerator !== 'number' || !Number.isFinite(numerator)) {
    throw new RangeError('shareOf: the numerator must be a finite number.');
  }
  return computed(numerator / denominator, SHARE, args.method, {
    fiscalYear: args.fiscalYear,
    awardTypeSetId: args.awardTypeSetId,
    sourceAsOf: args.sourceAsOf,
    denominatorText: args.denominatorText,
    note: args.note,
  });
}

/**
 * The Herfindahl index over a set of shares. Sum of squares, shares as decimals.
 *
 * The formula ships with the number, in the tooltip, because an index nobody can reproduce is
 * an assertion rather than a computation.
 *
 * @param {{name:string, amount:number}[]} rows
 * @param {Object} meta
 * @param {number} meta.fiscalYear
 * @param {string} meta.awardTypeSetId
 * @param {string|null} meta.sourceAsOf
 * @returns {import('../core/claim.js').Claim}
 */
export function herfindahl(rows, meta) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new TypeError('herfindahl: rows must be a non empty array.');
  }
  const total = rows.reduce((acc, r) => acc + r.amount, 0);
  if (!(total > 0)) {
    throw new RangeError('herfindahl: the rows sum to zero or less, so there are no shares to '
      + 'square. Nothing is shown rather than an index of zero.');
  }
  const index = rows.reduce((acc, r) => acc + Math.pow(r.amount / total, 2), 0);
  return computed(index, SHARE, METHODS.HERFINDAHL_INDEX, {
    fiscalYear: meta.fiscalYear,
    awardTypeSetId: meta.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
    denominatorText: 'Sum of the squares of each share across ' + rows.length
      + ' rows, shares taken as decimals of the ' + rows.length + ' row total.',
  });
}

/**
 * Validate an AnalysisInput before any arithmetic touches it.
 * @param {any} input
 * @returns {AnalysisInput}
 */
export function assertAnalysisInput(input) {
  if (!input || typeof input !== 'object') {
    throw new TypeError('assertAnalysisInput: input must be an object.');
  }
  if (!isResolvedIdentity(input.identity)) {
    throw new TypeError('assertAnalysisInput: input.identity must be a ResolvedIdentity built by '
      + 'resolveIdentity(). Analysis never runs against a name, only against a chosen entity.');
  }
  if (input.fiscalYear !== input.identity.fiscalYear) {
    throw new TypeError('assertAnalysisInput: input.fiscalYear is ' + input.fiscalYear
      + ' and identity.fiscalYear is ' + input.identity.fiscalYear + '. One period in '
      + 'application state. A parent measured over one window against children measured over '
      + 'another produced a published figure more than thirteen times too large, and both halves '
      + 'looked plausible on their own.');
  }
  if (input.awardTypeSetId !== input.identity.awardTypeSetId) {
    throw new TypeError('assertAnalysisInput: the award type set on the input and on the identity '
      + 'disagree. The set changes the total and it is named on every badge, so it cannot differ '
      + 'between the subject and the arithmetic.');
  }
  for (const key of ['agencyRows', 'subagencyRows', 'overTimePoints', 'awardRows', 'childRows']) {
    if (!Array.isArray(input[key])) {
      throw new TypeError('assertAnalysisInput: input.' + key + ' must be an array, even empty.');
    }
  }
  if (typeof input.parentReportedTotal !== 'number' || !Number.isFinite(input.parentReportedTotal)) {
    throw new TypeError('assertAnalysisInput: parentReportedTotal must be a finite number. A null '
      + 'or an absent total is not a zero and must not arrive here as one.');
  }
  if (!Number.isInteger(input.awardRowsExcluded) || input.awardRowsExcluded < 0) {
    throw new TypeError('assertAnalysisInput: awardRowsExcluded is required and must be a non '
      + 'negative integer. The award search endpoint ignores the recipient id filter, so rows '
      + 'belonging to other companies do come back, and the count of what was dropped is shown '
      + 'on the page rather than swallowed.');
  }
  return /** @type {AnalysisInput} */ (input);
}

/**
 * Walk a finished AnalysisOutput and throw on any displayed value that is not a Claim.
 *
 * This is the backstop for the whole claim boundary. The badge gate catches a bare number in
 * the page and in a DOM write; this catches one earlier, in the object the render layer is
 * about to be handed, where the fix is cheaper and the message can say which field.
 *
 * Keys ending in Claim, or named exactly `value`, are required to be Claims. Everything else is
 * structure and is walked through.
 *
 * @param {any} output
 * @param {string} [path]
 * @returns {AnalysisOutput}
 */
export function assertAnalysisOutput(output, path = 'output') {
  if (output === null || output === undefined) {
    throw new TypeError(path + ': analysis output must not be null.');
  }
  walk(output, path);
  return /** @type {AnalysisOutput} */ (output);
}

/**
 * Subtrees the walker steps over, with the reason. There is one.
 *
 * `identity` is a ResolvedIdentity, and it is validated by resolveIdentity() and
 * isResolvedIdentity() rather than by this walker. It carries structural numbers that the render
 * layer turns into Claims at the point of display, such as each child entity amount in the
 * rollup panel, and it is frozen at construction so nothing can be added to it here. Walking it
 * would force every one of those into a Claim in the subject object rather than in the output,
 * which is the wrong place for them and would say nothing useful about the figures this contract
 * exists to protect.
 */
const SKIPPED_SUBTREES = new Set(['identity']);

/** @param {any} node @param {string} path */
function walk(node, path) {
  if (Array.isArray(node)) {
    node.forEach((v, i) => walk(v, path + '[' + i + ']'));
    return;
  }
  if (node instanceof Set || node instanceof Map) return;
  if (node === null || typeof node !== 'object') return;
  if (isClaim(node)) return;
  for (const [key, value] of Object.entries(node)) {
    const here = path + '.' + key;
    if (SKIPPED_SUBTREES.has(key)) continue;
    if (key.endsWith('Claim') || key === 'value') {
      if (!isClaim(value)) {
        throw new TypeError(here + ' must be a Claim built by reported() or computed(), not a '
          + (value === null ? 'null' : typeof value) + '. Every figure a reader sees carries its '
          + 'badge, its unit kind and the exact method that produced it, and a bare number here '
          + 'is a number that would reach the page with none of them.');
      }
      continue;
    }
    if (typeof value === 'number' && !ALLOWED_BARE_NUMBER_KEYS.has(key)) {
      throw new TypeError(here + ' is a bare number. Either badge it as a Claim or, if it is '
        + 'structural rather than displayed, add its key to ALLOWED_BARE_NUMBER_KEYS in '
        + 'src/contracts/analysis.js with a reason. That list is short on purpose.');
    }
    walk(value, here);
  }
}

/**
 * Numbers that are structure rather than a displayed figure. Each is here with a reason, and
 * the list being short is the point: it is the only escape hatch in the claim boundary and an
 * escape hatch nobody watches becomes the main road.
 */
export const ALLOWED_BARE_NUMBER_KEYS = new Set([
  'fiscalYear',          // a year, carried on the identity and on every claim already
  'childCount',          // rendered through a tally claim; the raw count drives layout
  'childrenExpected',    // drives the suppression decision, not a displayed figure
  'x',                   // chart geometry
  'y',                   // chart geometry
  'index',               // row ordering
  'rank',                // row ordering
  'priorFiscalYear',     // the year BEFORE the selected one, on a change panel. A year is not a
                         // quantity: it is already carried as a bare number under fiscalYear on
                         // the identity and on every claim, and a chart that wants to place the
                         // prior column needs the integer rather than its label.
]);

/** Re exported so a consumer needs one import to build and to check an analysis result. */
export { OBLIGATIONS, AWARD_VALUE, SHARE, TALLY };
