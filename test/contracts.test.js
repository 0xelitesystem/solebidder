// THE THREE CONTRACTS the parallel teams build against: resolved identity, analysis, chart.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveIdentity, refuseIdentity, mustRefuse, isResolvedIdentity, assertIdentityCandidate,
} from '../src/contracts/identity.js';
import {
  shareOf, herfindahl, assertAnalysisInput, assertAnalysisOutput, ALLOWED_BARE_NUMBER_KEYS,
} from '../src/contracts/analysis.js';
import {
  makeChartInput, assertAriaLabel, assertTable, seriesToTableRows,
  CHART_FORMS, SERIES_DASHES, SEGMENT_PATTERNS,
} from '../src/contracts/chart.js';
import { reported, computed, METHODS, renderClaim } from '../src/core/claim.js';
import { OBLIGATIONS, AWARD_VALUE, SHARE, TALLY } from '../src/core/units.js';
import { MAX_COMPARE_SERIES } from '../src/core/constants.js';

const META = { fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: '09/21/2026' };

const CANDIDATE = {
  recipientId: 'abc-P',
  uei: 'ABCDEFGHJKLM',
  name: 'LOCKHEED MARTIN CORPORATION',
  level: 'PARENT',
  alternateNames: ['SIKORSKY AIRCRAFT CORPORATION'],
  location: 'BETHESDA, MD',
};

const CHILDREN = [
  { uei: 'AAAAAAAAAAAA', name: 'CHILD ONE', obligations: 10 },
  { uei: 'BBBBBBBBBBBB', name: 'CHILD TWO', obligations: 20 },
];

function identity(overrides = {}) {
  return resolveIdentity({
    choice: { candidate: CANDIDATE, how: 'picked-from-list' },
    children: CHILDREN,
    childrenExpected: 2,
    fiscalYear: 2025,
    awardTypeSetId: 'contracts',
    sourceAsOf: '09/21/2026',
    ...overrides,
  });
}

/* ---------------------------------------------------------------------------------------------
 * IDENTITY
 * ------------------------------------------------------------------------------------------- */

test('an identity can only be built from an explicit choice', () => {
  assert.throws(() => resolveIdentity({ children: [], childrenExpected: 0, fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null }), TypeError);
  assert.throws(() => resolveIdentity({
    choice: { candidate: CANDIDATE },
    children: [], childrenExpected: 0, fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null,
  }), TypeError);
});

test('the resolved identity shows what was summed and how many children rolled in', () => {
  const id = identity();
  assert.ok(isResolvedIdentity(id));
  assert.equal(id.uei, 'ABCDEFGHJKLM');
  assert.equal(id.level, 'PARENT');
  assert.equal(id.childCount, 2);
  assert.equal(id.childrenExpected, 2);
  assert.equal(id.rollupComplete, true);
  assert.equal(id.chosenHow, 'picked-from-list');
  assert.ok(id.subjectSentence.includes('ABCDEFGHJKLM'));
  assert.ok(id.subjectSentence.includes('2 registered child entities'));
  assert.ok(id.subjectSentence.includes('self declared'));
  assert.ok(Object.isFrozen(id));
});

test('an incomplete rollup is detectable, so the total can be suppressed', () => {
  const id = identity({ childrenExpected: 217 });
  assert.equal(id.rollupComplete, false);
  assert.ok(id.subjectSentence.includes('of 217 expected'));
});

test('the entity name set is what award rows are validated against', () => {
  const id = identity();
  assert.ok(id.entityNamesUpper.has('LOCKHEED MARTIN CORPORATION'));
  assert.ok(id.entityNamesUpper.has('CHILD ONE'));
  assert.ok(!id.entityNamesUpper.has('HUMANA GOVERNMENT BUSINESS INC'));
});

test('V1 resolves parent records only', () => {
  assert.throws(() => assertIdentityCandidate({ ...CANDIDATE, level: 'CHILD' }, 't'), TypeError);
  assert.throws(() => assertIdentityCandidate({ ...CANDIDATE, uei: 'SHORT' }, 't'), TypeError);
});

