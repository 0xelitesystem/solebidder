// THE COMMAND LINE'S FETCH, AGAINST A REAL SERVER ON THIS MACHINE.
//
// Node's own fetch is what runs underneath the wrapper in production, so these tests run it for
// real: a node:http server on 127.0.0.1 answers, and the only thing replaced is the origin. The
// wrapper still sees https://api.usaspending.gov, and the base fetch beneath it rewrites that to
// the local port and hands everything else, including the redirect mode the wrapper forced, to
// Node unchanged. No request leaves this machine.

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { createCliFetch, userAgent, isJsonContentType, BODY_CAP_BYTES } from '../src/cli/fetch.js';
import { createClient } from '../src/query/client.js';
import { lastUpdatedRequest, validateLastUpdated } from '../src/query/endpoints.js';
import { API_ORIGIN } from '../src/core/constants.js';
import { BAD_REQUEST, MALFORMED_RESPONSE, ABORTED } from '../src/query/failure.js';

const VERSION = '9.9.9';

/**
 * A local server. Every request is recorded with its headers.
 * @param {(req:http.IncomingMessage, res:http.ServerResponse) => void} handler
 */
async function serve(handler) {
  /** @type {{url:string, headers:http.IncomingHttpHeaders}[]} */
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push({ url: req.url || '', headers: req.headers });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = /** @type {any} */ (server.address()).port;
  return {
    port,
    hits,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }),
  };
}

/**
 * The fetch beneath the wrapper: the real one, pointed at the local port.
 * @param {number} port
 */
const local = (port) => (url, init) => globalThis.fetch(String(url).replace(API_ORIGIN, 'http://127.0.0.1:' + port), init);

/** @param {any} f @param {{cap?:number, signal?:AbortSignal}} [o] */
function wrap(f, o = {}) {
  /** @type {string[]} */
  const refusals = [];
  const cliFetch = createCliFetch({
    fetch: f, version: VERSION, cap: o.cap, signal: o.signal, onRefusal: (k) => refusals.push(k),
  });
  return { cliFetch, refusals };
}

const URL_ = API_ORIGIN + '/api/v2/awards/last_updated/';

test('the request names the tool and nothing else, asks for JSON, and a body under the cap is read', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ last_updated: '09/21/2026' }));
  });
  try {
    const { cliFetch, refusals } = wrap(local(s.port));
    const r = await cliFetch(URL_);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { last_updated: '09/21/2026' });
    assert.equal(s.hits[0].headers['user-agent'], 'solebidder/9.9.9 (+https://github.com/0xelitesystem/solebidder)');
    assert.equal(s.hits[0].headers['user-agent'], userAgent(VERSION));
    assert.equal(s.hits[0].headers.accept, 'application/json');
    assert.equal(s.hits[0].headers.cookie, undefined);
    assert.deepEqual(refusals, []);
  } finally {
    await s.close();
  }
});

for (const status of [301, 302, 303, 307, 308, 300]) {
  test('a ' + status + ' is refused and never followed, and the client does not retry it', async () => {
    const elsewhere = await serve((req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"last_updated":"01/01/2000"}'); });
    const s = await serve((req, res) => {
      res.writeHead(status, { location: 'http://127.0.0.1:' + elsewhere.port + '/api/v2/awards/last_updated/' });
      res.end();
    });
    try {
      const { cliFetch, refusals } = wrap(local(s.port));
      const r = await cliFetch(URL_);
      assert.equal(r.ok, false);
      assert.equal(r.status, 0, 'the shape a browser gives a refused redirect');
      assert.deepEqual(refusals, ['redirect']);
      assert.equal(elsewhere.hits.length, 0, 'the redirect target was never contacted');

      const client = createClient({ fetch: cliFetch, sleep: async () => {}, random: () => 0 });
      const result = await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the date' });
      assert.equal(result.ok, false);
      assert.equal(/** @type {any} */ (result).failure.kind, BAD_REQUEST);
      assert.equal(/** @type {any} */ (result).failure.retryable, false);
      assert.equal(/** @type {any} */ (result).failure.attempts, 1, 'a redirect is not weather: asking again gets the same redirect');
      assert.equal(s.hits.length, 2, 'one request by the wrapper test, one by the client, no retries');
      assert.equal(elsewhere.hits.length, 0);
    } finally {
      await s.close();
      await elsewhere.close();
    }
  });
}

test('a streamed body over the cap is refused mid read and never parsed; the client calls it malformed and does not retry', async () => {
  const cap = 1024;
  const s = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    // No content length: the size is only discovered by reading.
    res.write('{"last_updated":"' + 'x'.repeat(cap));
    res.end('"}');
  });
  try {
    const { cliFetch, refusals } = wrap(local(s.port), { cap });
    const r = await cliFetch(URL_);
    await assert.rejects(() => r.json(), /size cap/);
    assert.deepEqual(refusals, ['body-cap']);
    const client = createClient({ fetch: cliFetch, sleep: async () => {}, random: () => 0 });
    const result = /** @type {any} */ (await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the date' }));
    assert.equal(result.failure.kind, MALFORMED_RESPONSE);
    assert.equal(result.failure.attempts, 1);
  } finally {
    await s.close();
  }
});

