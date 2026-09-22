// THE CHART SHAPER. It turns Claims the analysis layer already built into ChartInputs.
//
// WHAT IT DELIBERATELY DOES NOT DO: arithmetic. Every figure that reaches this file arrived as
// a Claim from src/analysis, which is where the shares, the index and the rollup are computed
// and where each one is guarded by an `available` flag and a `reason` sentence. A second copy of
// a money computation living in the render layer is a second copy that can drift away from the
// first, and drift in this product means two different numbers for the same question.
//
// WHAT IT IS FOR: the decisions that genuinely belong to the page. Which form a figure takes,
// which ramp and which fill pattern carry it, what the caption says, what the accessible label
// states, and which column headers the equivalent table uses. All of those go through
// makeChartInput() in src/contracts/chart.js, which refuses a second unit kind on one axis, a
// fourth series, a caption that is missing, an accessible label with no figures in it, and a
// table whose headers do not name their unit.
//
// THE UNIT KIND DECIDES THE RAMP, AND THE RAMP IS NOT A STYLE CHOICE. Obligations are drawn on
// the accent ramp with a solid fill. Lifetime award value is drawn on a neutral ramp with a
// diagonal hatch. Both appear on this page, in two charts, on purpose: the reader is shown the
// two quantities side by side and given a visible reason not to read them as one series, and the
// hatch is what carries that in greyscale and in forced colours where the colours are discarded.
//
// Isomorphic: no node:* imports, no DOM.

import { renderClaim } from '../core/claim.js';
import { OBLIGATIONS, AWARD_VALUE, SHARE } from '../core/units.js';
import { makeChartInput, seriesToTableRows } from '../contracts/chart.js';
import { AWARD_TYPE_SETS } from '../core/constants.js';

/** How many rows a ranked chart shows before the rest go to the table only. */
export const RANKED_ROWS = 10;

/** How many receipt rows sit under the hero bar. DESIGN 5. */
export const RECEIPT_ROWS = 4;

/** The value text of a Claim, for building a caption or an accessible label. */
export function figureText(claim) {
  return renderClaim(claim).valueText;
}

/** The award type set in words, so a caption can name which set produced the figures. */
export function setWords(identity) {
  const set = AWARD_TYPE_SETS[identity.awardTypeSetId];
  return set ? set.label.toLowerCase() : identity.awardTypeSetId;
}

/** "in FY2025", welded, so no caption in this file can drop the year. */
export function inYear(identity) {
  return 'in FY' + identity.fiscalYear;
}

/** A link into the government's own record for one award. */
export function awardHref(generatedInternalId) {
  return 'https://www.usaspending.gov/award/' + encodeURIComponent(String(generatedInternalId));
}

/* --------------------------------------------------------------------------------------------
 * C3. Obligations by fiscal year. The spine of the page.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Object} args
 * @param {any} args.spine The obligationsByYear result from src/analysis/over-time.js.
 * @param {any} args.identity
 * @returns {any} ChartInput
 */
export function spineChart({ spine, identity }) {
  if (!spine || spine.available !== true || spine.points.length === 0) {
    throw new TypeError('spineChart: the fiscal year series is not available. A panel calls this '
      + 'only after checking `available`, and prints the `reason` sentence otherwise. An empty '
      + 'chart reads as a real zero.');
  }
  const last = spine.points[spine.points.length - 1];
  const series = {
    id: 'obligations-by-year',
    label: identity.name,
    unitKind: OBLIGATIONS,
    dash: 'none',
    pattern: 'solid',
    points: spine.points.map((p) => ({ label: p.label, valueClaim: p.obligationsClaim })),
  };
  return makeChartInput({
    form: 'columns',
    series: [series],
    figcaption: 'Federal prime award obligations recorded against ' + identity.name
      + ', one column per fiscal year, on the ' + setWords(identity) + ' award type set. The '
      + 'first column is the earliest fiscal year this dataset can answer for.',
    ariaLabel: 'Obligations recorded against ' + identity.name + ' by fiscal year, from '
      + spine.firstLabel + ' to ' + spine.lastLabel + '. The most recent column, ' + last.label
      + ', is ' + figureText(last.obligationsClaim)
      + '. Every year in the series is in the table below this figure.',
    table: {
      columns: ['Fiscal year', 'Dollars obligated in that fiscal year', 'Badge'],
      rows: seriesToTableRows(series),
    },
    axisLabel: 'dollars obligated in the fiscal year, federal prime awards, subawards excluded',
  });
}

