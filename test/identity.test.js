// IDENTITY RESOLUTION. CONTRACT 1, DESIGN C9, traps 2, 4, 8 and 13.
//
// Every fixture under test/fixtures/api was recorded from the live API on 2026-09-22 with the
// legacy vendor identifier stripped out of it. So these are not hand written shapes that agree
// with our assumptions; they are what the government actually answered, including the sixteen
// parent records for one name and the child entity whose linkage is behind the world.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { fakeClient, fixture, REPO } from './helpers/fake-client.js';
import { toParentCandidates, decideIdentity, pickCandidate } from '../src/identity/candidates.js';
import { resolveQuery, hydrateIdentity, resolveChosenUei } from '../src/identity/resolve.js';
import {
  staleLinkageDisclosures, assertDisclosure, KNOWN_STALE_LINKAGES,
} from '../src/identity/stale-tree.js';
import { validateRecipientList } from '../src/query/endpoints.js';
import { isFailure, failureMessage, MALFORMED_RESPONSE, INCOMPLETE_ROLLUP } from '../src/query/failure.js';

const PARENT_ID = 'b97d19b0-833c-8d8f-3a2c-157d04ea55ef-P';
const PARENT_UEI = 'ZFN2JJXBLZT3';
const SANDIA_UEI = 'LUJEPCRRT377';

/** Routes, most specific first, because the first matching key wins. */
async function subjectRoutes(overrides = {}) {
  return {
    '/api/v2/recipient/children/': { json: await fixture('recipient-children-fy2025.json') },
    'b97d19b0': { json: await fixture('recipient-profile-parent-fy2025.json') },
    '/api/v2/recipient/': { json: await fixture('recipient-list-lockheed.json') },
    ...overrides,
  };
}

/* ---------------------------------------------------------------------------------------------
 * TRAP 4. The chooser is a choice between ENTITIES and it carries no figure.
 * ------------------------------------------------------------------------------------------- */

test('a candidate carries no amount, because the endpoint that produced it has no year', async () => {
  const mapped = toParentCandidates(validateRecipientList(await fixture('recipient-list-lockheed.json')));
  assert.ok(mapped.candidates.length > 0);
  for (const candidate of mapped.candidates) {
    const keys = Object.keys(candidate).sort();
    assert.deepEqual(keys, ['alternateNames', 'level', 'location', 'name', 'recipientId', 'uei']);
    assert.equal(Object.prototype.hasOwnProperty.call(candidate, 'amount'), false);
  }
});

test('the raw list response carries an amount and none of it survives into a candidate', async () => {
  const raw = await fixture('recipient-list-lockheed.json');
  const rawAmounts = raw.results.map((r) => r.amount).filter((a) => typeof a === 'number');
  assert.ok(rawAmounts.length > 0, 'the fixture must actually contain the figure being dropped');
  const mapped = toParentCandidates(validateRecipientList(raw));
  const serialised = JSON.stringify(mapped.candidates);
  for (const amount of rawAmounts.slice(0, 10)) {
    assert.equal(serialised.includes(String(amount)), false,
      'a figure from an endpoint with no year parameter reached the chooser');
  }
});

test('sixteen parent level records match one well known name, and child level rows are dropped', async () => {
  const raw = await fixture('recipient-list-lockheed.json');
  const mapped = toParentCandidates(validateRecipientList(raw));
  assert.equal(mapped.candidates.length, 16);
  assert.equal(mapped.droppedChildLevel, raw.results.length - 16);
  for (const c of mapped.candidates) assert.equal(c.level, 'PARENT');
});

/* ---------------------------------------------------------------------------------------------
 * DESIGN C9. The refusal is a capability.
 * ------------------------------------------------------------------------------------------- */

test('more than one unlinked parent record means the tool refuses to total, and lists them', async () => {
  const mapped = toParentCandidates(validateRecipientList(await fixture('recipient-list-lockheed.json')));
  const decision = decideIdentity('LOCKHEED MARTIN', mapped.candidates);
  assert.equal(decision.outcome, 'choice-required');
  assert.equal(decision.choice, null);
  assert.ok(decision.refusal.refused);
  assert.equal(decision.refusal.splitRecords.length, 16);
  assert.match(decision.sentence, /No single parent record exists/);
  assert.match(decision.sentence, /adding them together would invent a company/);
});

