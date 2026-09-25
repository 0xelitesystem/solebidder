// THE COMMAND LINE, DRIVEN WITH NO NETWORK.
//
// run() from src/cli/main.js takes its arguments, environment, streams, clock and the fetch that
// sits UNDER its own wrapper as parameters. This helper supplies all of them: a transport that
// answers every endpoint the report touches with real Response objects, so the wrapper's body
// reading, size cap and content type check run exactly as they do against the live host; two
// fake streams that record every character; and a process stand in that records signal handlers.
//
// THE RECORDED RESPONSES ARE THE ONES IN test/fixtures/api, off the live API on 2026-09-22. The
// award search, the award details and three of the four category dimensions were never
// recorded, so those answers are SYNTHETIC and look it: every award identifier starts with
// SYNTH, every invented agency name says synthetic, and no figure in them is quoted anywhere as a
// fact about a real entity.

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { run } from '../../src/cli/main.js';
import { REPO } from './fake-client.js';

const FIXTURES = path.join(REPO, 'test', 'fixtures', 'api');

/** The clock every CLI test runs at: fiscal year 2026 is current, 2025 is the default. */
export const NOW = new Date(Date.UTC(2026, 8, 24, 12));

/** @param {string} name @returns {any} */
export function recorded(name) {
  return JSON.parse(readFileSync(path.join(FIXTURES, name), 'utf8'));
}

/** The chosen parent in the recorded fixtures. */
export const PARENT_UEI = 'ZFN2JJXBLZT3';

/**
 * Synthetic award rows for the award search. Three belong to the entity set (the parent's list
 * name and two recorded child names) and one does not, so the dropped row tally is exercised.
 * @param {{name?:(i:number) => string}} [o]
 * @returns {object}
 */
export function syntheticAwardSearch(o = {}) {
  const names = ['LOCKHEED MARTIN CORP', 'SIKORSKY AIRCRAFT CORPORATION', 'LOCKHEED MARTIN CORP',
    'SYNTHETIC OUTSIDE RECIPIENT'];
  const values = [900, 500, 300, 50];
  return {
    results: names.map((n, i) => ({
      'Award ID': 'SYNTH-AWARD-' + (i + 1),
      'Recipient Name': o.name === undefined ? n : o.name(i),
      'Award Amount': values[i],
      generated_internal_id: 'SYNTH_GID_' + (i + 1),
      'Awarding Agency': 'Synthetic Agency',
    })),
    page_metadata: { hasNext: false },
  };
}

/**
 * A synthetic award detail for one generated id.
 * @param {string} gid
 * @returns {object}
 */
export function syntheticAwardDetail(gid) {
  const n = Number(gid.split('_').pop());
  const notCompeted = n === 1;
  return {
    generated_unique_award_id: gid,
    piid: 'SYNTH-AWARD-' + n,
    latest_transaction_contract_data: {
      extent_competed_description: notCompeted ? 'NOT COMPETED' : 'FULL AND OPEN COMPETITION',
      number_of_offers_received: notCompeted ? '1' : '3',
      solicitation_procedures_description: notCompeted ? 'ONLY ONE SOURCE' : 'NEGOTIATED PROPOSAL',
      type_set_aside_description: null,
    },
  };
}

/**
 * A synthetic category page for a dimension that was never recorded.
 * @param {string} dimension
 * @returns {object}
 */
export function syntheticCategory(dimension) {
  return {
    category: dimension,
    results: [
      { name: 'Synthetic ' + dimension + ' row one', code: 'S1', amount: 700 },
      { name: 'Synthetic ' + dimension + ' row two', code: 'S2', amount: 250 },
      { name: 'Synthetic ' + dimension + ' row three', code: 'S3', amount: -50 },
    ],
    page_metadata: { hasNext: false },
  };
}

/**
 * The healthy route table: every endpoint the report calls, keyed "METHOD /path", longest match
 * wins. A value is a body, or a function of (url, init, n) returning a body or a scripted answer
 * {status, body, headers, network, raw}.
 * @returns {Record<string, any>}
 */
export function healthyRoutes() {
  return {
    'GET /api/v2/awards/last_updated/': recorded('last-updated.json'),
    'POST /api/v2/recipient/': recorded('recipient-list-lockheed.json'),
    'GET /api/v2/recipient/children/': recorded('recipient-children-fy2025.json'),
    'GET /api/v2/recipient/': recorded('recipient-profile-parent-fy2025.json'),
    'POST /api/v2/search/spending_by_award/': syntheticAwardSearch(),
    'GET /api/v2/awards/': (url) => syntheticAwardDetail(decodeURIComponent(url.split('/').filter(Boolean).pop())),
    'POST /api/v2/search/spending_over_time/': recorded('spending-over-time-fy2016-2025.json'),
    'POST /api/v2/search/spending_by_category/awarding_agency/': recorded('category-awarding-agency-fy2025.json'),
    'POST /api/v2/search/spending_by_category/awarding_subagency/': syntheticCategory('awarding_subagency'),
    'POST /api/v2/search/spending_by_category/psc/': syntheticCategory('psc'),
    'POST /api/v2/search/spending_by_category/naics/': syntheticCategory('naics'),
    'POST /api/v2/search/spending_by_category/recipient/': recorded('category-recipient-all-fy2025.json'),
  };
}

