// THE COMMAND LINE'S FETCH. The browser gave the page four protections for free; Node gives none
// of them, so this wrapper puts them back, and it does so without touching src/query/client.js.
//
// The client already takes its fetch as a parameter, which is how the test suite runs the whole
// retry ladder without a network. The command line hands it this function instead of the global,
// and every request the report makes passes through it on its way to the one host.
//
//   REDIRECTS ARE REFUSED, NEVER FOLLOWED. In a browser the page's content security policy stops a
//   redirect to any host it did not declare. Node has no such policy and its fetch follows a
//   redirect to another origin by default, so a misconfigured or compromised answer could send a
//   request somewhere this tool never named. The redirect mode is forced to error, and a three
//   hundred status that arrives anyway is refused here as well.
//
//   A REFUSED REDIRECT IS NOT RETRIED. Node reports a redirect under that mode by throwing, and
//   the client reads any throw as a dropped connection and tries again, four times with backoff,
//   before calling the host unreachable. Both halves of that are wrong for a redirect: asking
//   again gets the same redirect, and the host was reached. So the throw is caught here and
//   answered with the shape a browser gives a refused redirect, an opaque response with status
//   zero, which the client treats as a rejected request: no retry, and a named failure.
//
//   BODIES ARE CAPPED. The client reads a body with no limit. The largest answer measured for this
//   product is tens of kilobytes, so the cap below is generous and it is a ceiling, not a budget:
//   a body over it is refused and never parsed.
//
//   A BODY THAT IS NOT JSON IS NOT READ. Every endpoint this tool calls answers JSON. Anything else
//   is refused, which the client reports as a malformed response rather than guessing at it.
//
//   THE USER AGENT NAMES THE TOOL AND NOTHING ELSE. Node would send its own name. This sends the
//   tool, its version and where its source lives, and never a user name, a host name or a path.
//
// It also forwards the abort signal it is given, joined with the run's own, so an interrupt stops
// every request in flight rather than only the ones a caller remembered to pass it to.
//
// A refused answer is reported to the caller through onRefusal, once per kind, so the command
// line can say in words WHY a panel is missing: the failure sentence the client builds knows only
// that a request failed.

import { API_ORIGIN } from '../core/constants.js';

/** The largest response body read, in bytes. */
export const BODY_CAP_BYTES = 4 * 1024 * 1024;

/** The repository, named in the User-Agent. */
export const REPOSITORY_URL = 'https://github.com/0xelitesystem/solebidder';

/** The kinds of refusal this wrapper makes. */
export const REFUSAL_KINDS = Object.freeze(['redirect', 'content-type', 'body-cap']);

/**
 * The User-Agent. Nothing personal: the tool, its version, and its source.
 * @param {string} version
 * @returns {string}
 */
export function userAgent(version) {
  return 'solebidder/' + version + ' (+' + REPOSITORY_URL + ')';
}

/** @param {string|null} type @returns {boolean} */
export function isJsonContentType(type) {
  if (typeof type !== 'string') return false;
  const essence = type.split(';')[0].trim().toLowerCase();
  if (essence === 'application/json') return true;
  return essence.startsWith('application/') && essence.endsWith('+json');
}

/**
 * A response the client will read as malformed. It is ok as far as the status goes, because the
 * status was a success; the refusal is about the body, and reading it rejects.
 * @param {Response} response
 * @param {string} reason
 * @returns {object}
 */
function refusedBody(response, reason) {
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    json: async () => { throw new TypeError(reason); },
    text: async () => { throw new TypeError(reason); },
  };
}

/**
 * What a browser hands back for a redirect it will not follow: an opaque response, status zero,
 * not ok, with nothing to read. The client sees a status that is not a success and not one it
 * retries, and reports a rejected request.
 * @returns {object}
 */
function opaqueRedirect() {
  const refuse = async () => { throw new TypeError('a redirect was refused, so there is no body'); };
  return {
    type: 'opaqueredirect',
    ok: false,
    status: 0,
    statusText: '',
    redirected: false,
    headers: new Headers(),
    json: refuse,
    text: refuse,
  };
}

