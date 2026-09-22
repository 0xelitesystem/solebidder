// THE API CLIENT LAYER. DESIGN C2, C3, C4, C5, 3.2, 6.3, 6.6 and traps 1, 2, 4, 6, 7, 11, 13.
//
// THE FIXTURES ARE RECORDED RESPONSES, not hand written shapes that agree with our assumptions.
// Everything under test/fixtures/api came off the live API on 2026-09-22 with the legacy vendor
// identifier stripped. The consequence that matters most is in the reconciliation tests below:
// the parent total and the child rollup really are one cent apart in the recorded data, so the
// test that publishes that cent is recomputing it rather than asserting a constant somebody
// typed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { fakeClient, fixture, REPO } from './helpers/fake-client.js';
import {
  buildTypeaheadIndex, assertStripped, serialiseIndex, parseIndex, searchIndex, buildPrefixMap,
  INDEX_FORMAT_VERSION, MAX_SUGGESTIONS,
} from '../src/api/typeahead-index.js';
import { createTypeahead, MIN_QUERY_LENGTH } from '../src/api/typeahead.js';
import { fetchSourceAsOf, SOURCE_AS_OF_UNAVAILABLE } from '../src/api/source-date.js';
import { fetchChildren, sumChildObligations } from '../src/api/children.js';
import { parentDetailClaims, fetchAwardCount, PROFILE_TOTAL_SET_NOTE } from '../src/api/parent.js';
import {
  fetchCategory, fetchCategoryTotal, sumRows, categoryRowClaims, nameMatchTotalClaim,
  MAX_CATEGORY_PAGES,
} from '../src/api/categories.js';
import { fetchObligationsByFiscalYear, assertObligationsOnly } from '../src/api/timeseries.js';
import { reconcileRollup, RESIDUAL_NOTE, ARM_NOT_COMPARABLE_NOTE } from '../src/api/reconcile.js';
import { createApi } from '../src/api/api.js';
import { renderClaim, isClaim } from '../src/core/claim.js';
import { hydrateIdentity } from '../src/identity/resolve.js';
import { scanText } from '../scripts/banned-vocabulary.mjs';

const PARENT_ID = 'b97d19b0-833c-8d8f-3a2c-157d04ea55ef-P';
const PARENT_UEI = 'ZFN2JJXBLZT3';

/** What the source reported for this parent at FY2025, to the cent. */
const PARENT_TOTAL = 65405410468.25;

const META = { fiscalYear: 2025, awardTypeSetId: 'all', sourceAsOf: '09/21/2026' };

async function subjectRoutes(overrides = {}) {
  return {
    '/api/v2/recipient/children/': { json: await fixture('recipient-children-fy2025.json') },
    'b97d19b0': { json: await fixture('recipient-profile-parent-fy2025.json') },
    '/api/v2/recipient/': { json: await fixture('recipient-list-lockheed.json') },
    'spending_by_category/recipient': { json: await fixture('category-recipient-all-fy2025.json') },
    'spending_by_category/awarding_agency': { json: await fixture('category-awarding-agency-fy2025.json') },
    'spending_over_time': { json: await fixture('spending-over-time-fy2016-2025.json') },
    'spending_by_award_count': { json: await fixture('award-count-fy2025.json') },
    'autocomplete/recipient': { json: await fixture('autocomplete-lockheed.json') },
    'awards/last_updated': { json: await fixture('last-updated.json') },
    ...overrides,
  };
}

function parentCandidate() {
  return {
    recipientId: PARENT_ID, uei: PARENT_UEI, name: 'LOCKHEED MARTIN CORP',
    level: 'PARENT', alternateNames: [], location: null,
  };
}

async function hydrated(awardTypeSetId = 'all', overrides = {}) {
  const { client } = fakeClient(await subjectRoutes(overrides));
  const result = await hydrateIdentity(client, {
    choice: { candidate: parentCandidate(), how: 'picked-from-list' },
    fiscalYear: 2025,
    awardTypeSetId,
    sourceAsOf: '09/21/2026',
  });
  assert.equal(result.ok, true);
  return result;
}

/* ---------------------------------------------------------------------------------------------
 * THE BUNDLED INDEX. DESIGN 3.2: amounts are stripped at build time.
 * ------------------------------------------------------------------------------------------- */

