// THE QUERY LAYER: the three hard rules, the retry policy, the endpoint contract.
//
// Trap 1, trap 2, trap 3 and the measured 502 and 504 behaviour are all here, because these are
// the tests that are the difference between a correct page and a libellous one.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { API_ORIGIN, MAX_CONCURRENCY, MAX_PAGE_LIMIT, SUBAWARDS } from '../src/core/constants.js';
import {
  requireFiscalYear, fiscalYearRange, timePeriod, fiscalYearSpan, fiscalYearOf, fiscalYearWindow,
} from '../src/query/fiscal-year.js';
import { SOURCE_AS_OF_UNAVAILABLE } from '../src/api/source-date.js';
import { CHANGE_UNAVAILABLE } from '../src/analysis/over-time.js';
import { buildAwardSearchBody, filterRowsToEntitySet, AWARD_FIELDS } from '../src/query/award-query.js';
import {
  url, recipientProfileRequest, recipientChildrenRequest, lastUpdatedRequest, awardDetailRequest,
  spendingOverTimeRequest, spendingByCategoryRequest, spendingByAwardCountRequest,
  recipientListRequest, recipientAutocompleteRequest,
  validateRecipientProfile, validateRecipientChildren, validateSpendingOverTime,
  validateSpendingByCategory, validateSpendingByAward, validateAwardDetail, validateLastUpdated,
  validateRecipientList, assertUei, MalformedResponse,
} from '../src/query/endpoints.js';
import {
  RETRYABLE_STATUS, DEFAULT_POLICY, TIMEOUTS, shouldRetry, backoffWindowMs, backoffDelayMs,
  parseRetryAfterMs, retryPlan,
} from '../src/query/retry.js';
import {
  failure, isFailure, failureMessage, kindForStatus, FAILURE_KINDS,
  UPSTREAM_ERROR, TIMEOUT, RATE_LIMITED, BAD_REQUEST, MALFORMED_RESPONSE, INCOMPLETE_ROLLUP,
} from '../src/query/failure.js';
import { createClient, assertSameOrigin } from '../src/query/client.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------------------------------------------------------------------------------------
 * TRAP 1. The award search endpoint ignores a recipient id filter.
 * ------------------------------------------------------------------------------------------- */

test('TRAP 1: the award query builder has no recipient id parameter anywhere in the file', async () => {
  const src = await readFile(path.join(REPO, 'src', 'query', 'award-query.js'), 'utf8');
  assert.ok(!src.includes('recipient_id'),
    'the award search endpoint silently ignores that filter and returns another company awards, '
    + 'so the field name does not appear in this module at all, comments included');
});

test('TRAP 1: the award search body filters by search text only, one item', () => {
  const body = buildAwardSearchBody({
    recipientSearchText: 'LOCKHEED MARTIN CORPORATION',
    fiscalYear: 2025,
    awardTypeSetId: 'contracts',
    limit: 40,
  });
  assert.deepEqual(body.filters.recipient_search_text, ['LOCKHEED MARTIN CORPORATION']);
  assert.equal(Object.prototype.hasOwnProperty.call(body.filters, 'recipient_id'), false);
  assert.equal(body.filters.subawards, false);
  assert.equal(body.subawards, SUBAWARDS);
  assert.deepEqual(body.filters.award_type_codes, ['A', 'B', 'C', 'D']);
  assert.deepEqual(body.fields, [...AWARD_FIELDS]);
  assert.equal(body.sort, 'Award Amount');
  assert.equal(body.order, 'desc');
});

test('TRAP 1: rows outside the resolved entity set are dropped and counted', () => {
  const rows = [
    { 'Recipient Name': 'LOCKHEED MARTIN CORPORATION', 'Award Amount': 10 },
    { 'Recipient Name': 'HUMANA GOVERNMENT BUSINESS INC', 'Award Amount': 51269205263.03 },
    { 'Recipient Name': 'SIKORSKY AIRCRAFT CORPORATION', 'Award Amount': 5 },
  ];
  const allowed = new Set(['LOCKHEED MARTIN CORPORATION', 'SIKORSKY AIRCRAFT CORPORATION']);
  const out = filterRowsToEntitySet(rows, allowed);
  assert.equal(out.kept.length, 2);
  assert.equal(out.excludedCount, 1);
  assert.equal(out.excluded[0]['Recipient Name'], 'HUMANA GOVERNMENT BUSINESS INC');
});