/* --------------------------------------------------------------------------------------------
 * C2. Who buys from it.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Object} args
 * @param {{name:string, claim:any}[]} args.rowClaims From categoryRowClaims().
 * @param {any} args.identity
 * @param {string} [args.dimensionNoun]
 * @param {number} [args.limit]
 * @returns {any} ChartInput
 */
export function agencyMixChart({ rowClaims, identity, dimensionNoun = 'buying agency', limit = RANKED_ROWS }) {
  if (!Array.isArray(rowClaims) || rowClaims.length === 0) {
    throw new TypeError('agencyMixChart: no rows. A concentration picture with no denominator is '
      + 'unavailable, and unavailable is not zero.');
  }
  const ranked = [...rowClaims].sort((a, b) => b.claim.value - a.claim.value);
  const shown = ranked.slice(0, limit);
  const series = {
    id: 'agency-mix',
    label: 'obligations ' + inYear(identity),
    unitKind: OBLIGATIONS,
    dash: 'none',
    pattern: 'solid',
    points: shown.map((r) => ({ label: r.name, valueClaim: r.claim })),
  };
  return makeChartInput({
    form: 'ranked-bars',
    series: [series],
    figcaption: 'Who the money came from. Each ' + dimensionNoun + ' recorded against '
      + identity.name + ' ' + inYear(identity) + ', ranked by dollars obligated, largest first. '
      + 'This is a ranked list rather than a circle, because a circle cannot be read at the '
      + 'ratios this data produces and cannot be labelled for a screen reader.',
    ariaLabel: 'The largest buyer is ' + shown[0].name + ' at ' + figureText(shown[0].claim)
      + '. Every row returned is in the table below this figure.',
    table: {
      columns: [titleCase(dimensionNoun), 'Dollars obligated ' + inYear(identity), 'Badge'],
      rows: seriesToTableRows({ ...series, points: ranked.map((r) => ({ label: r.name, valueClaim: r.claim })) }),
    },
    axisLabel: 'dollars obligated in the fiscal year, by ' + dimensionNoun,
  });
}

/** @param {string} s @returns {string} */
function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* --------------------------------------------------------------------------------------------
 * C1. The hero. One bar, one share, and the remainder of the same denominator behind it.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Object} args
 * @param {any} args.soleBidder The soleBidderShare result from src/analysis/competition.js.
 * @param {any} args.identity
 * @returns {any} ChartInput
 */
export function soleBidderChart({ soleBidder, identity }) {
  if (!soleBidder || soleBidder.available !== true) {
    throw new TypeError('soleBidderChart: the competition split is not available. The panel prints '
      + 'the reason sentence instead, because a bar of length zero would read as a measured zero.');
  }
  const series = {
    id: 'not-competed',
    label: 'awarded with exactly one bidder',
    unitKind: SHARE,
    dash: 'none',
    pattern: 'solid',
    points: [{
      label: 'Awarded with exactly one bidder',
      valueClaim: soleBidder.soleBidderShareClaim,
    }],
  };
  return makeChartInput({
    form: 'split-bar',
    series: [series],
    figcaption: 'The share of lifetime award value, across the largest contracts active '
      + inYear(identity) + ', that the government record marks as not competed. The rest of the '
      + 'track is the remainder of that same denominator, drawn with a hatch so the split '
      + 'survives greyscale printing and high contrast mode.',
    ariaLabel: figureText(soleBidder.soleBidderShareClaim) + ' of the lifetime award value '
      + 'across the largest contracts active ' + inYear(identity) + ' under ' + identity.name
      + ' was awarded with exactly one bidder. That is '
      + figureText(soleBidder.notCompetedValueClaim) + ' of '
      + figureText(soleBidder.totalValueClaim) + '.',
    table: {
      columns: ['Segment', 'Share of lifetime award value across those contracts', 'Badge'],
      rows: seriesToTableRows(series),
    },
    axisLabel: 'percent of the stated denominator, which is lifetime award value across those contracts',
  });
}

/* --------------------------------------------------------------------------------------------
 * The largest awards, on the LIFETIME AWARD VALUE ramp. DESIGN 2.5 made visible.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Object} args
 * @param {{awardId:string, awardValueClaim:any}[]} args.awardRows From competitionRows().
 * @param {any} args.identity
 * @param {number} [args.limit]
 * @returns {any} ChartInput
 */
