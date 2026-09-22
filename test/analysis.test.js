// THE ANALYSIS LAYER AS A WHOLE. src/analysis/index.js against CONTRACT 2.
//
// The per panel arithmetic is proved in concentration.test.js, sole-source.test.js,
// over-time.test.js and rollup.test.js. This file proves the three properties that only hold
// of the assembled result:
//
//   the finished output passes assertAnalysisOutput, which means every displayed leaf is a
//   Claim and no bare number slipped through under a key nobody thought about,
//   a completely empty input produces a complete output made entirely of sentences and tallies
//   rather than throwing or producing a page of zeroes, and
//   no figure anywhere in any of it renders as the text a failed division produces.

import test from 'node:test';
import assert from 'node:assert/strict';

import { analyse } from '../src/analysis/index.js';
import { assertAnalysisOutput } from '../src/contracts/analysis.js';
import { renderClaim } from '../src/core/claim.js';
import { NEVER_CLAIMED_ITEMS } from '../src/core/never-claimed.js';
import {
  validateSpendingByCategory, validateSpendingOverTime, validateRecipientChildren,
} from '../src/query/endpoints.js';
import {
  hand, recorded, META, identity, childEntities, analysisInput, collectClaims, renderAll, close,
} from './_analysis-helpers.js';

/** The fullest input these fixtures can build: recorded rows where they exist, hand built where they do not. */
function fullInput() {
  const children = childEntities(validateRecipientChildren(recorded('recipient-children-fy2025')));
  const agency = validateSpendingByCategory(recorded('category-awarding-agency-fy2025')).rows;
  const overTime = validateSpendingOverTime(recorded('spending-over-time-fy2016-2025')).points;
  const awards = hand('awards');
  const id = identity({ children, childrenExpected: 217 });
  return analysisInput({
    identity: id,
    agencyRows: agency,
    subagencyRows: agency,
    overTimePoints: overTime,
    awardRows: awards.awardRows,
    awardDetails: awards.awardDetails,
    awardRowsExcluded: 3,
    parentReportedTotal: 65405410468.25,
  });
}

test('THE FINISHED OUTPUT PASSES THE CLAIM BOUNDARY WALKER', () => {
  const out = analyse(fullInput());
  assert.doesNotThrow(() => assertAnalysisOutput(out),
    'every key ending in Claim holds a real Claim, and every bare number sits under one of the '
    + 'seven structural keys the contract allows');
  assert.equal(out.identity.uei, 'HAND00000001');
  assert.equal(out.totalSuppressed, false);
});

test('every figure in the finished output carries a badge, a unit kind and a method', () => {
  const out = analyse(fullInput());
  const claims = collectClaims(out);
  assert.ok(claims.length > 30, 'the output carries ' + claims.length + ' badged figures');
  for (const c of claims) {
    const r = renderClaim(c);
    assert.ok(['REPORTED', 'COMPUTED'].includes(r.badge),
      'nothing in this product is modelled, and the budget for a modelled figure is zero');
    assert.ok(r.dataAttrs['data-unit-kind'] !== 'none');
    assert.ok(r.dataAttrs['data-claim-method'].length > 0);
    assert.ok(r.provenance.length > 0);
  }
});

test('NO FIGURE ANYWHERE IN THE OUTPUT RENDERS AS A FAILED DIVISION', () => {
  for (const out of [analyse(fullInput()), analyse(analysisInput())]) {
    for (const text of renderAll(out)) {
      assert.equal(/NaN|Infinity/.test(text), false, 'produced "' + text + '"');
    }
  }
});

test('A COMPLETELY EMPTY INPUT PRODUCES A COMPLETE OUTPUT, NOT A PAGE OF ZEROES', () => {
  const out = analyse(analysisInput());

  assert.equal(out.soleBidder.share.available, false);
  assert.equal(out.soleBidder.oneOffer.available, false);
  assert.equal(out.concentration.agency.available, false);
  assert.equal(out.concentration.subagency.available, false);
  assert.equal(out.concentration.herfindahl.available, false);
  assert.equal(out.concentration.cumulative.available, false);
  assert.equal(out.concentration.topAward.available, false);
  assert.equal(out.overTime.spine.available, false);
  assert.equal(out.overTime.selectedYear.available, false);

  for (const panel of [out.soleBidder.share, out.concentration.agency, out.concentration.herfindahl]) {
    assert.equal(typeof panel.reason, 'string');
    assert.ok(panel.reason.length > 40, 'the reason is a sentence a reader can act on');
  }

  assert.equal(out.rollup.childSumClaim.value, 0,
    'a rollup of no children really is zero and it is a measurement, unlike a share of nothing');
  assert.equal(out.methodDelta, null);
  assert.doesNotThrow(() => assertAnalysisOutput(out));
});