test('TRAP 1: an absent entity set is refused rather than treated as keep everything', () => {
  assert.throws(() => filterRowsToEntitySet([], new Set()), TypeError);
  assert.throws(() => filterRowsToEntitySet([], undefined), TypeError);
});

test('the counter test: the category builder DOES take the recipient id filter', () => {
  const req = spendingByCategoryRequest({
    dimension: 'awarding_agency',
    recipientId: 'abc-P',
    fiscalYear: 2025,
    awardTypeSetId: 'contracts',
  });
  assert.equal(req.body.filters.recipient_id, 'abc-P');
});

test('the category builder refuses both definitions at once', () => {
  assert.throws(() => spendingByCategoryRequest({
    dimension: 'recipient',
    recipientId: 'abc-P',
    recipientSearchText: 'LOCKHEED MARTIN',
    fiscalYear: 2025,
    awardTypeSetId: 'contracts',
  }), TypeError);
  assert.throws(() => spendingByCategoryRequest({
    dimension: 'recipient',
    fiscalYear: 2025,
    awardTypeSetId: 'contracts',
  }), TypeError);
});

/* ---------------------------------------------------------------------------------------------
 * TRAP 2 and TRAP 3. One explicit period, everywhere.
 * ------------------------------------------------------------------------------------------- */

test('TRAP 2: every request builder throws without an explicit fiscal year', () => {
  assert.throws(() => recipientProfileRequest('abc-P'), TypeError);
  assert.throws(() => recipientChildrenRequest('ABCDEFGHJKLM'), TypeError);
  assert.throws(() => buildAwardSearchBody({ recipientSearchText: 'X', awardTypeSetId: 'contracts' }), TypeError);
  assert.throws(() => spendingOverTimeRequest({ recipientId: 'abc-P', awardTypeSetId: 'contracts' }), TypeError);
  assert.throws(() => spendingByCategoryRequest({ dimension: 'psc', recipientId: 'a', awardTypeSetId: 'contracts' }), TypeError);
  assert.throws(() => spendingByAwardCountRequest({ recipientId: 'a', awardTypeSetId: 'contracts' }), TypeError);
});