test('building the index reads the amounts to rank and writes none of them', () => {
  const index = buildTypeaheadIndex([
    { uei: 'ZFN2JJXBLZT3', name: 'LOCKHEED MARTIN CORP', amount: 61964720403.63 },
    { uei: 'NQV3T7DDKNT6', name: 'GOOGLE LLC', amount: 9151234.56 },
    { uei: 'N424F1LU4FK3', name: 'GOOGLE PUBLIC SECTOR LLC', amount: 38978161.4 },
  ]);
  assert.equal(index.v, INDEX_FORMAT_VERSION);
  assert.equal(index.rows.length, 3);
  assert.equal(index.rows[0][1], 'LOCKHEED MARTIN CORP', 'the largest ranks first');
  for (const row of index.rows) assert.equal(row.length, 2);
  const text = serialiseIndex(index);
  for (const amount of ['61964720403.63', '9151234.56', '38978161.4']) {
    assert.equal(text.includes(amount), false, 'an amount survived into the bundle');
  }
});

test('an index with a third element, or a number anywhere in a row, is refused', () => {
  assert.throws(() => assertStripped({ v: 1, rows: [['ZFN2JJXBLZT3', 'X', 1234]] }),
    /must be exactly two elements/);
  assert.throws(() => assertStripped({ v: 1, rows: [['ZFN2JJXBLZT3', 1234]] }),
    /must be two strings/);
  assert.throws(() => assertStripped({ v: 1, rows: [['ZFN2JJXBLZT3', 'X']], totals: [1] }),
    /unexpected key/);
  assert.throws(() => assertStripped({ v: 99, rows: [] }), /format version/);
});

test('a malformed identifier cannot enter the index', () => {
  const index = buildTypeaheadIndex([
    { uei: 'TOOSHORT', name: 'A', amount: 5 },
    { uei: 'ZFN2JJXBLZT3', name: 'B', amount: 4 },
    { uei: null, name: 'C', amount: 3 },
  ]);
  assert.equal(index.rows.length, 1);
  assert.equal(index.rows[0][0], 'ZFN2JJXBLZT3');
});

test('the index round trips through the bundle format', () => {
  const index = buildTypeaheadIndex([{ uei: 'ZFN2JJXBLZT3', name: 'LOCKHEED MARTIN CORP', amount: 1 }]);
  const back = parseIndex(serialiseIndex(index));
  assert.deepEqual(back.rows, index.rows);
});

test('search puts prefix matches first, then substring, and caps the list', () => {
  const rows = [];
  for (let i = 0; i < 40; i += 1) {
    rows.push({ uei: 'AAAAAAAAAA' + String(i).padStart(2, '0'), name: 'LOCKWOOD ' + i, amount: 40 - i });
  }
  rows.push({ uei: 'ZFN2JJXBLZT3', name: 'ACME LOCKWOOD PARTS', amount: 1 });
  const index = buildTypeaheadIndex(rows);
  const hits = searchIndex(index, 'lockwood', { prefixMap: buildPrefixMap(index) });
  assert.equal(hits.length, MAX_SUGGESTIONS);
  assert.ok(hits.every((h) => h.matched === 'prefix'));
  const narrow = searchIndex(index, 'lockwood p', { limit: 5 });
  assert.equal(narrow.length, 1);
  assert.equal(narrow[0].matched, 'substring');
  assert.equal(searchIndex(index, '', { limit: 5 }).length, 0);
});

test('if a bundled index has been generated it carries no figure and no vendor identifier', async () => {
  const file = path.join(REPO, 'src', 'data', 'typeahead-index.json');
  try {
    await stat(file);
  } catch {
    return; // Not generated in this checkout. The generator asserts the same thing on write.
  }
  const text = await readFile(file, 'utf8');
  const index = parseIndex(text);
  assert.ok(index.rows.length > 0);
  assert.equal(/\bduns\b/i.test(text), false);
  // No row may contain a bare decimal figure, which is what a leaked amount would look like.
  for (const row of index.rows) {
    assert.equal(/^\s*\d+(\.\d+)?\s*$/.test(row[1]), false);
  }
  // The bundle lands under src/, so it is shipped copy and the vocabulary gate reads it. This
  // asserts it against the gate's OWN scanner rather than a second opinion about the rules.
  assert.deepEqual(scanText(text, 'src/data/typeahead-index.json', 'shipped'), []);
});

