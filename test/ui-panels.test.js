// The panels. Each one is fed the real analysis output for a synthetic entity, so these tests
// exercise the same path the page does rather than a shape invented for the test.
//
// What they defend:
//
//   A suppressed figure prints its REASON and never a zero. The analysis layer returns an absent
//   key with a sentence beside it, and the panel asks `available` first. There is no path where
//   a missing number renders as nothing and reads as a measured zero.
//   The refusal is a panel, not an error. It names the split records, shows their identifiers,
//   and says plainly that adding them together would invent a company the record does not hold.
//   A failure names WHICH panel is missing and offers a retry only when a retry is honest.
//   The NEVER CLAIMED statements sit beside the figures they qualify, verbatim.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  skeletonPanel, coldPanel, unavailablePanel, failurePanel, narrativeNode,
  controlsPanel, chooserPanel, refusalPanel, subjectPanel, heroPanel, customerMixPanel,
  spinePanel, concentrationPanel, rollupPanel, secondDefinitionPanel, receiptsTable,
  sourceAsOfLine, mount,
} from '../src/ui/panels.js';
import {
  soleBidderShare, oneOfferShare, competitionRows, topRowShare, herfindahlIndex,
  cumulativeConcentration, obligationsByYear, methodDelta,
} from '../src/analysis/index.js';
import { categoryRowClaims } from '../src/api/categories.js';
import { parentDetailClaims } from '../src/api/parent.js';
import { reconcileRollup } from '../src/api/reconcile.js';
import { refuseIdentity } from '../src/contracts/identity.js';
import { failure, UPSTREAM_ERROR, BAD_REQUEST } from '../src/query/failure.js';
import { METHODS } from '../src/core/claim.js';
import { NEVER_CLAIMED_ITEMS } from '../src/core/never-claimed.js';
import { AWARD_TYPE_SETS, COLD_SOURCE_NOTICE } from '../src/core/constants.js';
import {
  soleBidderChart, agencyMixChart, spineChart, concentrationCurveChart, largestAwardsChart,
  revealSentence,
} from '../src/ui/view-model.js';
import { createDocument } from './helpers/mini-dom.js';
import {
  META, testIdentity, testAwardRows, testAwardDetails, testAgencyRows, testOverTimePoints,
  TEST_FISCAL_YEAR, TEST_SET, TEST_AS_OF,
} from './helpers/ui-fixtures.js';

const doc = createDocument();
const identity = testIdentity();
const awardRows = testAwardRows();
const awardDetails = testAwardDetails();

test('a waiting tile says what it is waiting for, and a slow one says the source has not answered yet', () => {
  assert.match(skeletonPanel(doc, 'the agency breakdown').textContent, /agency breakdown/);
  assert.match(skeletonPanel(doc, 'x').getAttribute('role'), /status/);
  assert.ok(coldPanel(doc, 'the agency breakdown').textContent.includes(COLD_SOURCE_NOTICE));
});

test('an unavailable figure prints the reason and never a zero', () => {
  const panel = unavailablePanel(doc, 'the single customer share',
    'The source returned no rows for this recipient.');
  assert.match(panel.textContent, /no rows/);
  assert.doesNotMatch(panel.textContent, /\$0/);
});

test('a failure names the panel, and offers a retry only when retrying is honest', () => {
  let retried = 0;
  const retryable = failurePanel(doc, failure(UPSTREAM_ERROR, 'the agency breakdown'),
    () => { retried += 1; });
  assert.match(retryable.textContent, /agency breakdown/);
  assert.equal(retryable.getAttribute('role'), 'alert');
  const button = retryable.querySelector('button');
  button.dispatch('click');
  assert.equal(retried, 1);

  const permanent = failurePanel(doc, failure(BAD_REQUEST, 'the agency breakdown'), () => {});
  assert.equal(permanent.querySelector('button'), null);
  assert.match(permanent.textContent, /Retrying will not change this/);
});

