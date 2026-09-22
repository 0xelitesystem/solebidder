// The charts. Hand written SVG, no library, and every accessibility requirement in DESIGN 6.8
// asserted rather than assumed.
//
// The three things these tests exist to stop shipping:
//
//   A chart that is a picture only. Every one here carries a visible caption, an accessible
//   label stating the real figures, and a VISIBLE toggle to an equivalent table whose headers
//   name their unit. A screen reader user and a finance reader get the same content.
//   A chart nobody can reach from a keyboard. One tab stop, then the arrows, then escape, with
//   the focused point announced in a live region. A roving tabindex over forty bars would flood
//   the tab order of a page that already has three other controls.
//   A chart whose meaning is carried by colour. Obligations and lifetime award value are drawn
//   with different fill patterns as well as different ramps, and the pattern is what survives
//   greyscale printing and forced colours mode.

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderChart, buildTable, wireKeyboard, GEO } from '../src/ui/charts.js';
import { makeChartInput, seriesToTableRows } from '../src/contracts/chart.js';
import { reported, computed, METHODS } from '../src/core/claim.js';
import { OBLIGATIONS, AWARD_VALUE, SHARE } from '../src/core/units.js';
import { UNIT_RAMPS, MONEY_RAMP_PAIR } from '../src/core/tokens.js';
import { createDocument } from './helpers/mini-dom.js';
import { META } from './helpers/ui-fixtures.js';

const doc = createDocument();

function obligationsChart() {
  const series = {
    id: 's',
    label: 'TEST PARENT ENTITY',
    unitKind: OBLIGATIONS,
    dash: 'none',
    pattern: 'solid',
    points: [2023, 2024, 2025].map((fy, i) => ({
      label: 'FY' + fy,
      valueClaim: reported((i + 1) * 100, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, {
        ...META, fiscalYear: fy,
      }),
    })),
  };
  return makeChartInput({
    form: 'columns',
    series: [series],
    figcaption: 'Obligations by fiscal year for the test entity.',
    ariaLabel: 'The most recent column is 300 dollars obligated.',
    table: { columns: ['Fiscal year', 'Dollars obligated', 'Badge'], rows: seriesToTableRows(series) },
    axisLabel: 'dollars obligated in the fiscal year',
  });
}

function awardValueChart() {
  const series = {
    id: 'a',
    label: 'lifetime award value',
    unitKind: AWARD_VALUE,
    dash: '6 3',
    pattern: 'hatch45',
    points: [
      { label: 'TESTAWARD0001', valueClaim: reported(600, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, META) },
      { label: 'TESTAWARD0002', valueClaim: reported(300, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, META) },
    ],
  };
  return makeChartInput({
    form: 'ranked-bars',
    series: [series],
    figcaption: 'The largest contracts by lifetime award value.',
    ariaLabel: 'The largest is 600 dollars in lifetime award value.',
    table: {
      columns: ['Award identifier', 'Lifetime award value', 'Badge'],
      rows: seriesToTableRows(series),
    },
    axisLabel: 'lifetime award value, exercised options included',
  });
}

function shareChart(form = 'split-bar') {
  const claim = computed(0.639, SHARE, METHODS.SOLE_BIDDER_SHARE, {
    ...META,
    denominatorText: 'A of B across the test set.',
  });
  const series = {
    id: 'share',
    label: 'awarded with exactly one bidder',
    unitKind: SHARE,
    dash: 'none',
    pattern: 'solid',
    points: [{ label: 'Awarded with exactly one bidder', valueClaim: claim }],
  };
  return makeChartInput({
    form,
    series: [series],
    figcaption: 'The share awarded with exactly one bidder.',
    ariaLabel: '63.9 percent of the stated denominator.',
    table: { columns: ['Segment', 'Share of lifetime award value', 'Badge'], rows: seriesToTableRows(series) },
    axisLabel: 'percent of the stated denominator',
  });
}

test('every chart is a figure with a VISIBLE caption and an image role stating the figures', () => {
  for (const input of [obligationsChart(), awardValueChart(), shareChart()]) {
    const fig = renderChart(doc, input);
    assert.equal(fig.tagName, 'figure');
    const caption = fig.querySelector('figcaption');
    assert.ok(caption, 'no figcaption');
    assert.ok(caption.textContent.length > 20, 'the caption must say something');
    const svg = fig.querySelector('svg');
    assert.equal(svg.getAttribute('role'), 'img');
    assert.match(svg.getAttribute('aria-label'), /\d/, 'the label must carry the numbers');
    assert.doesNotMatch(svg.getAttribute('aria-label'), /\b(bar|line|pie|column) chart\b/i);
  }
});

test('ONE TAB STOP per chart, never one per bar', () => {
  const fig = renderChart(doc, obligationsChart());
  const focusable = fig.querySelectorAll('[tabindex]');
  assert.equal(focusable.length, 1, 'a chart is one tab stop');
  assert.equal(focusable[0].getAttribute('tabindex'), '0');
});

