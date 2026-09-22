// THE FACADE. One object, bound to one client, with the wave order written into its shape.
//
// WHY A FACADE AT ALL, GIVEN EVERY MODULE BELOW IT IS ALREADY CALLABLE. Because the ORDER
// matters and the order is a measurement, not a preference. DESIGN 6.3, measured cold against
// warm on the same queries:
//
//   the profile and the children list          under half a second
//   obligations by fiscal year                 26.5 s cold, 0.41 s warm
//   the category breakdowns                    11.4 s to 27.7 s cold
//
// So wave one is the identity, the parent total and the rollup, and it blocks nothing. Wave two
// and wave three run behind their own tile skeletons and are never allowed to hold up the first
// paint. A caller that awaits everything before rendering anything would turn a page that is
// useful in half a second into a page that is blank for half a minute.
//
// THE HUMAN STEP IS PRESERVED IN THE SHAPE OF THIS OBJECT. There is no function here that takes
// a name and returns a total. startQuery returns candidates and a decision; loadSubject takes a
// CHOICE. Sixteen parent level records match one well known name, so a single call from text to
// money would have to pick one, and picking one is the thing this product refuses to do.
//
// NOTHING HERE FORMATS A NUMBER, TOUCHES THE DOM, OR SWALLOWS A FAILURE. Every function returns
// either a result or a named Failure, and a Failure carries no figure and cannot be rendered as
// one.
//
// Isomorphic: no node:* imports and no DOM.

import { createClient } from '../query/client.js';
import { fetchSourceAsOf } from './source-date.js';
import { fetchAwardCount, parentDetailClaims } from './parent.js';
import { fetchCategory, fetchCategoryTotal, categoryRowClaims, nameMatchTotalClaim } from './categories.js';
import { fetchObligationsByFiscalYear } from './timeseries.js';
import { reconcileRollup } from './reconcile.js';
import { createTypeahead } from './typeahead.js';
import { resolveQuery, resolveChosenUei, hydrateIdentity } from '../identity/resolve.js';

/**
 * @param {Object} [deps]
 * @param {object} [deps.client] An already built client, for tests.
 * @param {object} [deps.index] The bundled typeahead index, when it has been loaded.
 * @param {object} [deps.clientDeps] Passed to createClient when no client is supplied.
 * @returns {object}
 */
