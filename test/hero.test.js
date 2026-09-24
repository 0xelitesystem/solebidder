// THE HERO ASSEMBLY, WITHOUT A DOCUMENT.
//
// src/api/hero.js is the one place the hero and the concentration view are built, for the page
// and for the command line alike. These tests pin what it hands back, and the last of them boots
// the real page over the same inputs and checks the page shows exactly what the module computed,
// which is the test that stops the two surfaces drifting apart.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  metaOf, awardSearchRequest, keepEntityRows, searchLargestAwards, fetchCompetitionRecords,
  assembleHero, assemblyFailure, HERO_WHAT, DROPPED_ROW_NOTE, ARRIVED_RECORD_NOTE,
} from '../src/api/hero.js';
import { awardSearchRequest as pageAwardSearchRequest, boot } from '../src/ui/app.js';
import { renderClaim, renderClaimText, claimToJSON, METHODS } from '../src/core/claim.js';
import {
  failure, failureMessage, isFailure, UPSTREAM_ERROR, INCOMPLETE_ROLLUP, MALFORMED_RESPONSE,
} from '../src/query/failure.js';
import { MAX_CONCURRENCY, HERO_AWARD_COUNT } from '../src/core/constants.js';
import { parentDetailClaims } from '../src/api/parent.js';
import { createDocument } from './helpers/mini-dom.js';
import {
  REGION_IDS, testIdentity, testAwardRows, testAwardDetails, testAgencyRows, testOverTimePoints,
  META, TEST_AS_OF,
} from './helpers/ui-fixtures.js';

const FOREIGN = Object.freeze({
  awardId: 'TESTOTHER0001',
  recipientName: 'A COMPLETELY DIFFERENT COMPANY',
  awardValue: 9999,
  generatedInternalId: 'gid-other',
});

/** A client whose two methods record what they were asked, and answer from the fixtures. */
function recordingClient({ search, detail } = {}) {
  const asked = { requests: [], limits: [] };
  const client = {
    asked,
    request: async (spec, validate, options) => {
      asked.requests.push({ spec, options });
      if (spec.id === 'spendingByAward') {
        return search === undefined
          ? { ok: true, value: { rows: testAwardRows(), hasNextPage: false }, attempts: 1 }
          : search;
      }
      const found = testAwardDetails().find((d) => spec.url.includes(d.generatedInternalId));
      if (detail) return detail(spec, found);
      return { ok: true, value: found, attempts: 1 };
    },
    mapWithCap: async (tasks, limit) => {
      asked.limits.push(limit);
      return Promise.all(tasks.map((t) => t()));
    },
  };
  return client;
}

test('metaOf takes the provenance triple from ONE identity, and a missing date is null', () => {
  assert.deepEqual(metaOf(testIdentity()), {
    fiscalYear: META.fiscalYear, awardTypeSetId: META.awardTypeSetId, sourceAsOf: TEST_AS_OF,
  });
  assert.deepEqual(metaOf({ fiscalYear: 2024, awardTypeSetId: 'all' }),
    { fiscalYear: 2024, awardTypeSetId: 'all', sourceAsOf: null });
});

test('the page and the module build the award search with the same function', () => {
  assert.equal(pageAwardSearchRequest, awardSearchRequest, 'the page kept a copy of its own');
  const spec = awardSearchRequest(testIdentity());
  assert.equal(spec.body.limit, HERO_AWARD_COUNT);
  assert.doesNotMatch(JSON.stringify(spec.body), /recipient_id/);
  assert.equal(awardSearchRequest(testIdentity(), 7).body.limit, 7);
});

test('TRAP 1: a row for another company is dropped, and the drop is a badged tally with its note', () => {
  const kept = keepEntityRows(testIdentity(), [...testAwardRows(), FOREIGN]);
  assert.equal(kept.ok, true);
  assert.equal(kept.kept.length, 3);
  assert.ok(kept.kept.every((r) => r.recipientName !== FOREIGN.recipientName));
  assert.equal(kept.excludedCount, 1);
  assert.match(renderClaimText(kept.excludedRowCountClaim), /^1 dropped award row \[COMPUTED\]$/);
  const json = claimToJSON(kept.excludedRowCountClaim);
  assert.equal(json.method, METHODS.SOLE_BIDDER_SHARE);
  assert.equal(json.note, DROPPED_ROW_NOTE);
  assert.equal(json.sourceAsOf, TEST_AS_OF, 'the tally carries the as of date like every figure');
  assert.doesNotMatch(DROPPED_ROW_NOTE, /this page/, 'the shared note names no surface');
});

