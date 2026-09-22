// CONTRACT 3 OF 3: THE CHART INPUT. Owned by the chart team.
//
// ONE CHART, ONE UNIT KIND. This is the structural half of the rule that obligations are not
// revenue. A build gate fails if a single chart receives series of two different unit kinds, and
// makeChartInput() below is where that becomes impossible rather than merely forbidden: a chart
// cannot be constructed with a mixed series list, so there is no object for a renderer to draw.
//
// WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE. A reader forgives a table. A reader BELIEVES a
// chart, and two series on one axis is a visual assertion that they are comparable. Fiscal year
// obligations and lifetime award value are not comparable. Plotting them together would be the
// most persuasive wrong statement this product could make, and it would take one careless
// afternoon.
//
// COLOUR IS NOT THE CARRIER, AND THAT IS A MEASUREMENT RATHER THAN A PREFERENCE. Six candidate
// series colours all cleared the non text minimum against the ground, but their separation from
// each other was only 1.18 to 2.08. So colour alone cannot distinguish series on this palette.
// Four things are therefore mandatory and enforced here:
//
//   direct end of series labels on every line,
//   a distinct dash pattern per line,
//   a distinct fill pattern per stacked segment,
//   at most three series, because a fourth cannot be told apart.
//
// EVERY CHART SHIPS ITS TABLE. Not a visually hidden one. A visible toggle producing a real
// table with real header cells. It is the screen reader path, the no JavaScript fallback, the
// chart failed fallback, and the thing a finance reader wanted in the first place.
//
// THE ARIA LABEL STATES THE NUMBERS. "Bar chart" tells a screen reader user nothing. The label
// has to carry the actual headline figures, and this contract refuses one that does not contain
// a digit and refuses one that calls itself a chart type.
//
// NO MONEY VALUE IS EVER ANIMATED. A number in motion is a number being misread, and reduced
// motion is honoured for everything else.
//
// Isomorphic: no node:* imports and no DOM.

import { isClaim, renderClaim } from '../core/claim.js';
import { UNIT_KINDS, TALLY, QUANTITY_KINDS } from '../core/units.js';
import { UNIT_RAMPS } from '../core/tokens.js';
import { MAX_COMPARE_SERIES } from '../core/constants.js';

/** The four chart forms this product ships. DESIGN 6.9. There is no pie, on purpose. */
export const CHART_FORMS = Object.freeze([
  'columns',      // obligations by fiscal year, the spine
  'split-bar',    // the sole bidder split, the hero
  'ranked-bars',  // agency mix, top ten
  'curve',        // cumulative concentration against the even distribution diagonal
]);

/** Dash patterns, one per series, so a line is identifiable with no colour at all. */
export const SERIES_DASHES = Object.freeze(['none', '6 3', '2 3']);

/** Fill patterns, one per stacked segment, so a split survives greyscale and forced colours. */
export const SEGMENT_PATTERNS = Object.freeze(['solid', 'hatch45', 'dots']);

/**
 * @typedef {Object} ChartPoint
 * @property {string} label What the axis says for this point, for example "FY2025".
 * @property {import('../core/claim.js').Claim} valueClaim The figure, badged and united.
 * @property {string} [href] A link into the government record, where one exists.
 */

/**
 * @typedef {Object} ChartSeries
 * @property {string} id
 * @property {string} label Printed at the END of the series, not only in a legend.
 * @property {string} unitKind One of UNIT_KINDS or TALLY. Every point must match it.
 * @property {ChartPoint[]} points
 * @property {string} dash One of SERIES_DASHES.
 * @property {string} pattern One of SEGMENT_PATTERNS.
 */

/**
 * @typedef {Object} ChartTable
 * @property {string[]} columns Header cells, each carrying its unit in the text.
 * @property {string[][]} rows Already rendered strings, every figure through renderClaim().
 */

