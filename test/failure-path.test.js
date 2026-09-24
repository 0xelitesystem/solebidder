// THE FLAKY API, DRIVEN ALL THE WAY TO THE DOM, WITH AN INJECTED TRANSPORT.
//
// WHAT THIS FILE PROVES THAT test/query.test.js DOES NOT. That file drives the client and stops
// at the client: it proves the ladder climbs and that a run of server errors ends in a named
// Failure object. It cannot say what a READER sees, and what a reader sees is the whole claim.
// The three wrong answers named in src/query/failure.js are all render layer outcomes:
//
//   a spinner that spins forever, which reads as broken,
//   a spinner that implies progress it cannot see, which is a lie,
//   an empty chart, which reads as a real zero.
//
// So every test here boots the REAL page against the REAL api facade over the REAL client, and
// the only thing replaced is the transport at the bottom: one function standing where fetch
// stands. Nothing here touches the network, and the whole retry ladder, with backoff windows
// measured in seconds, runs in milliseconds because the clock, sleep and the jitter source are
// injected alongside it.
//
// THE SEQUENCES ARE THE MEASURED ONES. Real 502 and 504 responses arrived before a 200 on the
// same query on the same day, which is why 502 then 504 then 200 appears below as the ordinary
// case rather than the exotic one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { boot } from '../src/ui/app.js';
import { createApi } from '../src/api/api.js';
import { DEFAULT_POLICY } from '../src/query/retry.js';
import { createDocument } from './helpers/mini-dom.js';
import { REGION_IDS } from './helpers/ui-fixtures.js';

const root = new URL('../', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(fileURLToPath(new URL('test/fixtures/api/' + name, root)), 'utf8'));

/**
 * The transport. A route key is "METHOD /path" and it is matched as a substring of the actual
 * "METHOD url", LONGEST KEY FIRST. Both halves matter:
 *
 *   The method, because two different endpoints live at /api/v2/recipient/. POST to it is the
 *   entity LIST and GET to it with an id is the parent PROFILE, and a router that matched on the
 *   path alone would hand the list response to the profile validator and report a malformed
 *   response for a call nobody broke.
 *
 *   The longest key, because /api/v2/awards/last_updated/ is a strict extension of
 *   /api/v2/awards/, and first match wins would make the route table order dependent.
 *
 * Each route answers a SEQUENCE, one entry per attempt, so "two upstream errors then a success on
 * the same query" is expressible as data rather than as a counter somebody has to maintain.
 *
 * It records every call and every sleep, which is what turns "it was retried with backoff" from
 * a reassurance into an assertion with numbers in it.
 *
 * @param {Record<string, Array<number|'network'>>} script Status per attempt, per route.
 * @param {Record<string, any>} bodies Success body per route.
 */
function transport(script, bodies) {
  /** @type {{url:string, method:string}[]} */
  const calls = [];
  /** @type {number[]} */
  const slept = [];
  /** @type {Map<string, number>} */
  const cursor = new Map();
  let clock = 0;

  /** @type {string[]} */
  const unrouted = [];

  // THE SIGNATURE IS METHOD PLUS PATH, NOT METHOD PLUS URL. The client calls the absolute URL, so
  // a key written as "POST /api/v2/recipient/" never appears in "POST https://host/api/v2/...".
  // That mismatch does not announce itself: the router throws, the client catches the throw as a
  // network error, and the ladder climbs four rungs against a route table nobody matched. So the
  // origin is stripped here and every unmatched call is recorded for the assertion below.
  const signatureOf = (method, url) => method + ' ' + url.replace('https://api.usaspending.gov', '');

  const routeFor = (signature) => {
    const key = Object.keys(script)
      .filter((k) => signature.includes(k))
      .sort((a, b) => b.length - a.length)[0];
    if (key === undefined) {
      unrouted.push(signature);
      return null;
    }
    return key;
  };

  const fetchImpl = async (url, init) => {
    const text = String(url);
    const method = (init && init.method) || 'GET';
    calls.push({ url: text, method });
    const key = routeFor(signatureOf(method, text));
    if (key === null) {
      // Answered as a 404, which is not retryable, so an unrouted call fails fast and loudly
      // instead of being mistaken for four rungs of a real ladder.
      return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    }
    const at = cursor.get(key) === undefined ? 0 : cursor.get(key);
    cursor.set(key, at + 1);
    const statuses = script[key];
    const status = statuses[Math.min(at, statuses.length - 1)];
    if (status === 'network') throw new TypeError('fetch failed');
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => bodies[key],
    };
  };

  return {
    calls,
    slept,
    unrouted,
    countFor: (key) => calls.filter((c) => signatureOf(c.method, c.url).includes(key)).length,
    clientDeps: {
      fetch: fetchImpl,
      now: () => clock,
      sleep: async (ms) => { slept.push(ms); clock += ms; },
      // Full jitter is uniform in [0, window]. Pinning the source at the midpoint makes the
      // waited delays exactly half of each window, which is a number a test can assert instead
      // of a range it has to tolerate.
      random: () => 0.5,
    },
  };
}

