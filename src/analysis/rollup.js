// THE CHILD ROLLUP CHECK. DESIGN C4, DESIGN 2.2, DESIGN 7.2 item 1.
//
// WHAT THIS PANEL IS FOR. Every other figure on the page rests on one assumption: that the
// entity the reader chose is the entity that was summed. This panel is where that assumption
// is done in front of them. The registered child entities are listed, they are added up, and
// the total is set beside the figure the government reports for the parent for the same year.
// A reader who does not trust our arithmetic can add the column themselves.
//
// THE DELTA IS PUBLISHED, NOT ROUNDED AWAY. The child sum and the parent total have been
// measured one cent apart. That is float arithmetic over hundreds of rows and it is not a bug.
// Showing it is more convincing than hiding it, because a page that reconciles to the cent
// every time is a page that is rounding somewhere, and a reader who works with money knows it.
//
// AN INCOMPLETE ROLLUP SUPPRESSES THE TOTAL. This is the load bearing rule of the whole
// module. If the children endpoint said there are more children than arrived, the sum is
// SMALLER than the truth, it is smaller by an unknown amount, and it looks exactly like a
// correct total. A reader will quote it. So when the resolved identity reports the rollup as
// incomplete, no sum is produced at all: the key is absent rather than null, the reason is
// printed in its place, and the count that arrived is shown against the count expected so the
// size of the hole is visible.
//
// ONE PERIOD. The children and the parent must have been fetched for the SAME explicit fiscal
// year. A parent measured over one window against children measured over another produced a
// figure more than thirteen times too large, and both halves looked plausible on their own.
// The resolved identity carries the year it was built for, and this module refuses to run
// against a different one rather than trusting the caller to have matched them.
//
// Isomorphic: no node:* imports and no DOM.

import { computed, reported, METHODS } from '../core/claim.js';
import { OBLIGATIONS, TALLY, formatUnit, formatUnitBare, formatTally } from '../core/units.js';
import { sumField, countNegative, tallyClaim, NEGATIVE_ROW_NOTE } from './share.js';

/** The reason a suppressed rollup gives, in full, where the total would have been. */
export const ROLLUP_SUPPRESSED = 'The children endpoint reported more registered child entities '
  + 'for this parent than arrived, so any sum of the ones that did arrive is smaller than the '
  + 'truth by an unknown amount while looking exactly like a correct total. No sum is shown. '
  + 'The count that arrived and the count expected are both printed so the size of the gap is '
  + 'visible.';

/**
 * Add the registered children up in front of the reader, and set the result against the figure
 * the government reports for the parent. DESIGN C4.
 *
 * @param {Object} args
 * @param {import('../contracts/identity.js').ResolvedIdentity} args.identity
 * @param {number} args.parentReportedTotal The parent total_transaction_amount for this year.
 * @param {number} args.fiscalYear Must equal identity.fiscalYear.
 * @param {string} args.awardTypeSetId
 * @param {string|null} args.sourceAsOf
 * @returns {Object}
 */