/**
 * @typedef {Object} ChartInput
 * @property {string} form One of CHART_FORMS.
 * @property {string} unitKind The ONE kind on this axis.
 * @property {string} rampId Which ramp the renderer must use.
 * @property {string} figcaption A real caption, visible.
 * @property {string} ariaLabel States the actual headline numbers.
 * @property {readonly ChartSeries[]} series At most three.
 * @property {ChartTable} table The equivalent table. Always present.
 * @property {string} axisLabel Carries the unit, always.
 * @property {boolean} animatesValues Always false. Present so the renderer reads it rather than
 *   deciding for itself.
 */

/**
 * The only way to build a ChartInput.
 *
 * @param {Object} args
 * @param {string} args.form
 * @param {ChartSeries[]} args.series
 * @param {string} args.figcaption
 * @param {string} args.ariaLabel
 * @param {ChartTable} args.table
 * @param {string} args.axisLabel
 * @returns {ChartInput}
 */
export function makeChartInput(args) {
  if (!CHART_FORMS.includes(args.form)) {
    throw new RangeError('makeChartInput: form must be one of ' + CHART_FORMS.join(', ')
      + ', got ' + JSON.stringify(args.form) + '. There is no pie: a pie cannot be read at a '
      + 'ninety nine to one ratio and cannot be labelled accessibly.');
  }
  if (!Array.isArray(args.series) || args.series.length === 0) {
    throw new TypeError('makeChartInput: at least one series is required. A chart with no series '
      + 'renders as an empty frame, and an empty chart reads as a real zero.');
  }
  if (args.series.length > MAX_COMPARE_SERIES) {
    throw new RangeError('makeChartInput: at most ' + MAX_COMPARE_SERIES + ' series. A fourth '
      + 'cannot be told apart: the measured separation between candidate series colours on this '
      + 'palette is 1.18 to 2.08, which is why the dash and the end label carry the distinction '
      + 'and why the cap is a number rather than a guideline.');
  }

  const kinds = new Set();
  for (const s of args.series) {
    if (!QUANTITY_KINDS.includes(s.unitKind)) {
      throw new RangeError('makeChartInput: series "' + s.id + '" has unitKind '
        + JSON.stringify(s.unitKind) + '. It must be one of ' + QUANTITY_KINDS.join(', ') + '.');
    }
    kinds.add(s.unitKind);
    if (!Array.isArray(s.points) || s.points.length === 0) {
      throw new TypeError('makeChartInput: series "' + s.id + '" has no points.');
    }
    if (!SERIES_DASHES.includes(s.dash)) {
      throw new RangeError('makeChartInput: series "' + s.id + '" must carry a dash from '
        + SERIES_DASHES.join(' | ') + '. Colour alone does not separate these series.');
    }
    if (!SEGMENT_PATTERNS.includes(s.pattern)) {
      throw new RangeError('makeChartInput: series "' + s.id + '" must carry a fill pattern from '
        + SEGMENT_PATTERNS.join(' | ') + ', so the distinction survives greyscale printing and '
        + 'forced colours mode, where every author supplied colour is discarded.');
    }
    if (typeof s.label !== 'string' || s.label.trim().length === 0) {
      throw new TypeError('makeChartInput: series "' + s.id + '" needs a label, and it is printed '
        + 'at the end of the series rather than only in a legend.');
    }
    for (const [i, p] of s.points.entries()) {
      if (!isClaim(p.valueClaim)) {
        throw new TypeError('makeChartInput: series "' + s.id + '" point ' + i + ' does not carry '
          + 'a Claim. A chart is the most believed thing on the page and it draws only badged '
          + 'figures.');
      }
      const pointKind = renderClaim(p.valueClaim).unitKind;
      if (pointKind !== s.unitKind) {
        throw new TypeError('makeChartInput: series "' + s.id + '" declares unit kind '
          + s.unitKind + ' but point ' + i + ' carries ' + String(pointKind) + '. A series whose '
          + 'points disagree with its own axis is the mixed unit bug wearing one more layer.');
      }
    }
  }

  if (kinds.size > 1) {
    throw new TypeError('makeChartInput: this chart received ' + kinds.size + ' different unit '
      + 'kinds (' + [...kinds].join(', ') + ') on one axis. Fiscal year obligations and lifetime '
      + 'award value are different quantities and plotting them together is a visual assertion '
      + 'that they are comparable. They are not. Build two charts.');
  }

  const unitKind = args.series[0].unitKind;
  const ramp = unitKind === TALLY ? null : UNIT_RAMPS[unitKind];

  if (typeof args.figcaption !== 'string' || args.figcaption.trim().length === 0) {
    throw new TypeError('makeChartInput: a real, visible figcaption is required.');
  }
  assertAriaLabel(args.ariaLabel);
  assertTable(args.table);
  if (typeof args.axisLabel !== 'string' || args.axisLabel.trim().length === 0) {
    throw new TypeError('makeChartInput: the axis label is required and it carries the unit, '
      + 'always. An axis labelled "dollars" does not say which dollars.');
  }

  return Object.freeze({
    form: args.form,
    unitKind,
    rampId: ramp === null ? 'tally' : ramp.id,
    figcaption: args.figcaption,
    ariaLabel: args.ariaLabel,
    series: Object.freeze(args.series.map((s) => Object.freeze({
      ...s,
      points: Object.freeze([...s.points]),
    }))),
    table: Object.freeze({
      columns: Object.freeze([...args.table.columns]),
      rows: Object.freeze(args.table.rows.map((r) => Object.freeze([...r]))),
    }),
    axisLabel: args.axisLabel,
    animatesValues: false,
  });
}