test('a household name with two unlinked parent records refuses in the same way', async () => {
  const mapped = toParentCandidates(validateRecipientList(await fixture('recipient-list-google.json')));
  assert.equal(mapped.candidates.length, 2);
  const decision = decideIdentity('Google', mapped.candidates);
  assert.equal(decision.outcome, 'choice-required');
  const ueis = decision.refusal.splitRecords.map((r) => r.uei);
  assert.ok(ueis.includes('NQV3T7DDKNT6'), 'the separate record must be shown, not merged away');
});

test('no matching parent record is said plainly and is never a zero', () => {
  const decision = decideIdentity('a name nothing matches', []);
  assert.equal(decision.outcome, 'no-records');
  assert.equal(decision.choice, null);
  assert.match(decision.sentence, /No parent level record matches/);
  assert.match(decision.sentence, /not that a company of that name received nothing/);
  assert.equal(/\b0\b/.test(decision.sentence), false);
});

test('exactly one match resolves without asking, and still names the entity', () => {
  const only = {
    recipientId: 'x-P', uei: PARENT_UEI, name: 'A COMPANY', level: 'PARENT',
    alternateNames: [], location: null,
  };
  const decision = decideIdentity('a company', [only]);
  assert.equal(decision.outcome, 'only-candidate');
  assert.equal(decision.choice.how, 'only-candidate');
  assert.match(decision.sentence, /UEI ZFN2JJXBLZT3/);
});

test('picking an entity the visitor never saw is refused', async () => {
  const mapped = toParentCandidates(validateRecipientList(await fixture('recipient-list-lockheed.json')));
  assert.throws(() => pickCandidate(mapped.candidates, 'AAAAAAAAAAAA'), /no candidate carries UEI/);
  const choice = pickCandidate(mapped.candidates, mapped.candidates[0].uei);
  assert.equal(choice.how, 'picked-from-list');
});

/* ---------------------------------------------------------------------------------------------
 * THE API IS FLAKY. Retry, then an honest failure.
 * ------------------------------------------------------------------------------------------- */

test('two upstream errors before a success are retried and the answer still arrives', async () => {
  const { client, calls } = fakeClient({
    '/api/v2/recipient/': [
      { status: 502 },
      { status: 504 },
      { json: await fixture('recipient-list-lockheed.json') },
    ],
  });
  const result = await resolveQuery(client, { text: 'LOCKHEED MARTIN' });
  assert.equal(result.ok, true);
  assert.equal(calls.length, 3);
  assert.equal(result.candidates.length, 16);
});

test('a network failure is retried and a total failure is named, not spun', async () => {
  const { client, calls } = fakeClient({ '/api/v2/recipient/': { networkError: true } });
  const result = await resolveQuery(client, { text: 'LOCKHEED MARTIN' });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 4, 'four attempts, which is one try and three retries');
  assert.ok(isFailure(result.failure));
  assert.equal(result.failure.kind, 'NETWORK_UNREACHABLE');
  assert.equal(result.failure.retryable, true);
  assert.match(failureMessage(result.failure), /could not reach USAspending/);
  assert.throws(() => String(result.failure), /not a value/);
});

test('a rejected request is our defect and is not retried', async () => {
  const { client, calls } = fakeClient({ '/api/v2/recipient/': { status: 400 } });
  const result = await resolveQuery(client, { text: 'LOCKHEED MARTIN' });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 1);
  assert.equal(result.failure.kind, 'BAD_REQUEST');
  assert.equal(result.failure.retryable, false);
});

/* ---------------------------------------------------------------------------------------------
 * TRAP 2. One period, and both halves of the rollup are fetched over it.
 * ------------------------------------------------------------------------------------------- */

