// YEAR OVER YEAR. DESIGN C3 and DESIGN 2.2.
//
// The formula has one line and four ways of having no answer, and every one of those four
// appears in the real recorded data or in a fixture built to match it. None of them may render
// as a zero, an infinity or a blank.

import test from 'node:test';
import assert from 'node:assert/strict';

import { yearOverYear, obligationsByYear, indexByFiscalYear, CHANGE_UNAVAILABLE } from '../src/analysis/over-time.js';
import { renderClaim } from '../src/core/claim.js';
import { validateSpendingOverTime } from '../src/query/endpoints.js';
import { hand, recorded, META, close, renderAll } from './_analysis-helpers.js';

const OT_META = { awardTypeSetId: META.awardTypeSetId, sourceAsOf: META.sourceAsOf };

/* ---------------------------------------------------------------------------------------- *
 * THE HAND BUILT SERIES.
 * ---------------------------------------------------------------------------------------- */

test('the change is the year minus the year before, over the year before', () => {
  const fx = hand('over-time');
  const r = yearOverYear({ points: fx.points, fiscalYear: 2023, meta: OT_META });
  assert.equal(r.available, true);
  assert.equal(r.direction, fx.arithmetic.fy2023.direction);
  assert.equal(r.deltaClaim.value, fx.arithmetic.fy2023.delta);
  close(assert, r.changeShareClaim.value, fx.arithmetic.fy2023.share, 1e-15, fx.arithmetic.fy2023.working);
  assert.equal(renderClaim(r.changeShareClaim).valueText, '20.0 percent');
  assert.equal(r.currentClaim.value, 1200);
  assert.equal(r.priorClaim.value, 1000);
  assert.equal(r.priorLabel, 'FY2022');
});

test('a fall of exactly one hundred percent publishes, with the direction as a word', () => {
  const fx = hand('over-time');
  const r = yearOverYear({ points: fx.points, fiscalYear: 2024, meta: OT_META });
  assert.equal(r.available, true);
  assert.equal(r.direction, 'decrease');
  assert.equal(r.deltaClaim.value, fx.arithmetic.fy2024.delta);
  assert.equal(r.changeShareClaim.value, 1);
  assert.equal(renderClaim(r.changeShareClaim).valueText, '100.0 percent');
  assert.ok(renderClaim(r.changeShareClaim).provenance.includes('decrease'),
    'the figure is a magnitude, so the direction travels with it in words rather than in a sign '
    + 'the reader has to notice');
});

test('A YEAR WITH NO AWARDS IS NEVER DIVIDED BY', () => {
  const fx = hand('over-time');
  const r = yearOverYear({ points: fx.points, fiscalYear: 2025, meta: OT_META });
  assert.equal(r.available, false);
  assert.equal(r.reason, CHANGE_UNAVAILABLE.ZERO_PRIOR_YEAR);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'changeShareClaim'), false);
  assert.equal(r.deltaClaim.value, fx.arithmetic.fy2025.delta,
    'the change is still fully described, in dollars, which is the unit both years are in');
  assert.equal(r.currentClaim.value, 600);
  assert.equal(r.priorClaim.value, 0);
  assert.equal(r.direction, 'increase');
});

test('the first year in a set reports no change rather than a change of zero', () => {
  const fx = hand('over-time');
  const r = yearOverYear({ points: fx.points, fiscalYear: 2022, meta: OT_META });
  assert.equal(r.available, false);
  assert.equal(r.reason, CHANGE_UNAVAILABLE.NO_PRIOR_YEAR);
  assert.equal(r.direction, null);
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'deltaClaim'), false);
  assert.equal(r.currentClaim.value, 1000, 'the year itself is still reported');
});

test('a year that is not in the set at all says so', () => {
  const fx = hand('over-time');
  const r = yearOverYear({ points: fx.points, fiscalYear: 2019, meta: OT_META });
  assert.equal(r.available, false);
  assert.ok(r.reason.includes('FY2019'));
  assert.equal(Object.prototype.hasOwnProperty.call(r, 'currentClaim'), false);
});

test('A RISE OF MORE THAN ONE HUNDRED PERCENT IS CARRIED IN DOLLARS, NOT AS A PERCENTAGE', () => {
  const fx = hand('over-time-edge');
  const r = yearOverYear({ points: fx.growthBeyondRange.points, fiscalYear: 2025, meta: OT_META });
  assert.equal(r.available, false);
  assert.equal(r.reason, CHANGE_UNAVAILABLE.BEYOND_RENDERABLE_RANGE);
  assert.equal(r.deltaClaim.value, fx.growthBeyondRange.delta);
  assert.equal(r.direction, 'increase');
  assert.equal(r.currentClaim.value, 300);
  assert.equal(r.priorClaim.value, 100);
  assert.ok(renderClaim(r.deltaClaim).valueText.includes('obligated'),
    'the change is in the same unit as both years and it says so');
});

test('a negative year before is not a base to measure a percentage against', () => {
  const fx = hand('over-time-edge');
  const r = yearOverYear({ points: fx.negativePriorYear.points, fiscalYear: 2025, meta: OT_META });
  assert.equal(r.available, false);
  assert.equal(r.reason, CHANGE_UNAVAILABLE.NEGATIVE_PRIOR_YEAR);
  assert.equal(r.deltaClaim.value, fx.negativePriorYear.delta);
});