test('the generator leaves out a name the shipped copy rules forbid, and counts it', async () => {
  const { partitionByShippedCopyRules } = await import('../scripts/build-typeahead-index.mjs');
  const rows = [
    { uei: 'ZFN2JJXBLZT3', name: 'LOCKHEED MARTIN CORP', amount: 3 },
    { uei: 'NQV3T7DDKNT6', name: 'STATE OF SOMEWHERE DEPARTMENT OF REVENUE', amount: 2 },
    { uei: 'N424F1LU4FK3', name: 'AN ORDINARY CONTRACTOR', amount: 1 },
  ];
  const out = partitionByShippedCopyRules(rows);
  assert.equal(out.keep.length, 2);
  assert.equal(out.excluded.length, 1);
  assert.equal(out.excluded[0].ruleId, 'revenue-claim');
  // It is left out of the CACHE, not out of the product: the live endpoint still answers for it.
  assert.equal(out.keep.some((r) => r.name.includes('DEPARTMENT OF')), false);
});

/* ---------------------------------------------------------------------------------------------
 * THE TYPEAHEAD. Bundled first, live second, and the difference is stated.
 * ------------------------------------------------------------------------------------------- */

test('a bundled hit carries an identifier; a live suggestion is text and says so', async () => {
  const index = buildTypeaheadIndex([{ uei: PARENT_UEI, name: 'LOCKHEED MARTIN CORP', amount: 1 }]);
  const { client, calls } = fakeClient(await subjectRoutes());
  const typeahead = createTypeahead({ index, client });

  const bundled = await typeahead.suggest('lockheed');
  assert.equal(bundled.source, 'bundled');
  assert.equal(calls.length, 0, 'a bundled hit costs no network call');
  assert.equal(bundled.suggestions[0].uei, PARENT_UEI);
  assert.equal(bundled.suggestions[0].needsResolution, false);

  const live = await typeahead.suggest('a name not in the bundle');
  assert.equal(live.source, 'live');
  assert.ok(live.suggestions.length > 0);
  for (const s of live.suggestions) {
    assert.equal(s.uei, null, 'the live endpoint returned a null identifier on every row');
    assert.equal(s.needsResolution, true);
  }
});

test('the typeahead says nothing below the minimum query length', async () => {
  const typeahead = createTypeahead({});
  const result = await typeahead.suggest('l'.repeat(MIN_QUERY_LENGTH - 1));
  assert.deepEqual(result.suggestions, []);
  assert.equal(result.source, 'none');
});

test('a failed live suggestion is a named failure, not an empty list pretending to be an answer', async () => {
  const { client } = fakeClient({ 'autocomplete/recipient': { status: 503 } });
  const typeahead = createTypeahead({ client });
  const result = await typeahead.suggest('lockheed');
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, 'UPSTREAM_ERROR');
});

/* ---------------------------------------------------------------------------------------------
 * THE SOURCE AS OF DATE. Never asserted unless it was just received.
 * ------------------------------------------------------------------------------------------- */

test('the as of date is fetched live, and a failure yields no date rather than a plausible one', async () => {
  const ok = fakeClient(await subjectRoutes());
  assert.deepEqual(await fetchSourceAsOf(ok.client), { sourceAsOf: '09/21/2026', notice: null });

  const bad = fakeClient({ 'awards/last_updated': { status: 500 } });
  const result = await fetchSourceAsOf(bad.client);
  assert.equal(result.sourceAsOf, null);
  assert.equal(result.notice, SOURCE_AS_OF_UNAVAILABLE);
});

/* ---------------------------------------------------------------------------------------------
 * THE PARENT DETAIL PANEL.
 * ------------------------------------------------------------------------------------------- */

test('the profile total is badged with the set that produced it, not the one on screen', async () => {
  const profile = (await hydrated('contracts')).profile;
  const detail = parentDetailClaims({
    profile, fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: '09/21/2026',
  });
  assert.equal(detail.totalClaim.value, PARENT_TOTAL);
  assert.equal(detail.totalClaim.badge, 'REPORTED');
  assert.equal(detail.totalClaim.awardTypeSetId, 'all',
    'this endpoint takes no award type filter, so the badge may not claim one');
  assert.equal(detail.totalClaim.note, PROFILE_TOTAL_SET_NOTE);

  const allSet = parentDetailClaims({ profile, ...META });
  assert.equal(allSet.totalClaim.note, null);
});