export function childRollupCheck(args) {
  const { identity, parentReportedTotal, fiscalYear } = args;
  if (!identity || typeof identity !== 'object' || !Array.isArray(identity.children)) {
    throw new TypeError('childRollupCheck: identity must be a ResolvedIdentity carrying the '
      + 'children that were summed. The panel exists to show the reader what "the company" '
      + 'meant here, and it cannot do that from a total alone.');
  }
  if (identity.fiscalYear !== fiscalYear) {
    throw new RangeError('childRollupCheck: the identity was resolved for FY' + identity.fiscalYear
      + ' and this rollup was asked for FY' + fiscalYear + '. One period in application state. A '
      + 'parent measured over one window against children measured over another produced a '
      + 'published figure more than thirteen times too large, and both halves looked plausible '
      + 'on their own.');
  }
  if (typeof parentReportedTotal !== 'number' || !Number.isFinite(parentReportedTotal)) {
    throw new TypeError('childRollupCheck: parentReportedTotal must be a finite number. A total '
      + 'the source did not return is refused rather than compared against as a zero.');
  }

  const meta = {
    fiscalYear,
    awardTypeSetId: args.awardTypeSetId,
    sourceAsOf: args.sourceAsOf === undefined ? null : args.sourceAsOf,
  };
  const children = identity.children;
  const negatives = countNegative(children, 'obligations');

  const base = {
    childCount: identity.childCount,
    childrenExpected: identity.childrenExpected,
    rollupComplete: identity.rollupComplete === true,
    childCountClaim: reported(identity.childCount, TALLY, METHODS.RECIPIENT_CHILDREN, {
      ...meta,
      tallyNoun: 'registered child entity',
    }),
    childrenExpectedClaim: reported(identity.childrenExpected, TALLY, METHODS.RECIPIENT_CHILDREN, {
      ...meta,
      tallyNoun: 'expected registered child entity',
      note: 'How many registered child entities the source says exist for this parent. It is '
        + 'shown beside how many arrived, so the size of any gap is visible.',
    }),
    negativeChildCountClaim: tallyClaim(negatives, 'negative child amount',
      METHODS.CHILD_ROLLUP_CHECK, meta, NEGATIVE_ROW_NOTE),
    parentTotalClaim: reported(parentReportedTotal, OBLIGATIONS,
      METHODS.RECIPIENT_PROFILE_TOTAL, meta),
  };

  if (identity.rollupComplete !== true) {
    return Object.freeze({
      ...base,
      totalSuppressed: true,
      reason: ROLLUP_SUPPRESSED,
      sentence: formatTally(identity.childCount, 'registered child entity') + ' arrived of '
        + formatTally(identity.childrenExpected, 'expected registered child entity')
        + ' for fiscal year FY' + fiscalYear
        + '. No sum is shown. ' + ROLLUP_SUPPRESSED,
    });
  }

  const childSum = children.length === 0 ? 0 : sumField(children, 'obligations');
  const delta = childSum - parentReportedTotal;

  return Object.freeze({
    ...base,
    totalSuppressed: false,
    reason: null,
    childSumClaim: computed(childSum, OBLIGATIONS, METHODS.CHILD_ROLLUP_CHECK, meta),
    deltaClaim: computed(delta, OBLIGATIONS, METHODS.CHILD_ROLLUP_CHECK, {
      ...meta,
      note: 'The difference between the sum of the registered children and the figure the '
        + 'source reports for the parent, for the same explicit fiscal year. It is published '
        + 'rather than rounded away: it is float arithmetic over every child row, and saying so '
        + 'is more convincing than a reconciliation that is exact every time.',
    }),
    sentence: formatTally(identity.childCount, 'registered child entity') + ' sum to '
      + formatUnitBare(childSum, OBLIGATIONS) + ' against a reported parent total of '
      + formatUnit(parentReportedTotal, OBLIGATIONS) + ' for fiscal year FY' + fiscalYear
      + ', a difference of ' + formatUnitBare(delta, OBLIGATIONS) + '.',
  });
}

/**
 * The second definition of the company, set beside the first and never merged with it.
 * DESIGN C5.
 *
 * TWO DEFINITIONS, NOT TWO ESTIMATES OF ONE TRUTH. The parent rollup is the government's own
 * arithmetic over one registered family. The name match is every recipient whose name matches
 * the text searched, which includes entities registered under no parent at all and joint
 * ventures whose economics are split with another company. They answer different questions.
 *
 * So there is no share between them and there is no range. A range would imply the truth lies
 * somewhere in the middle, and it does not: both figures are exactly right for the question
 * each one answers. What is published is both totals, the difference between them in dollars,
 * and the entities that sit in the gap, named and itemised.
 *
 * WHAT parentRollupTotal HAS TO BE, and this is the part that is easy to get wrong.
 *
 * It must be the paged entity breakdown summed under the resolved parent IDENTIFIER, on the same
 * fiscal year and THE SAME AWARD TYPE SET as the name match. It is NOT the parent profile total.
 * The profile endpoint takes no award type filter at all, so its figure always covers every
 * award type, and differencing it against a name match restricted to contracts would publish a
 * gap that is partly the award type control rather than the definition. Measured on one large
 * prime for FY2025: the profile total is 65,405,410,468.25 over every award type while the
 * contracts only figure for the same parent is 64,734,245,175.25, so the wrong input moves the
 * published gap by roughly 671 million dollars in the wrong direction.
 *
 * Both sides therefore come from ONE endpoint on ONE set of filters, and the only thing that
 * differs between them is whether the filter was the identifier or the text.
 *
 * @param {Object} args
 * @param {{name:string, amount:number, uei:string|null}[]} args.nameMatchRows
 * @param {number} args.parentRollupTotal The paged entity breakdown under the parent identifier,
 *   same fiscal year and same award type set as the name match. See the block above.
 * @param {Set<string>} args.parentEntityNamesUpper From the resolved identity.
 * @param {number} args.fiscalYear
 * @param {string} args.awardTypeSetId
 * @param {string|null} args.sourceAsOf
 * @returns {Object}
 */
