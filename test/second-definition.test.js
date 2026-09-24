// THE SECOND DEFINITION AND THE ONE ENTITY BREAKDOWN, WITHOUT A DOCUMENT.
//
// src/api/second-definition.js is where the page and the command line fetch both arms, refuse
// when either is missing, and compute the gap. The entity breakdown it needs is also the third arm
// of the reconciliation, and the page used to page it twice. The last test drives the REAL page
// over the REAL api and the recorded responses and counts the requests, so a regression to two
// fetches fails here rather than quietly doubling the load on a host with no published limit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  nameMatchText, fetchEntityBreakdown, fetchSecondDefinitionArms, secondDefinition,
  SECOND_DEFINITION_WHAT,
} from '../src/api/second-definition.js';
import { createApi } from '../src/api/api.js';
import { boot } from '../src/ui/app.js';
import { renderClaim } from '../src/core/claim.js';
import { failure, UPSTREAM_ERROR, MALFORMED_RESPONSE } from '../src/query/failure.js';
import { createDocument } from './helpers/mini-dom.js';
import { fakeClient } from './helpers/fake-client.js';
import { REGION_IDS, testIdentity, TEST_AS_OF } from './helpers/ui-fixtures.js';

const NAMED_OK = Object.freeze({
  ok: true,
  rows: [
    { name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', amount: 900, code: null, id: null },
    { name: 'AN ENTITY IN THE GAP', uei: 'TESTOTHER001', amount: 250, code: null, id: null },
  ],
  total: 1150,
});
const BY_ID_OK = Object.freeze({
  ok: true,
  rows: [{ name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', amount: 900, code: null, id: null }],
  total: 900,
});

/** An api with the two methods this module calls, recording every call. */
function recordingApi(named = NAMED_OK, byId = BY_ID_OK) {
  const calls = { nameMatchTotal: [], entityBreakdown: [] };
  return {
    calls,
    nameMatchTotal: async (args) => { calls.nameMatchTotal.push(args); return named; },
    entityBreakdown: async (args) => { calls.entityBreakdown.push(args); return byId; },
  };
}

test('the name match runs on what the reader typed, and on the resolved name only when nothing was', () => {
  const identity = testIdentity();
  assert.equal(nameMatchText('test parent', identity), 'test parent');
  assert.equal(nameMatchText('', identity), identity.name);
  assert.equal(nameMatchText(undefined, identity), identity.name);
});

test('the entity breakdown is asked for on the identity\'s own year, set and parent id', async () => {
  const api = recordingApi();
  const controller = new AbortController();
  const onCold = () => {};
  await fetchEntityBreakdown(api, testIdentity(), { signal: controller.signal, onCold });
  assert.deepEqual(api.calls.entityBreakdown, [{
    recipientId: 'test-recipient-id', fiscalYear: 2025, awardTypeSetId: 'contracts',
    signal: controller.signal, onCold,
  }]);
});

test('A BREAKDOWN ALREADY IN FLIGHT IS AWAITED, NOT FETCHED AGAIN; without one it is fetched once', async () => {
  const handed = recordingApi();
  const inFlight = Promise.resolve(BY_ID_OK);
  const arms = await fetchSecondDefinitionArms(handed, {
    identity: testIdentity(), queryText: 'test parent', breakdown: inFlight,
  });
  assert.equal(handed.calls.entityBreakdown.length, 0, 'a breakdown in hand was paged again');
  assert.equal(arms.byId, BY_ID_OK);
  assert.equal(arms.named, NAMED_OK);
  const [asked] = handed.calls.nameMatchTotal;
  assert.equal(asked.text, 'test parent');
  assert.equal(asked.fiscalYear, 2025);
  assert.equal(asked.awardTypeSetId, 'contracts', 'both arms on the same award type set');
  assert.equal(asked.sourceAsOf, TEST_AS_OF);

  const fresh = recordingApi();
  await fetchSecondDefinitionArms(fresh, { identity: testIdentity(), queryText: '', breakdown: null });
  assert.equal(fresh.calls.entityBreakdown.length, 1);
  assert.equal(fresh.calls.nameMatchTotal[0].text, 'TEST PARENT ENTITY');
});

test('BOTH ARMS OR NOTHING, and the kind of refusal says whether asking again can help', () => {
  const identity = testIdentity();
  const ok = secondDefinition({ named: NAMED_OK, byId: BY_ID_OK, identity });
  assert.equal(ok.ok, true);
  assert.equal(renderClaim(ok.delta.parentRollupTotalClaim).valueText, '$900.00 obligated',
    'definition one is the breakdown under the parent id, not the profile total');
  assert.equal(renderClaim(ok.delta.deltaClaim).valueText, '$250.00 obligated');
  assert.deepEqual(ok.delta.gapEntities.map((g) => g.name), ['AN ENTITY IN THE GAP']);

  const namedDown = failure(UPSTREAM_ERROR, 'the name match total');
  const r1 = secondDefinition({ named: { ok: false, failure: namedDown }, byId: BY_ID_OK, identity });
  assert.deepEqual(r1, { ok: false, armFailed: true, failure: namedDown });

  const byIdDown = failure(UPSTREAM_ERROR, 'the entity breakdown');
  const r2 = secondDefinition({ named: NAMED_OK, byId: { ok: false, failure: byIdDown }, identity });
  assert.deepEqual(r2, { ok: false, armFailed: true, failure: byIdDown });
  assert.equal(r2.delta, undefined, 'half a comparison carries no figure');

  const r3 = secondDefinition({ named: { ok: true, rows: null, total: 0 }, byId: BY_ID_OK, identity });
  assert.equal(r3.ok, false);
  assert.equal(r3.armFailed, false, 'a defect in arms that did arrive is not worth asking again');
  assert.equal(r3.failure.kind, MALFORMED_RESPONSE);
  assert.equal(r3.failure.what, SECOND_DEFINITION_WHAT);
});

test('the three arm reconciliation reuses a breakdown it is handed rather than paging it again', async () => {
  const { client, calls } = fakeClient({ '/api/v2/search/spending_by_category/': { json: {} } });
  const api = createApi({ client });
  const three = await api.reconcileThreeWays({
    identity: testIdentity(),
    parentReportedTotal: 1000,
    sourceAsOf: TEST_AS_OF,
    breakdown: Promise.resolve({ ok: true, rows: [{ amount: 1000 }], total: 1000 }),
  });
  assert.equal(calls.length, 0, 'the breakdown was paged again');
  assert.equal(three.ok, true);
  assert.equal(three.armsMissing, false);
  assert.equal(three.reconciliation.arms.length, 3);
});

/* ------------------------------------------------------------------------------------------ *
 * The real page over the real api over the recorded responses.
 * ------------------------------------------------------------------------------------------ */

const root = new URL('../', import.meta.url);
const recorded = (name) => JSON.parse(readFileSync(fileURLToPath(new URL('test/fixtures/api/' + name, root)), 'utf8'));

/** Longest matching "METHOD /path" route wins; every call is recorded with its body. */
function transport(bodies) {
  const calls = [];
  let clock = 0;
  const fetchImpl = async (url, init) => {
    const method = (init && init.method) || 'GET';
    const signature = method + ' ' + String(url).replace('https://api.usaspending.gov', '');
    calls.push({ signature, body: init && init.body ? JSON.parse(init.body) : null });
    const key = Object.keys(bodies).filter((k) => signature.includes(k)).sort((a, b) => b.length - a.length)[0];
    if (key === undefined) return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => bodies[key] };
  };
  return {
    calls,
    clientDeps: { fetch: fetchImpl, now: () => clock, sleep: async (ms) => { clock += ms; }, random: () => 0.5 },
  };
}

test('THE ENTITY BREAKDOWN IS PAGED ONCE PER SUBJECT, and both of its consumers still get it', async () => {
  const t = transport({
    'GET /api/v2/awards/last_updated/': recorded('last-updated.json'),
    'GET /api/v2/recipient/children/': recorded('recipient-children-fy2025.json'),
    'GET /api/v2/recipient/': recorded('recipient-profile-parent-fy2025.json'),
    'POST /api/v2/recipient/': recorded('recipient-list-lockheed.json'),
    'POST /api/v2/search/spending_over_time/': recorded('spending-over-time-fy2016-2025.json'),
    'POST /api/v2/search/spending_by_category/recipient/': recorded('category-recipient-all-fy2025.json'),
    'POST /api/v2/search/spending_by_category/': recorded('category-awarding-agency-fy2025.json'),
    'POST /api/v2/search/spending_by_award/': { results: [], page_metadata: { hasNext: false } },
  });
  const doc = createDocument(REGION_IDS);
  const app = boot(doc, {
    api: createApi({ clientDeps: t.clientDeps }),
    now: () => new Date(Date.UTC(2026, 8, 22)),
    loadIndexText: async () => '',
  });
  await app.search('lockheed martin');
  const settle = async () => { for (let i = 0; i < 12; i += 1) await new Promise((r) => setTimeout(r, 0)); };
  await settle();
  // Sixteen parent records match, so the page refuses and the subject is picked here, by a click.
  const row = doc.getElementById('panel-chooser').querySelectorAll('tr')
    .find((tr) => tr.textContent.includes('ZFN2JJXBLZT3'));
  assert.ok(row, 'the recorded parent is not offered in the chooser');
  row.querySelector('button').dispatch('click');
  await settle();

  const recipientDimension = t.calls.filter((c) => c.signature.includes('/spending_by_category/recipient/'));
  const byId = recipientDimension.filter((c) => c.body && c.body.filters && c.body.filters.recipient_id);
  const byName = recipientDimension.filter((c) => c.body && c.body.filters && c.body.filters.recipient_search_text);
  assert.equal(byId.length, 1, 'the entity breakdown under the parent id was paged ' + byId.length + ' times');
  assert.equal(byName.length, 1, 'the name match is its own request');

  assert.match(doc.getElementById('panel-definition').textContent, /Two definitions of the company/,
    'the second definition never got its breakdown');
  assert.match(doc.getElementById('panel-rollup').textContent, /three ways/,
    'the third reconciliation arm never got its breakdown');
});