test('a count is a tally and can never become a currency string', async () => {
  const profile = (await hydrated()).profile;
  const detail = parentDetailClaims({ profile, ...META, awardCount: 6808 });
  const rendered = renderClaim(detail.transactionsClaim);
  assert.match(rendered.valueText, /transaction records$/);
  assert.equal(rendered.unitKind, 'tally');
  assert.equal(renderClaim(detail.awardCountClaim).valueText, '6,808 awards');
  assert.match(renderClaim(detail.awardCountClaim).a11yLabel, /all award types set/);
  assert.equal(renderClaim(detail.alternateNamesClaim).valueText, '27 declared names');
});

test('no federal awards is an answer with a sentence, not an empty panel', () => {
  const detail = parentDetailClaims({
    profile: { name: 'X', uei: PARENT_UEI, totalObligations: 0, totalTransactions: 0, alternateNames: [] },
    ...META,
    awardCount: 0,
  });
  assert.equal(detail.noFederalAwards, true);
  assert.match(detail.sentence, /no federal prime award obligations recorded/);
  assert.match(detail.sentence, /not a failed request/);
  assert.equal(detail.totalClaim.value, 0, 'the reported zero is still a reported figure');
});

test('the award count comes back from its own endpoint', async () => {
  const { client } = fakeClient(await subjectRoutes());
  const result = await fetchAwardCount(client, {
    recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'contracts',
  });
  assert.equal(result.ok, true);
  assert.ok(Number.isFinite(result.awardCount));
});

/* ---------------------------------------------------------------------------------------------
 * THE CHILD LIST AND THE RECONCILIATION. DESIGN C4. The residual is published.
 * ------------------------------------------------------------------------------------------- */

test('the children arrive whole and their sum is recomputed from the recorded response', async () => {
  const { client } = fakeClient(await subjectRoutes());
  const result = await fetchChildren(client, { uei: PARENT_UEI, fiscalYear: 2025 });
  assert.equal(result.ok, true);
  assert.equal(result.children.length, 217);
  assert.equal(result.complete, true);
  assert.equal(sumChildObligations(result.children).toFixed(2), '65405410468.26');
});

test('THE ONE CENT IS PUBLISHED, not rounded away', async () => {
  const { identity } = await hydrated('all');
  const out = reconcileRollup({ identity, parentReportedTotal: PARENT_TOTAL, sourceAsOf: '09/21/2026' });
  assert.equal(out.ok, true);

  const residual = out.residuals.find((r) => r.id === 'children-minus-parent');
  assert.ok(residual, 'the residual is part of the return value, not an optional extra');
  assert.ok(isClaim(residual.claim));
  assert.equal(residual.claim.badge, 'COMPUTED');
  assert.equal(residual.claim.value.toFixed(2), '0.01');
  assert.equal(residual.claim.note, RESIDUAL_NOTE);

  const rendered = renderClaim(residual.claim);
  assert.match(rendered.valueText, /0\.01 obligated$/,
    'the cent reaches the page with its unit welded on');
  assert.match(rendered.text, /\[COMPUTED\]/);

  // And the two arms it is the difference between are both on the page as well.
  const ids = out.arms.map((a) => a.id);
  assert.deepEqual(ids, ['parent-profile', 'child-rollup']);
  assert.equal(out.arms[0].claim.value, PARENT_TOTAL);
  assert.equal(out.arms[1].claim.value.toFixed(2), '65405410468.26');
});