test('the parent and the children are fetched over the SAME explicit fiscal year', async () => {
  const { client, calls } = fakeClient(await subjectRoutes());
  const choice = { candidate: parentCandidate(), how: 'picked-from-list' };
  const result = await hydrateIdentity(client, {
    choice, fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: '09/21/2026',
  });
  assert.equal(result.ok, true);
  const years = calls.map((c) => /year=(\d+)/.exec(c.url)).filter(Boolean).map((m) => m[1]);
  assert.equal(years.length, 2, 'the profile and the children calls both carry a year');
  assert.deepEqual([...new Set(years)], ['2025']);
});

test('an identity cannot be hydrated without an explicit fiscal year', async () => {
  const { client } = fakeClient(await subjectRoutes());
  await assert.rejects(
    () => hydrateIdentity(client, {
      choice: { candidate: parentCandidate(), how: 'picked-from-list' },
      awardTypeSetId: 'contracts',
      sourceAsOf: null,
    }),
    /explicit integer fiscalYear is required/,
  );
});

/* ---------------------------------------------------------------------------------------------
 * THE RESOLVED IDENTITY, against the live recorded responses.
 * ------------------------------------------------------------------------------------------- */

test('the rollup names what was summed: 217 children, the parent UEI and the caveat', async () => {
  const { client } = fakeClient(await subjectRoutes());
  const result = await hydrateIdentity(client, {
    choice: { candidate: parentCandidate(), how: 'picked-from-list' },
    fiscalYear: 2025,
    awardTypeSetId: 'all',
    sourceAsOf: '09/21/2026',
  });
  assert.equal(result.ok, true);
  const identity = result.identity;
  assert.equal(identity.childCount, 217);
  assert.equal(identity.childrenExpected, 217);
  assert.equal(identity.rollupComplete, true);
  assert.equal(identity.uei, PARENT_UEI);
  assert.equal(identity.alternateNames.length, 27, 'the declared names come from the profile');
  assert.match(identity.subjectSentence, /217 registered child entities/);
  assert.match(identity.subjectSentence, /self declared in SAM.gov registration, not SEC consolidation/);
  assert.ok(identity.entityNamesUpper.has('SIKORSKY AIRCRAFT CORPORATION'),
    'award rows are validated against this set, so a child name has to be in it');
});

