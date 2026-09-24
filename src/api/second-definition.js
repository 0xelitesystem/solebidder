// THE SECOND DEFINITION, ASSEMBLED WITHOUT A DOCUMENT. DESIGN C5.
//
// Everything matching the NAME that was typed, published beside the total under the parent
// IDENTIFIER that was chosen, as a second named figure and never merged with the first. The two
// were measured billions apart for one well known name, and the entities that sit in the gap are
// listed rather than folded into a range, because a range would imply the truth lies between them
// and there is no single truth to lie between them.
//
// This used to live inside the boot() closure in src/ui/app.js. It lives here so the page and the
// command line fetch it, refuse it and compute it the same way.
//
// BOTH SIDES COME FROM ONE ENDPOINT UNDER ONE SET OF FILTERS, and the only difference between
// them is the filter itself: the identifier on one, the typed text on the other. The parent
// PROFILE total is deliberately not used as definition one. That endpoint takes no award type
// filter, so its figure always covers every award type, and differencing it against a name match
// restricted to contracts would publish a gap that is partly the award type control rather than
// the definition. The reasoning, with the measured size of that error, is in
// src/analysis/rollup.js above methodDelta.
//
// BOTH ARMS OR NOTHING. A gap computed against a denominator that did not answer would be a
// figure about nothing, and half of a comparison is not a comparison: there is no substitute
// figure that belongs in the empty slot.
//
// THE ENTITY BREAKDOWN IS FETCHED ONCE. It is definition one here and the third arm of the rollup
// reconciliation, and the page used to page it twice, once for each. A caller that already has
// it in flight hands the promise in and it is awaited rather than fetched again.
//
// Isomorphic: no node:* imports and no DOM.

import { methodDelta } from '../analysis/rollup.js';
import { assemblyFailure } from './hero.js';

/** The name this panel goes by in a failure sentence. */
export const SECOND_DEFINITION_WHAT = 'everything matching the name searched';

/**
 * The text the name match runs on: what the reader typed, and the resolved name only when nothing
 * was typed, which is the case when a record was picked some other way.
 * @param {unknown} queryText
 * @param {{name:string}} identity
 * @returns {string}
 */
export function nameMatchText(queryText, identity) {
  return typeof queryText === 'string' && queryText.length > 0 ? queryText : identity.name;
}

/**
 * The paged entity breakdown under the resolved parent identifier, on the identity's own fiscal
 * year and award type set. Start it ONCE and hand the promise to both of its consumers.
 *
 * @param {{entityBreakdown:Function}} api From createApi().
 * @param {any} identity A ResolvedIdentity.
 * @param {{signal?:AbortSignal, onCold?:Function}} [options]
 * @returns {Promise<any>} {ok:true, rows, total} or {ok:false, failure}.
 */
export function fetchEntityBreakdown(api, identity, options = {}) {
  return api.entityBreakdown({
    recipientId: identity.recipientId,
    fiscalYear: identity.fiscalYear,
    awardTypeSetId: identity.awardTypeSetId,
    signal: options.signal,
    onCold: options.onCold,
  });
}

/**
 * Fetch both arms at once.
 *
 * @param {{nameMatchTotal:Function, entityBreakdown:Function}} api From createApi().
 * @param {Object} args
 * @param {any} args.identity A ResolvedIdentity.
 * @param {string} [args.queryText] What the reader typed.
 * @param {Promise<any>|any|null} [args.breakdown] The entity breakdown already in flight or
 *   already settled. Absent or null means fetch it here.
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold] Fired by the name match, the slower of the two.
 * @returns {Promise<{named:any, byId:any}>}
 */
export async function fetchSecondDefinitionArms(api, args) {
  const { identity } = args;
  const byId = args.breakdown === undefined || args.breakdown === null
    ? fetchEntityBreakdown(api, identity, { signal: args.signal })
    : args.breakdown;
  const [named, settledById] = await Promise.all([
    api.nameMatchTotal({
      text: nameMatchText(args.queryText, identity),
      fiscalYear: identity.fiscalYear,
      awardTypeSetId: identity.awardTypeSetId,
      sourceAsOf: identity.sourceAsOf,
      signal: args.signal,
      onCold: args.onCold,
    }),
    byId,
  ]);
  return { named, byId: settledById };
}

/**
 * Both arms or refuse, then the arithmetic. Pure.
 *
 * `armFailed` says which kind of refusal it is. An arm that did not arrive is a request that may
 * answer next time, so a caller may offer to ask again. A failure to assemble arms that did
 * arrive is a defect, and asking again would only repeat it.
 *
 * @param {{named:any, byId:any, identity:any}} args
 * @returns {{ok:true, delta:object}|{ok:false, armFailed:boolean, failure:any}}
 */
export function secondDefinition({ named, byId, identity }) {
  if (!named.ok || !byId.ok) {
    return { ok: false, armFailed: true, failure: named.ok ? byId.failure : named.failure };
  }
  try {
    return {
      ok: true,
      delta: methodDelta({
        nameMatchRows: named.rows,
        parentRollupTotal: byId.total,
        parentEntityNamesUpper: identity.entityNamesUpper,
        fiscalYear: identity.fiscalYear,
        awardTypeSetId: identity.awardTypeSetId,
        sourceAsOf: identity.sourceAsOf,
      }),
    };
  } catch (e) {
    return { ok: false, armFailed: false, failure: assemblyFailure(SECOND_DEFINITION_WHAT, e) };
  }
}