test('THE NEVER CLAIMED STATEMENTS TRAVEL WITH THE FIGURES, VERBATIM', () => {
  const out = analyse(fullInput());
  assert.ok(out.notices.length >= 8);
  assert.equal(out.notices[0], out.identity.subjectSentence);
  const registry = new Set(NEVER_CLAIMED_ITEMS.map((i) => i.sentence));
  for (const notice of out.notices.slice(1)) {
    assert.equal(registry.has(notice), true,
      'the statement is taken from the registry character for character. The gate compares them '
      + 'exactly and a paraphrase is a failure, which is why none is written out here.');
  }
  const joined = out.notices.join(' ');
  assert.ok(joined.includes('obligations, not revenue'));
  assert.ok(joined.includes('lifetime value of an award'));
  assert.ok(joined.includes('not SEC consolidation'));
});

test('AN INCOMPLETE ROLLUP SUPPRESSES THE TOTAL ACROSS THE WHOLE OUTPUT', () => {
  const children = childEntities(validateRecipientChildren(recorded('recipient-children-fy2025')));
  const id = identity({ children, childrenExpected: 400 });
  const out = analyse(analysisInput({ identity: id, parentReportedTotal: 65405410468.25 }));
  assert.equal(out.totalSuppressed, true);
  assert.equal(Object.prototype.hasOwnProperty.call(out.rollup, 'childSumClaim'), false);
  assert.equal(out.rollup.childCountClaim.value, 217);
  assert.equal(out.rollup.childrenExpectedClaim.value, 400);
});

test('A MISMATCHED PERIOD NEVER REACHES THE ARITHMETIC', () => {
  assert.throws(
    () => analyse(analysisInput({ fiscalYear: 2024 })),
    /One period in application state/,
  );
});

test('a mismatched award type set is refused, because the set changes the total', () => {
  assert.throws(() => analyse(analysisInput({ awardTypeSetId: 'all' })), /award type set/);
});

test('a missing excluded row count is refused, because the drop has to be visible', () => {
  assert.throws(() => analyse(analysisInput({ awardRowsExcluded: undefined })), /awardRowsExcluded/);
  assert.throws(() => analyse(analysisInput({ awardRowsExcluded: -1 })), /awardRowsExcluded/);
});

test('THE EXCLUDED AWARD ROW COUNT IS PUBLISHED, NOT SWALLOWED', () => {
  const out = analyse(fullInput());
  assert.equal(out.soleBidder.excludedRowCountClaim.value, 3);
  assert.equal(renderClaim(out.soleBidder.excludedRowCountClaim).valueText, '3 excluded award rows');
  assert.ok(renderClaim(out.soleBidder.excludedRowCountClaim).a11yLabel.includes('ignores the recipient filter'),
    'the award search endpoint ignores the recipient id filter, so rows belonging to other '
    + 'companies do come back. The count of what was dropped is on the page, with the reason.');
});

test('the analysis layer reaches no network and reads no clock', () => {
  const src = [
    'src/analysis/index.js', 'src/analysis/share.js', 'src/analysis/concentration.js',
    'src/analysis/competition.js', 'src/analysis/over-time.js', 'src/analysis/rollup.js',
  ];
  return Promise.all(src.map(async (rel) => {
    const { readFile } = await import('node:fs/promises');
    const text = await readFile(new URL('../' + rel, import.meta.url), 'utf8');
    for (const banned of ['fetch(', 'XMLHttpRequest', 'Date.now', 'new Date', 'document.', 'window.']) {
      assert.equal(text.includes(banned), false,
        rel + ' contains ' + banned + '. The analysis layer never fetches and never reads a '
        + 'clock, which is what lets every published figure be recomputed from a committed '
        + 'fixture by somebody who has never spoken to us.');
    }
  }));
});

test('RECOMPUTES THE HEADLINE CONCENTRATION FIGURE THROUGH THE WHOLE LAYER', () => {
  const out = analyse(fullInput());
  assert.equal(out.concentration.agency.topName, 'Department of Defense');
  close(assert, out.concentration.agency.topShareClaim.value, 0.9877548409881965, 1e-12,
    'the same figure the panel test recomputes, arrived at through the assembled layer.');
  assert.equal(renderClaim(out.concentration.agency.topShareClaim).valueText, '98.8 percent');
  close(assert, out.concentration.herfindahl.indexClaim.value, 0.9757721497260515, 1e-12,
    'and the index alongside it.');
  assert.equal(renderClaim(out.rollup.parentTotalClaim).valueText,
    '$65,405,410,468.25 obligated',
    'the unit noun is welded to the figure, in the one place a currency string can be built');
});