test('a declared length over the cap is refused before the body is read; exactly at the cap is read', async () => {
  const cap = 1024;
  const body = '{"last_updated":"' + 'y'.repeat(cap - 20) + '"}';
  const exact = body.padEnd(cap, ' ');
  assert.equal(Buffer.byteLength(exact), cap);
  const s = await serve((req, res) => {
    const big = req.url.includes('big');
    const text = big ? exact + ' ' : exact;
    res.writeHead(200, { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(text)) });
    res.end(text);
  });
  try {
    const { cliFetch, refusals } = wrap(local(s.port), { cap });
    const over = await cliFetch(URL_ + '?big');
    await assert.rejects(() => over.json(), /size cap/);
    assert.deepEqual(refusals, ['body-cap']);
    const at = await cliFetch(URL_);
    assert.equal((await at.json()).last_updated.length, cap - 20);
  } finally {
    await s.close();
  }
});

test('the production cap is four mebibytes', () => {
  assert.equal(BODY_CAP_BYTES, 4 * 1024 * 1024);
});

test('a body that is not JSON is not read; the client calls it malformed and does not retry', async () => {
  const s = await serve((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<html>{"last_updated":"09/21/2026"}</html>');
  });
  try {
    const { cliFetch, refusals } = wrap(local(s.port));
    const r = await cliFetch(URL_);
    await assert.rejects(() => r.json(), /not JSON/);
    assert.deepEqual(refusals, ['content-type']);
    const client = createClient({ fetch: cliFetch, sleep: async () => {}, random: () => 0 });
    const result = /** @type {any} */ (await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the date' }));
    assert.equal(result.failure.kind, MALFORMED_RESPONSE);
    assert.equal(result.failure.attempts, 1);
  } finally {
    await s.close();
  }
  assert.equal(isJsonContentType('application/json'), true);
  assert.equal(isJsonContentType('Application/JSON; charset=utf-8'), true);
  assert.equal(isJsonContentType('application/problem+json'), true);
  assert.equal(isJsonContentType('text/json'), false);
  assert.equal(isJsonContentType(null), false);
});

for (const status of [204, 205]) {
  test('a ' + status + ' labelled JSON is an answer with nothing in it: malformed once, never retried as a dropped connection', async () => {
    const s = await serve((req, res) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end();
    });
    try {
      const { cliFetch, refusals } = wrap(local(s.port));
      const r = await cliFetch(URL_);
      assert.equal(r.status, status, 'the status travels on unchanged');
      await assert.rejects(() => r.json(), SyntaxError);
      assert.deepEqual(refusals, []);
      const client = createClient({ fetch: cliFetch, sleep: async () => {}, random: () => 0 });
      const result = /** @type {any} */ (await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the date' }));
      assert.equal(result.failure.kind, MALFORMED_RESPONSE, 'the host answered, so it was reached');
      assert.equal(result.failure.attempts, 1);
      assert.equal(s.hits.length, 2, 'one request by the wrapper test, one by the client, no retries');
    } finally {
      await s.close();
    }
  });
}

test('a server error keeps its status, so the client can retry it as it always has', async () => {
  let n = 0;
  const s = await serve((req, res) => {
    n += 1;
    if (n < 3) { res.writeHead(503, { 'content-type': 'text/html' }); res.end('busy'); return; }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"last_updated":"09/21/2026"}');
  });
  try {
    const { cliFetch } = wrap(local(s.port));
    const client = createClient({ fetch: cliFetch, sleep: async () => {}, random: () => 0 });
    const result = /** @type {any} */ (await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the date' }));
    assert.equal(result.ok, true);
    assert.equal(result.attempts, 3);
  } finally {
    await s.close();
  }
});

test('the run signal aborts a request in flight, and so does the request signal', async () => {
  const s = await serve(() => { /* never answers */ });
  try {
    const run = new AbortController();
    const { cliFetch } = wrap(local(s.port), { signal: run.signal });
    const pending = cliFetch(URL_);
    setTimeout(() => run.abort(), 20);
    await assert.rejects(pending, (e) => /abort/i.test(String(e && (e.name + e.message))));

    const { cliFetch: second } = wrap(local(s.port));
    const own = new AbortController();
    const pending2 = second(URL_, { signal: own.signal });
    setTimeout(() => own.abort(), 20);
    await assert.rejects(pending2, (e) => /abort/i.test(String(e && (e.name + e.message))));

    const client = createClient({ fetch: wrap(local(s.port), { signal: run.signal }).cliFetch, sleep: async () => {} });
    const result = /** @type {any} */ (await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the date', signal: run.signal }));
    assert.equal(result.failure.kind, ABORTED);
  } finally {
    await s.close();
  }
});

test('any other origin is refused before a socket opens', async () => {
  const s = await serve((req, res) => { res.end('{}'); });
  try {
    const { cliFetch } = wrap(local(s.port));
    for (const url of ['https://example.invalid/api/v2/', 'http://api.usaspending.gov/api/v2/', 'https://api.usaspending.gov.example.invalid/', API_ORIGIN]) {
      await assert.rejects(() => cliFetch(url), TypeError, url);
    }
    assert.equal(s.hits.length, 0);
  } finally {
    await s.close();
  }
});
