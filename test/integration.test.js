// THE INTEGRATION SEAMS. Every test here is a positive control over a defect that was actually
// found when the four parallel work streams were joined together, not a hypothetical one.
//
// A seam defect does not look like a defect. It looks like an empty panel, a figure whose badge
// names the wrong arithmetic, or an identifier quietly carried one layer further than it should
// have been. Each of these fails on the code as the teams handed it over and passes on the code
// as it was joined, which is the only way to know the join did anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import { validateSpendingByCategory } from '../src/query/endpoints.js';
import { filterRowsToEntitySet } from '../src/query/award-query.js';
import { METHODS, computed, renderClaim } from '../src/core/claim.js';
import { OBLIGATIONS, SHARE, TALLY } from '../src/core/units.js';
import { topAwardShare } from '../src/analysis/concentration.js';
import { ALLOWED_BARE_NUMBER_KEYS } from '../src/contracts/analysis.js';
import { parseIndex } from '../src/api/typeahead-index.js';
import { reported } from '../src/core/claim.js';
import { formatTally } from '../src/core/units.js';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');

const META = { fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: '09/21/2026' };

/* ------------------------------------------------------------------------------------------ */

test('TRAP 13: THE RECIPIENT DIMENSION CARRIES THE LEGACY VENDOR NUMBER IN A FIELD NAMED code, '
  + 'AND THE PROJECTION REFUSES TO PASS IT ON', () => {
  const raw = JSON.parse(read('test/fixtures/api/category-recipient-all-fy2025.json'));

  // The control first. The recorded response really does carry it, so this test measures the fix
  // rather than describing a response shape that never existed.
  assert.equal(raw.category, 'recipient');
  assert.match(raw.results[0].code, /^[0-9]{9}$/,
    'the recorded response no longer carries a nine digit vendor number, so this test is stale');

  const out = validateSpendingByCategory(raw);
  assert.equal(out.dimension, 'recipient');
  for (const row of out.rows) {
    assert.equal(row.code, null, 'the vendor number reached the layer above the validator');
  }
  // And the identifier this product DOES key on is projected in its place.
  assert.equal(out.rows[0].uei, 'G4KDGE4JFFK7');
});

test('the same projection KEEPS the classification code on every other dimension, because there '
  + 'it is a public government code and dropping it would cost a real field', () => {
  const raw = JSON.parse(read('test/fixtures/api/category-awarding-agency-fy2025.json'));
  const out = validateSpendingByCategory(raw);
  assert.equal(out.dimension, 'awarding_agency');
  assert.equal(out.rows[0].code, 'DOD');
  assert.equal(out.rows[0].uei, null, 'an agency has no unique entity identifier');
});

/* ------------------------------------------------------------------------------------------ */

test('THE ENTITY SET FILTER READS THE SPELLING THE RESPONSE VALIDATOR ACTUALLY PRODUCES', () => {
  const allowed = new Set(['TEST PARENT ENTITY']);
  // This is exactly what validateSpendingByAward projects: camel case, not the display column
  // and not the snake case field. Before the join this dropped every row, and a filter that
  // drops every row presents as a company with no contracts rather than as a defect.
  const validated = [
    { recipientName: 'TEST PARENT ENTITY', awardValue: 10 },
    { recipientName: 'SOMEBODY ELSE ENTIRELY', awardValue: 99 },
  ];
  const r = filterRowsToEntitySet(validated, allowed);
  assert.equal(r.kept.length, 1);
  assert.equal(r.excludedCount, 1);

  // The two older spellings still work, because other endpoints still use them.
  assert.equal(filterRowsToEntitySet([{ 'Recipient Name': 'TEST PARENT ENTITY' }], allowed).kept.length, 1);
  assert.equal(filterRowsToEntitySet([{ recipient_name: 'TEST PARENT ENTITY' }], allowed).kept.length, 1);

  // A row whose recipient cannot be read is still excluded. That is the safe direction.
  assert.equal(filterRowsToEntitySet([{ awardValue: 10 }], allowed).excludedCount, 1);
});

/* ------------------------------------------------------------------------------------------ */

test('THE THIRD RECONCILIATION ARM HAS ITS OWN METHOD, so its badge does not describe summing '
  + 'children when what it summed was an entity breakdown', () => {
  assert.equal(typeof METHODS.ENTITY_BREAKDOWN_ROLLUP_CHECK, 'string');
  assert.notEqual(METHODS.ENTITY_BREAKDOWN_ROLLUP_CHECK, METHODS.CHILD_ROLLUP_CHECK);

  const src = read('src/api/reconcile.js');
  const armBlock = src.slice(src.indexOf("id: 'entity-breakdown'"));
  assert.ok(armBlock.includes('METHODS.ENTITY_BREAKDOWN_ROLLUP_CHECK'),
    'the entity breakdown arm is badged with the child rollup method again');

  // It is COMPUTED, and the claim system proves that rather than this test asserting it.
  assert.equal(renderClaim(computed(1, OBLIGATIONS, METHODS.ENTITY_BREAKDOWN_ROLLUP_CHECK, META)).badge,
    'COMPUTED');
});