test('the controls are real form controls, and both of them reload the page state', () => {
  let year = null;
  let setId = null;
  const panel = controlsPanel(doc, {
    fiscalYear: 2025,
    latestFiscalYear: 2026,
    awardTypeSetId: 'contracts',
    onFiscalYear: (fy) => { year = fy; },
    onAwardTypeSet: (s) => { setId = s; },
  });
  const select = panel.querySelector('select');
  assert.equal(select.getAttribute('id'), 'fiscal-year');
  select.dispatch('change', { target: { value: '2019' } });
  assert.equal(year, 2019);

  const radios = panel.querySelectorAll('input');
  assert.equal(radios.length, Object.keys(AWARD_TYPE_SETS).length,
    'all three award type sets are visible, never a hidden default');
  radios[2].dispatch('change');
  assert.equal(setId, Object.values(AWARD_TYPE_SETS)[2].id);
  assert.match(panel.textContent, /never a hidden default/);
});

test('the fiscal year list stops at the floor, because nothing earlier exists in this dataset', () => {
  const panel = controlsPanel(doc, {
    fiscalYear: 2025,
    latestFiscalYear: 2026,
    awardTypeSetId: 'contracts',
    onFiscalYear: () => {},
    onAwardTypeSet: () => {},
  });
  const options = panel.querySelectorAll('option');
  const values = options.map((o) => Number(o.getAttribute('value')));
  assert.equal(Math.min(...values), 2008);
  assert.equal(Math.max(...values), 2026);
});

test('THE CHOOSER SHOWS THE NAME AND THE IDENTIFIER, AND NEVER A DOLLAR FIGURE', () => {
  let chosen = null;
  const candidates = [
    { recipientId: 'r1', uei: 'TESTPARENT01', name: 'TEST PARENT ENTITY', level: 'PARENT' },
    { recipientId: 'r2', uei: 'TESTPARENT02', name: 'TEST PARENT OTHER', level: 'PARENT' },
  ];
  const panel = chooserPanel(doc, { candidates, onChoose: (c) => { chosen = c; } });
  assert.match(panel.textContent, /TESTPARENT01/);
  assert.match(panel.textContent, /TEST PARENT ENTITY/);
  assert.doesNotMatch(panel.textContent, /\$/, 'a candidate carries no money figure, ever');
  panel.querySelectorAll('button')[1].dispatch('click');
  assert.equal(chosen.uei, 'TESTPARENT02');
});

test('THE REFUSAL IS A PANEL: it lists the split records and declines to add them together', () => {
  const split = [
    { recipientId: 'r1', uei: 'TESTSPLIT001', name: 'TEST SPLIT ONE', level: 'PARENT' },
    { recipientId: 'r2', uei: 'TESTSPLIT002', name: 'TEST SPLIT TWO', level: 'PARENT' },
  ];
  let picked = null;
  const panel = refusalPanel(doc, refuseIdentity('test split', split), (c) => { picked = c; });
  assert.match(panel.textContent, /No single parent record exists/);
  assert.match(panel.textContent, /invent a company/);
  assert.match(panel.textContent, /TESTSPLIT001/);
  assert.match(panel.textContent, /TESTSPLIT002/);
  panel.querySelectorAll('button')[0].dispatch('click');
  assert.equal(picked.uei, 'TESTSPLIT001');
});

test('the subject panel says WHAT was summed and that the linkage is self declared', () => {
  const detail = parentDetailClaims({
    profile: {
      recipientId: 'r1',
      uei: 'TESTPARENT01',
      name: 'TEST PARENT ENTITY',
      level: 'P',
      totalObligations: 1000,
      totalTransactions: 12,
      alternateNames: ['TEST PARENT ALIAS'],
      parentUei: null,
    },
    fiscalYear: TEST_FISCAL_YEAR,
    awardTypeSetId: TEST_SET,
    sourceAsOf: TEST_AS_OF,
  });
  const panel = subjectPanel(doc, { identity, detail });
  assert.match(panel.textContent, /TESTPARENT01/);
  assert.match(panel.textContent, /registered child entities/);
  assert.match(panel.textContent, /self declared in SAM\.gov registration/);
  assert.ok(panel.textContent.includes(NEVER_CLAIMED_ITEMS[0].sentence),
    'obligations are not revenue, beside the total, verbatim');
});

