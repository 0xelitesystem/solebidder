// THE ANALYSIS LAYER, ASSEMBLED. CONTRACT 2 in src/contracts/analysis.js.
//
// IN: validated projections and a resolved identity. OUT: Claims, and sentences where a Claim
// could not honestly be built. This module fetches nothing, which is the whole reason every
// published figure can be recomputed by a stranger who clones the repository and runs the
// tests against the committed fixtures.
//
// THE ORDER OF OPERATIONS IS THE ORDER OF THE GUARDS.
//
//   1. assertAnalysisInput refuses a mismatched period, a mismatched award type set, a missing
//      excluded row count and a non finite parent total, before any arithmetic runs.
//   2. Each panel is computed independently, so a panel whose rows did not arrive reports its
//      own reason and the rest of the page still renders. A single empty result set does not
//      take the page down and it does not silently become a zero anywhere.
//   3. assertAnalysisOutput walks the finished structure and refuses any displayed leaf that
//      is not a Claim. A figure that lost its badge in a refactor fails here rather than on
//      screen.
//
// WHY EVERY SUPPRESSED FIGURE IS AN ABSENT KEY RATHER THAN A NULL. The output walker requires
// any key ending in Claim to hold a real Claim, so a suppressed figure cannot be represented as
// a null under its own name. That is deliberate on both sides: the panel asks `available`
// first, prints `reason` when it is false, and can never reach for a figure that was not
// computed. There is no path where a missing figure renders as nothing and reads as zero.
//
// Isomorphic: no node:* imports and no DOM.

import { assertAnalysisInput, assertAnalysisOutput } from '../contracts/analysis.js';
import { neverClaimedById } from '../core/never-claimed.js';
import { topRowShare, herfindahlIndex, cumulativeConcentration, topAwardShare } from './concentration.js';
import { soleBidderShare, oneOfferShare, competitionRows } from './competition.js';
import { obligationsByYear, yearOverYear } from './over-time.js';
import { childRollupCheck, methodDelta } from './rollup.js';
import { tallyClaim } from './share.js';
import { METHODS } from '../core/claim.js';

/**
 * The statements that qualify the figures this layer produces, placed beside them on the page
 * rather than in a footnote. They are pulled by id from the registry rather than written here,
 * because the gate compares them character for character and a paraphrase is a failure.
 */
const NOTICE_IDS = Object.freeze([
  'obligations-are-not-revenue',
  'award-value-is-lifetime',
  'not-everything-a-company-gets',
  'parent-tree-self-reported',
  'subawards-excluded',
  'no-losing-bidders',
  'floor-2008',
]);

/**
 * Run the whole analysis. DESIGN C1 to C5.
 *
 * @param {import('../contracts/analysis.js').AnalysisInput} rawInput
 * @returns {import('../contracts/analysis.js').AnalysisOutput}
 */