/** Every route the page touches, answering 200 with a recorded response. */
function healthyScript() {
  return {
    script: {
      'GET /api/v2/awards/last_updated/': [200],
      'GET /api/v2/recipient/children/': [200],
      'GET /api/v2/recipient/': [200],
      'POST /api/v2/recipient/': [200],
      'POST /api/v2/search/spending_over_time/': [200],
      'POST /api/v2/search/spending_by_category/': [200],
      'POST /api/v2/search/spending_by_award/': [200],
      'POST /api/v2/search/spending_by_award_count/': [200],
      'GET /api/v2/awards/': [200],
    },
    bodies: {
      'GET /api/v2/awards/last_updated/': fixture('last-updated.json'),
      'GET /api/v2/recipient/children/': fixture('recipient-children-fy2025.json'),
      'GET /api/v2/recipient/': fixture('recipient-profile-parent-fy2025.json'),
      'POST /api/v2/recipient/': fixture('recipient-list-lockheed.json'),
      'POST /api/v2/search/spending_over_time/': fixture('spending-over-time-fy2016-2025.json'),
      'POST /api/v2/search/spending_by_category/': fixture('category-awarding-agency-fy2025.json'),
      'POST /api/v2/search/spending_by_award/': { results: [], page_metadata: { hasNext: false } },
      'POST /api/v2/search/spending_by_award_count/': fixture('award-count-fy2025.json'),
      'GET /api/v2/awards/': {},
    },
  };
}

/**
 * Boot the real page over the real api over the injected transport.
 * @param {ReturnType<typeof transport>} t
 */
function bootPage(t) {
  const doc = createDocument(REGION_IDS);
  const api = createApi({ clientDeps: t.clientDeps });
  const app = boot(doc, {
    api,
    now: () => new Date(Date.UTC(2026, 8, 22)),
    // The bundled index is not under test here and fetching it would need a seventh route.
    loadIndexText: async () => '',
  });
  return { doc, app };
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));
};

/**
 * EVERY CALL THE PAGE MADE HAD A ROUTE. An unrouted call is answered 404 above, and a 404 is a
 * BAD_REQUEST failure that looks a lot like a deliberate test of the failure path. Asserting the
 * list is empty is what stops a stale route table from quietly turning these tests into tests of
 * a page that could not reach anything.
 * @param {ReturnType<typeof transport>} t
 */
function assertFullyRouted(t) {
  assert.deepEqual(t.unrouted, [], 'the page called an endpoint this route table does not cover');
}

/* --------------------------------------------------------------------------------------------
 * 1. THE MEASURED RECOVERY. Two upstream faults and then an answer, on the same query.
 * ------------------------------------------------------------------------------------------ */

test('THE MEASURED CASE END TO END: 502 then 504 then 200 on the identity call paints the page, '
  + 'and the reader never learns the first two happened', async () => {
  const h = healthyScript();
  h.script['POST /api/v2/recipient/'] = [502, 504, 200];
  const t = transport(h.script, h.bodies);
  const { doc, app } = bootPage(t);

  await app.search('lockheed martin');
  await settle();

  const listCalls = t.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v2/recipient/'));
  assert.equal(listCalls.length, 3, 'the same query was attempted three times: 502, 504, then 200');

  // BACKOFF, NOT A TIGHT LOOP. The policy windows are 400 and 800 ms at the first two retries and
  // the jitter source is pinned at the midpoint, so the waits are exactly half of each.
  assert.deepEqual(t.slept, [200, 400],
    'full jitter at the pinned midpoint of the 400 ms and 800 ms windows');

  // And the page shows the answer rather than the weather.
  const chooser = doc.getElementById('panel-chooser').textContent;
  assert.doesNotMatch(chooser, /did not respond/i, 'a recovered request must not leave a failure on the page');
  assert.doesNotMatch(chooser, /Loading /, 'the skeleton was replaced by the answer');
  assert.match(chooser, /LOCKHEED MARTIN/i);
  assertFullyRouted(t);
});