test('when NO row survives the filter, the hero is a named failure that offers no retry', () => {
  const r = keepEntityRows(testIdentity(), [FOREIGN]);
  assert.equal(r.ok, false);
  assert.equal(r.emptied, true, 'asking again would drop the same rows again');
  assert.ok(isFailure(r.failure));
  assert.equal(r.failure.kind, INCOMPLETE_ROLLUP);
  assert.equal(r.failure.what, HERO_WHAT.emptied);
  assert.deepEqual(r.failure.parts, { arrived: 0, expected: 1 });
  assert.match(failureMessage(r.failure), /0 of 1 expected parts arrived/);
  assert.match(renderClaimText(r.excludedRowCountClaim), /^1 dropped award row/);
});

test('the search step passes the caller signal and cold notice through, and a failed search is not '
  + 'mistaken for an emptied set', async () => {
  const controller = new AbortController();
  const onCold = () => {};
  const client = recordingClient();
  const ok = await searchLargestAwards(client, testIdentity(), { signal: controller.signal, onCold });
  assert.equal(ok.ok, true);
  const [{ spec, options }] = client.asked.requests;
  assert.equal(spec.id, 'spendingByAward');
  assert.equal(options.what, HERO_WHAT.search);
  assert.equal(options.signal, controller.signal);
  assert.equal(options.onCold, onCold);

  const down = failure(UPSTREAM_ERROR, HERO_WHAT.search);
  const failed = await searchLargestAwards(recordingClient({ search: { ok: false, failure: down } }),
    testIdentity());
  assert.deepEqual(failed, { ok: false, emptied: false, failure: down });
});

test('the fan out asks once per kept row, never above the concurrency cap, and drops a record that '
  + 'did not answer rather than inventing it', async () => {
  const client = recordingClient({
    detail: (spec, found) => (found.generatedInternalId === 'gid-2'
      ? { ok: false, failure: failure(UPSTREAM_ERROR, HERO_WHAT.detail) }
      : { ok: true, value: found, attempts: 1 }),
  });
  const details = await fetchCompetitionRecords(client, testAwardRows());
  assert.deepEqual(client.asked.limits, [MAX_CONCURRENCY]);
  assert.equal(client.asked.requests.length, 3);
  for (const [i, row] of testAwardRows().entries()) {
    assert.ok(client.asked.requests[i].spec.url.endsWith('/api/v2/awards/' + row.generatedInternalId + '/'));
    assert.equal(client.asked.requests[i].options.what, HERO_WHAT.detail);
  }
  assert.deepEqual(details.map((d) => d.generatedInternalId), ['gid-1', 'gid-3']);
});

test('THE AWARD LINKS ARE RE-ATTACHED BY INDEX, and the two tallies and both views come back', () => {
  const kept = testAwardRows();
  const out = assembleHero({ kept, awardDetails: testAwardDetails(), meta: META });
  assert.equal(out.hero.ok, true);
  assert.equal(out.hero.awards.length, kept.length);
  out.hero.awards.forEach((row, i) => {
    assert.equal(row.awardId, kept[i].awardId);
    assert.equal(row.generatedInternalId, kept[i].generatedInternalId,
      'receipt ' + i + ' would link to the wrong award record');
  });
  // 600 of 1,000 in lifetime award value is marked NOT COMPETED in the synthetic records.
  assert.equal(renderClaim(out.hero.soleBidder.soleBidderShareClaim).valueText, '60.0 percent');
  assert.equal(out.hero.soleBidder.isFloor, false);
  assert.match(renderClaimText(out.detailCountClaim), /^3 arrived competition records \[COMPUTED\]$/);
  assert.equal(claimToJSON(out.detailCountClaim).method, METHODS.RESPONSE_COVERAGE_COUNT);
  assert.equal(claimToJSON(out.detailCountClaim).note, ARRIVED_RECORD_NOTE);

  assert.equal(out.concentration.ok, true);
  assert.equal(out.concentration.awardRows.length, kept.length);
  assert.ok(out.concentration.cumulative && out.concentration.topAward);
});

test('a record that did not arrive makes the share a floor and the tally says how many did', () => {
  const details = testAwardDetails().filter((d) => d.generatedInternalId !== 'gid-1');
  const out = assembleHero({ kept: testAwardRows(), awardDetails: details, meta: META });
  assert.equal(out.hero.soleBidder.isFloor, true);
  assert.match(renderClaimText(out.detailCountClaim), /^2 arrived competition records/);
});