export function analyse(rawInput) {
  const input = assertAnalysisInput(rawInput);
  const meta = {
    fiscalYear: input.fiscalYear,
    awardTypeSetId: input.awardTypeSetId,
    sourceAsOf: input.sourceAsOf === undefined ? null : input.sourceAsOf,
  };
  const awardDetails = Array.isArray(input.awardDetails) ? input.awardDetails : [];

  const rollup = childRollupCheck({
    identity: input.identity,
    parentReportedTotal: input.parentReportedTotal,
    fiscalYear: input.fiscalYear,
    awardTypeSetId: input.awardTypeSetId,
    sourceAsOf: meta.sourceAsOf,
  });

  const output = {
    identity: input.identity,

    soleBidder: Object.freeze({
      share: soleBidderShare({ awardRows: input.awardRows, awardDetails, meta }),
      oneOffer: oneOfferShare({ awardRows: input.awardRows, awardDetails, meta }),
      awards: competitionRows({ awardRows: input.awardRows, awardDetails, meta }),
      excludedRowCountClaim: tallyClaim(input.awardRowsExcluded, 'excluded award row',
        METHODS.SOLE_BIDDER_SHARE, meta,
        'A row the award search endpoint returned whose recipient is not in the resolved entity '
        + 'set. That endpoint ignores the recipient filter, so rows belonging to other companies '
        + 'do come back. These are dropped from every figure on this page and counted here.'),
      // METHODS.RESPONSE_COVERAGE_COUNT, not the competition fields method. The FIELDS are
      // reported by the source; how many of them arrived is a count WE took over the fan out.
      // The claim system refuses a COMPUTED badge on a REPORTED tier method, which is what
      // caught the first version of this line, and the coverage method is what makes the
      // provenance say what the count actually is rather than borrowing the share's method.
      detailCountClaim: tallyClaim(awardDetails.length, 'award competition record',
        METHODS.RESPONSE_COVERAGE_COUNT, meta,
        'How many of the award competition records arrived. A detail call can fail on its own '
        + 'and the page says how many did rather than showing a short set as a complete one.'),
    }),

    concentration: Object.freeze({
      agency: topRowShare({
        rows: input.agencyRows,
        method: METHODS.ONE_CUSTOMER_SHARE,
        rowNoun: 'awarding agency',
        meta,
      }),
      subagency: topRowShare({
        rows: input.subagencyRows,
        method: METHODS.SUBAGENCY_SHARE,
        rowNoun: 'awarding sub agency',
        meta,
      }),
      herfindahl: herfindahlIndex(input.agencyRows, 'awarding agency', meta),
      cumulative: cumulativeConcentration({ awardRows: input.awardRows, meta }),
      topAward: topAwardShare({ awardRows: input.awardRows, meta }),
    }),

    overTime: Object.freeze({
      spine: obligationsByYear({ points: input.overTimePoints, meta }),
      selectedYear: yearOverYear({
        points: input.overTimePoints,
        fiscalYear: input.fiscalYear,
        meta,
      }),
    }),

    rollup,

    // BOTH SIDES OR NEITHER. The second definition needs a denominator taken through the SAME
    // endpoint on the SAME award type set, which is the entity breakdown summed under the parent
    // identifier. The parent profile total is not a substitute for it: that endpoint takes no
    // award type filter, so using it would publish a gap that is partly the award type control.
    // Without that figure there is no comparison to make and this key is absent rather than
    // wrong.
    methodDelta: Array.isArray(input.nameMatchRows)
      && typeof input.entityBreakdownTotal === 'number'
      && Number.isFinite(input.entityBreakdownTotal)
      ? methodDelta({
        nameMatchRows: input.nameMatchRows,
        parentRollupTotal: input.entityBreakdownTotal,
        parentEntityNamesUpper: input.identity.entityNamesUpper,
        fiscalYear: input.fiscalYear,
        awardTypeSetId: input.awardTypeSetId,
        sourceAsOf: meta.sourceAsOf,
      })
      : null,

    notices: Object.freeze([
      input.identity.subjectSentence,
      ...NOTICE_IDS.map((id) => neverClaimedById(id).sentence),
    ]),

    totalSuppressed: rollup.totalSuppressed === true,
  };

  return assertAnalysisOutput(Object.freeze(output));
}

export {
  topRowShare, herfindahlIndex, cumulativeConcentration, topAwardShare,
  soleBidderShare, oneOfferShare, competitionRows,
  obligationsByYear, yearOverYear,
  childRollupCheck, methodDelta,
};
export { safeShare, SHARE_UNAVAILABLE, sumField, countNegative, tallyClaim } from './share.js';
export { NOT_COMPETED, isNotCompeted, joinAwardDetails, NO_USABLE_OFFERS_FIELD } from './competition.js';
export { CHANGE_UNAVAILABLE, indexByFiscalYear } from './over-time.js';
export { ROLLUP_SUPPRESSED } from './rollup.js';