test('a profile for a different entity than the one chosen is refused, not reconciled', async () => {
  const profile = await fixture('recipient-profile-parent-fy2025.json');
  profile.uei = 'AAAAAAAAAAAA';
  const { client } = fakeClient(await subjectRoutes({ 'b97d19b0': { json: profile } }));
  const result = await hydrateIdentity(client, {
    choice: { candidate: parentCandidate(), how: 'picked-from-list' },
    fiscalYear: 2025, awardTypeSetId: 'all', sourceAsOf: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, MALFORMED_RESPONSE);
  assert.match(result.failure.detail, /a figure under the wrong name is worse than no figure/);
});

test('a child list that never arrives is a hard failure, never an identity with an empty rollup', async () => {
  const { client } = fakeClient(await subjectRoutes({
    '/api/v2/recipient/children/': { status: 503 },
  }));
  const result = await hydrateIdentity(client, {
    choice: { candidate: parentCandidate(), how: 'picked-from-list' },
    fiscalYear: 2025, awardTypeSetId: 'all', sourceAsOf: null,
  });
  assert.equal(result.ok, false);
  assert.equal(result.failure.kind, 'UPSTREAM_ERROR');
  assert.equal(result.identity, undefined);
});

/* ---------------------------------------------------------------------------------------------
 * THE TYPEAHEAD TO PARENT UEI PATH.
 * ------------------------------------------------------------------------------------------- */

test('clicking a suggestion whose UEI is a parent record records the choice as the visitor', async () => {
  const { client } = fakeClient(await subjectRoutes());
  const result = await resolveChosenUei(client, { text: 'LOCKHEED MARTIN', uei: PARENT_UEI });
  assert.equal(result.ok, true);
  assert.equal(result.clickedUeiFound, true);
  assert.equal(result.outcome, 'only-candidate');
  assert.equal(result.choice.how, 'picked-a-chip');
  assert.equal(result.choice.candidate.uei, PARENT_UEI);
});

test('clicking a suggestion whose UEI is not a parent record shows the list instead of guessing', async () => {
  const { client } = fakeClient(await subjectRoutes());
  const result = await resolveChosenUei(client, { text: 'LOCKHEED MARTIN', uei: SANDIA_UEI });
  assert.equal(result.ok, true);
  assert.equal(result.clickedUeiFound, false);
  assert.equal(result.choice, null);
  assert.match(result.sentence, /not one of the parent level records/);
});

/* ---------------------------------------------------------------------------------------------
 * TRAP 8. The tree is self declared and it goes stale. We DISCLOSE, we never correct.
 * ------------------------------------------------------------------------------------------- */

test('the stale linkage is disclosed on the page and the children are left exactly as recorded', async () => {
  const { client } = fakeClient(await subjectRoutes());
  const result = await hydrateIdentity(client, {
    choice: { candidate: parentCandidate(), how: 'picked-from-list' },
    fiscalYear: 2025, awardTypeSetId: 'all', sourceAsOf: null,
  });
  assert.equal(result.ok, true);
  assert.equal(result.disclosures.length, 1);
  assert.equal(result.disclosures[0].childUei, SANDIA_UEI);
  assert.match(result.disclosures[0].sentence, /moved to a different operator in 2017/);
  assert.match(result.disclosures[0].sentence, /does not edit the tree/);
  assert.match(result.linkageNotice, /not SEC consolidation/);

  // The disclosed entity is STILL in the rollup, at the figure the source recorded for it.
  const child = result.identity.children.find((c) => c.uei === SANDIA_UEI);
  assert.ok(child, 'the entity is disclosed, not removed');
  const raw = (await fixture('recipient-children-fy2025.json')).find((r) => r.uei === SANDIA_UEI);
  assert.equal(child.obligations, raw.amount);
});

test('reading the disclosures does not mutate the children array', () => {
  const children = Object.freeze([Object.freeze({ uei: SANDIA_UEI, name: 'X', obligations: 0 })]);
  const before = children.length;
  const out = staleLinkageDisclosures({ uei: PARENT_UEI, children });
  assert.equal(children.length, before);
  assert.equal(out.disclosures.length, 1);
});

test('a disclosure may not carry a figure, and the registry is checked on import', () => {
  assert.equal(KNOWN_STALE_LINKAGES.length >= 1, true);
  assert.throws(() => assertDisclosure({
    childUei: SANDIA_UEI,
    parentUei: PARENT_UEI,
    childNameAsRecorded: 'X',
    sentence: 'This entity was worth 24,480,000,000 under a previous operator.',
  }, 'control'), /carries no figure/);
  assert.doesNotThrow(() => assertDisclosure({
    childUei: SANDIA_UEI,
    parentUei: PARENT_UEI,
    childNameAsRecorded: 'X',
    sentence: 'The contract moved to a different operator in 2017.',
  }, 'control'));
});

/* ---------------------------------------------------------------------------------------------
 * The legacy vendor identifier never enters this layer. Trap 13.
 * ------------------------------------------------------------------------------------------- */

test('neither identity module names the legacy vendor identifier', async () => {
  for (const file of ['candidates.js', 'resolve.js', 'stale-tree.js']) {
    const src = await readFile(path.join(REPO, 'src', 'identity', file), 'utf8');
    assert.equal(/\bduns\b/i.test(src), false, file + ' names the legacy vendor identifier');
  }
});

test('every request this layer makes goes to the one declared host', async () => {
  const { client, calls } = fakeClient(await subjectRoutes());
  await resolveQuery(client, { text: 'LOCKHEED MARTIN' });
  await hydrateIdentity(client, {
    choice: { candidate: parentCandidate(), how: 'picked-from-list' },
    fiscalYear: 2025, awardTypeSetId: 'all', sourceAsOf: null,
  });
  assert.ok(calls.length >= 3);
  for (const call of calls) {
    assert.equal(call.url.startsWith('https://api.usaspending.gov/'), true, call.url);
  }
});

/** The chosen entity, as the list endpoint recorded it. */
function parentCandidate() {
  return {
    recipientId: PARENT_ID,
    uei: PARENT_UEI,
    name: 'LOCKHEED MARTIN CORP',
    level: 'PARENT',
    alternateNames: [],
    location: null,
  };
}

void INCOMPLETE_ROLLUP;