test('TRAP 3: the query layer holds no rolling window literal', async () => {
  const files = ['client.js', 'endpoints.js', 'award-query.js', 'retry.js', 'failure.js', 'fiscal-year.js'];
  for (const name of files) {
    const src = await readFile(path.join(REPO, 'src', 'query', name), 'utf8');
    assert.ok(!/year\s*=\s*latest/.test(src), name + ' carries a rolling window request');
    assert.ok(!/["'`]latest["'`]/.test(src), name + ' carries the rolling window literal');
  }
});

test('a federal fiscal year runs October to September', () => {
  assert.deepEqual(fiscalYearRange(2025), { start_date: '2024-10-01', end_date: '2025-09-30' });
  assert.deepEqual(timePeriod(2025), [{ start_date: '2024-10-01', end_date: '2025-09-30' }]);
});

test('the fiscal year span is floored at the year the data starts', () => {
  assert.deepEqual(fiscalYearSpan(2010, 10), [2008, 2009, 2010]);
  assert.equal(fiscalYearSpan(2025, 10).length, 10);
  assert.equal(fiscalYearSpan(2025, 10)[0], 2016);
});

test('a future or pre floor fiscal year is refused', () => {
  assert.throws(() => requireFiscalYear(2007, 't'), RangeError);
  assert.throws(() => requireFiscalYear(new Date().getUTCFullYear() + 5, 't'), RangeError);
});

test('THE NEXT FISCAL YEAR IS REFUSED UNTIL IT STARTS, not from January of the calendar year '
  + 'before it', () => {
  // The old bound was the calendar year plus one, which admitted FY2027 on 15 January 2026,
  // eight and a half months before FY2027 begins on 1 October 2026.
  const january = new Date(Date.UTC(2026, 0, 15));
  assert.throws(() => requireFiscalYear(2027, 't', january), /in the future/);
  assert.equal(requireFiscalYear(2026, 't', january), 2026, 'the current fiscal year is open');

  // The last day of FY2026 and the first day of FY2027, judged in UTC like fiscalYearOf.
  const lastDay = new Date(Date.UTC(2026, 8, 30, 23, 59));
  const firstDay = new Date(Date.UTC(2026, 9, 1, 0, 0));
  assert.throws(() => requireFiscalYear(2027, 't', lastDay), RangeError);
  assert.equal(requireFiscalYear(2027, 't', firstDay), 2027);
});

test('the fiscal year window lives in the query layer and bounds every picker the same way', () => {
  assert.equal(fiscalYearOf(new Date(Date.UTC(2026, 8, 30))), 2026);
  assert.equal(fiscalYearOf(new Date(Date.UTC(2026, 9, 1))), 2027);
  const w = fiscalYearWindow(new Date(Date.UTC(2026, 8, 24)));
  assert.deepEqual(w, { latest: 2026, defaultYear: 2025 });
  // Whatever the window offers, the request builders accept, on the same day.
  const today = new Date(Date.UTC(2026, 8, 24));
  assert.equal(requireFiscalYear(w.latest, 't', today), w.latest);
  assert.throws(() => requireFiscalYear(w.latest + 1, 't', today), RangeError);
  assert.deepEqual(fiscalYearWindow(new Date(Date.UTC(2008, 0, 1))), { latest: 2008, defaultYear: 2008 },
    'the default never falls under the floor');
});

/* ---------------------------------------------------------------------------------------------
 * TRAP 4 and TRAP 7. What the validators refuse to carry.
 * ------------------------------------------------------------------------------------------- */

test('TRAP 7: no projection carries the outlay field, even when the response does', () => {
  const overTime = validateSpendingOverTime({
    results: [
      { time_period: { fiscal_year: '2025' }, aggregated_amount: 64734245175.25, total_outlays: null },
    ],
  });
  assert.deepEqual(Object.keys(overTime.points[0]).sort(), ['fiscalYear', 'obligations']);
  assert.equal(overTime.points[0].obligations, 64734245175.25);

  const category = validateSpendingByCategory({
    category: 'awarding_agency',
    results: [{ name: 'Department of Defense', code: null, id: 1, amount: 63941564049.57, total_outlays: null }],
    page_metadata: { hasNext: false },
  });
  assert.ok(!Object.keys(category.rows[0]).includes('total_outlays'));
});

test('TRAP 4: the recipient list projection carries no amount at all', () => {
  const out = validateRecipientList({
    results: [{ id: 'abc-P', uei: 'ABCDEFGHJKLM', name: 'LOCKHEED MARTIN CORPORATION', recipient_level: 'P', amount: 61964720403.63 }],
  });
  assert.deepEqual(Object.keys(out.candidates[0]).sort(), ['level', 'name', 'recipientId', 'uei']);
  assert.ok(!('amount' in out.candidates[0]));
});

test('a validator throws rather than guessing when a contracted field is absent', () => {
  assert.throws(() => validateRecipientProfile({ uei: 'ABCDEFGHJKLM' }), MalformedResponse);
  assert.throws(() => validateSpendingOverTime({ results: 'nope' }), MalformedResponse);
  assert.throws(() => validateAwardDetail({ generated_unique_award_id: 'x' }), MalformedResponse);
  assert.throws(() => validateLastUpdated({}), MalformedResponse);
});

test('the profile and children projections carry what the rollup arithmetic needs', () => {
  const profile = validateRecipientProfile({
    recipient_id: 'abc-P',
    uei: 'ABCDEFGHJKLM',
    name: 'LOCKHEED MARTIN CORPORATION',
    recipient_level: 'P',
    total_transaction_amount: 65405410468.25,
    total_transactions: 1234,
    alternate_names: ['SIKORSKY AIRCRAFT CORPORATION'],
  });
  assert.equal(profile.totalObligations, 65405410468.25);
  assert.equal(profile.totalTransactions, 1234);
  assert.equal(profile.alternateNames.length, 1);

  const children = validateRecipientChildren([
    { uei: 'AAAAAAAAAAAA', name: 'CHILD ONE', amount: 1.5 },
    { uei: 'BBBBBBBBBBBB', name: 'CHILD TWO', amount: 2.5 },
  ]);
  assert.equal(children.count, 2);
  assert.equal(children.children[0].amount, 1.5);
});

test('an internally inconsistent competition record is flagged, not corrected', () => {
  const detail = validateAwardDetail({
    generated_unique_award_id: 'CONT_AWD_X',
    piid: 'DEAC0584OR21400',
    latest_transaction_contract_data: {
      extent_competed_description: 'FULL AND OPEN COMPETITION',
      number_of_offers_received: '0',
      solicitation_procedures_description: 'NEGOTIATED PROPOSAL',
      type_set_aside_description: 'NONE',
    },
  });
  assert.equal(detail.offersReceived, 0);
  assert.equal(detail.inconsistent, true, 'full and open competition with no offers received is a '
    + 'contradiction in the source record, and it is shown as reported with a visible exclusion '
    + 'rather than quietly fixed');
});

test('an award row projection names the value as award value, not obligations', () => {
  const out = validateSpendingByAward({
    results: [{
      'Award ID': 'N0001917C0001',
      'Recipient Name': 'LOCKHEED MARTIN CORPORATION',
      'Award Amount': 35140000000,
      generated_internal_id: 'CONT_AWD_1',
    }],
    page_metadata: { hasNext: false },
  });
  assert.equal(out.rows[0].awardValue, 35140000000);
  assert.ok(!('obligations' in out.rows[0]));
});

/* ---------------------------------------------------------------------------------------------
 * ONE HOST.
 * ------------------------------------------------------------------------------------------- */

test('every request is on the one declared origin', () => {
  const requests = [
    recipientProfileRequest('abc-P', 2025),
    recipientChildrenRequest('ABCDEFGHJKLM', 2025),
    lastUpdatedRequest(),
    awardDetailRequest('CONT_AWD_1'),
    spendingOverTimeRequest({ recipientId: 'abc-P', fiscalYears: [2024, 2025], awardTypeSetId: 'contracts' }),
    spendingByCategoryRequest({ dimension: 'naics', recipientId: 'abc-P', fiscalYear: 2025, awardTypeSetId: 'all' }),
    spendingByAwardCountRequest({ recipientId: 'abc-P', fiscalYear: 2025, awardTypeSetId: 'contracts' }),
    recipientListRequest('LOCKHEED'),
    recipientAutocompleteRequest('LOCKHEED'),
  ];
  for (const r of requests) {
    assert.ok(r.url.startsWith(API_ORIGIN + '/'), r.id + ' is not on the declared origin');
    assert.doesNotThrow(() => assertSameOrigin(r.url));
  }
  assert.throws(() => url('api/v2/x'), TypeError);
  assert.throws(() => assertSameOrigin('https://data.sec.gov/x'), TypeError);
});

test('the origin written at the fetch call site matches the constant', async () => {
  const src = await readFile(path.join(REPO, 'src', 'query', 'client.js'), 'utf8');
  const m = /doFetch\('([^']+)'/.exec(src);
  assert.ok(m, 'the one fetch call site could not be found');
  assert.equal(m[1], API_ORIGIN, 'the literal at the call site and the declared constant disagree, '
    + 'which would make the host the network gate sees different from the host the code reaches');
});

test('a UEI is twelve characters and a malformed one is refused', () => {
  assert.equal(assertUei('ABCDEFGHJKLM', 't'), 'ABCDEFGHJKLM');
  assert.throws(() => assertUei('SHORT', 't'), TypeError);
  assert.throws(() => assertUei('abcdefghjklm', 't'), TypeError);
});

test('the page limit ceiling is enforced, because the API answers 422 above it', () => {
  assert.throws(() => buildAwardSearchBody({
    recipientSearchText: 'X', fiscalYear: 2025, awardTypeSetId: 'contracts', limit: MAX_PAGE_LIMIT + 1,
  }), RangeError);
});

/* ---------------------------------------------------------------------------------------------
 * RETRY AND BACKOFF, against the real 502 and 504 behaviour.
 * ------------------------------------------------------------------------------------------- */

test('the retryable statuses are the transient ones and nothing else', () => {
  assert.deepEqual([...RETRYABLE_STATUS], [429, 500, 502, 503, 504]);
  for (const s of [502, 504, 500, 503, 429]) {
    assert.equal(shouldRetry({ status: s }, 1), true, s + ' must be retried');
  }
  for (const s of [400, 403, 404, 422]) {
    assert.equal(shouldRetry({ status: s }, 1), false, s + ' is our own bad request, not weather');
  }
  assert.equal(shouldRetry({ networkError: true }, 1), true);
  assert.equal(shouldRetry({ aborted: true }, 1), false);
});

test('retries stop at the committed attempt ceiling', () => {
  assert.equal(shouldRetry({ status: 502 }, DEFAULT_POLICY.maxAttempts - 1), true);
  assert.equal(shouldRetry({ status: 502 }, DEFAULT_POLICY.maxAttempts), false);
});

test('backoff is exponential and capped', () => {
  assert.equal(backoffWindowMs(1), 400);
  assert.equal(backoffWindowMs(2), 800);
  assert.equal(backoffWindowMs(3), 1600);
  assert.equal(backoffWindowMs(20), DEFAULT_POLICY.maxDelayMs);
  assert.throws(() => backoffWindowMs(0), RangeError);
});

test('jitter is full jitter, uniform in the window', () => {
  assert.equal(backoffDelayMs(2, { random: () => 0 }), 0);
  assert.equal(backoffDelayMs(2, { random: () => 0.5 }), 400);
  assert.equal(backoffDelayMs(2, { random: () => 0.999 }), Math.round(0.999 * 800));
  assert.throws(() => backoffDelayMs(1, { random: () => 1 }), RangeError);
});

test('an explicit Retry-After outranks the guess but is capped', () => {
  assert.equal(parseRetryAfterMs('3'), 3000);
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs('not a date'), null);
  assert.equal(parseRetryAfterMs(new Date(1000000 + 5000).toUTCString(), 1000000) >= 4000, true);
  assert.equal(backoffDelayMs(1, { retryAfterMs: 999999 }), DEFAULT_POLICY.maxRetryAfterMs);
});