export function createApi(deps = {}) {
  const client = deps.client === undefined ? createClient(deps.clientDeps) : deps.client;
  const typeahead = createTypeahead({ index: deps.index, client });

  return {
    client,
    typeahead,

    /** The date the source publishes about itself. Never fails the page; returns null instead. */
    sourceAsOf: (options) => fetchSourceAsOf(client, options),

    /** WAVE ZERO. Text to a list of entities and a decision. Never a figure. */
    startQuery: (args) => resolveQuery(client, args),

    /**
     * WAVE ZERO, the bundled path. The same resolution, plus the identifier the visitor clicked.
     *
     * A bundled suggestion carries a UEI, so the entity it means is not in doubt. It still goes
     * through the list endpoint, because a UEI alone cannot fetch a profile: that document is
     * addressed by the internal identifier the list endpoint hands back, and nothing bundled
     * states which LEVEL a record sits at. If the clicked identifier turns out not to be a
     * parent level record, the candidate list is shown rather than a substitute chosen for the
     * visitor, which is the same refusal the typed path makes.
     */
    startQueryForUei: (args) => resolveChosenUei(client, args),

    /**
     * WAVE ONE. A chosen entity to an identity, the parent claims and the two arm reconciliation.
     * Under half a second on the measured endpoints, and it blocks nothing else.
     *
     * @param {Object} args
     * @param {import('../contracts/identity.js').IdentityChoice} args.choice
     * @param {number} args.fiscalYear
     * @param {import('../core/constants.js').AwardTypeSetId} args.awardTypeSetId
     * @param {string|null} args.sourceAsOf
     * @param {AbortSignal} [args.signal]
     * @param {Function} [args.onCold]
     */
    async loadSubject(args) {
      const hydrated = await hydrateIdentity(client, args);
      if (!hydrated.ok) return hydrated;

      const detail = parentDetailClaims({
        profile: hydrated.profile,
        fiscalYear: args.fiscalYear,
        awardTypeSetId: args.awardTypeSetId,
        sourceAsOf: args.sourceAsOf,
      });

      const reconciliation = reconcileRollup({
        identity: hydrated.identity,
        parentReportedTotal: hydrated.profile.totalObligations,
        sourceAsOf: args.sourceAsOf,
      });

      return {
        ok: true,
        identity: hydrated.identity,
        profile: hydrated.profile,
        disclosures: hydrated.disclosures,
        linkageNotice: hydrated.linkageNotice,
        detail,
        reconciliation,
      };
    },

    /** WAVE TWO. The award count for the selected set. */
    awardCount: (args) => fetchAwardCount(client, args),

    /** WAVE TWO. Obligations by fiscal year, one call for the whole span. */
    obligationsByFiscalYear: (args) => fetchObligationsByFiscalYear(client, args),

    /** WAVE THREE. One ranked category panel. The slowest endpoints, never blocking first paint. */
    category: (args) => fetchCategory(client, args),

    /** WAVE THREE. The paged entity breakdown, which is the third arm of the reconciliation. */
    entityBreakdown: (args) => fetchCategoryTotal(client, { ...args, dimension: 'recipient' }),

    /**
     * WAVE THREE. The full three arm reconciliation: it fetches the paged entity breakdown and
     * differences it against the parent total and the child rollup.
     *
     * A failed breakdown does NOT take the panel down. The two arm reconciliation from wave one
     * already stands on its own, so this returns it with a note about the arm that is missing.
     */
    async reconcileThreeWays(args) {
      const breakdown = await fetchCategoryTotal(client, {
        dimension: 'recipient',
        recipientId: args.identity.recipientId,
        fiscalYear: args.identity.fiscalYear,
        awardTypeSetId: args.identity.awardTypeSetId,
        signal: args.signal,
        onCold: args.onCold,
      });
      if (!breakdown.ok) {
        return {
          ok: true,
          armsMissing: true,
          breakdownFailure: breakdown.failure,
          reconciliation: reconcileRollup({
            identity: args.identity,
            parentReportedTotal: args.parentReportedTotal,
            sourceAsOf: args.sourceAsOf,
          }),
        };
      }
      return {
        ok: true,
        armsMissing: false,
        breakdownFailure: null,
        breakdown,
        reconciliation: reconcileRollup({
          identity: args.identity,
          parentReportedTotal: args.parentReportedTotal,
          categoryBreakdown: { rows: breakdown.rows, total: breakdown.total },
          sourceAsOf: args.sourceAsOf,
        }),
      };
    },

    /**
     * THE SECOND DEFINITION. DESIGN C5. A paged sum under the typed NAME rather than the
     * resolved parent id, published beside the parent figure as a second named figure.
     */
    async nameMatchTotal(args) {
      const paged = await fetchCategoryTotal(client, {
        dimension: 'recipient',
        recipientSearchText: args.text,
        fiscalYear: args.fiscalYear,
        awardTypeSetId: args.awardTypeSetId,
        signal: args.signal,
        onCold: args.onCold,
      });
      if (!paged.ok) return paged;
      return {
        ok: true,
        rows: paged.rows,
        total: paged.total,
        claim: nameMatchTotalClaim(paged.total, {
          fiscalYear: args.fiscalYear,
          awardTypeSetId: args.awardTypeSetId,
          sourceAsOf: args.sourceAsOf,
          entityCount: paged.rows.length,
        }),
      };
    },

    /** Reported claims, one per category row, for a panel that is about to chart them. */
    categoryRowClaims,
  };
}