export function methodDelta(args) {
  const { nameMatchRows, parentRollupTotal, parentEntityNamesUpper } = args;
  if (!Array.isArray(nameMatchRows)) {
    throw new TypeError('methodDelta: nameMatchRows must be an array, even empty.');
  }
  if (!(parentEntityNamesUpper instanceof Set)) {
    throw new TypeError('methodDelta: parentEntityNamesUpper must be the Set carried on the '
      + 'resolved identity. Without it every row would look like it sits in the gap.');
  }
  const meta = {
    fiscalYear: args.fiscalYear,
    awardTypeSetId: args.awardTypeSetId,
    sourceAsOf: args.sourceAsOf === undefined ? null : args.sourceAsOf,
  };

  const nameMatchTotal = nameMatchRows.length === 0 ? 0 : sumField(nameMatchRows, 'amount');
  const inGap = nameMatchRows.filter((r) => !parentEntityNamesUpper.has(String(r.name).toUpperCase()));

  return Object.freeze({
    available: nameMatchRows.length > 0,
    reason: nameMatchRows.length > 0 ? null : 'The second definition was not fetched or returned '
      + 'no rows, so there is nothing to set beside the parent rollup.',
    nameMatchTotalClaim: computed(nameMatchTotal, OBLIGATIONS, METHODS.NAME_MATCH_TOTAL, meta),
    // ENTITY_BREAKDOWN_ROLLUP_CHECK, not NAME_MATCH_TOTAL. This is definition ONE and it was
    // produced by filtering on the parent identifier; the name match method describes filtering
    // on the text, which is the arithmetic that produced the OTHER figure. A badge that names
    // the wrong filter on the figure it sits under is the whole failure this claim system
    // exists to prevent, and it shipped on screen once before this line was written.
    parentRollupTotalClaim: computed(parentRollupTotal, OBLIGATIONS,
      METHODS.ENTITY_BREAKDOWN_ROLLUP_CHECK, {
        ...meta,
        note: 'The paged entity breakdown under the resolved parent identifier, on the same '
          + 'fiscal year and the same award type set as the figure beside it. Both come from one '
          + 'endpoint under one set of filters and the only difference between them is whether '
          + 'the filter was the identifier or the text.',
      }),
    deltaClaim: computed(nameMatchTotal - parentRollupTotal, OBLIGATIONS, METHODS.METHOD_DELTA, {
      ...meta,
      note: 'Two different definitions of the company, not two estimates of one truth. Neither '
        + 'figure is an error bar around the other and they are never added, averaged or shown '
        + 'as a range. The entities that sit in the difference are listed beside this figure.',
    }),
    gapEntityCountClaim: tallyClaim(inGap.length, 'gap entity', METHODS.METHOD_DELTA, meta,
      'An entity matching the name searched that is not registered under the parent chosen. '
      + 'These are the entities that sit in the difference between the two definitions, and '
      + 'they are listed by name rather than summarised as an error bar.'),
    gapEntities: Object.freeze(inGap.map((r, i) => Object.freeze({
      index: i,
      name: r.name,
      uei: r.uei === undefined ? null : r.uei,
      amountClaim: reported(r.amount, OBLIGATIONS, METHODS.SPENDING_BY_CATEGORY, meta),
    }))),
  });
}