test('the heavy timeout exceeds the measured cold query time', () => {
  // A cold query on the heavy endpoints was measured in the tens of seconds, with the slowest
  // observed at roughly 42 seconds. A per attempt timeout under that turns a correct slow answer
  // into a wrong empty panel.
  assert.ok(TIMEOUTS.heavy.perAttemptMs > 42100, 'the heavy per attempt timeout would cut off a '
    + 'query that was measured completing successfully');
  assert.ok(TIMEOUTS.heavy.deadlineMs > TIMEOUTS.heavy.perAttemptMs);
  assert.ok(TIMEOUTS.fast.perAttemptMs < TIMEOUTS.heavy.perAttemptMs);
  const plan = retryPlan('heavy');
  assert.equal(plan.maxAttempts, 4);
  assert.deepEqual(plan.windowsMs, [400, 800, 1600]);
  assert.throws(() => retryPlan('medium'), RangeError);
});

/* ---------------------------------------------------------------------------------------------
 * FAILURE STATES.
 * ------------------------------------------------------------------------------------------- */

test('every failure kind has a sentence a reader can act on', () => {
  for (const kind of FAILURE_KINDS) {
    const f = failure(kind, 'the agency breakdown');
    assert.ok(isFailure(f));
    assert.ok(f.message.includes('the agency breakdown'), kind + ' does not name what is missing');
    assert.ok(f.message.length > 40, kind + ' message is too short to say anything useful');
  }
});

