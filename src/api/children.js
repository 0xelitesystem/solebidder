// THE REGISTERED CHILD ENTITIES OF A PARENT UEI. DESIGN C4, trap 2, trap 8.
//
// ONE EXPLICIT YEAR, AND IT IS THE SAME YEAR AS THE PARENT. Trap 2 is the most expensive
// mistake available here and it is not hypothetical: a parent fetched over one window against
// children fetched over another produced 827,727,296,777.05 against 61,964,720,403.63 for the
// same company, a factor of more than thirteen, and both halves looked plausible on their own.
// The request builder refuses to be called without an integer fiscal year, and the caller passes
// the ONE year that is in application state.
//
// MEASURED LIVE ON 2026-09-22. GET /api/v2/recipient/children/ZFN2JJXBLZT3/?year=2025 returned
// HTTP 200 in 380 ms with 217 rows summing to 65,405,410,468.26 against a parent reported total
// of 65,405,410,468.25 for the same year. That one cent is float arithmetic over 217 rows and it
// is DISPLAYED rather than rounded away. See ./reconcile.js, which is where it is published.
//
// WHAT IT PROJECTS AND WHAT IT DROPS. UEI, name and amount. The legacy vendor identifier that
// this endpoint still returns is dropped by the validator and never reaches this module, trap
// 13. The state field is dropped because nothing on the page asks a geographic question.
//
// WHY A FAILURE HERE IS A HARD FAILURE. The child list is not decoration. It is what the word
// "company" means on this page, it feeds the entity name set every award row is validated
// against, and it is one arm of the reconciliation. A rollup built from a child list that did
// not arrive is smaller than the truth, and a reader would quote it. So this returns either the
// whole list or a named failure, never a short list.
//
// Isomorphic: no node:* imports and no DOM.

import { recipientChildrenRequest, validateRecipientChildren } from '../query/endpoints.js';

/**
 * @typedef {Object} ChildrenResult
 * @property {true} ok
 * @property {import('../contracts/identity.js').ChildEntity[]} children
 * @property {number} expected How many the endpoint said exist. One response is the whole list
 *   on this endpoint, so arrived and expected agree unless a page is missing.
 * @property {boolean} complete
 * @property {number} attempts
 */

/**
 * Fetch the children of a parent UEI for one explicit fiscal year.
 *
 * @param {{request:Function}} client
 * @param {Object} args
 * @param {string} args.uei Parent UEI.
 * @param {number} args.fiscalYear Explicit integer year. Trap 2.
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold]
 * @returns {Promise<ChildrenResult|{ok:false, failure:import('../query/failure.js').Failure}>}
 */
export async function fetchChildren(client, args) {
  const request = recipientChildrenRequest(args.uei, args.fiscalYear);
  const result = await client.request(request, validateRecipientChildren, {
    what: 'the registered child entities of this parent',
    signal: args.signal,
    onCold: args.onCold,
  });
  if (!result.ok) return { ok: false, failure: result.failure };

  const children = result.value.children.map((row) => Object.freeze({
    uei: row.uei,
    name: row.name,
    recipientId: row.recipientId,
    obligations: row.amount,
  }));

  return {
    ok: true,
    children,
    expected: result.value.count,
    complete: children.length === result.value.count,
    attempts: result.attempts,
  };
}

/**
 * Sum the child amounts. Plain arithmetic, kept here beside the fetch so the reconciliation
 * module and the test suite use the same one.
 *
 * Summation order is the order the endpoint returned, deliberately: reproducing the published
 * cent requires reproducing the float addition exactly, and a sort would change it.
 *
 * @param {readonly {obligations:number}[]} children
 * @returns {number}
 */
export function sumChildObligations(children) {
  if (!Array.isArray(children)) {
    throw new TypeError('sumChildObligations: children must be an array.');
  }
  let total = 0;
  for (const child of children) {
    if (typeof child.obligations !== 'number' || !Number.isFinite(child.obligations)) {
      throw new TypeError('sumChildObligations: every child must carry a finite figure. A value '
        + 'that could not be read is refused here rather than treated as a zero, because a zero '
        + 'in a sum is a silent understatement of the total.');
    }
    total += child.obligations;
  }
  return total;
}
