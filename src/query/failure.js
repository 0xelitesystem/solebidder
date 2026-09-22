// THE HONEST FAILURE STATES. DESIGN 6.6, trap 5, trap 11, trap 12.
//
// The API is flaky. Real 502 and 504 responses were measured before a 200 on the same query on
// the same day. So the interesting question is not whether a call fails, it is what the page
// says when it does, and there are exactly three wrong answers:
//
//   a spinner that spins forever, which reads as broken,
//   a spinner that implies progress it cannot see, which is a lie,
//   an empty chart, which reads as a real zero.
//
// Every failure in this product is therefore a NAMED object with a sentence a reader can act
// on. A Failure carries no number and can never be rendered as one, which is enforced the same
// way a Claim is: it is branded, frozen, and every implicit stringification path throws.
//
// THE SUPPRESSION RULE. A partial rollup is never shown as a total. If some pages of a child
// list arrived and others did not, the total is SUPPRESSED and the panel says how many of the
// expected children arrived. A number that is smaller than the truth is worse than no number,
// because a reader will quote it.
//
// Isomorphic: no node:* imports and no DOM.

/** The upstream answered with a server error after every retry was spent. */
export const UPSTREAM_ERROR = 'UPSTREAM_ERROR';
/** The upstream did not answer inside the deadline for this endpoint. */
export const TIMEOUT = 'TIMEOUT';
/** The upstream asked us to slow down. No published limit exists, so this is treated as real. */
export const RATE_LIMITED = 'RATE_LIMITED';
/** The upstream rejected the request. This is our bug, not the visitor's. */
export const BAD_REQUEST = 'BAD_REQUEST';
/** The response arrived but did not match the shape this endpoint is contracted to return. */
export const MALFORMED_RESPONSE = 'MALFORMED_RESPONSE';
/** The browser could not reach the host at all. */
export const NETWORK_UNREACHABLE = 'NETWORK_UNREACHABLE';
/** The visitor navigated away or changed the query. Not an error, and never shown as one. */
export const ABORTED = 'ABORTED';
/** Some pages arrived and some did not. The total is suppressed. */
export const INCOMPLETE_ROLLUP = 'INCOMPLETE_ROLLUP';

/** @typedef {'UPSTREAM_ERROR'|'TIMEOUT'|'RATE_LIMITED'|'BAD_REQUEST'|'MALFORMED_RESPONSE'|'NETWORK_UNREACHABLE'|'ABORTED'|'INCOMPLETE_ROLLUP'} FailureKind */

export const FAILURE_KINDS = Object.freeze([
  UPSTREAM_ERROR, TIMEOUT, RATE_LIMITED, BAD_REQUEST, MALFORMED_RESPONSE,
  NETWORK_UNREACHABLE, ABORTED, INCOMPLETE_ROLLUP,
]);

/**
 * What the tile says, per kind. `{what}` is replaced with the name of the panel that failed, so
 * the visitor is told which part of the page is missing rather than being shown a generic
 * apology at the top.
 *
 * @typedef {Object} FailureSpec
 * @property {FailureKind} kind
 * @property {boolean} retryable Whether offering a Retry button is honest.
 * @property {boolean} suppressesFigures Whether any figure in this tile may still be shown.
 * @property {string} template
 */

/** @type {Readonly<Record<FailureKind, FailureSpec>>} */
export const FAILURE_SPEC = Object.freeze({
  [UPSTREAM_ERROR]: Object.freeze({
    kind: UPSTREAM_ERROR,
    retryable: true,
    suppressesFigures: true,
    template: 'USAspending did not respond for {what}. This endpoint returns a server error '
      + 'intermittently and the request was already retried. Nothing is shown here rather than '
      + 'something incomplete.',
  }),
  [TIMEOUT]: Object.freeze({
    kind: TIMEOUT,
    retryable: true,
    suppressesFigures: true,
    template: 'USAspending did not answer in time for {what}. A cold query on this endpoint has '
      + 'been measured at tens of seconds, and the answer is usually fast once the source has '
      + 'warmed. Retry.',
  }),
  [RATE_LIMITED]: Object.freeze({
    kind: RATE_LIMITED,
    retryable: true,
    suppressesFigures: true,
    template: 'USAspending asked this browser to slow down before it answered for {what}. No '
      + 'published rate limit exists for this API, so this is taken at face value and the '
      + 'request was backed off rather than hammered.',
  }),
  [BAD_REQUEST]: Object.freeze({
    kind: BAD_REQUEST,
    retryable: false,
    suppressesFigures: true,
    template: 'USAspending rejected the request for {what}. That is a defect in this page rather '
      + 'than anything you did, and retrying will not change it.',
  }),
  [MALFORMED_RESPONSE]: Object.freeze({
    kind: MALFORMED_RESPONSE,
    retryable: false,
    suppressesFigures: true,
    template: 'USAspending answered for {what} with a body this page could not read against the '
      + 'shape it expects. Nothing is displayed, because guessing at a field that moved is how a '
      + 'wrong number gets published.',
  }),
  [NETWORK_UNREACHABLE]: Object.freeze({
    kind: NETWORK_UNREACHABLE,
    retryable: true,
    suppressesFigures: true,
    template: 'This browser could not reach USAspending for {what}. Every figure on this page is '
      + 'fetched live from that one host and nothing is cached, so there is no offline copy to '
      + 'fall back to.',
  }),
  [ABORTED]: Object.freeze({
    kind: ABORTED,
    retryable: true,
    suppressesFigures: true,
    template: 'The request for {what} was cancelled, usually because the query changed.',
  }),
  [INCOMPLETE_ROLLUP]: Object.freeze({
    kind: INCOMPLETE_ROLLUP,
    retryable: true,
    suppressesFigures: true,
    template: 'Part of {what} did not arrive, so the total is suppressed rather than shown '
      + 'partial. A rollup that is missing some of its parts is smaller than the truth and a '
      + 'reader would quote it.',
  }),
});