test('the table toggle is visible, is a real button, and controls the table it names', () => {
  const fig = renderChart(doc, obligationsChart(), { idBase: 'toggle-case' });
  const toggle = fig.querySelector('.chart-table-toggle');
  assert.equal(toggle.tagName, 'button');
  assert.equal(toggle.getAttribute('type'), 'button');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), 'toggle-case-table');

  const table = fig.querySelector('.tablewrap');
  assert.equal(table.getAttribute('id'), 'toggle-case-table');
  assert.ok(table.hasAttribute('hidden'));

  toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(table.hasAttribute('hidden'), false);
  assert.match(toggle.textContent, /Hide/);

  toggle.dispatch('click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.ok(table.hasAttribute('hidden'));
});

test('the equivalent table has real header cells and every figure to the cent', () => {
  const input = obligationsChart();
  const wrap = buildTable(doc, input, 'tbl');
  const headers = wrap.querySelectorAll('th');
  assert.equal(headers.length, input.table.columns.length);
  for (const th of headers) assert.equal(th.getAttribute('scope'), 'col');
  assert.match(wrap.textContent, /obligated/, 'a column header must name its unit');
  assert.match(wrap.textContent, /100\.00/, 'the table carries the full value');
});

test('KEYBOARD: arrows move, home and end jump, escape leaves, and each point is announced', () => {
  const fig = renderChart(doc, obligationsChart(), { idBase: 'kb' });
  const svg = fig.querySelector('svg');
  const live = fig.querySelector('.chart-live');
  assert.equal(live.getAttribute('aria-live'), 'polite');
  assert.equal(live.textContent, '', 'nothing is announced before the reader arrives');

  svg.dispatch('keydown', { key: 'ArrowRight' });
  assert.match(live.textContent, /FY2023/);
  assert.match(live.textContent, /obligated/, 'the announcement carries the unit');
  assert.match(live.textContent, /REPORTED/, 'the announcement carries the badge');

  svg.dispatch('keydown', { key: 'End' });
  assert.match(live.textContent, /FY2025/);

  svg.dispatch('keydown', { key: 'Home' });
  assert.match(live.textContent, /FY2023/);

  svg.dispatch('keydown', { key: 'ArrowLeft' });
  assert.match(live.textContent, /FY2023/, 'the first point is the floor, not a wrap around');

  svg.dispatch('keydown', { key: 'Escape' });
  assert.equal(live.textContent, '');
});

test('the focus indicator is drawn OUTSIDE the mark, so its ground is the plot rather than a fill', () => {
  const fig = renderChart(doc, obligationsChart(), { idBase: 'focus' });
  const svg = fig.querySelector('svg');
  const ring = fig.querySelector('.chart-focus');
  assert.ok(ring.hasAttribute('hidden'), 'the ring is absent until a point is focused');

  svg.dispatch('keydown', { key: 'Home' });
  assert.equal(ring.hasAttribute('hidden'), false);

  const marks = fig.querySelectorAll('.mark');
  const first = marks[0];
  const ringX = Number(ring.getAttribute('x'));
  const ringW = Number(ring.getAttribute('width'));
  const markX = Number(first.getAttribute('x'));
  const markW = Number(first.getAttribute('width'));
  assert.ok(ringX < markX, 'the ring starts left of the mark');
  assert.ok(ringX + ringW > markX + markW, 'the ring ends right of the mark');
});