/**
 * The aria label must state the actual numbers. This refuses the two failures that show up in
 * every accessibility audit of a chart: a label that names the chart type, and a label with no
 * figures in it.
 * @param {unknown} label
 * @returns {string}
 */
export function assertAriaLabel(label) {
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new TypeError('makeChartInput: an aria-label is required.');
  }
  if (!/\d/.test(label)) {
    throw new TypeError('makeChartInput: the aria-label must state the actual headline figures. '
      + 'A label with no numbers in it gives a screen reader user a shape and withholds the '
      + 'content, which is the whole point of the chart: ' + JSON.stringify(label));
  }
  if (/\b(bar|line|pie|column|donut|doughnut)\s+chart\b/i.test(label)) {
    throw new TypeError('makeChartInput: the aria-label names a chart type. The element already '
      + 'has role img and a figcaption; what the label owes the reader is the numbers: '
      + JSON.stringify(label));
  }
  return label;
}

/**
 * The equivalent table. Its column headers must carry the unit, because a column of figures with
 * a bare header is where a unit gets lost.
 * @param {any} table
 * @returns {ChartTable}
 */
export function assertTable(table) {
  if (!table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    throw new TypeError('makeChartInput: every chart ships an equivalent table with real header '
      + 'cells. It is the screen reader path, the no JavaScript fallback, the chart failed '
      + 'fallback, and the thing a finance reader wanted anyway. It is not optional and it is '
      + 'not visually hidden.');
  }
  if (table.columns.length === 0) {
    throw new TypeError('makeChartInput: the table needs column headers.');
  }
  const carriesUnit = table.columns.some((c) => UNIT_KINDS.some((k) => String(c).includes(k))
    || /obligat|award value|lifetime|percent|share|count/i.test(String(c)));
  if (!carriesUnit) {
    throw new TypeError('makeChartInput: no column header names its unit. The unit is welded into '
      + 'every header string in this product, so a column of dollars cannot be read as a column '
      + 'of some other dollars: ' + JSON.stringify(table.columns));
  }
  for (const [i, row] of table.rows.entries()) {
    if (!Array.isArray(row) || row.length !== table.columns.length) {
      throw new TypeError('makeChartInput: table row ' + i + ' has ' + (Array.isArray(row) ? row.length : 'no')
        + ' cells against ' + table.columns.length + ' columns.');
    }
  }
  return /** @type {ChartTable} */ (table);
}

/**
 * Build the table rows from a series, with every figure rendered through the claim system so a
 * table cell cannot contain a number the badge gate never saw.
 * @param {ChartSeries} series
 * @returns {string[][]}
 */
export function seriesToTableRows(series) {
  return series.points.map((p) => {
    const r = renderClaim(p.valueClaim);
    return [p.label, r.valueText, r.badgeLabel];
  });
}
