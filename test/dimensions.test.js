// THE FOUR CATEGORY QUESTIONS, ASKED FROM ONE TABLE BY TWO SURFACES.
//
// src/api/dimensions.js holds the category dimensions and the spine length so that the page and
// the command line ask the same four questions, badge each answer with the same method and say
// it in the same words. These tests hold the table to that: the page's re-export is the SAME
// object, every dimension carries its own method, and the sentence each one prints is the one
// the page printed before the table moved.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CATEGORY_PANELS, SPINE_YEARS } from '../src/api/dimensions.js';
import * as app from '../src/ui/app.js';
import { METHODS } from '../src/core/claim.js';
import { CATEGORY_DIMENSIONS } from '../src/query/endpoints.js';
import { pickCandidate } from '../src/identity/candidates.js';
import { resolveIdentity } from '../src/contracts/identity.js';

test('the page re-exports the very same table and spine length, so the two surfaces cannot drift', () => {
  assert.equal(app.CATEGORY_PANELS, CATEGORY_PANELS);
  assert.equal(app.SPINE_YEARS, SPINE_YEARS);
  assert.equal(SPINE_YEARS, 10);
});

test('four dimensions, in the headline order, each with its own method', () => {
  assert.deepEqual(CATEGORY_PANELS.map((p) => p.dimension),
    ['awarding_agency', 'awarding_subagency', 'psc', 'naics']);
  const methods = CATEGORY_PANELS.map((p) => p.method);
  assert.equal(new Set(methods).size, 4, 'a shared method would have three panels mislabel their share');
  assert.deepEqual(methods, [
    METHODS.ONE_CUSTOMER_SHARE, METHODS.SUBAGENCY_SHARE, METHODS.PRODUCT_SERVICE_SHARE,
    METHODS.INDUSTRY_SHARE,
  ]);
  for (const p of CATEGORY_PANELS) {
    assert.ok(CATEGORY_DIMENSIONS.includes(p.dimension), p.dimension + ' is not a known dimension');
    assert.ok(Object.isFrozen(p));
  }
  assert.ok(Object.isFrozen(CATEGORY_PANELS));
  assert.deepEqual(CATEGORY_PANELS.filter((p) => p.herfindahl).map((p) => p.dimension), ['awarding_agency']);
});

test('every dimension carries its own sentence, and the two buyer dimensions say what the page '
  + 'always said for them', () => {
  for (const p of CATEGORY_PANELS) {
    assert.equal(typeof p.tailText, 'string');
    assert.equal(typeof p.topLabel, 'string');
    assert.ok(!/\d/.test(p.tailText + p.topLabel), 'a sentence template carries no figure');
  }
  // These two used to fall through to the panel's default, which was built from the noun. The
  // table now states them outright, and they must be the same words the default produced.
  const [agency, subagency] = CATEGORY_PANELS;
  assert.equal(agency.tailText, ' of the dollars obligated to this entity in the fiscal year selected '
    + 'came from one ' + agency.noun + '.');
  assert.equal(subagency.tailText, ' of the dollars obligated to this entity in the fiscal year '
    + 'selected came from one ' + subagency.noun + '.');
  assert.equal(agency.topLabel, 'That one buyer is ');
  assert.equal(subagency.topLabel, 'That one buyer is ');
});

test('a choice made with the command line option is recorded as that, and nothing else is admitted', () => {
  const candidate = Object.freeze({
    recipientId: 'test-recipient-id', uei: 'TESTPARENT01', name: 'TEST PARENT ENTITY', level: 'PARENT',
    alternateNames: Object.freeze([]), location: null,
  });
  const choice = pickCandidate([candidate], 'TESTPARENT01', 'picked-by-flag');
  assert.equal(choice.how, 'picked-by-flag');
  const identity = resolveIdentity({
    choice, children: [], childrenExpected: 0, fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null,
  });
  assert.equal(identity.chosenHow, 'picked-by-flag');
  assert.throws(() => pickCandidate([candidate], 'TESTPARENT01', /** @type {any} */ ('guessed')), TypeError);
  assert.throws(() => resolveIdentity({
    choice: { candidate, how: 'guessed' }, children: [], childrenExpected: 0, fiscalYear: 2025,
    awardTypeSetId: 'contracts', sourceAsOf: null,
  }), TypeError);
});