/* --------------------------------------------------------------------------------------------
 * 2. THE LADDER IS SPENT. What the page says when retrying did not help.
 * ------------------------------------------------------------------------------------------ */

test('A RUN OF 502s ENDS IN THE HONEST FAILURE STATE ON THE PAGE: a named sentence, a retry that '
  + 'is offered because it is honest, and no chart, no zero and no spinner left behind', async () => {
  const h = healthyScript();
  h.script['POST /api/v2/recipient/'] = [502, 502, 502, 502];
  const t = transport(h.script, h.bodies);
  const { doc, app } = bootPage(t);

  await app.search('lockheed martin');
  await settle();

  const listCalls = t.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v2/recipient/'));
  assert.equal(listCalls.length, DEFAULT_POLICY.maxAttempts,
    'the ladder was climbed to its last rung before the page gave up');
  assert.deepEqual(t.slept, [200, 400, 800], 'three backoff waits, one before each retry');

  const region = doc.getElementById('panel-chooser');
  const text = region.textContent;

  // A NAMED SENTENCE, NAMING WHAT IS MISSING. Not "something went wrong".
  assert.match(text, /USAspending did not respond for the list of entities matching that name/);
  assert.match(text, /already retried/, 'the sentence says the retrying happened');
  assert.match(text, /Nothing is shown here rather than something incomplete/);
  assert.doesNotMatch(text, /something went wrong/i);

  // NO SPINNER THAT LIES. The skeleton that was mounted while the request was in flight is gone.
  assert.equal(region.querySelectorAll('.skeleton').length, 0,
    'a skeleton left on a failed panel is a spinner that spins forever');
  assert.doesNotMatch(text, /Loading the parent records/);

  // NO EMPTY CHART AND NO ZERO. An empty chart reads as a measured zero, which this is not.
  assert.equal(doc.querySelectorAll('svg').length, 0, 'a chart was drawn for data that never arrived');
  assert.doesNotMatch(text, /\$/, 'a currency figure appeared beside a failed request');
  assert.doesNotMatch(text, /\b0\b/, 'a zero appeared where the answer is that there is no figure');

  // IT IS AN ALERT, AND IT OFFERS THE ONE ACTION THAT IS HONEST HERE.
  assert.equal(region.querySelectorAll('[role="alert"]').length, 1);
  const buttons = region.querySelectorAll('button');
  assert.equal(buttons.length, 1);
  assert.match(buttons[0].textContent, /Retry this request/);
  assertFullyRouted(t);
});

test('THE RETRY BUTTON REALLY RETRIES, and a source that has recovered paints the page', async () => {
  const h = healthyScript();
  // Four failures spend the ladder; the fifth call, which only a retry can make, succeeds.
  h.script['POST /api/v2/recipient/'] = [502, 502, 502, 502, 200];
  const t = transport(h.script, h.bodies);
  const { doc, app } = bootPage(t);

  await app.search('lockheed martin');
  await settle();
  assert.match(doc.getElementById('panel-chooser').textContent, /did not respond/);

  const retry = doc.getElementById('panel-chooser').querySelectorAll('button')[0];
  retry.dispatch('click');
  await settle();

  const text = doc.getElementById('panel-chooser').textContent;
  assert.doesNotMatch(text, /did not respond/, 'the failure panel outlived the recovery');
  assert.match(text, /LOCKHEED MARTIN/i);
  assertFullyRouted(t);
});

/* --------------------------------------------------------------------------------------------
 * 3. NOT EVERYTHING IS RETRYABLE, AND THE PAGE SAYS SO RATHER THAN OFFERING A USELESS BUTTON.
 * ------------------------------------------------------------------------------------------ */

test('A 422 IS NOT RETRIED AND NO RETRY IS OFFERED, because retrying our own bad request just '
  + 'makes the same mistake more often', async () => {
  const h = healthyScript();
  h.script['POST /api/v2/recipient/'] = [422];
  const t = transport(h.script, h.bodies);
  const { doc, app } = bootPage(t);

  await app.search('lockheed martin');
  await settle();

  const listCalls = t.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v2/recipient/'));
  assert.equal(listCalls.length, 1, 'a 4xx that is ours was retried');
  assert.deepEqual(t.slept, [], 'nothing was waited for a request that will never succeed');

  const region = doc.getElementById('panel-chooser');
  assert.match(region.textContent, /USAspending rejected the request/);
  assert.match(region.textContent, /defect in this tool rather than anything you did/);
  assert.match(region.textContent, /Retrying will not change this/);
  assert.equal(region.querySelectorAll('button').length, 0, 'a retry button was offered for a request that cannot succeed');
  assertFullyRouted(t);
});