/** @param {unknown} e @returns {boolean} */
function isRedirectError(e) {
  const err = /** @type {any} */ (e);
  const cause = err && err.cause;
  const text = String((cause && cause.message) || '') + ' ' + String((err && err.message) || '');
  return /redirect/i.test(text);
}

/** @param {Response} response */
function discard(response) {
  try {
    if (response && response.body && typeof response.body.cancel === 'function') {
      response.body.cancel().catch(() => {});
    }
  } catch {
    // Nothing to release.
  }
}

/**
 * Read a body up to the cap. Null when it is over.
 * @param {Response} response
 * @param {number} cap
 * @returns {Promise<Uint8Array|null>}
 */
async function readCapped(response, cap) {
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}

/**
 * @param {Object} args
 * @param {typeof globalThis.fetch} [args.fetch] The underlying fetch. The global by default.
 * @param {string} args.version For the User-Agent.
 * @param {AbortSignal} [args.signal] The run's own signal, joined to every request's.
 * @param {number} [args.cap] Bytes. BODY_CAP_BYTES by default.
 * @param {(kind:string) => void} [args.onRefusal]
 * @returns {(url:string, init?:object) => Promise<any>}
 */
export function createCliFetch(args) {
  const base = args.fetch === undefined ? globalThis.fetch : args.fetch;
  const cap = args.cap === undefined ? BODY_CAP_BYTES : args.cap;
  const agent = userAgent(args.version);
  const refuse = (kind) => { if (args.onRefusal) args.onRefusal(kind); };

  return async function cliFetch(url, init = {}) {
    // The client has already refused any other origin. This is the same rule a second time, at
    // the last point before a socket opens, so no future caller of this function can widen it.
    if (typeof url !== 'string' || !url.startsWith(API_ORIGIN + '/')) {
      throw new TypeError('solebidder contacts one host and this request was not for it.');
    }
    const headers = new Headers(init.headers === undefined ? undefined : init.headers);
    headers.set('user-agent', agent);
    headers.set('accept', 'application/json');
    const signals = [init.signal, args.signal].filter((s) => s !== undefined && s !== null);
    const signal = signals.length === 0 ? undefined
      : (signals.length === 1 ? signals[0] : AbortSignal.any(signals));

    let response;
    try {
      response = await base(url, { ...init, headers, signal, redirect: 'error' });
    } catch (e) {
      if (!(signal && signal.aborted) && isRedirectError(e)) {
        refuse('redirect');
        return opaqueRedirect();
      }
      throw e;
    }

    const status = response.status;
    if ((status >= 300 && status < 400) || response.type === 'opaqueredirect' || response.redirected === true) {
      discard(response);
      refuse('redirect');
      return opaqueRedirect();
    }
    if (!response.ok) {
      // The client reads only the status of an answer that failed, so the body is released
      // unread and the status travels on.
      discard(response);
      return new Response(null, { status, statusText: response.statusText, headers: response.headers });
    }
    if (!isJsonContentType(response.headers.get('content-type'))) {
      discard(response);
      refuse('content-type');
      return refusedBody(response, 'the answer was not JSON, so it was not read');
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > cap) {
      discard(response);
      refuse('body-cap');
      return refusedBody(response, 'the answer declared a body over the size cap, so it was not read');
    }
    const bytes = await readCapped(response, cap);
    if (bytes === null) {
      refuse('body-cap');
      return refusedBody(response, 'the answer ran over the size cap, so it was not read');
    }
    // A success status that by definition carries no body cannot be rebuilt around one, even an
    // empty one: the constructor throws, and the client would read that throw as a dropped
    // connection and retry a host that answered. It goes on with no body, which the client reads
    // as a malformed answer, once.
    const noBody = status === 204 || status === 205;
    return new Response(noBody ? null : bytes, { status, statusText: response.statusText, headers: response.headers });
  };
}