export function largestAwardsChart({ awardRows, identity, limit = RANKED_ROWS }) {
  if (!Array.isArray(awardRows) || awardRows.length === 0) {
    throw new TypeError('largestAwardsChart: no award rows.');
  }
  const ranked = [...awardRows].sort((a, b) => b.awardValueClaim.value - a.awardValueClaim.value);
  const shown = ranked.slice(0, limit);
  const series = {
    id: 'award-lifetime-value',
    label: 'lifetime award value',
    unitKind: AWARD_VALUE,
    dash: '6 3',
    pattern: 'hatch45',
    points: shown.map((r) => ({ label: r.awardId, valueClaim: r.awardValueClaim })),
  };
  return makeChartInput({
    form: 'ranked-bars',
    series: [series],
    figcaption: 'The same contracts measured in dollars: the largest of them by LIFETIME award '
      + 'value, exercised options included. This is a different quantity from every fiscal year '
      + 'figure on this page, so it is drawn on its own neutral ramp with a diagonal hatch and '
      + 'the two can never be read as one series.',
    ariaLabel: 'The largest contract by lifetime value is ' + shown[0].awardId + ' at '
      + figureText(shown[0].awardValueClaim)
      + '. Every contract in the set is in the table below this figure.',
    table: {
      columns: ['Award identifier', 'Lifetime award value, exercised options included', 'Badge'],
      rows: seriesToTableRows({ ...series, points: ranked.map((r) => ({ label: r.awardId, valueClaim: r.awardValueClaim })) }),
    },
    axisLabel: 'lifetime award value, exercised options included, not fiscal year money',
  });
}

/* --------------------------------------------------------------------------------------------
 * The concentration curve. The gap against the diagonal IS the concentration.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Object} args
 * @param {any} args.cumulative The cumulativeConcentration result.
 * @param {any} args.identity
 * @returns {any} ChartInput
 */
export function concentrationCurveChart({ cumulative, identity }) {
  if (!cumulative || cumulative.available !== true || cumulative.points.length === 0) {
    throw new TypeError('concentrationCurveChart: the cumulative series is not available.');
  }
  const points = cumulative.points;
  const half = points[Math.max(0, Math.ceil(points.length / 2) - 1)];
  const series = {
    id: 'cumulative-share',
    label: 'cumulative share of the set',
    unitKind: SHARE,
    dash: '6 3',
    pattern: 'dots',
    points: points.map((p) => ({ label: p.label, valueClaim: p.cumulativeShareClaim })),
  };
  return makeChartInput({
    form: 'curve',
    series: [series],
    figcaption: 'How concentrated the contract book is. Contracts are ranked by lifetime award '
      + 'value, largest first, and the line is the running share of the set. The straight line is '
      + 'what an evenly distributed book would trace, so the gap between the two IS the '
      + 'concentration and no derived index has to be invented to name it.',
    ariaLabel: 'The largest half of the contracts in this set account for '
      + figureText(half.cumulativeShareClaim) + ' of the lifetime award value across the whole '
      + 'set. An evenly distributed book would put that figure at fifty percent.',
    table: {
      columns: ['Contract, ranked by lifetime award value', 'Cumulative share of the set', 'Badge'],
      rows: seriesToTableRows(series),
    },
    axisLabel: 'percent of the stated denominator, cumulative across contracts ranked by lifetime award value',
  });
}

/* --------------------------------------------------------------------------------------------
 * The reveal. DESIGN 5.
 *
 * The figure is NOT in this string. It is rendered as a badged Claim between the two halves, so
 * the sentence and the number cannot drift apart and the number cannot arrive without its unit.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {any} identity
 * @returns {{lead:string, tail:string}}
 */
export function revealSentence(identity) {
  return {
    lead: 'Of the total lifetime value across the largest contracts active ' + inYear(identity)
      + ' under ' + identity.name + ',',
    tail: 'was awarded with exactly one bidder, according to the competition field on the '
      + 'government record for each of those contracts.',
  };
}

/**
 * The competition fields of one award as a sentence, including the case where the record
 * contradicts itself. DESIGN C1: the warts are shown, not hidden.
 * @param {any} row A row from competitionRows().
 * @returns {string}
 */
export function competitionSentence(row) {
  if (!row.detailAvailable) {
    return 'The competition record for this contract did not arrive, so it is counted in neither '
      + 'direction and it appears in the excluded tally above.';
  }
  const parts = [];
  parts.push(row.extentCompeted === null
    ? 'no extent of competition recorded'
    : row.extentCompeted);
  if (row.solicitationProcedures) parts.push(row.solicitationProcedures);
  if (row.setAside) parts.push(row.setAside);
  if (row.inconsistent) {
    parts.push('the source contradicts itself here: the record claims open competition and '
      + 'reports fewer than two offers. Both fields are shown as the source published them and '
      + 'this contract is excluded from the count cross check');
  }
  return parts.join('. ') + '.';
}