test('more than one unlinked parent record means refuse, and the refusal names them', () => {
  const a = { ...CANDIDATE, recipientId: 'a-P', uei: 'AAAAAAAAAAAA', name: 'GOOGLE PUBLIC SECTOR LLC' };
  const b = { ...CANDIDATE, recipientId: 'b-P', uei: 'BBBBBBBBBBBB', name: 'GOOGLE LLC' };
  assert.equal(mustRefuse([a, b]), true);
  assert.equal(mustRefuse([a]), false);
  const refusal = refuseIdentity('Google', [a, b]);
  assert.equal(refusal.refused, true);
  assert.equal(refusal.splitRecords.length, 2);
  assert.ok(refusal.sentence.includes('No single parent record exists'));
  assert.ok(refusal.sentence.includes('adding them together'));
  assert.throws(() => refuseIdentity('Google', [a]), TypeError);
});

test('a refusal carries no total of any kind', () => {
  const a = { ...CANDIDATE, recipientId: 'a-P', uei: 'AAAAAAAAAAAA' };
  const b = { ...CANDIDATE, recipientId: 'b-P', uei: 'BBBBBBBBBBBB' };
  const refusal = refuseIdentity('Google', [a, b]);
  for (const rec of refusal.splitRecords) {
    assert.ok(!('amount' in rec), 'a candidate carries no money figure, because the endpoint that '
      + 'produces one has no year parameter and its window is nobody named');
  }
});

/* ---------------------------------------------------------------------------------------------
 * ANALYSIS
 * ------------------------------------------------------------------------------------------- */

function analysisInput(overrides = {}) {
  const id = identity();
  return {
    identity: id,
    fiscalYear: 2025,
    awardTypeSetId: 'contracts',
    sourceAsOf: '09/21/2026',
    agencyRows: [{ name: 'Department of Defense', amount: 100 }],
    subagencyRows: [],
    pscRows: [],
    naicsRows: [],
    overTimePoints: [{ fiscalYear: 2025, obligations: 100 }],
    awardRows: [],
    awardRowsExcluded: 0,
    awardDetails: [],
    childRows: CHILDREN,
    parentReportedTotal: 30,
    ...overrides,
  };
}

test('analysis refuses to run against anything but a resolved identity', () => {
  assert.throws(() => assertAnalysisInput({ ...analysisInput(), identity: { name: 'X' } }), TypeError);
});

test('analysis refuses a period mismatch between the subject and the arithmetic', () => {
  assert.throws(() => assertAnalysisInput(analysisInput({ fiscalYear: 2024 })), TypeError);
  assert.throws(() => assertAnalysisInput(analysisInput({ awardTypeSetId: 'all' })), TypeError);
});

test('analysis requires the excluded row count, because a quietly shrunk denominator is wrong', () => {
  assert.throws(() => assertAnalysisInput(analysisInput({ awardRowsExcluded: undefined })), TypeError);
  assert.throws(() => assertAnalysisInput(analysisInput({ awardRowsExcluded: -1 })), TypeError);
  assert.doesNotThrow(() => assertAnalysisInput(analysisInput()));
});

test('a null parent total is refused rather than treated as a zero', () => {
  assert.throws(() => assertAnalysisInput(analysisInput({ parentReportedTotal: null })), TypeError);
});

test('a share never mixes unit kinds', () => {
  assert.throws(() => shareOf({
    numerator: 1, denominator: 2,
    numeratorUnitKind: OBLIGATIONS, denominatorUnitKind: AWARD_VALUE,
    method: METHODS.SOLE_BIDDER_SHARE, denominatorText: 'x of y',
    fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null,
  }), TypeError);
});

test('a share is a COMPUTED claim carrying its denominator', () => {
  const claim = shareOf({
    numerator: 269500000000,
    denominator: 421660000000,
    numeratorUnitKind: AWARD_VALUE,
    denominatorUnitKind: AWARD_VALUE,
    method: METHODS.SOLE_BIDDER_SHARE,
    denominatorText: 'Sum of award value where the record says not competed, over the sum across '
      + 'the largest 40 contracts active in the year.',
    fiscalYear: 2025,
    awardTypeSetId: 'contracts',
    sourceAsOf: '09/21/2026',
  });
  const r = renderClaim(claim);
  assert.equal(r.badge, 'COMPUTED');
  assert.equal(r.unitKind, 'share');
  assert.ok(r.valueText.endsWith('percent'));
  assert.ok(r.provenance.includes('largest 40'));
});