test('a failure is not a value and cannot be stringified into a figure', () => {
  const f = failure(UPSTREAM_ERROR, 'the agency breakdown');
  assert.throws(() => String(f), TypeError);
  assert.throws(() => `${f}`, TypeError);
  assert.ok(Object.isFrozen(f));
});

test('THE SHARED TEMPLATES NAME NO SURFACE. The page and the command line print the same failure '
  + 'sentences, the same as of notice and the same change reasons, so none of them may claim to '
  + 'be a browser or a page', () => {
  const sentences = [
    ...FAILURE_KINDS.map((kind) => failure(kind, 'the agency breakdown').message),
    SOURCE_AS_OF_UNAVAILABLE,
    ...Object.values(CHANGE_UNAVAILABLE),
  ];
  assert.ok(sentences.length >= FAILURE_KINDS.length + 2);
  for (const s of sentences) {
    assert.doesNotMatch(s, /\bbrowser\b/i, 'a shared sentence names the browser: ' + s);
    assert.doesNotMatch(s, /\bthis page\b|\bon every load\b|\bfigures below\b/i,
      'a shared sentence names the page: ' + s);
  }
});

test('an unnamed failure is refused, because a generic apology is not a failure state', () => {
  assert.throws(() => failure(UPSTREAM_ERROR, ''), TypeError);
  assert.throws(() => failure('SOMETHING_BROKE', 'a panel'), TypeError);
});