test('the third arm reconciles when it is on the same basis, and is labelled when it is not', async () => {
  const breakdown = (await fixture('category-recipient-all-fy2025.json')).results
    .map((r) => ({ amount: r.amount }));
  assert.equal(breakdown.length, 60);

  const all = reconcileRollup({
    identity: (await hydrated('all')).identity,
    parentReportedTotal: PARENT_TOTAL,
    categoryBreakdown: { rows: breakdown },
    sourceAsOf: '09/21/2026',
  });
  assert.equal(all.arms.length, 3);
  assert.equal(all.allArmsComparable, true);
  assert.equal(all.arms[2].claim.value.toFixed(2), '65405410468.26');
  assert.equal(all.residuals.length, 2);
  assert.equal(all.residuals[1].claim.value.toFixed(2), '0.01');

  const filtered = reconcileRollup({
    identity: (await hydrated('contracts')).identity,
    parentReportedTotal: PARENT_TOTAL,
    categoryBreakdown: { rows: breakdown },
    sourceAsOf: '09/21/2026',
  });
  assert.equal(filtered.allArmsComparable, false);
  assert.equal(filtered.arms[2].comparable, false);
  assert.equal(filtered.arms[2].note, ARM_NOT_COMPARABLE_NOTE);
  assert.equal(filtered.residuals.length, 1,
    'a difference between two different filters is not a residual');
});

test('an incomplete rollup suppresses the total instead of publishing it short', async () => {
  const { identity } = await hydrated('all');
  const short = { ...identity, childCount: 216, childrenExpected: 217, rollupComplete: false };
  const out = reconcileRollup({ identity: short, parentReportedTotal: PARENT_TOTAL, sourceAsOf: null });
  assert.equal(out.ok, false);
  assert.equal(out.failure.kind, 'INCOMPLETE_ROLLUP');
  assert.deepEqual(out.failure.parts, { arrived: 216, expected: 217 });
  assert.equal(out.arms, undefined);
});

test('the reconciliation narrative hands the renderer claims, never bare numbers', async () => {
  const { identity } = await hydrated('all');
  const out = reconcileRollup({ identity, parentReportedTotal: PARENT_TOTAL, sourceAsOf: null });
  for (const segment of out.narrative) {
    if (segment.kind === 'claim') {
      assert.ok(isClaim(segment.claim), 'every figure segment is a Claim the badge gate can see');
    } else {
      assert.equal(/\d/.test(segment.text), false,
        'prose segments carry no digit, so a figure cannot reach the page unbadged through one');
    }
  }
});

/* ---------------------------------------------------------------------------------------------
 * THE CATEGORY QUERIES. DESIGN C2 and C5.
 * ------------------------------------------------------------------------------------------- */

test('the agency breakdown comes back ranked, with the figures the source recorded', async () => {
  const { client, calls } = fakeClient(await subjectRoutes());
  const result = await fetchCategory(client, {
    dimension: 'awarding_agency', recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'contracts',
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].name, 'Department of Defense');
  assert.equal(result.rows[0].amount, 63941564049.57);
  assert.equal(calls[0].body.filters.recipient_id, PARENT_ID,
    'this endpoint does honour the recipient filter, which is the counter test to the award trap');
  assert.equal(calls[0].body.filters.subawards, false);

  const claims = categoryRowClaims(result.rows, { fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null });
  assert.ok(claims.every((c) => isClaim(c.claim)));
  assert.equal(claims[0].claim.badge, 'REPORTED');
});

test('the outlay field never leaves the query layer, on any row', async () => {
  const raw = await fixture('category-awarding-agency-fy2025.json');
  assert.ok(raw.results.every((r) => Object.prototype.hasOwnProperty.call(r, 'total_outlays')));
  assert.ok(raw.results.every((r) => r.total_outlays === null),
    'the recorded response really does carry null there, which is the whole reason for the rule');
  const { client } = fakeClient(await subjectRoutes());
  const result = await fetchCategory(client, {
    dimension: 'awarding_agency', recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'contracts',
  });
  const serialised = JSON.stringify(result.rows);
  assert.equal(serialised.includes('outlay'), false);
});

test('a paged total that is one page is summed; a page that fails suppresses the total', async () => {
  const ok = fakeClient(await subjectRoutes());
  const complete = await fetchCategoryTotal(ok.client, {
    dimension: 'recipient', recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'all',
  });
  assert.equal(complete.ok, true);
  assert.equal(complete.pages, 1);
  assert.equal(complete.rows.length, 60);
  assert.equal(complete.total.toFixed(2), '65405410468.26');

  const page1 = await fixture('category-recipient-all-fy2025.json');
  page1.page_metadata = { ...page1.page_metadata, hasNext: true };
  const broken = fakeClient({
    'spending_by_category/recipient': [{ json: page1 }, { status: 502 }, { status: 502 }, { status: 502 }, { status: 502 }],
  });
  const partial = await fetchCategoryTotal(broken.client, {
    dimension: 'recipient', recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'all',
  });
  assert.equal(partial.ok, false);
  assert.equal(partial.failure.kind, 'INCOMPLETE_ROLLUP');
  assert.deepEqual(partial.failure.parts, { arrived: 1, expected: 2 });
  assert.equal(partial.total, undefined);
});

