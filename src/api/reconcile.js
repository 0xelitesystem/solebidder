// THE ROLLUP RECONCILIATION, AND THE RESIDUAL IS PUBLISHED. DESIGN C4, DESIGN 6.6, trap 2.
//
// THREE WAYS TO THE SAME FIGURE, MEASURED LIVE ON 2026-09-22 FOR PARENT UEI ZFN2JJXBLZT3 AT
// FY2025:
//
//   the parent profile total                                  65,405,410,468.25
//   the sum of the 217 registered child entities              65,405,410,468.26
//   the paged entity breakdown under the same parent id       65,405,410,468.26
//
// ONE CENT APART, AND THE CENT IS SHOWN. It is float addition over hundreds of rows and nothing
// else. Rounding it away would make the panel tidier and less true, and a reader who checks our
// arithmetic against the government's own page and finds a cent we hid has every reason to
// distrust the other eleven digits. The residual is a badged figure with a unit on it, exactly
// like every other number here, and it is rendered whether it is one cent, zero, or larger.
//
// THE THREE ARMS ARE NOT ALL FILTERED THE SAME WAY, AND THAT IS STATED RATHER THAN AVERAGED.
// The profile endpoint and the children endpoint take a fiscal year and NO award type filter, so
// both cover every award type whatever the visible control says. The category endpoint does
// honour the award type codes. So the third arm reconciles against the other two only when the
// selected set is the all award types set. Under any other set it is a figure about a different
// question and it is labelled that way rather than differenced, because a residual between two
// different filters is not a residual, it is a category error with a decimal point in it.
//
// AN INCOMPLETE ROLLUP SUPPRESSES THE SUM. DESIGN 6.6. If the child list did not arrive whole,
// there is no child sum, no residual and no reconciliation: there is a named failure saying how
// many of the expected parts arrived. A rollup missing some of its parts is smaller than the
// truth and a reader will quote it.
//
// WHY THIS RETURNS A NARRATIVE OF SEGMENTS RATHER THAN A SENTENCE. Every figure in the sentence
// the visitor reads has to carry its badge and its unit. A pre baked string with the numbers
// already inside it would arrive at the DOM as a bare figure, which is the one thing the badge
// gate exists to catch. So this hands back prose segments and Claim segments, and the renderer
// puts a badge on every one of the second kind.
//
// Isomorphic: no node:* imports and no DOM.

import { computed, reported, METHODS } from '../core/claim.js';
import { OBLIGATIONS, TALLY } from '../core/units.js';
import { failure, INCOMPLETE_ROLLUP } from '../query/failure.js';
import { sumChildObligations } from './children.js';
import { sumRows } from './categories.js';

/** The note that rides on every residual, whatever its size. */
export const RESIDUAL_NOTE = 'This is the difference between two figures for the same entity and '
  + 'the same fiscal year, computed by adding hundreds of rows in binary floating point. It is '
  + 'shown rather than rounded away, because a difference a reader can reproduce is evidence '
  + 'that the arithmetic above it was actually performed.';

/** The note on the third arm when the award type control makes it answer a different question. */
export const ARM_NOT_COMPARABLE_NOTE = 'The profile and children endpoints take a fiscal year and '
  + 'no award type filter, so they cover every award type. This figure honours the award type '
  + 'control, so it answers a different question and it is not differenced against them. Select '
  + 'the all award types set to compare the three on the same basis.';

/**
 * @typedef {Object} ReconciliationArm
 * @property {string} id
 * @property {string} label
 * @property {object} claim
 * @property {boolean} comparable Whether it is on the same basis as the parent total.
 * @property {string|null} note
 */

/**
 * Reconcile the parent total against the child rollup against the paged entity breakdown.
 *
 * @param {Object} args
 * @param {import('../contracts/identity.js').ResolvedIdentity} args.identity
 * @param {number} args.parentReportedTotal From the profile projection.
 * @param {{rows:readonly {amount:number}[], total?:number}|null} [args.categoryBreakdown] The
 *   paged entity breakdown under the resolved parent id, when it arrived.
 * @param {string|null} args.sourceAsOf
 * @returns {{ok:true, arms:ReconciliationArm[], residuals:object[], narrative:object[],
 *   childCountClaim:object, allArmsComparable:boolean}
 *   |{ok:false, failure:import('../query/failure.js').Failure}>}
 */