test('AN UNREACHABLE HOST IS RETRIED AND THEN NAMED, and the sentence says why there is no '
  + 'offline copy to fall back to', async () => {
  const h = healthyScript();
  h.script['POST /api/v2/recipient/'] = ['network', 'network', 'network', 'network'];
  const t = transport(h.script, h.bodies);
  const { doc, app } = bootPage(t);

  await app.search('lockheed martin');
  await settle();

  const listCalls = t.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v2/recipient/'));
  assert.equal(listCalls.length, DEFAULT_POLICY.maxAttempts);
  const text = doc.getElementById('panel-chooser').textContent;
  assert.match(text, /could not reach USAspending/);
  assert.match(text, /nothing is cached, so there is no offline copy/);
  assert.equal(doc.querySelectorAll('svg').length, 0);
  assertFullyRouted(t);
});

/* --------------------------------------------------------------------------------------------
 * 4. ONE PANEL FAILING IS ONE PANEL FAILING. DESIGN 6.3.
 * ------------------------------------------------------------------------------------------ */

test('A DEAD CATEGORY ENDPOINT COSTS ONE PANEL AND NOT THE PAGE, and the panel it costs says so '
  + 'in a sentence instead of drawing an empty chart', async () => {
  const h = healthyScript();
  h.script['POST /api/v2/search/spending_by_category/'] = [503, 503, 503, 503];
  const t = transport(h.script, h.bodies);
  const { doc, app } = bootPage(t);

  await app.search('lockheed martin');
  await settle();

  // Sixteen parent level records match this name, so the page refuses to pick one and shows the
  // chooser. That refusal is the design, and it means the subject is chosen HERE, by a click, the
  // same way a visitor chooses it.
  const pick = doc.getElementById('panel-chooser').querySelectorAll('button')[0];
  assert.ok(pick, 'the chooser offered no candidate to pick');
  pick.dispatch('click');
  await settle();
  await settle();

  // The identity resolved, so the page knows what it is about.
  assert.match(doc.getElementById('panel-subject').textContent, /LOCKHEED MARTIN/i);

  const mix = doc.getElementById('panel-mix');
  assert.match(mix.textContent, /USAspending did not respond/);
  assert.equal(mix.querySelectorAll('svg').length, 0, 'an empty chart was drawn for a failed panel');
  assert.equal(mix.querySelectorAll('.skeleton').length, 0, 'the skeleton outlived the request');

  // And the category endpoint really was retried to the end of the ladder for each dimension,
  // rather than one dimension failing and the rest being abandoned.
  const categoryCalls = t.countFor('POST /api/v2/search/spending_by_category/');
  assert.ok(categoryCalls >= DEFAULT_POLICY.maxAttempts,
    'the category endpoint was called ' + categoryCalls + ' times, fewer than one full ladder');
  assertFullyRouted(t);
});

/* --------------------------------------------------------------------------------------------
 * 5. THE DEADLINE. A source that answers nothing at all must not hold a tile open forever.
 * ------------------------------------------------------------------------------------------ */

test('THE LADDER IS BOUNDED IN ATTEMPTS AND IN TIME, so no tile can wait on a silent source '
  + 'indefinitely', async () => {
  const h = healthyScript();
  h.script['POST /api/v2/recipient/'] = [500, 500, 500, 500];
  const t = transport(h.script, h.bodies);
  const { app } = bootPage(t);

  await app.search('lockheed martin');
  await settle();

  const listCalls = t.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/api/v2/recipient/'));
  assert.equal(listCalls.length, DEFAULT_POLICY.maxAttempts,
    'the attempt count is capped by the policy and not by patience');
  const waited = t.slept.reduce((a, b) => a + b, 0);
  assert.ok(waited <= DEFAULT_POLICY.maxDelayMs * DEFAULT_POLICY.maxAttempts,
    'total backoff ' + waited + ' ms exceeded the ceiling the policy allows');
  assertFullyRouted(t);
});