test('a shape the arithmetic cannot use costs each view with its OWN named failure, never a partial '
  + 'figure', () => {
  // Not an array of records: the join refuses it, in the hero and in the concentration view.
  const out = assembleHero({ kept: testAwardRows(), awardDetails: { length: 0 }, meta: META });
  assert.equal(out.hero.ok, false);
  assert.equal(out.hero.failure.kind, MALFORMED_RESPONSE);
  assert.equal(out.hero.failure.what, HERO_WHAT.hero);
  assert.match(out.hero.failure.detail, /awardDetails must be an array/);
  assert.equal(out.concentration.ok, false);
  assert.equal(out.concentration.failure.what, HERO_WHAT.concentration);
  assert.equal(out.hero.soleBidder, undefined, 'a failed view carries no figure at all');

  const f = assemblyFailure('the competition split', new Error('boom'));
  assert.equal(f.kind, MALFORMED_RESPONSE);
  assert.equal(f.detail, 'boom');
});

/** A stub api with the surface boot() uses, answering from the synthetic fixtures. */
function stubApi(client) {
  const identity = testIdentity();
  const candidate = { recipientId: 'test-recipient-id', uei: 'TESTPARENT01', name: 'TEST PARENT ENTITY', level: 'PARENT' };
  const profile = { recipientId: 'test-recipient-id', uei: 'TESTPARENT01', name: 'TEST PARENT ENTITY', level: 'P', totalObligations: 1000, totalTransactions: 12, alternateNames: [], parentUei: null };
  return {
    sourceAsOf: async () => ({ sourceAsOf: TEST_AS_OF, notice: null }),
    startQuery: async () => ({
      ok: true, outcome: 'only-candidate', candidates: [candidate], refusal: null,
      choice: { candidate, how: 'only-candidate' }, sentence: 'One parent level record matches.',
      droppedChildLevel: 0, droppedNoUei: 0,
    }),
    loadSubject: async () => ({
      ok: true, identity, profile, disclosures: [], linkageNotice: null,
      detail: parentDetailClaims({ profile, fiscalYear: META.fiscalYear, awardTypeSetId: META.awardTypeSetId, sourceAsOf: TEST_AS_OF }),
      reconciliation: { ok: false, failure: failure(UPSTREAM_ERROR, 'the subsidiary rollup') },
    }),
    obligationsByFiscalYear: async () => ({ ok: true, years: [], points: testOverTimePoints(), claims: [] }),
    category: async (args) => ({ ok: true, dimension: args.dimension, rows: testAgencyRows(), hasNextPage: false }),
    entityBreakdown: async () => ({ ok: false, failure: failure(UPSTREAM_ERROR, 'the entity breakdown') }),
    nameMatchTotal: async () => ({ ok: false, failure: failure(UPSTREAM_ERROR, 'the name match total') }),
    reconcileThreeWays: async () => ({ ok: true, armsMissing: true }),
    client,
  };
}

test('THE PAGE SHOWS WHAT THE MODULE COMPUTED: the same share, the same tallies, and every receipt '
  + 'linking to its own award record', async () => {
  const rows = [...testAwardRows(), FOREIGN];
  const client = recordingClient({ search: { ok: true, value: { rows, hasNextPage: false }, attempts: 1 } });
  const doc = createDocument(REGION_IDS);
  const app = boot(doc, { api: stubApi(client), now: () => new Date(Date.UTC(2026, 8, 22)), loadIndexText: async () => '' });
  await app.search('test parent');
  for (let i = 0; i < 6; i += 1) await new Promise((r) => setTimeout(r, 0));

  // The same figures, computed by the module directly over the same inputs.
  const expected = keepEntityRows(testIdentity(), rows);
  const assembled = assembleHero({ kept: expected.kept, awardDetails: testAwardDetails(), meta: expected.meta });

  const hero = doc.getElementById('panel-hero');
  const text = hero.textContent;
  for (const claim of [assembled.hero.soleBidder.soleBidderShareClaim, expected.excludedRowCountClaim,
    assembled.detailCountClaim]) {
    assert.ok(text.includes(renderClaim(claim).valueText), 'the page does not show ' + renderClaimText(claim));
  }
  const links = hero.querySelectorAll('a').filter((a) => /^TESTAWARD/.test(a.textContent));
  assert.equal(links.length, 3);
  for (const a of links) {
    const row = testAwardRows().find((r) => r.awardId === a.textContent);
    assert.ok(a.getAttribute('href').endsWith('/award/' + row.generatedInternalId),
      a.textContent + ' links to ' + a.getAttribute('href'));
  }
  assert.doesNotMatch(text, /A COMPLETELY DIFFERENT COMPANY/);
  assert.match(doc.getElementById('panel-concentration').textContent, /lifetime award value/i);
});
