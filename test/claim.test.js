// THE CLAIM SYSTEM. Four tiers, and a figure that cannot be rendered without a badge and a unit.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BADGE_KINDS, BADGE_SPEC, METHODS, REPORTED, COMPUTED, ESTIMATED, NEVER_CLAIMED,
  reported, computed, estimated, neverClaimed,
  isClaim, assertClaim, renderClaim, renderClaimText, claimToJSON,
} from '../src/core/claim.js';
import { OBLIGATIONS, AWARD_VALUE, SHARE, TALLY } from '../src/core/units.js';
import { NEVER_CLAIMED_ITEMS, NEVER_CLAIMED_COUNT, neverClaimedClaims, neverClaimedById } from '../src/core/never-claimed.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const META = { fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: '09/21/2026' };

test('there are exactly four badge kinds and each has a shape and a glyph', () => {
  assert.deepEqual([...BADGE_KINDS], ['REPORTED', 'COMPUTED', 'ESTIMATED', 'NEVER_CLAIMED']);
  for (const kind of BADGE_KINDS) {
    const spec = BADGE_SPEC[kind];
    assert.ok(spec, kind + ' has no spec');
    assert.ok(spec.shape.length > 0, kind + ' has no shape, so it would depend on colour alone');
    assert.ok(spec.glyph.length > 0);
    assert.ok(spec.meaning.length > 0);
  }
  // Every kind must be distinguishable with no colour at all.
  const shapes = new Set(BADGE_KINDS.map((k) => BADGE_SPEC[k].shape));
  assert.equal(shapes.size, BADGE_KINDS.length);
});

test('a figure cannot be built without a unit kind', () => {
  assert.throws(() => reported(1, undefined, METHODS.RECIPIENT_PROFILE_TOTAL, META), TypeError);
  assert.throws(() => reported(1, null, METHODS.RECIPIENT_PROFILE_TOTAL, META), TypeError);
  assert.throws(() => reported(1, 'dollars', METHODS.RECIPIENT_PROFILE_TOTAL, META), TypeError);
});

test('a figure cannot be built without an explicit fiscal year', () => {
  assert.throws(() => reported(1, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, {}), TypeError);
  assert.throws(
    () => reported(1, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, { awardTypeSetId: 'contracts' }),
    TypeError,
  );
});

test('a method must come from the registry and must match its tier', () => {
  assert.throws(() => reported(1, OBLIGATIONS, 'we looked it up somewhere', META), TypeError);
  // ONE_CUSTOMER_SHARE is a COMPUTED method. Claiming it as REPORTED is a construction error.
  assert.throws(() => reported(0.5, SHARE, METHODS.ONE_CUSTOMER_SHARE, {
    ...META, denominatorText: 'x of y',
  }), TypeError);
  assert.throws(() => computed(1, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, META), TypeError);
});

test('a share must carry its denominator in words', () => {
  assert.throws(() => computed(0.988, SHARE, METHODS.ONE_CUSTOMER_SHARE, META), TypeError);
  const ok = computed(0.988, SHARE, METHODS.ONE_CUSTOMER_SHARE, {
    ...META,
    denominatorText: 'One department against the sum of every department returned for the year.',
  });
  assert.ok(isClaim(ok));
});

test('a tally must name what it counts and needs no fiscal year', () => {
  assert.throws(() => reported(217, TALLY, METHODS.RECIPIENT_CHILDREN, {}), TypeError);
  const ok = reported(217, TALLY, METHODS.RECIPIENT_CHILDREN, { tallyNoun: 'registered child entity' });
  assert.equal(renderClaim(ok).valueText, '217 registered child entities');
});

test('a null figure is refused at construction, so a null outlay can never become a zero', () => {
  assert.throws(() => reported(null, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, META), TypeError);
  assert.throws(() => reported(undefined, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, META), TypeError);
  assert.throws(() => reported(NaN, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, META), TypeError);
});

test('a Claim cannot be forged and cannot be stringified implicitly', () => {
  const claim = reported(65405410468.25, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, META);
  assert.ok(isClaim(claim));
  assert.ok(!isClaim({ value: 1, unitKind: OBLIGATIONS, badge: REPORTED, method: 'x' }));
  assert.throws(() => String(claim), TypeError);
  assert.throws(() => `${claim}`, TypeError);
  assert.throws(() => claim + '', TypeError);
  assert.throws(() => JSON.stringify(claim), TypeError);
  assert.throws(() => assertClaim(65405410468.25), TypeError);
});

test('a Claim is frozen', () => {
  const claim = reported(1, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, META);
  assert.ok(Object.isFrozen(claim));
  assert.throws(() => { 'use strict'; claim.value = 2; }, TypeError);
});