/**
 * The transport. It answers the ORIGIN the wrapper insists on and nothing else, records every
 * call with its headers, and answers an unrouted call with a 404 so a stale table fails loudly.
 * @param {Record<string, any>} [routes]
 */
export function cliTransport(routes = healthyRoutes()) {
  /** @type {{method:string, path:string, url:string, headers:Headers, body:any, redirect:string|undefined}[]} */
  const calls = [];
  /** @type {string[]} */
  const unrouted = [];
  /** @type {Map<string, number>} */
  const counts = new Map();

  const fetch = async (url, init = {}) => {
    const text = String(url);
    const method = init.method || 'GET';
    const p = text.replace('https://api.usaspending.gov', '');
    calls.push({
      method, path: p, url: text, headers: new Headers(init.headers), redirect: init.redirect,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    });
    if (init.signal && init.signal.aborted) {
      throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
    }
    const signature = method + ' ' + p;
    const key = Object.keys(routes).filter((k) => signature.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) {
      unrouted.push(signature);
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    }
    const n = counts.get(key) === undefined ? 0 : counts.get(key);
    counts.set(key, n + 1);
    let answer = routes[key];
    if (typeof answer === 'function') answer = await answer(text, init, n);
    if (answer && answer.scripted === true) {
      if (answer.network) throw new TypeError('fetch failed');
      if (answer.hang) {
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        });
      }
      const headers = answer.headers === undefined ? { 'content-type': 'application/json' } : answer.headers;
      const body = answer.raw !== undefined ? answer.raw : JSON.stringify(answer.body === undefined ? {} : answer.body);
      return new Response(answer.status === 204 ? null : body, { status: answer.status === undefined ? 200 : answer.status, headers });
    }
    return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  return {
    fetch,
    calls,
    unrouted,
    countFor: (prefix) => calls.filter((c) => (c.method + ' ' + c.path).startsWith(prefix)).length,
  };
}

/**
 * A scripted answer, for a route that must fail or misbehave.
 * @param {{status?:number, body?:any, raw?:string, headers?:Record<string,string>, network?:boolean, hang?:boolean}} o
 * @returns {object}
 */
export function scripted(o) {
  return { scripted: true, ...o };
}

/**
 * A writable stand in that records what it is given.
 * @param {{isTTY?:boolean, columns?:number}} [o]
 */
export function recordingStream(o = {}) {
  const s = /** @type {any} */ (new EventEmitter());
  s.isTTY = o.isTTY === true;
  s.columns = o.columns;
  s.chunks = [];
  s.write = (chunk) => {
    s.chunks.push(String(chunk));
    return true;
  };
  s.text = () => s.chunks.join('');
  return s;
}

/** A process stand in: records signal handlers, and an exit that records instead of exiting. */
export function fakeProc() {
  const p = /** @type {any} */ (new EventEmitter());
  p.exits = [];
  p.exit = (code) => { p.exits.push(code); };
  return p;
}

/**
 * Run the command line once, offline.
 * @param {string[]} argv
 * @param {Object} [o]
 * @param {Record<string, any>} [o.routes]
 * @param {ReturnType<typeof cliTransport>} [o.transport]
 * @param {Record<string, string|undefined>} [o.env]
 * @param {{isTTY?:boolean, columns?:number}} [o.stdout]
 * @param {any} [o.stdoutStream]
 * @param {Date} [o.now]
 * @param {any} [o.proc]
 * @param {string} [o.cwd]
 * @param {string} [o.packageRoot]
 * @param {() => Promise<string>} [o.readIndex]
 * @param {boolean} [o.allowError]
 * @param {(t:any, p:any) => void} [o.during] Called once the run has started, for interrupt tests.
 */
export async function runCli(argv, o = {}) {
  const stdout = o.stdoutStream === undefined ? recordingStream(o.stdout) : o.stdoutStream;
  const stderr = recordingStream();
  const transport = o.transport === undefined ? cliTransport(o.routes) : o.transport;
  const proc = o.proc === undefined ? fakeProc() : o.proc;
  let clock = 0;
  /** @type {unknown} */
  let error = null;
  const pending = run({
    argv,
    env: o.env === undefined ? {} : o.env,
    stdout,
    stderr,
    now: () => (o.now === undefined ? NOW : o.now),
    fetch: transport.fetch,
    clientDeps: {
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      random: () => 0.5,
    },
    proc,
    cwd: o.cwd,
    packageRoot: o.packageRoot,
    readIndex: o.readIndex,
    onError: (e) => { error = e; },
  });
  if (o.during) o.during(transport, proc);
  const code = await pending;
  if (error !== null && o.allowError !== true) throw error;
  return {
    code,
    stdout: typeof stdout.text === 'function' ? stdout.text() : '',
    stderr: stderr.text(),
    transport,
    proc,
    error,
  };
}