test('paging stops at the ceiling and suppresses rather than running away', async () => {
  const page = await fixture('category-recipient-all-fy2025.json');
  page.page_metadata = { ...page.page_metadata, hasNext: true };
  const { client, calls } = fakeClient({ 'spending_by_category/recipient': { json: page } });
  const result = await fetchCategoryTotal(client, {
    dimension: 'recipient', recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'all',
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, 'INCOMPLETE_ROLLUP');
  assert.equal(calls.length, MAX_CATEGORY_PAGES);
});

test('the second definition is its own named figure and is never merged with the parent one', async () => {
  const claim = nameMatchTotalClaim(75954132796, {
    fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null, entityCount: 20,
  });
  assert.equal(claim.badge, 'COMPUTED');
  assert.match(claim.note, /A DIFFERENT DEFINITION/);
  assert.match(claim.note, /never shown as a range/);
});

test('the request builder refuses both definitions at once', async () => {
  const { client } = fakeClient(await subjectRoutes());
  await assert.rejects(() => fetchCategoryTotal(client, {
    dimension: 'recipient',
    recipientId: PARENT_ID,
    recipientSearchText: 'LOCKHEED MARTIN',
    fiscalYear: 2025,
    awardTypeSetId: 'all',
  }), /Never both/);
});

test('summing refuses a row whose figure could not be read', () => {
  assert.throws(() => sumRows([{ amount: 1 }, { amount: null }]), /finite amount/);
  assert.throws(() => sumChildObligations([{ obligations: undefined }]), /finite figure/);
});

/* ---------------------------------------------------------------------------------------------
 * OBLIGATIONS BY FISCAL YEAR. DESIGN C3, trap 7, trap 14.
 * ------------------------------------------------------------------------------------------- */

test('the fiscal year series carries obligations and nothing else', async () => {
  const { client, calls } = fakeClient(await subjectRoutes());
  const result = await fetchObligationsByFiscalYear(client, {
    recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: '09/21/2026',
  });
  assert.equal(result.ok, true);
  assert.equal(result.points.length, 10);
  assert.deepEqual(result.points.map((p) => p.fiscalYear), [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  for (const point of result.points) {
    assert.deepEqual(Object.keys(point).sort(), ['fiscalYear', 'obligations']);
  }
  assert.ok(result.claims.every((c) => isClaim(c.claim) && c.claim.badge === 'REPORTED'));
  assert.match(result.floorNotice, /fiscal year 2008/);
  assert.equal(calls[0].body.group, 'fiscal_year');
  assert.equal(calls[0].body.filters.subawards, false);
});

test('a point that carries a second quantity is refused', () => {
  assert.throws(
    () => assertObligationsOnly([{ fiscalYear: 2025, obligations: 1, totalOutlays: 0 }]),
    /A point on this chart is a fiscal year and an obligations figure/,
  );
  assert.throws(() => assertObligationsOnly([{ fiscalYear: 2025, obligations: null }]), /finite number/);
});

test('the raw time series really does carry a null outlay bucket on every row', async () => {
  const raw = await fixture('spending-over-time-fy2016-2025.json');
  assert.ok(raw.results.length > 0);
  assert.ok(raw.results.every((r) => r.total_outlays === null));
});

/* ---------------------------------------------------------------------------------------------
 * THE FACADE, end to end, and the flakiness it has to survive.
 * ------------------------------------------------------------------------------------------- */

test('a subject loads end to end: identity, parent claims and the reconciliation', async () => {
  const api = createApi({ client: fakeClient(await subjectRoutes()).client });
  const asOf = await api.sourceAsOf();
  const started = await api.startQuery({ text: 'LOCKHEED MARTIN' });
  assert.equal(started.outcome, 'choice-required', 'sixteen parent records means the visitor picks');

  const loaded = await api.loadSubject({
    choice: { candidate: parentCandidate(), how: 'picked-from-list' },
    fiscalYear: 2025,
    awardTypeSetId: 'all',
    sourceAsOf: asOf.sourceAsOf,
  });
  assert.equal(loaded.ok, true);
  assert.equal(loaded.identity.childCount, 217);
  assert.equal(loaded.detail.totalClaim.value, PARENT_TOTAL);
  assert.equal(loaded.reconciliation.ok, true);
  assert.equal(loaded.reconciliation.residuals[0].claim.value.toFixed(2), '0.01');
  assert.equal(loaded.disclosures.length, 1);
});

test('the three way reconciliation survives losing its third arm', async () => {
  const api = createApi({
    client: fakeClient(await subjectRoutes({ 'spending_by_category/recipient': { status: 504 } })).client,
  });
  const { identity } = await hydrated('all');
  const out = await api.reconcileThreeWays({
    identity, parentReportedTotal: PARENT_TOTAL, sourceAsOf: null,
  });
  assert.equal(out.ok, true);
  assert.equal(out.armsMissing, true);
  assert.equal(out.breakdownFailure.kind, 'INCOMPLETE_ROLLUP');
  assert.equal(out.reconciliation.ok, true, 'the two arm reconciliation still stands');
  assert.equal(out.reconciliation.arms.length, 2);
});

test('the whole layer retries the measured upstream faults and then stops', async () => {
  const routes = await subjectRoutes({
    'spending_over_time': [{ status: 502 }, { status: 503 }, { status: 504 }, { json: await fixture('spending-over-time-fy2016-2025.json') }],
  });
  const { client, calls } = fakeClient(routes);
  const result = await fetchObligationsByFiscalYear(client, {
    recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'contracts',
  });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 4);
  assert.equal(calls.length, 4);

  const dead = fakeClient(await subjectRoutes({ 'spending_over_time': { status: 502 } }));
  const failed = await fetchObligationsByFiscalYear(dead.client, {
    recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'contracts',
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.failure.kind, 'UPSTREAM_ERROR');
  assert.equal(failed.failure.attempts, 4);
  assert.match(failed.failure.detail, /backoff windows of 400, 800, 1600 ms with full jitter/);
  assert.equal(failed.failure.retryable, true);
});

test('a body the validator cannot read is a named failure and nothing is displayed', async () => {
  const { client } = fakeClient(await subjectRoutes({
    '/api/v2/recipient/children/': { json: { nope: true } },
  }));
  const result = await fetchChildren(client, { uei: PARENT_UEI, fiscalYear: 2025 });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, 'MALFORMED_RESPONSE');
  assert.equal(result.failure.retryable, false);
  assert.equal(result.children, undefined);
});

/* ---------------------------------------------------------------------------------------------
 * House rules that hold across the whole layer.
 * ------------------------------------------------------------------------------------------- */

test('no module in this layer names the legacy vendor identifier or the rolling window', async () => {
  const files = ['api.js', 'categories.js', 'children.js', 'parent.js', 'reconcile.js',
    'source-date.js', 'timeseries.js', 'typeahead.js', 'typeahead-index.js'];
  for (const file of files) {
    const src = await readFile(path.join(REPO, 'src', 'api', file), 'utf8');
    assert.equal(/\bduns\b/i.test(src), false, file + ' names the legacy vendor identifier');
    assert.equal(/year\s*=\s*latest|['"`]latest['"`]/.test(src), false,
      file + ' names the rolling window, which is not a fiscal year');
  }
});

test('every request the layer makes is on the one declared host', async () => {
  const { client, calls } = fakeClient(await subjectRoutes());
  const api = createApi({ client });
  await api.sourceAsOf();
  await api.obligationsByFiscalYear({ recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'all' });
  await api.category({ dimension: 'awarding_agency', recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'all' });
  await api.entityBreakdown({ recipientId: PARENT_ID, fiscalYear: 2025, awardTypeSetId: 'all' });
  assert.ok(calls.length >= 4);
  for (const call of calls) {
    assert.equal(call.url.startsWith('https://api.usaspending.gov/'), true, call.url);
  }
});
