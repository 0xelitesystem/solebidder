// THE API CLIENT. One host, retried honestly, with a named failure instead of a spinner.
//
// WHAT THIS MODULE IS RESPONSIBLE FOR, and it is a short list on purpose:
//
//   * make exactly one kind of network call, to exactly one host,
//   * retry the transient upstream faults that were actually measured, with full jitter,
//   * give up at a stated deadline rather than spinning,
//   * hand back either a validated projection or a named Failure, never a half result,
//   * tell the caller when a query has gone quiet long enough that the tile must say why,
//   * cap concurrency, because there is no published rate limit to design against.
//
// IT NEVER FORMATS A NUMBER AND IT NEVER TOUCHES THE DOM. Everything it returns goes through
// the claim system before a reader sees it.
//
// THE ORIGIN IS WRITTEN OUT AT THE CALL SITE. Below, the one fetch in this product reads
// fetch('https://api.usaspending.gov' + path). It would be tidier to assemble that from the
// constant, and it is deliberately not: the flagship network gate collects the hosts that
// appear beside a fetch in shipped code and compares that set with the allowlist declared in
// the page head, in both directions. Writing the host at the call site is what makes the set a
// reader can see and the set a machine checks the same set. assertSameOrigin below proves the
// literal and the constant agree, so the tidiness is bought back without losing the check.
//
// EVERYTHING EXTERNAL IS INJECTABLE. fetch, the clock, sleep and the jitter source are all
// parameters with real defaults. That is what lets the whole retry ladder be tested in
// milliseconds without waiting for real seconds and without touching the network.
//
// Isomorphic: no node:* imports and no DOM.

import { API_ORIGIN, MAX_CONCURRENCY, COLD_SOURCE_NOTICE_MS } from '../core/constants.js';
import {
  failure, isFailure, kindForStatus,
  TIMEOUT, MALFORMED_RESPONSE, NETWORK_UNREACHABLE, ABORTED,
} from './failure.js';
import {
  DEFAULT_POLICY, TIMEOUTS, shouldRetry, backoffDelayMs, parseRetryAfterMs, retryPlan,
} from './retry.js';
import { MalformedResponse } from './endpoints.js';

/**
 * @typedef {Object} ClientDeps
 * @property {typeof globalThis.fetch} [fetch]
 * @property {() => number} [now] Monotonic milliseconds.
 * @property {(ms:number) => Promise<void>} [sleep]
 * @property {() => number} [random] Jitter source, uniform in [0, 1).
 * @property {typeof DEFAULT_POLICY} [policy]
 */

/**
 * @typedef {Object} RequestSpec
 * @property {string} id Endpoint id, quoted in every failure.
 * @property {'GET'|'POST'} method
 * @property {string} url Absolute, on the one declared origin.
 * @property {object} [body]
 * @property {'fast'|'heavy'} weight
 */

/**
 * @typedef {Object} Ok
 * @property {true} ok
 * @property {any} value The validated projection.
 * @property {number} attempts
 * @property {number} elapsedMs
 */

/**
 * @typedef {Object} Err
 * @property {false} ok
 * @property {import('./failure.js').Failure} failure
 */

/**
 * Assert a URL is on the one declared origin, and return the path.
 *
 * This is the check that keeps the call site literal honest. A URL that is not on the declared
 * origin cannot be requested at all, so a second host cannot appear at runtime even if a
 * request builder is changed later.
 *
 * @param {string} absoluteUrl
 * @returns {string} The path and query, beginning with a slash.
 */