test('an unhandled key is left alone, so the page still scrolls and tabs', () => {
  const fig = renderChart(doc, obligationsChart());
  const svg = fig.querySelector('svg');
  let prevented = false;
  svg.dispatch('keydown', { key: 'Tab', preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('blur clears the live region rather than leaving a stale announcement', () => {
  const fig = renderChart(doc, obligationsChart());
  const svg = fig.querySelector('svg');
  const live = fig.querySelector('.chart-live');
  svg.dispatch('keydown', { key: 'Home' });
  assert.notEqual(live.textContent, '');
  svg.dispatch('blur');
  assert.equal(live.textContent, '');
});

test('OBLIGATIONS AND LIFETIME AWARD VALUE GET DIFFERENT RAMPS AND DIFFERENT PATTERNS', () => {
  const obligations = renderChart(doc, obligationsChart(), { idBase: 'ob' });
  const awards = renderChart(doc, awardValueChart(), { idBase: 'av' });

  assert.equal(obligations.getAttribute('data-ramp'), 'obligations');
  assert.equal(awards.getAttribute('data-ramp'), 'awardValue');
  assert.equal(obligations.getAttribute('data-unit-kind'), 'obligations');
  assert.equal(awards.getAttribute('data-unit-kind'), 'awardValue');

  assert.ok(obligations.querySelector('.mark').className.includes('ramp-obligations'));
  assert.ok(awards.querySelector('.mark').className.includes('ramp-award-value'));

  // The pattern, not the colour, is the carrier. The obligations chart has no pattern overlay
  // and the award value chart has one per mark.
  assert.equal(obligations.querySelectorAll('.mark-pattern').length, 0);
  assert.equal(awards.querySelectorAll('.mark-pattern').length, 2);
  const overlay = awards.querySelector('.mark-pattern');
  assert.equal(overlay.getAttribute('fill'), 'url(#av-hatch45)');
});

test('the pattern definitions are scoped per chart, so two charts cannot collide', () => {
  const a = renderChart(doc, awardValueChart(), { idBase: 'first' });
  const b = renderChart(doc, awardValueChart(), { idBase: 'second' });
  assert.equal(a.querySelector('pattern').getAttribute('id'), 'first-hatch45');
  assert.equal(b.querySelector('pattern').getAttribute('id'), 'second-hatch45');
});

test('the two money ramps differ in colour, in pattern AND in forced colours system colour', () => {
  const [a, b] = MONEY_RAMP_PAIR.map((id) => UNIT_RAMPS[id]);
  assert.notEqual(a.dark, b.dark);
  assert.notEqual(a.light, b.light);
  assert.notEqual(a.pattern, b.pattern);
  assert.notEqual(a.forcedColors, b.forcedColors);
});

test('a chart carrying two unit kinds cannot be constructed, so it cannot be rendered', () => {
  const obligation = reported(100, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, META);
  const award = reported(200, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, META);
  assert.throws(() => makeChartInput({
    form: 'columns',
    series: [
      { id: 'a', label: 'obligations', unitKind: OBLIGATIONS, dash: 'none', pattern: 'solid', points: [{ label: 'FY2025', valueClaim: obligation }] },
      { id: 'b', label: 'award value', unitKind: AWARD_VALUE, dash: '6 3', pattern: 'hatch45', points: [{ label: 'FY2025', valueClaim: award }] },
    ],
    figcaption: 'Two kinds on one axis.',
    ariaLabel: '100 and 200.',
    table: { columns: ['Fiscal year', 'Dollars obligated'], rows: [['FY2025', 'x']] },
    axisLabel: 'dollars obligated in the fiscal year',
  }), /different unit/);
});

test('the renderer refuses a hand built object and refuses an animated value', () => {
  assert.throws(() => renderChart(doc, { form: 'columns' }), /makeChartInput/);
  const input = { ...obligationsChart(), animatesValues: true };
  assert.throws(() => renderChart(doc, input), /never animated/);
});

test('a ranked chart grows with its rows and a column chart does not', () => {
  const columns = renderChart(doc, obligationsChart());
  assert.match(columns.querySelector('svg').getAttribute('viewBox'), new RegExp(String(GEO.columnsHeight) + '$'));
  const ranked = renderChart(doc, awardValueChart());
  const expected = GEO.padTop + GEO.padBottom + 2 * GEO.rowHeight;
  assert.match(ranked.querySelector('svg').getAttribute('viewBox'), new RegExp(String(expected) + '$'));
});

test('a split bar on a share axis measures against the whole track, not against itself', () => {
  const fig = renderChart(doc, shareChart('split-bar'), { idBase: 'split' });
  const measured = fig.querySelectorAll('.mark').filter((m) => !m.className.includes('mark-remainder'));
  const width = Number(measured[0].getAttribute('width'));
  const track = GEO.width - 20 - 24;
  // A bar that filled the whole track would be the claim that every contract had one bidder,
  // which is not what a share of 0.639 says.
  assert.ok(width < track * 0.75, 'the segment must be a fraction of the track');
  assert.ok(width > track * 0.55);

  // The rest of the track is drawn, hatched, and labelled in words with NO figure of its own.
  const remainder = fig.querySelector('.mark-remainder');
  assert.ok(remainder, 'the remainder of the denominator must be visible');
  assert.ok(Number(remainder.getAttribute('width')) > track * 0.3);
  assert.match(fig.textContent, /the rest of the stated denominator/);
});

test('the unit key ships with every chart, naming the quantity and what it is not', () => {
  const fig = renderChart(doc, awardValueChart());
  const key = fig.querySelector('.unit-key');
  assert.ok(key);
  assert.equal(key.getAttribute('data-unit-kind'), 'awardValue');
  assert.match(key.textContent, /lifetime/i);
});

test('wireKeyboard works on a chart with no focus rectangle, rather than throwing', () => {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const live = doc.createElement('p');
  const claim = reported(1, OBLIGATIONS, METHODS.SPENDING_OVER_TIME, META);
  const handle = wireKeyboard(svg, [{ x: 0, y: 0, w: 1, h: 1, point: { label: 'FY2025', valueClaim: claim } }], live);
  assert.equal(handle.count, 1);
  svg.dispatch('keydown', { key: 'Home' });
  assert.match(live.textContent, /FY2025/);
});