test('an incomplete rollup says the total is suppressed rather than showing it short', () => {
  const short = testIdentity({ childrenExpected: 9 });
  assert.equal(short.rollupComplete, false);
  const panel = subjectPanel(doc, { identity: short, detail: null });
  assert.match(panel.textContent, /suppressed/);
  assert.match(panel.textContent, /smaller than the truth/);
});

test('THE HERO CARRIES THE REVEAL, THE SPLIT, THE TALLIES AND THE RECEIPTS', () => {
  const soleBidder = soleBidderShare({ awardRows, awardDetails, meta: META });
  const oneOffer = oneOfferShare({ awardRows, awardDetails, meta: META });
  const awards = competitionRows({ awardRows, awardDetails, meta: META });
  const panel = heroPanel(doc, {
    soleBidder,
    oneOffer,
    awards: awards.map((r, i) => ({ ...r, generatedInternalId: awardRows[i].generatedInternalId })),
    excludedRowCountClaim: null,
    detailCountClaim: null,
    reveal: revealSentence(identity),
    chart: soleBidderChart({ soleBidder, identity }),
  });

  assert.match(panel.textContent, /awarded with exactly one bidder/);
  assert.match(panel.textContent, /percent/, 'the reveal is a share with its unit');
  assert.match(panel.textContent, /COMPUTED/, 'and it carries its badge');
  assert.match(panel.textContent, /lifetime award value/, 'the denominator names its own unit');
  assert.match(panel.textContent, /TESTAWARD0001/, 'the receipts are on the page');
  assert.ok(panel.textContent.includes(
    NEVER_CLAIMED_ITEMS.find((i) => i.id === 'no-losing-bidders').sentence,
  ), 'the page says plainly that losing bidders are not in this data');
  const link = panel.querySelector('a');
  assert.match(link.getAttribute('href'), /^https:\/\/www\.usaspending\.gov\/award\//);
});

test('a contract whose record contradicts itself is SHOWN, with the contradiction named', () => {
  const awards = competitionRows({ awardRows, awardDetails, meta: META });
  const table = receiptsTable(doc, awards.map((r, i) => ({
    ...r, generatedInternalId: awardRows[i].generatedInternalId,
  })), 10);
  assert.match(table.textContent, /contradicts itself/);
  assert.match(table.textContent, /TESTAWARD0003/);
});

test('when the split cannot be computed the hero prints the reason and still shows the tallies', () => {
  const soleBidder = soleBidderShare({ awardRows: [], awardDetails: [], meta: META });
  assert.equal(soleBidder.available, false);
  const panel = heroPanel(doc, {
    soleBidder,
    oneOffer: oneOfferShare({ awardRows: [], awardDetails: [], meta: META }),
    awards: [],
    excludedRowCountClaim: null,
    detailCountClaim: null,
    reveal: revealSentence(identity),
    chart: null,
  });
  assert.match(panel.textContent, /No figure for the competition split/);
  assert.doesNotMatch(panel.textContent, /percent of the stated denominator/);
});

test('the customer mix leads with the single customer share and names the buyer', () => {
  const rows = testAgencyRows();
  const agency = topRowShare({
    rows, method: METHODS.ONE_CUSTOMER_SHARE, rowNoun: 'awarding agency', meta: META,
  });
  const panel = customerMixPanel(doc, {
    agency,
    herfindahl: herfindahlIndex(rows, 'awarding agency', META),
    chart: agencyMixChart({ rowClaims: categoryRowClaims(rows, META), identity }),
  });
  assert.match(panel.textContent, /came from one department/);
  assert.match(panel.textContent, /TEST DEPARTMENT ALPHA/);
  assert.match(panel.textContent, /Herfindahl/);
  assert.match(panel.textContent, /90\.0 percent/, 'the share is computed from the rows, not typed');
});

test('the spine and the concentration panels carry the statements that qualify them', () => {
  const spine = obligationsByYear({ points: testOverTimePoints(), meta: META });
  const spineNode = spinePanel(doc, { spine, chart: spineChart({ spine, identity }) });
  assert.ok(spineNode.textContent.includes(
    NEVER_CLAIMED_ITEMS.find((i) => i.id === 'not-outlays').sentence,
  ));
  assert.ok(spineNode.textContent.includes(
    NEVER_CLAIMED_ITEMS.find((i) => i.id === 'floor-2008').sentence,
  ));

  const cumulative = cumulativeConcentration({ awardRows, meta: META });
  const awards = competitionRows({ awardRows, awardDetails, meta: META });
  const conc = concentrationPanel(doc, {
    cumulative,
    curveChart: concentrationCurveChart({ cumulative, identity }),
    awardsChart: largestAwardsChart({ awardRows: awards, identity }),
  });
  assert.ok(conc.textContent.includes(
    NEVER_CLAIMED_ITEMS.find((i) => i.id === 'subawards-excluded').sentence,
  ));
  assert.match(conc.textContent, /hatched neutral ramp/);
});

test('the rollup shows the arithmetic, the arms and every child entity', () => {
  const reconciliation = reconcileRollup({
    identity,
    parentReportedTotal: 1000,
    sourceAsOf: TEST_AS_OF,
  });
  const panel = rollupPanel(doc, { reconciliation, identity });
  assert.match(panel.textContent, /TEST CHILD ONE/);
  assert.match(panel.textContent, /TESTCHILD003/);
  assert.match(panel.textContent, /obligated/, 'every child amount carries its unit');
  assert.match(panel.textContent, /registered child entities/);
});

test('a rollup that could not complete renders the failure, not a short total', () => {
  const short = testIdentity({ childrenExpected: 9 });
  const reconciliation = reconcileRollup({
    identity: short,
    parentReportedTotal: 1000,
    sourceAsOf: TEST_AS_OF,
  });
  assert.equal(reconciliation.ok, false);
  const panel = rollupPanel(doc, { reconciliation, identity: short });
  assert.match(panel.textContent, /suppressed|smaller than the truth/);
});

test('the second definition is a second named figure and never a range', () => {
  const view = methodDelta({
    nameMatchRows: [
      { name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', amount: 1000 },
      { name: 'TEST UNRELATED ENTITY', uei: 'TESTOTHER001', amount: 250 },
    ],
    parentRollupTotal: 1000,
    parentEntityNamesUpper: identity.entityNamesUpper,
    fiscalYear: TEST_FISCAL_YEAR,
    awardTypeSetId: TEST_SET,
    sourceAsOf: TEST_AS_OF,
  });
  const panel = secondDefinitionPanel(doc, view);
  assert.match(panel.textContent, /two different definitions/);
  assert.match(panel.textContent, /TEST UNRELATED ENTITY/);
  assert.doesNotMatch(panel.textContent, /\brange of\b/);
});

test('a narrative keeps prose as prose and every figure badged', () => {
  const reconciliation = reconcileRollup({
    identity, parentReportedTotal: 1000, sourceAsOf: TEST_AS_OF,
  });
  const node = narrativeNode(doc, reconciliation.narrative);
  const badged = node.querySelectorAll('[data-claim-badge]');
  assert.ok(badged.length > 0, 'a narrative figure must arrive badged');
  for (const fig of badged) assert.ok(fig.hasAttribute('data-unit-kind'));
});

test('the as-of line never asserts a date it did not receive', () => {
  assert.match(sourceAsOfLine(doc, null).textContent, /unavailable/);
  assert.match(sourceAsOfLine(doc, '09/21/2026').textContent, /09\/21\/2026/);
});

test('mount replaces a region rather than appending to it', () => {
  const region = doc.createElement('div');
  mount(region, skeletonPanel(doc, 'one'));
  mount(region, skeletonPanel(doc, 'two'));
  assert.equal(region.childNodes.length, 1);
  assert.match(region.textContent, /two/);
  assert.doesNotMatch(region.textContent, /one/);
});