test('rendering always emits the badge and the unit, and there is no way to ask for the bare number', () => {
  const claim = reported(65405410468.25, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, META);
  const r = renderClaim(claim);
  assert.equal(r.valueText, '$65,405,410,468.25 obligated');
  assert.equal(r.text, '$65,405,410,468.25 obligated [REPORTED]');
  assert.equal(renderClaimText(claim), r.text);
  assert.equal(r.dataAttrs['data-claim-badge'], 'REPORTED');
  assert.equal(r.dataAttrs['data-unit-kind'], 'obligations');
  assert.equal(r.rampId, 'obligations');
  assert.ok(r.provenance.includes('FY2025'));
  assert.ok(r.provenance.includes('09/21/2026'));
  // Every text producing path carries the badge label.
  assert.ok(r.text.includes('REPORTED'));
  assert.ok(r.a11yLabel.includes('REPORTED'));
});

test('the two money kinds render with different nouns and different ramps', () => {
  const o = renderClaim(reported(100, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, META));
  const a = renderClaim(reported(100, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, META));
  assert.notEqual(o.valueText, a.valueText);
  assert.notEqual(o.rampId, a.rampId);
  assert.notEqual(o.dataAttrs['data-unit-kind'], a.dataAttrs['data-unit-kind']);
});

test('a missing source as of date is stated, never invented', () => {
  const claim = reported(1, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, {
    fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null,
  });
  assert.ok(renderClaim(claim).provenance.includes('Source as of date unavailable'));
});

test('the ESTIMATED kind exists so the gate can detect it, and it constructs a real claim', () => {
  // If this threw, the gate positive control would be a simulation rather than a control. There
  // is exactly one method in the ESTIMATED tier and it exists for this purpose alone.
  const claim = estimated(0.5, SHARE, METHODS.MODELLED_FIGURE, {
    ...META, denominatorText: 'x of y',
  });
  assert.equal(renderClaim(claim).badge, ESTIMATED);
  // And a COMPUTED method still cannot be dressed up as an estimate, or the tiers would be
  // interchangeable and the boundary would mean nothing.
  assert.throws(() => estimated(0.5, SHARE, METHODS.ONE_CUSTOMER_SHARE, {
    ...META, denominatorText: 'x of y',
  }), TypeError);
});

test('nothing under src uses the estimate constructor', async () => {
  const { readdir } = await import('node:fs/promises');
  const walk = async (dir, out = []) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, out);
      else if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
  };
  const files = await walk(path.join(REPO, 'src'));
  for (const f of files) {
    const rel = path.relative(REPO, f).split(path.sep).join('/');
    if (rel === 'src/core/claim.js') continue;
    const text = await readFile(f, 'utf8');
    assert.ok(!/estimated\s*\(/.test(text.replace(/\/\/.*$/gm, '')),
      rel + ' constructs an estimate, and the budget for estimates on this page is zero');
  }
});

test('the estimate budget committed in the repository is zero', async () => {
  const budget = JSON.parse(await readFile(path.join(REPO, 'scripts', 'badge-exception-budget.json'), 'utf8'));
  assert.equal(budget.maxEstimated, 0, 'DESIGN 2.3: an estimate cannot physically reach the page');
});

test('a NEVER CLAIMED item is a sentence, never a figure, and carries no unit kind', () => {
  const claim = neverClaimed('Obligations are not revenue.');
  assert.equal(renderClaim(claim).badge, NEVER_CLAIMED);
  assert.equal(renderClaim(claim).dataAttrs['data-unit-kind'], 'none');
  assert.throws(() => neverClaimed(65405410468.25), TypeError);
  assert.throws(() => neverClaimed(''), TypeError);
});

test('there are exactly ten NEVER CLAIMED statements and each renders as a claim', () => {
  assert.equal(NEVER_CLAIMED_ITEMS.length, NEVER_CLAIMED_COUNT);
  assert.equal(NEVER_CLAIMED_COUNT, 10);
  const ids = new Set(NEVER_CLAIMED_ITEMS.map((i) => i.id));
  assert.equal(ids.size, 10, 'two statements share an id');
  const claims = neverClaimedClaims();
  assert.equal(claims.length, 10);
  for (const c of claims) assert.equal(renderClaim(c).badge, NEVER_CLAIMED);
  assert.equal(neverClaimedById('not-outlays').id, 'not-outlays');
  assert.throws(() => neverClaimedById('no-such-statement'), RangeError);
});

test('all ten statements appear verbatim in the shipped page', async () => {
  const html = (await readFile(path.join(REPO, 'index.html'), 'utf8')).replace(/\s+/g, ' ');
  for (const item of NEVER_CLAIMED_ITEMS) {
    assert.ok(html.includes(item.sentence.replace(/\s+/g, ' ')),
      item.id + ' is not on the page, and these are on the page rather than in a footnote');
  }
});

test('serialising a Claim is explicit and keeps every provenance field', () => {
  const claim = computed(0.639, SHARE, METHODS.SOLE_BIDDER_SHARE, {
    ...META,
    denominatorText: 'Sum of award value marked not competed, over the sum across the largest 40.',
  });
  const json = claimToJSON(claim);
  assert.equal(json.badge, COMPUTED);
  assert.equal(json.unitKind, 'share');
  assert.equal(json.fiscalYear, 2025);
  assert.equal(json.awardTypeSetId, 'contracts');
  assert.ok(json.denominatorText.length > 0);
});