test('an empty denominator is unavailable, not zero percent', () => {
  assert.throws(() => shareOf({
    numerator: 1, denominator: 0,
    numeratorUnitKind: OBLIGATIONS, denominatorUnitKind: OBLIGATIONS,
    method: METHODS.ONE_CUSTOMER_SHARE, denominatorText: 'x of y',
    fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null,
  }), RangeError);
});

test('the concentration index recomputes from rows and ships its formula', () => {
  const rows = [{ name: 'A', amount: 75 }, { name: 'B', amount: 25 }];
  const claim = herfindahl(rows, { fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null });
  // 0.75 squared plus 0.25 squared is 0.625.
  assert.ok(Math.abs(renderClaim(claim).valueText.startsWith('62.5') ? 0 : 1) === 0);
  assert.ok(renderClaim(claim).provenance.includes('squares'));
  assert.throws(() => herfindahl([], { fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null }), TypeError);
});

test('the analysis output walker refuses a bare number where a figure belongs', () => {
  const good = {
    identity: identity(),
    soleBidder: {
      shareClaim: shareOf({
        numerator: 1, denominator: 2,
        numeratorUnitKind: AWARD_VALUE, denominatorUnitKind: AWARD_VALUE,
        method: METHODS.SOLE_BIDDER_SHARE, denominatorText: 'one of two',
        fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: null,
      }),
      excludedClaim: reported(0, TALLY, METHODS.AWARD_COMPETITION_FIELDS, { tallyNoun: 'excluded row' }),
    },
    notices: [],
    totalSuppressed: false,
  };
  assert.doesNotThrow(() => assertAnalysisOutput(good));

  const bad = { ...good, soleBidder: { ...good.soleBidder, shareClaim: 0.639 } };
  assert.throws(() => assertAnalysisOutput(bad), TypeError);

  const sneaky = { ...good, headlineTotal: 65405410468.25 };
  assert.throws(() => assertAnalysisOutput(sneaky), TypeError);
});

test('the bare number escape hatch is short and every key in it is structural', () => {
  assert.ok(ALLOWED_BARE_NUMBER_KEYS.size <= 8, 'the escape hatch is growing');
  for (const k of ALLOWED_BARE_NUMBER_KEYS) assert.equal(typeof k, 'string');
});

/* ---------------------------------------------------------------------------------------------
 * CHART
 * ------------------------------------------------------------------------------------------- */

function seriesFor(kind, id) {
  const claim = kind === SHARE
    ? computed(0.639, SHARE, METHODS.SOLE_BIDDER_SHARE, { ...META, denominatorText: 'one of two' })
    : reported(100, kind, kind === OBLIGATIONS ? METHODS.RECIPIENT_PROFILE_TOTAL : METHODS.AWARD_LIFETIME_VALUE, META);
  return {
    id,
    label: 'Series ' + id,
    unitKind: kind,
    dash: SERIES_DASHES[0],
    pattern: SEGMENT_PATTERNS[0],
    points: [{ label: 'FY2025', valueClaim: claim }],
  };
}

const TABLE = { columns: ['Fiscal year', 'Dollars obligated'], rows: [['FY2025', 'x']] };

test('a chart with two unit kinds cannot be constructed', () => {
  assert.throws(() => makeChartInput({
    form: 'columns',
    series: [seriesFor(OBLIGATIONS, 'a'), { ...seriesFor(AWARD_VALUE, 'b'), dash: SERIES_DASHES[1], pattern: SEGMENT_PATTERNS[1] }],
    figcaption: 'Two kinds',
    ariaLabel: 'FY2025, 100 and 100',
    table: TABLE,
    axisLabel: 'dollars obligated in the fiscal year',
  }), TypeError);
});

