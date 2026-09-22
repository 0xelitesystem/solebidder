// THE RETRY AND BACKOFF POLICY. Trap 5, trap 11, and the measured 502 and 504 behaviour.
//
// What was actually measured, and it is the whole basis of this file:
//
//   * Real 502 and 504 responses arrived before a 200 on the SAME query on the same day. The
//     failure is transient and query independent, so a retry is the correct response rather
//     than a way of hiding a bug.
//   * A cold query on the heavy search endpoints ran 11 to 42 seconds and collapsed to 0.37 to
//     2.0 seconds once the upstream cache was warm. So a short per attempt timeout does not make
//     the page faster, it converts a slow success into a failure.
//   * There is NO documented rate limit and none was observed across 20 sequential and 10
//     parallel requests. That cuts both ways: nothing throttled us, and there is also no
//     published ceiling to design against, so an undocumented limit can appear without notice.
//     The response is a concurrency cap and honouring Retry-After if it ever arrives, not an
//     assumption that we can hammer the host.
//
// FULL JITTER, not fixed backoff. Every visitor's browser is an independent client here, there
// is no server of ours in the middle, and a transient upstream fault tends to hit many of them
// at once. Fixed backoff would have them all return in step. The delay is therefore uniform in
// [0, cap], which is the standard full jitter form.
//
// This module is PURE. It computes a plan and it decides whether to retry. It does not sleep,
// it does not call fetch, and it does not read a clock unless one is handed to it. That is what
// makes the policy testable without waiting for real seconds to pass.
//
// Isomorphic: no node:* imports and no DOM.

/**
 * Statuses worth retrying. Everything here is either explicitly transient or explicitly a
 * request to come back later.
 *
 * 500, 502, 503 and 504 are upstream faults. 429 is a slow down. Nothing in the 4xx range other
 * than 429 is retried: a 400 or a 422 is our own malformed request and retrying it just makes
 * the same mistake more often. In particular 422 is what this API returns for a page limit above
 * 100, which is a code defect, not weather.
 */
export const RETRYABLE_STATUS = Object.freeze([429, 500, 502, 503, 504]);

/**
 * The policy, as data so that a test can assert the numbers and a reader can see them without
 * tracing code.
 *
 * @typedef {Object} RetryPolicy
 * @property {number} maxAttempts Total attempts including the first. 4 means 1 try and 3 retries.
 * @property {number} baseDelayMs First backoff window.
 * @property {number} factor Window multiplier per attempt.
 * @property {number} maxDelayMs Ceiling on the window.
 * @property {number} maxRetryAfterMs Ceiling on an honoured Retry-After header.
 */

/** @type {RetryPolicy} */
export const DEFAULT_POLICY = Object.freeze({
  maxAttempts: 4,
  baseDelayMs: 400,
  factor: 2,
  maxDelayMs: 8000,
  maxRetryAfterMs: 20000,
});

/**
 * Per attempt timeout and overall deadline, by endpoint weight.
 *
 * The heavy numbers are deliberately large. A cold spending_by_award took 33.2 seconds and a
 * cold new awards query took 42.1 seconds in the measurements this design is built on. A 30
 * second timeout would turn a correct slow answer into a wrong empty panel, which is the exact
 * failure this product exists to avoid.
 */
export const TIMEOUTS = Object.freeze({
  fast: Object.freeze({ perAttemptMs: 15000, deadlineMs: 45000 }),
  heavy: Object.freeze({ perAttemptMs: 75000, deadlineMs: 150000 }),
});

/** @typedef {'fast'|'heavy'} EndpointWeight */

/**
 * Should this outcome be retried.
 *
 * @param {{status?:number|null, networkError?:boolean, aborted?:boolean}} outcome
 * @param {number} attempt 1 for the first attempt.
 * @param {RetryPolicy} [policy]
 * @returns {boolean}
 */
export function shouldRetry(outcome, attempt, policy = DEFAULT_POLICY) {
  if (outcome.aborted) return false;
  if (attempt >= policy.maxAttempts) return false;
  if (outcome.networkError) return true;
  const status = outcome.status;
  if (typeof status !== 'number') return false;
  return RETRYABLE_STATUS.includes(status);
}

/**
 * The backoff window for an attempt, before jitter. Exponential, capped.
 * @param {number} attempt 1 for the first attempt.
 * @param {RetryPolicy} [policy]
 * @returns {number}
 */
export function backoffWindowMs(attempt, policy = DEFAULT_POLICY) {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new RangeError('backoffWindowMs: attempt is 1 based, got ' + String(attempt));
  }
  const raw = policy.baseDelayMs * Math.pow(policy.factor, attempt - 1);
  return Math.min(policy.maxDelayMs, raw);
}

/**
 * The delay actually waited. Full jitter: uniform in [0, window].
 *
 * @param {number} attempt
 * @param {{retryAfterMs?:number|null, random?:() => number, policy?:RetryPolicy}} [options]
 *   `random` is injectable so a test can pin the jitter instead of hoping.
 * @returns {number} Milliseconds, an integer.
 */
export function backoffDelayMs(attempt, options = {}) {
  const policy = options.policy === undefined ? DEFAULT_POLICY : options.policy;
  const random = options.random === undefined ? Math.random : options.random;
  const retryAfter = options.retryAfterMs;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter >= 0) {
    // An explicit instruction from the server outranks our guess, but it is capped so a
    // mistaken or hostile header cannot park the page for an hour.
    return Math.round(Math.min(retryAfter, policy.maxRetryAfterMs));
  }
  const window = backoffWindowMs(attempt, policy);
  const r = random();
  if (typeof r !== 'number' || !(r >= 0) || !(r < 1)) {
    throw new RangeError('backoffDelayMs: random() must return a number in [0, 1), got ' + String(r));
  }
  return Math.round(r * window);
}

/**
 * Parse a Retry-After header. The spec allows a delay in seconds or an HTTP date, and this API
 * sent neither in any measured response, so this exists for the day it starts to.
 *
 * @param {string|null|undefined} header
 * @param {number} [nowMs] Injectable clock, so the date branch is testable.
 * @returns {number|null} Milliseconds to wait, or null when the header is absent or unusable.
 */
export function parseRetryAfterMs(header, nowMs = Date.now()) {
  if (header === null || header === undefined) return null;
  const text = String(header).trim();
  if (text.length === 0) return null;
  if (/^\d+$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;
  const delta = at - nowMs;
  return delta > 0 ? delta : 0;
}

/**
 * The whole plan for one request, as data. Printed in the engineering detail of a Failure so
 * that "it was retried" is a statement with numbers behind it rather than a reassurance.
 *
 * @param {EndpointWeight} weight
 * @param {RetryPolicy} [policy]
 * @returns {{maxAttempts:number, perAttemptMs:number, deadlineMs:number, windowsMs:number[]}}
 */
export function retryPlan(weight, policy = DEFAULT_POLICY) {
  const t = TIMEOUTS[weight];
  if (!t) {
    throw new RangeError('retryPlan: weight must be "fast" or "heavy", got ' + JSON.stringify(weight));
  }
  const windowsMs = [];
  for (let a = 1; a < policy.maxAttempts; a += 1) windowsMs.push(backoffWindowMs(a, policy));
  return {
    maxAttempts: policy.maxAttempts,
    perAttemptMs: t.perAttemptMs,
    deadlineMs: t.deadlineMs,
    windowsMs,
  };
}