test('a suppressed rollup says how many parts arrived', () => {
  const f = failure(INCOMPLETE_ROLLUP, 'the subsidiary rollup', { parts: { arrived: 180, expected: 217 } });
  const msg = failureMessage(f);
  assert.ok(msg.includes('180 of 217'));
  assert.ok(msg.includes('suppressed'));
});

test('the status to failure mapping distinguishes their fault from ours', () => {
  assert.equal(kindForStatus(502), UPSTREAM_ERROR);
  assert.equal(kindForStatus(504), UPSTREAM_ERROR);
  assert.equal(kindForStatus(429), RATE_LIMITED);
  assert.equal(kindForStatus(422), BAD_REQUEST);
  assert.equal(kindForStatus(404), BAD_REQUEST);
});

/* ---------------------------------------------------------------------------------------------
 * THE CLIENT, driven with an injected fetch so the whole ladder runs in milliseconds.
 * ------------------------------------------------------------------------------------------- */

function fakeResponse(status, body, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => headers[k.toLowerCase()] === undefined ? null : headers[k.toLowerCase()] },
    json: async () => body,
  };
}

function harness(statuses, bodies = {}) {
  const calls = [];
  const slept = [];
  let t = 0;
  const client = createClient({
    fetch: async (u) => {
      calls.push(u);
      const s = statuses[calls.length - 1];
      if (s === 'network') throw new Error('network down');
      return fakeResponse(s, bodies[calls.length - 1] === undefined ? { last_updated: '09/21/2026' } : bodies[calls.length - 1]);
    },
    now: () => t,
    sleep: async (ms) => { slept.push(ms); t += ms; },
    random: () => 0.5,
  });
  return { client, calls, slept, advance: (ms) => { t += ms; } };
}

test('THE MEASURED CASE: 502 then 504 then 200 on the same query succeeds', async () => {
  const { client, calls, slept } = harness([502, 504, 200]);
  const result = await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the source date' });
  assert.equal(result.ok, true);
  assert.equal(result.value.sourceAsOf, '09/21/2026');
  assert.equal(calls.length, 3);
  assert.deepEqual(slept, [200, 400], 'full jitter at the pinned midpoint of each window');
});

test('a run of server errors ends in a named failure, never a spinner', async () => {
  const { client, calls } = harness([502, 502, 502, 502]);
  const result = await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the source date' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, UPSTREAM_ERROR);
  assert.equal(result.failure.attempts, DEFAULT_POLICY.maxAttempts);
  assert.equal(calls.length, DEFAULT_POLICY.maxAttempts);
  assert.ok(result.failure.message.includes('the source date'));
  assert.ok(result.failure.detail.includes('attempts'));
});

test('a 422 is not retried, because it is our own bad request', async () => {
  const { client, calls } = harness([422]);
  const result = await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the source date' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, BAD_REQUEST);
  assert.equal(calls.length, 1);
  assert.equal(result.failure.retryable, false);
});

test('a network error is retried and then named honestly', async () => {
  const { client, calls } = harness(['network', 'network', 'network', 'network']);
  const result = await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the source date' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, 'NETWORK_UNREACHABLE');
  assert.equal(calls.length, DEFAULT_POLICY.maxAttempts);
});

test('a response that does not match the contract is a named failure, not a guess', async () => {
  const { client } = harness([200], { 0: { nothing: 'useful' } });
  const result = await client.request(lastUpdatedRequest(), validateLastUpdated, { what: 'the source date' });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, MALFORMED_RESPONSE);
  assert.equal(result.failure.retryable, false);
});

test('the concurrency cap is real and cannot be raised at a call site', async () => {
  const { client } = harness([]);
  let live = 0;
  let peak = 0;
  const tasks = Array.from({ length: 40 }, () => async () => {
    live += 1;
    peak = Math.max(peak, live);
    await Promise.resolve();
    live -= 1;
    return 1;
  });
  const out = await client.mapWithCap(tasks);
  assert.equal(out.length, 40);
  assert.ok(peak <= MAX_CONCURRENCY, 'peak concurrency was ' + peak);
  await assert.rejects(async () => client.mapWithCap(tasks, MAX_CONCURRENCY + 1), RangeError);
});