test('a chart with one unit kind builds and carries its ramp', () => {
  const chart = makeChartInput({
    form: 'columns',
    series: [seriesFor(OBLIGATIONS, 'a')],
    figcaption: 'Obligations by fiscal year',
    ariaLabel: 'FY2025, 100 dollars obligated, REPORTED',
    table: TABLE,
    axisLabel: 'dollars obligated in the fiscal year',
  });
  assert.equal(chart.unitKind, OBLIGATIONS);
  assert.equal(chart.rampId, 'obligations');
  assert.equal(chart.animatesValues, false);
  assert.ok(Object.isFrozen(chart));
});

test('a point whose claim disagrees with its own series is refused', () => {
  const s = seriesFor(OBLIGATIONS, 'a');
  s.points = [{ label: 'FY2025', valueClaim: reported(100, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, META) }];
  assert.throws(() => makeChartInput({
    form: 'columns', series: [s], figcaption: 'x', ariaLabel: 'FY2025, 100',
    table: TABLE, axisLabel: 'dollars obligated in the fiscal year',
  }), TypeError);
});

test('a chart draws only badged figures', () => {
  const s = seriesFor(OBLIGATIONS, 'a');
  s.points = [{ label: 'FY2025', valueClaim: 100 }];
  assert.throws(() => makeChartInput({
    form: 'columns', series: [s], figcaption: 'x', ariaLabel: 'FY2025, 100',
    table: TABLE, axisLabel: 'dollars obligated in the fiscal year',
  }), TypeError);
});

test('compare is capped at three series, because a fourth cannot be told apart', () => {
  const series = ['a', 'b', 'c', 'd'].map((id, i) => ({
    ...seriesFor(OBLIGATIONS, id),
    dash: SERIES_DASHES[i % SERIES_DASHES.length],
    pattern: SEGMENT_PATTERNS[i % SEGMENT_PATTERNS.length],
  }));
  assert.equal(MAX_COMPARE_SERIES, 3);
  assert.throws(() => makeChartInput({
    form: 'columns', series, figcaption: 'x', ariaLabel: 'FY2025, 100',
    table: TABLE, axisLabel: 'dollars obligated in the fiscal year',
  }), RangeError);
});

test('every series carries a dash and a pattern, because colour alone does not separate them', () => {
  const s = { ...seriesFor(OBLIGATIONS, 'a'), dash: 'sparkly' };
  assert.throws(() => makeChartInput({
    form: 'columns', series: [s], figcaption: 'x', ariaLabel: 'FY2025, 100',
    table: TABLE, axisLabel: 'dollars obligated in the fiscal year',
  }), RangeError);
});

test('the aria label must state the numbers and must not name a chart type', () => {
  assert.throws(() => assertAriaLabel('A bar chart of obligations'), TypeError);
  assert.throws(() => assertAriaLabel('Obligations by fiscal year'), TypeError);
  assert.doesNotThrow(() => assertAriaLabel('FY2025, 65.41B obligated, REPORTED'));
});

test('every chart ships an equivalent table whose headers carry the unit', () => {
  assert.throws(() => assertTable({ columns: ['Year', 'Amount'], rows: [] }), TypeError);
  assert.doesNotThrow(() => assertTable({ columns: ['Year', 'Dollars obligated'], rows: [] }));
  assert.throws(() => makeChartInput({
    form: 'columns', series: [seriesFor(OBLIGATIONS, 'a')], figcaption: 'x',
    ariaLabel: 'FY2025, 100', table: undefined, axisLabel: 'dollars obligated in the fiscal year',
  }), TypeError);
});

test('table rows are rendered through the claim system', () => {
  const rows = seriesToTableRows(seriesFor(OBLIGATIONS, 'a'));
  assert.equal(rows[0][0], 'FY2025');
  assert.ok(rows[0][1].includes('obligated'));
  assert.equal(rows[0][2], 'REPORTED');
});

test('there is no pie, and an unknown form is refused', () => {
  assert.ok(!CHART_FORMS.includes('pie'));
  assert.throws(() => makeChartInput({
    form: 'pie', series: [seriesFor(SHARE, 'a')], figcaption: 'x', ariaLabel: 'FY2025, 63.9',
    table: { columns: ['Segment', 'Share of award value'], rows: [] },
    axisLabel: 'percent of the stated denominator',
  }), RangeError);
});