export function reconcileRollup(args) {
  const identity = args.identity;
  if (!identity || typeof identity !== 'object' || !Array.isArray(identity.children)) {
    throw new TypeError('reconcileRollup: a ResolvedIdentity is required. The reconciliation is '
      + 'about a named entity and the entities that rolled into it.');
  }
  if (typeof args.parentReportedTotal !== 'number' || !Number.isFinite(args.parentReportedTotal)) {
    throw new TypeError('reconcileRollup: the parent total must be a finite number. A figure the '
      + 'source did not give us is refused here rather than treated as a zero.');
  }

  const fiscalYear = identity.fiscalYear;
  const sourceAsOf = args.sourceAsOf === undefined ? null : args.sourceAsOf;

  // DESIGN 6.6. A short rollup is not a small total, it is no total.
  if (!identity.rollupComplete) {
    return {
      ok: false,
      failure: failure(INCOMPLETE_ROLLUP, 'the subsidiary rollup for ' + identity.name, {
        parts: { arrived: identity.childCount, expected: identity.childrenExpected },
        detail: 'the sum over the child entities that did arrive is smaller than the truth, so '
          + 'it is not published and neither is any figure derived from it.',
      }),
    };
  }

  const childSum = sumChildObligations(identity.children);

  const parentClaim = reported(args.parentReportedTotal, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, {
    fiscalYear,
    awardTypeSetId: 'all',
    sourceAsOf,
  });

  const childSumClaim = computed(childSum, OBLIGATIONS, METHODS.CHILD_ROLLUP_CHECK, {
    fiscalYear,
    awardTypeSetId: 'all',
    sourceAsOf,
    note: 'The sum of every registered child entity of this parent for the same fiscal year, '
      + 'added in the order the source returned them.',
  });

  const childCountClaim = reported(identity.childCount, TALLY, METHODS.RECIPIENT_CHILDREN, {
    fiscalYear,
    awardTypeSetId: 'all',
    sourceAsOf,
    tallyNoun: 'registered child entity',
  });

  /** @type {ReconciliationArm[]} */
  const arms = [
    {
      id: 'parent-profile',
      label: 'The parent profile total',
      claim: parentClaim,
      comparable: true,
      note: null,
    },
    {
      id: 'child-rollup',
      label: 'The sum of the registered child entities',
      claim: childSumClaim,
      comparable: true,
      note: null,
    },
  ];

  /** @type {object[]} */
  const residuals = [];

  const childrenMinusParent = childSum - args.parentReportedTotal;
  residuals.push({
    id: 'children-minus-parent',
    label: 'Child rollup less the parent profile total',
    claim: computed(childrenMinusParent, OBLIGATIONS, METHODS.CHILD_ROLLUP_CHECK, {
      fiscalYear,
      awardTypeSetId: 'all',
      sourceAsOf,
      note: RESIDUAL_NOTE,
    }),
  });

  let allArmsComparable = true;
  if (args.categoryBreakdown && Array.isArray(args.categoryBreakdown.rows)) {
    const categoryTotal = typeof args.categoryBreakdown.total === 'number'
      ? args.categoryBreakdown.total
      : sumRows(args.categoryBreakdown.rows);
    const comparable = identity.awardTypeSetId === 'all';
    if (!comparable) allArmsComparable = false;

    arms.push({
      id: 'entity-breakdown',
      label: 'The paged entity breakdown under this parent id',
      claim: computed(categoryTotal, OBLIGATIONS, METHODS.ENTITY_BREAKDOWN_ROLLUP_CHECK, {
        fiscalYear,
        awardTypeSetId: identity.awardTypeSetId,
        sourceAsOf,
        note: comparable
          ? 'The sum over every row of the entity breakdown returned for this parent id, which '
            + 'is a third route to the same figure through a different endpoint.'
          : ARM_NOT_COMPARABLE_NOTE,
      }),
      comparable,
      note: comparable ? null : ARM_NOT_COMPARABLE_NOTE,
    });

    if (comparable) {
      residuals.push({
        id: 'breakdown-minus-parent',
        label: 'Entity breakdown less the parent profile total',
        claim: computed(categoryTotal - args.parentReportedTotal, OBLIGATIONS,
          METHODS.ENTITY_BREAKDOWN_ROLLUP_CHECK, {
          fiscalYear,
          awardTypeSetId: 'all',
          sourceAsOf,
          note: RESIDUAL_NOTE,
        }),
      });
    }
  }

  return {
    ok: true,
    arms,
    residuals,
    childCountClaim,
    allArmsComparable,
    narrative: buildNarrative({ arms, residuals, childCountClaim, allArmsComparable }),
  };
}

/**
 * The panel copy, as segments. Prose is prose and every figure is a Claim, so the renderer can
 * badge each figure without the panel ever handing it a bare number.
 *
 * @param {{arms:ReconciliationArm[], residuals:object[], childCountClaim:object,
 *   allArmsComparable:boolean}} parts
 * @returns {{kind:'text'|'claim', text?:string, label?:string, claim?:object}[]}
 */
export function buildNarrative(parts) {
  /** @type {{kind:'text'|'claim', text?:string, label?:string, claim?:object}[]} */
  const out = [];
  out.push({ kind: 'claim', label: 'Registered child entities', claim: parts.childCountClaim });
  out.push({
    kind: 'text',
    text: 'rolled into this parent for the fiscal year selected. The same figure is reached '
      + (parts.arms.length === 3 ? 'three ways' : 'two ways') + ', and the difference between '
      + 'those routes is published rather than rounded away.',
  });
  for (const arm of parts.arms) {
    out.push({ kind: 'claim', label: arm.label, claim: arm.claim });
  }
  for (const residual of parts.residuals) {
    out.push({ kind: 'claim', label: residual.label, claim: residual.claim });
  }
  if (!parts.allArmsComparable) {
    out.push({ kind: 'text', text: ARM_NOT_COMPARABLE_NOTE });
  }
  return out;
}
