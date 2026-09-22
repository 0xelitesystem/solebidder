// A CLIENT WITH EVERY DEPENDENCY PINNED, so the retry ladder is exercised in milliseconds and
// no test touches the network.
//
// The client under test takes fetch, the clock, sleep and the jitter source as parameters. This
// helper supplies all four: a scripted fetch, a clock that only advances when the code under
// test sleeps, a sleep that advances that clock instead of waiting, and a fixed jitter value.
// The consequence is that a four attempt ladder with backoff windows measured in seconds runs
// instantly and deterministically, and a flaky test here would be a real defect rather than a
// timing accident.
//
// It also RECORDS every request, which is how the year trap is tested: the assertion is not that
// the code meant to send the same fiscal year to two endpoints, it is that both recorded URLs
// carry it.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '../../src/query/client.js';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = path.join(REPO, 'test', 'fixtures', 'api');

/** @param {string} name @returns {Promise<any>} */
export async function fixture(name) {
  return JSON.parse(await readFile(path.join(FIXTURES, name), 'utf8'));
}

/**
 * One scripted response.
 * @typedef {Object} Scripted
 * @property {number} [status] Defaults to 200.
 * @property {any} [json] The body, when the status is a success.
 * @property {boolean} [networkError] Throw instead of answering, like an unreachable host.
 * @property {string} [badJson] A body that is not JSON.
 * @property {Record<string,string>} [headers]
 */

/**
 * Build a client whose fetch answers from a route table.
 *
 * A route value may be a single scripted response or an ARRAY of them, which is consumed one per
 * attempt. An array is how a real measured sequence is reproduced: two upstream errors and then
 * a success on the same query, which is what the live API actually did.
 *
 * @param {Record<string, Scripted|Scripted[]>} routes Keyed by a substring of the path.
 * @param {{random?:number}} [options]
 */
export function fakeClient(routes, options = {}) {
  /** @type {{url:string, method:string, body:any}[]} */
  const calls = [];
  /** @type {Map<string, number>} */
  const cursor = new Map();
  let clock = 0;
  const jitter = options.random === undefined ? 0 : options.random;

  const pick = (url) => {
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (key === undefined) {
      throw new Error('fakeClient: no route matches ' + url + '. Routes: ' + Object.keys(routes).join(', '));
    }
    const value = routes[key];
    if (!Array.isArray(value)) return value;
    const at = cursor.get(key) === undefined ? 0 : cursor.get(key);
    cursor.set(key, at + 1);
    return value[Math.min(at, value.length - 1)];
  };

  const fetchImpl = async (url, init) => {
    calls.push({
      url: String(url),
      method: (init && init.method) || 'GET',
      body: init && init.body ? JSON.parse(init.body) : null,
    });
    const scripted = pick(String(url));
    if (scripted.networkError) throw new TypeError('fetch failed');
    const status = scripted.status === undefined ? 200 : scripted.status;
    const headers = scripted.headers === undefined ? {} : scripted.headers;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name) => (headers[name.toLowerCase()] === undefined ? null : headers[name.toLowerCase()]) },
      json: async () => {
        if (scripted.badJson !== undefined) throw new SyntaxError('not JSON');
        return scripted.json;
      },
    };
  };

  const client = createClient({
    fetch: fetchImpl,
    now: () => clock,
    sleep: async (ms) => { clock += ms; },
    random: () => jitter,
  });

  return { client, calls, advance: (ms) => { clock += ms; } };
}