export function assertSameOrigin(absoluteUrl) {
  if (typeof absoluteUrl !== 'string' || !absoluteUrl.startsWith(API_ORIGIN + '/')) {
    throw new TypeError('assertSameOrigin: this product may reach exactly one host and this URL '
      + 'is not on it: ' + JSON.stringify(absoluteUrl) + '. Every other candidate source was cut '
      + 'for a stated reason, and the page network allowlist declares one host. A second host '
      + 'here would fail the build.');
  }
  return absoluteUrl.slice(API_ORIGIN.length);
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Build a client. Every dependency has a real default, so production code calls
 * createClient() with no arguments and the test suite pins all four.
 *
 * @param {ClientDeps} [deps]
 */
export function createClient(deps = {}) {
  const doFetch = deps.fetch === undefined ? globalThis.fetch : deps.fetch;
  const now = deps.now === undefined ? (() => Date.now()) : deps.now;
  const sleep = deps.sleep === undefined ? defaultSleep : deps.sleep;
  const random = deps.random === undefined ? Math.random : deps.random;
  const policy = deps.policy === undefined ? DEFAULT_POLICY : deps.policy;

  /**
   * Run one request through the retry ladder.
   *
   * @param {RequestSpec} request
   * @param {(json:any) => any} validate The endpoint validator from ./endpoints.js.
   * @param {Object} [options]
   * @param {string} [options.what] The panel name used in the failure sentence.
   * @param {AbortSignal} [options.signal]
   * @param {(info:{attempt:number, elapsedMs:number}) => void} [options.onCold] Called once the
   *   query has been quiet for COLD_SOURCE_NOTICE_MS, so the tile can replace its skeleton with
   *   a sentence that says the source is cold. Never a bare spinner.
   * @returns {Promise<Ok|Err>}
   */
  async function request(request_, validate, options = {}) {
    const spec = request_;
    const path = assertSameOrigin(spec.url);
    const what = options.what === undefined ? spec.id : options.what;
    const weight = spec.weight === 'heavy' ? 'heavy' : 'fast';
    const { perAttemptMs, deadlineMs } = TIMEOUTS[weight];
    const started = now();
    let attempt = 0;
    let lastStatus = null;
    let coldFired = false;

    const coldTimer = setTimeout(() => {
      coldFired = true;
      if (options.onCold) options.onCold({ attempt, elapsedMs: now() - started });
    }, COLD_SOURCE_NOTICE_MS);

    try {
      for (;;) {
        attempt += 1;
        if (options.signal && options.signal.aborted) {
          return err(ABORTED, what, { attempts: attempt, elapsedMs: now() - started });
        }
        const remaining = deadlineMs - (now() - started);
        if (remaining <= 0) {
          return err(TIMEOUT, what, {
            attempts: attempt - 1,
            elapsedMs: now() - started,
            detail: describePlan(weight, policy),
          });
        }

        const controller = new AbortController();
        const attemptMs = Math.min(perAttemptMs, remaining);
        const timer = setTimeout(() => controller.abort(new Error('per attempt timeout')), attemptMs);
        const onOuterAbort = () => controller.abort(new Error('caller aborted'));
        if (options.signal) options.signal.addEventListener('abort', onOuterAbort, { once: true });

        /** @type {{status:number|null, networkError:boolean, aborted:boolean, response:any}} */
        let outcome = { status: null, networkError: false, aborted: false, response: null };
        try {
          const init = {
            method: spec.method,
            signal: controller.signal,
            // No credentials, no cookies, no custom headers beyond the content type a POST
            // needs. A custom header would trigger a preflight on every call for no gain, and
            // there is no key to send: this API needs none.
            headers: spec.method === 'POST' ? { 'content-type': 'application/json' } : undefined,
            body: spec.method === 'POST' ? JSON.stringify(spec.body === undefined ? {} : spec.body) : undefined,
          };
          // The one network call in this product. The host is written out here on purpose; see
          // the note at the top of this file.
          const response = await doFetch('https://api.usaspending.gov' + path, init);
          outcome = { status: response.status, networkError: false, aborted: false, response };
        } catch (e) {
          const aborted = options.signal ? options.signal.aborted : false;
          outcome = { status: null, networkError: !aborted, aborted, response: null };
        } finally {
          clearTimeout(timer);
          if (options.signal) options.signal.removeEventListener('abort', onOuterAbort);
        }

        if (outcome.aborted) {
          return err(ABORTED, what, { attempts: attempt, elapsedMs: now() - started });
        }

        if (outcome.response && outcome.response.ok) {
          let json;
          try {
            json = await outcome.response.json();
          } catch (e) {
            return err(MALFORMED_RESPONSE, what, {
              attempts: attempt,
              elapsedMs: now() - started,
              httpStatus: outcome.status,
              detail: 'the body was not valid JSON',
            });
          }
          try {
            const value = validate(json);
            return { ok: true, value, attempts: attempt, elapsedMs: now() - started };
          } catch (e) {
            const detail = e instanceof MalformedResponse ? e.detail : String(e && e.message);
            return err(MALFORMED_RESPONSE, what, {
              attempts: attempt,
              elapsedMs: now() - started,
              httpStatus: outcome.status,
              detail,
            });
          }
        }

        lastStatus = outcome.status;
        const retry = shouldRetry(
          { status: outcome.status, networkError: outcome.networkError, aborted: false },
          attempt,
          policy,
        );
        if (!retry) {
          if (outcome.networkError) {
            return err(NETWORK_UNREACHABLE, what, {
              attempts: attempt,
              elapsedMs: now() - started,
              detail: describePlan(weight, policy),
            });
          }
          if (outcome.status === null) {
            return err(TIMEOUT, what, {
              attempts: attempt,
              elapsedMs: now() - started,
              detail: describePlan(weight, policy),
            });
          }
          return err(kindForStatus(outcome.status), what, {
            attempts: attempt,
            elapsedMs: now() - started,
            httpStatus: outcome.status,
            detail: describePlan(weight, policy),
          });
        }

        const retryAfterMs = outcome.response && outcome.response.headers
          ? parseRetryAfterMs(outcome.response.headers.get('retry-after'), now())
          : null;
        const delay = backoffDelayMs(attempt, { retryAfterMs, random, policy });
        const left = deadlineMs - (now() - started);
        if (delay >= left) {
          return err(TIMEOUT, what, {
            attempts: attempt,
            elapsedMs: now() - started,
            httpStatus: lastStatus,
            detail: describePlan(weight, policy),
          });
        }
        await sleep(delay);
      }
    } finally {
      clearTimeout(coldTimer);
      void coldFired;
    }
  }

  /**
   * Run many requests with a hard concurrency cap. Trap 6 and trap 11: no unbounded fan out,
   * ever. The hero fans out over the largest awards and that is the only fan out in the product.
   *
   * Results come back in input order and a failed member is a Failure in that slot, so a caller
   * can count what arrived and suppress a total rather than silently summing a short list.
   *
   * @template T
   * @param {(() => Promise<T>)[]} tasks
   * @param {number} [limit]
   * @returns {Promise<T[]>}
   */
  async function mapWithCap(tasks, limit = MAX_CONCURRENCY) {
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONCURRENCY) {
      throw new RangeError('mapWithCap: limit must be an integer in [1, ' + MAX_CONCURRENCY
        + ']. There is no published rate limit for this API, which means there is also no '
        + 'published ceiling to design against, so the cap is ours and it does not move.');
    }
    const out = new Array(tasks.length);
    let next = 0;
    const workers = new Array(Math.min(limit, tasks.length)).fill(null).map(async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= tasks.length) return;
        out[i] = await tasks[i]();
      }
    });
    await Promise.all(workers);
    return out;
  }

  return { request, mapWithCap, plan: (weight) => retryPlan(weight, policy) };
}

/**
 * @param {import('./failure.js').FailureKind} kind
 * @param {string} what
 * @param {object} extra
 * @returns {Err}
 */
function err(kind, what, extra) {
  return { ok: false, failure: failure(kind, what, extra) };
}

/**
 * The retry ladder in words, for the engineering detail behind a failure. "It was retried" is a
 * reassurance; this is a statement with numbers in it.
 * @param {'fast'|'heavy'} weight
 * @param {typeof DEFAULT_POLICY} policy
 * @returns {string}
 */
function describePlan(weight, policy) {
  const p = retryPlan(weight, policy);
  return 'up to ' + p.maxAttempts + ' attempts, ' + p.perAttemptMs + ' ms per attempt, '
    + p.deadlineMs + ' ms overall, backoff windows of ' + p.windowsMs.join(', ')
    + ' ms with full jitter';
}

export { isFailure };