test('two rows for one fiscal year are refused loudly', () => {
  assert.throws(
    () => indexByFiscalYear([{ fiscalYear: 2025, obligations: 1 }, { fiscalYear: 2025, obligations: 2 }]),
    /appears twice/,
    'two rows for one year is the shape a mismatched period takes by the time it gets here',
  );
});

test('a point with no integer year and a point with no figure are both refused', () => {
  assert.throws(() => indexByFiscalYear([{ fiscalYear: '2025', obligations: 1 }]), /integer fiscalYear/);
  assert.throws(() => indexByFiscalYear([{ fiscalYear: 2025, obligations: null }]), /non finite/);
});

/* ---------------------------------------------------------------------------------------- *
 * THE SPINE.
 * ---------------------------------------------------------------------------------------- */

test('the spine is sorted ascending regardless of the order the endpoint used', () => {
  const fx = hand('over-time');
  const shuffled = [fx.points[2], fx.points[0], fx.points[3], fx.points[1]];
  const s = obligationsByYear({ points: shuffled, meta: OT_META });
  assert.deepEqual(s.points.map((p) => p.fiscalYear), [2022, 2023, 2024, 2025]);
  assert.equal(s.firstLabel, 'FY2022');
  assert.equal(s.lastLabel, 'FY2025');
});

test('an empty fiscal year series plots nothing rather than a flat line at zero', () => {
  const s = obligationsByYear({ points: [], meta: OT_META });
  assert.equal(s.available, false);
  assert.deepEqual(s.points, []);
  assert.equal(s.firstLabel, null);
  assert.ok(s.reason.includes('nothing to plot'));
});

/* ---------------------------------------------------------------------------------------- *
 * THE RECORDED SERIES. This is where the renderable range limit stops being theoretical.
 * ---------------------------------------------------------------------------------------- */

test('RECOMPUTES THE RECORDED FISCAL YEAR SERIES, TEN YEARS', () => {
  const { points } = validateSpendingOverTime(recorded('spending-over-time-fy2016-2025'));
  const s = obligationsByYear({ points, meta: OT_META });
  assert.equal(s.available, true);
  assert.equal(s.points.length, 10);
  assert.equal(s.firstLabel, 'FY2016');
  assert.equal(s.lastLabel, 'FY2025');
  assert.equal(s.points[9].obligationsClaim.value, 64734245175.25);
  assert.equal(s.points[8].obligationsClaim.value, 31666317852.26);
  assert.equal(s.points[9].obligationsClaim.unitKind, 'obligations');
});

test('THE RECORDED HEADLINE YEAR RISES MORE THAN ONE HUNDRED PERCENT AND HAS NO PERCENTAGE', () => {
  const { points } = validateSpendingOverTime(recorded('spending-over-time-fy2016-2025'));
  const r = yearOverYear({ points, fiscalYear: 2025, meta: OT_META });

  close(assert, r.deltaClaim.value, 33067927322.99, 1e-4,
    '64,734,245,175.25 less 31,666,317,852.26.');
  assert.equal(r.direction, 'increase');
  assert.equal(r.available, false);
  assert.equal(r.reason, CHANGE_UNAVAILABLE.BEYOND_RENDERABLE_RANGE,
    'the ratio is 1.0442618392599117, which is a rise of 104.4 percent. The share unit kind on '
    + 'this page is a proportion between nought and one hundred percent, so this figure has no '
    + 'kind it can be rendered as. It is carried in dollars instead. This is not an edge case '
    + 'invented for a test: it is the most recent year of the most searched company in the '
    + 'dataset, and it is recorded in the handover as a gap in the unit contract.');
});

test('an earlier recorded year whose change does fit publishes a percentage', () => {
  const { points } = validateSpendingOverTime(recorded('spending-over-time-fy2016-2025'));
  const r = yearOverYear({ points, fiscalYear: 2023, meta: OT_META });
  assert.equal(r.available, true);
  assert.equal(r.direction, 'decrease');
  close(assert, r.deltaClaim.value, -11051634851.84, 1e-4,
    '35,632,423,406.18 less 46,684,058,258.02.');
  close(assert, r.changeShareClaim.value, 0.2367325220690599, 1e-12,
    'the magnitude of that fall over the year before it, 11,051,634,851.84 over '
    + '46,684,058,258.02.');
  assert.equal(renderClaim(r.changeShareClaim).valueText, '23.7 percent');
});

test('NO FIGURE IN ANY YEAR OVER YEAR RESULT RENDERS AS A FAILED DIVISION', () => {
  const { points } = validateSpendingOverTime(recorded('spending-over-time-fy2016-2025'));
  const all = [obligationsByYear({ points, meta: OT_META })];
  for (const name of ['over-time']) {
    const fx = hand(name);
    all.push(obligationsByYear({ points: fx.points, meta: OT_META }));
  }
  for (const text of renderAll(all)) {
    assert.equal(/NaN|Infinity|undefined/.test(text), false, 'produced "' + text + '"');
  }
});