/** Module private brand, so nothing outside this file can forge a Failure. */
const FAILURES = new WeakSet();

const REFUSE = 'solebidder: a Failure is not a value. It cannot be stringified implicitly, '
  + 'because the whole point of it is that no number is available. Use failureMessage().';

/**
 * @typedef {Object} Failure
 * @property {FailureKind} kind
 * @property {string} what The panel or figure that is missing, in the words the page uses.
 * @property {string} message The sentence shown to the reader.
 * @property {boolean} retryable
 * @property {number|null} httpStatus The last status seen, when there was one.
 * @property {number} attempts How many attempts were made.
 * @property {number|null} elapsedMs
 * @property {string|null} detail Engineering detail, shown behind a disclosure, never a number
 *   that could be read as a figure.
 * @property {{arrived:number, expected:number}|null} parts For INCOMPLETE_ROLLUP.
 */

/**
 * @param {FailureKind} kind
 * @param {string} what
 * @param {{httpStatus?:number|null, attempts?:number, elapsedMs?:number|null, detail?:string|null, parts?:{arrived:number, expected:number}|null}} [extra]
 * @returns {Failure}
 */
export function failure(kind, what, extra = {}) {
  const spec = FAILURE_SPEC[kind];
  if (!spec) {
    throw new TypeError('failure(): kind must be one of ' + FAILURE_KINDS.join(', ') + ', got '
      + JSON.stringify(kind) + '. There is no generic failure in this product, because a generic '
      + 'failure message tells a reader nothing about which figure is missing.');
  }
  if (typeof what !== 'string' || what.trim().length === 0) {
    throw new TypeError('failure(): `what` must name the panel or figure that is missing, in the '
      + 'words the page uses. "Something went wrong" is not a failure state, it is an apology.');
  }
  const f = {
    kind,
    what,
    message: spec.template.replace('{what}', what),
    retryable: spec.retryable,
    httpStatus: extra.httpStatus === undefined ? null : extra.httpStatus,
    attempts: extra.attempts === undefined ? 1 : extra.attempts,
    elapsedMs: extra.elapsedMs === undefined ? null : extra.elapsedMs,
    detail: extra.detail === undefined ? null : extra.detail,
    parts: extra.parts === undefined ? null : extra.parts,
  };
  const refuse = () => { throw new TypeError(REFUSE); };
  Object.defineProperty(f, 'toString', { value: refuse, enumerable: false });
  Object.defineProperty(f, 'valueOf', { value: refuse, enumerable: false });
  Object.defineProperty(f, Symbol.toPrimitive, { value: refuse, enumerable: false });
  Object.freeze(f);
  FAILURES.add(f);
  return /** @type {Failure} */ (f);
}

/** @param {unknown} x @returns {boolean} */
export function isFailure(x) {
  return typeof x === 'object' && x !== null && FAILURES.has(/** @type {object} */ (x));
}

/**
 * The sentence the tile shows. Adds the parts line for an incomplete rollup, because "how many
 * of the expected children arrived" is the thing that makes suppression legible rather than
 * mysterious.
 * @param {unknown} f
 * @returns {string}
 */
export function failureMessage(f) {
  if (!isFailure(f)) {
    throw new TypeError('failureMessage: expected a Failure built by failure().');
  }
  const fail = /** @type {Failure} */ (f);
  if (fail.kind === INCOMPLETE_ROLLUP && fail.parts) {
    return fail.message + ' ' + fail.parts.arrived + ' of ' + fail.parts.expected
      + ' expected parts arrived.';
  }
  return fail.message;
}

/**
 * Map an HTTP status onto a failure kind. 502 and 504 were both observed live before a 200 on
 * the same query, so they are the ordinary case rather than the exotic one.
 * @param {number} status
 * @returns {FailureKind}
 */
export function kindForStatus(status) {
  if (status === 429) return RATE_LIMITED;
  if (status >= 500) return UPSTREAM_ERROR;
  return BAD_REQUEST;
}