test('a count WE took over the responses that arrived has its own COMPUTED method', () => {
  assert.equal(typeof METHODS.RESPONSE_COVERAGE_COUNT, 'string');
  const c = computed(40, TALLY, METHODS.RESPONSE_COVERAGE_COUNT,
    { ...META, tallyNoun: 'award competition record' });
  assert.equal(renderClaim(c).badge, 'COMPUTED');
  assert.match(renderClaim(c).provenance, /count WE took/);
});

test('the product and service and the industry dimensions each have their OWN share method, so '
  + 'four ranked panels cannot all claim to be a share over awarding agencies', () => {
  const ids = ['ONE_CUSTOMER_SHARE', 'SUBAGENCY_SHARE', 'PRODUCT_SERVICE_SHARE', 'INDUSTRY_SHARE'];
  const texts = new Set(ids.map((id) => METHODS[id]));
  assert.equal(texts.size, 4, 'two dimensions share one method text');
  for (const id of ids) {
    const c = computed(0.5, SHARE, METHODS[id], { ...META, denominatorText: 'one of two.' });
    assert.equal(renderClaim(c).badge, 'COMPUTED');
  }
});

/* ------------------------------------------------------------------------------------------ */

test('topAwardShare answers to the name the function is called, and it is ONE claim under two '
  + 'keys rather than two figures', () => {
  const r = topAwardShare({
    awardRows: [{ awardId: 'HAND-1', awardValue: 300 }, { awardId: 'HAND-2', awardValue: 100 }],
    meta: META,
  });
  assert.equal(r.available, true);
  assert.equal(r.topAwardShareClaim, r.topShareClaim, 'two distinct Claim objects for one figure');
  assert.equal(renderClaim(r.topAwardShareClaim).valueText, '75.0 percent');
});

test('the prior fiscal year is an allowed bare number, so a chart can place the prior column '
  + 'without the year being dressed up as a quantity', () => {
  assert.ok(ALLOWED_BARE_NUMBER_KEYS.has('priorFiscalYear'));
});

/* ------------------------------------------------------------------------------------------ */

test('THE INDEX REFRESH AND THE INDEX CHECK ARE WIRED INTO package.json', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['index:refresh'], 'node scripts/build-typeahead-index.mjs');
  assert.equal(pkg.scripts['index:check'], 'node scripts/build-typeahead-index.mjs --check');
});

test('THE BUNDLED INDEX IS ON DISK, CARRIES NO MONEY, AND SITS UNDER ITS CEILING', () => {
  const text = read('src/data/typeahead-index.json');
  const index = parseIndex(text);
  assert.ok(index.rows.length > 4000, 'the bundle is smaller than the head of the distribution');
  for (const row of index.rows) {
    assert.equal(row.length, 2, 'a bundled row grew a third column');
    assert.equal(typeof row[0], 'string');
    assert.equal(typeof row[1], 'string');
  }
  assert.doesNotMatch(text, /"amount"|"total"/, 'a figure reached the bundle');

  const gz = gzipSync(Buffer.from(text, 'utf8')).length;
  assert.ok(gz <= 120 * 1024, 'the bundle is over the 120 KB gzip ceiling at ' + gz + ' bytes');
});

/* ------------------------------------------------------------------------------------------ */

test('THE TALLY NOUN GUARD IS IN THE CLAIM CONSTRUCTOR, so a figure built with reported() or '
  + 'computed() directly cannot walk past it', () => {
  // The exact line that reached a real browser reading "2 offer receiveds". It was built with
  // reported(), which did not run the analysis layer helper that held the only copy of the rule.
  assert.throws(
    () => reported(2, TALLY, METHODS.AWARD_COMPETITION_FIELDS, { ...META, tallyNoun: 'offer received' }),
    /participle rather than a head noun/,
  );
  // And the fixed spelling reads correctly at both cardinalities.
  assert.equal(formatTally(1, 'received offer'), '1 received offer');
  assert.equal(formatTally(2, 'received offer'), '2 received offers');

  // The clause half of the rule still holds, and it still holds through the constructor.
  assert.throws(
    () => reported(3, TALLY, METHODS.AWARD_COMPETITION_FIELDS,
      { ...META, tallyNoun: 'award whose record arrived' }),
    /clause rather than a noun phrase/,
  );
});

test('every tally noun the product actually ships survives its own guard', () => {
  // A positive control over the real strings, not over invented ones. Anything the source files
  // hand to a tally is parsed out and run through the pluraliser in both cardinalities.
  const files = ['src/analysis/competition.js', 'src/analysis/concentration.js',
    'src/analysis/over-time.js', 'src/analysis/rollup.js', 'src/analysis/index.js',
    'src/api/parent.js', 'src/api/children.js', 'src/api/hero.js', 'src/ui/app.js'];
  const nouns = new Set();
  for (const f of files) {
    const text = read(f);
    for (const m of text.matchAll(/tallyNoun: '([^']+)'/g)) nouns.add(m[1]);
    for (const m of text.matchAll(/tallyClaim\([^,]+, '([^']+)'/g)) nouns.add(m[1]);
  }
  assert.ok(nouns.size >= 10, 'the scan found almost no nouns, so it is not scanning');
  for (const noun of nouns) {
    if (noun.trim().length === 0) continue;
    assert.doesNotThrow(() => formatTally(1, noun), 'singular: ' + noun);
    assert.doesNotThrow(() => formatTally(2, noun), 'plural: ' + noun);
  }
});
