// The four charts. Hand written inline SVG, no library, DESIGN 6.9.
//
// WHAT THIS FILE IS NOT ALLOWED TO DECIDE. It never picks a unit, never picks a ramp and never
// assembles its own input. Every chart arrives as a ChartInput from makeChartInput() in
// src/contracts/chart.js, which is where a chart carrying two unit kinds becomes impossible to
// construct, and scripts/gate-units.mjs fails the build on any module that builds the same
// object literal by hand to step around that check.
//
// FOUR THINGS EVERY CHART HERE SHIPS WITH, none of them optional, DESIGN 6.8:
//
//   1. A <figure> with a real, VISIBLE <figcaption>. The SVG is role="img" with an aria-label
//      that states the actual figures. A label that says "bar chart" hands a screen reader user
//      the shape and withholds the content, and makeChartInput refuses one.
//   2. A VISIBLE table toggle producing the equivalent table with real header cells. It is the
//      screen reader path, the chart failed fallback, and the thing a finance reader wanted
//      anyway. It is not visually hidden.
//   3. ONE tab stop for the whole chart, then Left and Right between points, Home and End to the
//      ends, Escape to leave. A roving tabindex over every bar floods the tab order of a page
//      that already has a search field, a year control and an award type control.
//   4. No animation of a value, ever. animatesValues is false on the contract and asserted here.
//      A number in motion is a number being misread, and prefers-reduced-motion removes what
//      little movement is left.
//
// COLOUR IS NEVER THE CARRIER. Obligations render on the accent ramp with a solid fill. Award
// lifetime value renders on a neutral ramp with a 45 degree hatch. The hatch is what survives
// greyscale printing and forced-colors mode, where every author supplied colour is discarded;
// the measured separation between the two fills is 3.23 in the dark theme and 2.72 in the light
// one, which is enough to tell apart and not enough to rely on alone.
//
// Isomorphic: no node:* imports, no global document.

import { renderClaim } from '../core/claim.js';
import { formatUnit, SHARE } from '../core/units.js';
import { el, svgEl, prose, clear } from './dom.js';
import { unitKeyNode, kebab } from './figure.js';

/** Plot geometry, in SVG user units. The page scales the viewBox; these never change. */
export const GEO = Object.freeze({
  width: 720,
  padLeft: 60,
  padRight: 116,
  padTop: 20,
  padBottom: 46,
  columnsHeight: 320,
  splitHeight: 128,
  rowHeight: 34,
  curveHeight: 360,
});

let autoId = 0;

/**
 * Render one chart.
 *
 * @param {Document} doc
 * @param {any} input A ChartInput from makeChartInput().
 * @param {{idBase?:string}} [options]
 * @returns {HTMLElement} The figure element.
 */
export function renderChart(doc, input, options = {}) {
  assertChartInput(input);
  autoId += 1;
  const idBase = options.idBase === undefined ? 'chart-' + autoId : options.idBase;
  const tableId = idBase + '-table';
  const liveId = idBase + '-live';

  const boxes = [];
  const svg = buildSvg(doc, input, boxes, idBase);

  const caption = prose(doc, 'figcaption', input.figcaption, { class: 'chart-caption' });

  const live = el(doc, 'p', {
    class: 'chart-live',
    id: liveId,
    role: 'status',
    'aria-live': 'polite',
  });

  const hint = prose(doc, 'p',
    'This chart is one tab stop. Once it has focus, use the left and right arrow keys to move '
    + 'between points, home and end to jump to the ends, and escape to leave. Each point is '
    + 'announced with its value, its unit and its badge. The same figures are in the table '
    + 'below.',
    { class: 'chart-hint soft' });

  const table = buildTable(doc, input, tableId);
  table.setAttribute('hidden', '');

  const toggle = prose(doc, 'button', 'Show the table', {
    type: 'button',
    class: 'chart-table-toggle ghost',
    'aria-expanded': 'false',
    'aria-controls': tableId,
  });
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (open) table.setAttribute('hidden', '');
    else table.removeAttribute('hidden');
    toggle.textContent = open ? 'Show the table' : 'Hide the table';
  });

  wireKeyboard(svg, boxes, live);

  return el(doc, 'figure', {
    class: 'chart',
    'data-chart-form': input.form,
    'data-unit-kind': input.unitKind,
    'data-ramp': input.rampId,
  }, [
    caption,
    el(doc, 'div', { class: 'chart-plot' }, [svg]),
    live,
    hint,
    toggle,
    table,
    unitKeyNode(doc, input.unitKind),
  ]);
}

/**
 * The contract has already checked the shape. This checks the two things a renderer must not
 * accept even from an object that looks valid.
 * @param {any} input
 */
export function assertChartInput(input) {
  if (!input || typeof input !== 'object' || !Array.isArray(input.series)) {
    throw new TypeError('renderChart: expected a ChartInput built by makeChartInput() in '
      + 'src/contracts/chart.js. That constructor is where a chart carrying two unit kinds stops '
      + 'being constructible, so a renderer that accepted a hand built object would be the way '
      + 'around it.');
  }
  if (input.animatesValues !== false) {
    throw new TypeError('renderChart: animatesValues must be false. A money value is never '
      + 'animated, because a number in motion is a number being misread.');
  }
}

/* --------------------------------------------------------------------------------------------
 * Geometry per form.
 * ------------------------------------------------------------------------------------------ */

function buildSvg(doc, input, boxes, idBase) {
  const height = heightFor(input);
  const svg = svgEl(doc, 'svg', {
    class: 'chart-svg',
    viewBox: '0 0 ' + GEO.width + ' ' + height,
    preserveAspectRatio: 'xMinYMin meet',
    role: 'img',
    'aria-label': input.ariaLabel,
    tabindex: '0',
  }, [defs(doc, idBase)]);

  if (input.form === 'columns') drawColumns(doc, svg, input, boxes, idBase);
  else if (input.form === 'ranked-bars') drawRankedBars(doc, svg, input, boxes, idBase);
  else if (input.form === 'split-bar') drawSplitBar(doc, svg, input, boxes, idBase);
  else drawCurve(doc, svg, input, boxes, idBase);

  const focus = svgEl(doc, 'rect', {
    class: 'chart-focus',
    id: idBase + '-focus',
    x: '0', y: '0', width: '0', height: '0',
    fill: 'none',
    'pointer-events': 'none',
  });
  focus.setAttribute('hidden', '');
  svg.appendChild(focus);
  return svg;
}

function heightFor(input) {
  if (input.form === 'columns') return GEO.columnsHeight;
  if (input.form === 'split-bar') return GEO.splitHeight;
  if (input.form === 'curve') return GEO.curveHeight;
  return GEO.padTop + GEO.padBottom + input.series[0].points.length * GEO.rowHeight;
}

/**
 * The hatch and dot patterns. They are the carrier of meaning, not the colours: in forced-colors
 * mode the fills below are replaced by system colours and the patterns are all that is left.
 */
function defs(doc, idBase) {
  const hatch = svgEl(doc, 'pattern', {
    id: idBase + '-hatch45',
    patternUnits: 'userSpaceOnUse',
    width: '8',
    height: '8',
    patternTransform: 'rotate(45)',
  }, [
    // No background rectangle. The ramp colour is painted by the mark underneath and shows
    // between these lines, so the pattern adds texture without hiding the colour.
    svgEl(doc, 'line', { x1: '0', y1: '0', x2: '0', y2: '8', class: 'hatch-line' }),
  ]);
  const dots = svgEl(doc, 'pattern', {
    id: idBase + '-dots',
    patternUnits: 'userSpaceOnUse',
    width: '6',
    height: '6',
  }, [
    svgEl(doc, 'circle', { cx: '3', cy: '3', r: '1.4', class: 'dot-mark' }),
  ]);
  return svgEl(doc, 'defs', {}, [hatch, dots]);
}

/**
 * Draw one filled mark, and the pattern OVER it when the series carries one.
 *
 * Why two elements rather than one fill. The ramp colour is a CSS custom property, so it has to
 * arrive through a stylesheet rule on .mark; a CSS rule beats a presentation attribute, so a
 * `fill="url(#pattern)"` attribute on the same element would be overridden and the hatch would
 * silently vanish. The pattern therefore rides on its own overlay element that no CSS fill rule
 * touches, and its background is transparent so the ramp colour shows between the lines. That
 * ordering is what keeps obligations and lifetime award value distinguishable in greyscale and
 * in forced-colors mode, where the author colours are discarded and the pattern is all there is.
 *
 * @param {Document} doc
 * @param {Element} svg
 * @param {Record<string,any>} geometry Attributes describing the rectangle.
 * @param {string} rampId
 * @param {string} pattern
 * @param {string} idBase
 */
function addMark(doc, svg, geometry, rampId, pattern, idBase, extraClass) {
  svg.appendChild(svgEl(doc, 'rect', {
    ...geometry,
    class: 'mark ramp-' + kebab(rampId) + (extraClass ? ' ' + extraClass : ''),
  }));
  if (pattern === 'solid') return;
  const ref = pattern === 'hatch45' ? idBase + '-hatch45' : idBase + '-dots';
  svg.appendChild(svgEl(doc, 'rect', {
    ...geometry,
    class: 'mark-pattern',
    fill: 'url(#' + ref + ')',
  }));
}

function claimValue(p) {
  return p.valueClaim.value;
}

function maxValue(input) {
  let max = 0;
  for (const s of input.series) for (const p of s.points) max = Math.max(max, claimValue(p));
  return max === 0 ? 1 : max;
}

/** Vertical columns. DESIGN 6.9 chart one: obligations by fiscal year, the spine of the page. */
function drawColumns(doc, svg, input, boxes, idBase) {
  const plotW = GEO.width - GEO.padLeft - GEO.padRight;
  const plotH = GEO.columnsHeight - GEO.padTop - GEO.padBottom;
  const max = maxValue(input);
  const series = input.series;
  const slot = plotW / series[0].points.length;
  const barW = Math.max(6, (slot * 0.62) / series.length);

  svg.appendChild(svgEl(doc, 'line', {
    class: 'axis',
    x1: GEO.padLeft, y1: GEO.padTop + plotH, x2: GEO.padLeft + plotW, y2: GEO.padTop + plotH,
  }));
  const maxTick = svgEl(doc, 'text', {
    class: 'tick num', x: GEO.padLeft - 8, y: GEO.padTop + 4, 'text-anchor': 'end',
  });
  maxTick.textContent = formatUnit(max, input.unitKind, { form: 'abbrev' });
  svg.appendChild(maxTick);

  series.forEach((s, si) => {
    s.points.forEach((p, i) => {
      const v = claimValue(p);
      const h = Math.max(1, (v / max) * plotH);
      const x = GEO.padLeft + i * slot + (slot - barW * series.length) / 2 + si * barW;
      const y = GEO.padTop + plotH - h;
      addMark(doc, svg, { x, y, width: barW, height: h }, input.rampId, s.pattern, idBase);
      boxes.push({ x, y, w: barW, h, point: p, series: s });
      if (si === 0) {
        const t = svgEl(doc, 'text', {
          class: 'axis-label',
          x: GEO.padLeft + i * slot + slot / 2,
          y: GEO.padTop + plotH + 18,
          'text-anchor': 'middle',
        });
        t.textContent = p.label;
        svg.appendChild(t);
      }
    });
    const last = s.points[s.points.length - 1];
    const lastH = Math.max(1, (claimValue(last) / max) * plotH);
    const endLabel = svgEl(doc, 'text', {
      class: 'series-end', x: GEO.padLeft + plotW + 8, y: GEO.padTop + plotH - lastH + 4,
    });
    endLabel.textContent = s.label;
    svg.appendChild(endLabel);
  });

  const axis = svgEl(doc, 'text', { class: 'axis-title', x: GEO.padLeft, y: GEO.columnsHeight - 8 });
  axis.textContent = input.axisLabel;
  svg.appendChild(axis);
}

/**
 * Horizontal ranked bars. DESIGN 6.9 chart three: the agency mix. Never a pie: a pie cannot be
 * read at a ninety nine to one ratio and cannot be labelled accessibly.
 */
function drawRankedBars(doc, svg, input, boxes, idBase) {
  const labelW = 210;
  const barLeft = GEO.padLeft + labelW;
  const barW = GEO.width - barLeft - GEO.padRight;
  const s = input.series[0];
  const max = maxValue(input);

  s.points.forEach((p, i) => {
    const v = claimValue(p);
    const y = GEO.padTop + i * GEO.rowHeight;
    const h = GEO.rowHeight - 12;
    const w = Math.max(1, (v / max) * barW);
    const name = svgEl(doc, 'text', { class: 'row-label', x: GEO.padLeft, y: y + h - 3 });
    name.textContent = p.label;
    svg.appendChild(name);
    addMark(doc, svg, { x: barLeft, y, width: w, height: h }, input.rampId, s.pattern, idBase);
    const val = svgEl(doc, 'text', { class: 'row-value num', x: barLeft + w + 6, y: y + h - 3 });
    val.textContent = formatUnit(v, input.unitKind, { form: 'abbrev' });
    svg.appendChild(val);
    boxes.push({ x: barLeft, y, w, h, point: p, series: s });
  });

  const axis = svgEl(doc, 'text', {
    class: 'axis-title',
    x: GEO.padLeft,
    y: GEO.padTop + s.points.length * GEO.rowHeight + 24,
  });
  axis.textContent = input.axisLabel;
  svg.appendChild(axis);
}

/**
 * One horizontal bar split into its segments. DESIGN 6.9 chart two and DESIGN 8.3: the hero.
 * Each segment is its own series, so each carries its own fill pattern and its own label, and
 * the split survives greyscale printing and forced colours.
 */
function drawSplitBar(doc, svg, input, boxes, idBase) {
  const barLeft = 20;
  const barW = GEO.width - barLeft - 24;
  const y = GEO.padTop + 18;
  const h = 44;

  // THE DENOMINATOR IS THE TRACK, AND ON A SHARE AXIS THE TRACK IS ONE WHOLE.
  //
  // A share of 0.639 drawn as the entire width would be the visual claim that every contract in
  // the set had one bidder. The measured segment therefore takes 63.9 percent of the track and
  // the REMAINDER is drawn behind it with a hatch, labelled in words. The remainder carries no
  // figure of its own: it is one minus a badged share rather than a second measurement, and a
  // number printed there would be a figure nothing computed.
  const isShare = input.unitKind === SHARE;
  let total = 0;
  for (const s of input.series) total += claimValue(s.points[0]);
  if (isShare) total = 1;
  if (!(total > 0)) total = 1;

  const measured = input.series.reduce((acc, s) => acc + claimValue(s.points[0]), 0);
  if (isShare && measured < 0.999) {
    const remainderX = barLeft + (measured / total) * barW;
    const remainderW = Math.max(1, barW - (remainderX - barLeft));
    addMark(doc, svg, { x: remainderX, y, width: remainderW, height: h },
      input.rampId, 'hatch45', idBase, 'mark-remainder');
    const note = svgEl(doc, 'text', {
      class: 'split-label soft-mark', x: remainderX + 4, y: y - 6,
    });
    note.textContent = 'the rest of the stated denominator';
    svg.appendChild(note);
  }

  let x = barLeft;
  input.series.forEach((s) => {
    const v = claimValue(s.points[0]);
    const w = Math.max(1, (v / total) * barW);
    addMark(doc, svg, { x, y, width: w, height: h }, input.rampId, s.pattern, idBase);
    const label = svgEl(doc, 'text', { class: 'split-label', x, y: y - 6 });
    label.textContent = s.label;
    svg.appendChild(label);
    const val = svgEl(doc, 'text', { class: 'split-value num', x, y: y + h + 20 });
    val.textContent = formatUnit(v, input.unitKind, { form: 'abbrev' });
    svg.appendChild(val);
    boxes.push({ x, y, w, h, point: s.points[0], series: s });
    x += w;
  });
}

/**
 * The cumulative concentration curve. DESIGN 6.9 chart four: cumulative share over awards ranked
 * descending, against the diagonal an evenly distributed book would trace. The GAP is the
 * concentration, so no derived index has to be invented to name it.
 */
function drawCurve(doc, svg, input, boxes, idBase) {
  const plotW = GEO.width - GEO.padLeft - GEO.padRight;
  const plotH = GEO.curveHeight - GEO.padTop - GEO.padBottom;
  const s = input.series[0];
  const n = s.points.length;

  svg.appendChild(svgEl(doc, 'line', {
    class: 'axis',
    x1: GEO.padLeft, y1: GEO.padTop + plotH, x2: GEO.padLeft + plotW, y2: GEO.padTop + plotH,
  }));
  svg.appendChild(svgEl(doc, 'line', {
    class: 'axis', x1: GEO.padLeft, y1: GEO.padTop, x2: GEO.padLeft, y2: GEO.padTop + plotH,
  }));
  svg.appendChild(svgEl(doc, 'line', {
    class: 'reference',
    x1: GEO.padLeft, y1: GEO.padTop + plotH, x2: GEO.padLeft + plotW, y2: GEO.padTop,
  }));
  const refLabel = svgEl(doc, 'text', {
    class: 'series-end', x: GEO.padLeft + plotW + 8, y: GEO.padTop + 4,
  });
  refLabel.textContent = 'an evenly distributed book';
  svg.appendChild(refLabel);

  const coords = s.points.map((p, i) => ({
    x: GEO.padLeft + ((i + 1) / n) * plotW,
    y: GEO.padTop + plotH - claimValue(p) * plotH,
    p,
  }));
  svg.appendChild(svgEl(doc, 'polyline', {
    class: 'curve ramp-stroke-' + kebab(input.rampId),
    fill: 'none',
    'stroke-dasharray': s.dash === 'none' ? null : s.dash,
    points: coords.map((c) => c.x + ',' + c.y).join(' '),
  }));
  coords.forEach((c) => {
    svg.appendChild(svgEl(doc, 'circle', {
      cx: c.x, cy: c.y, r: '3.5', class: 'mark ramp-' + kebab(input.rampId),
    }));
    boxes.push({ x: c.x - 7, y: c.y - 7, w: 14, h: 14, point: c.p, series: s });
  });

  const end = coords[coords.length - 1];
  const endLabel = svgEl(doc, 'text', {
    class: 'series-end', x: GEO.padLeft + plotW + 8, y: end.y + 4,
  });
  endLabel.textContent = s.label;
  svg.appendChild(endLabel);

  const axis = svgEl(doc, 'text', { class: 'axis-title', x: GEO.padLeft, y: GEO.curveHeight - 8 });
  axis.textContent = input.axisLabel;
  svg.appendChild(axis);
}

/* --------------------------------------------------------------------------------------------
 * The table. DESIGN 6.8: visible toggle, real header cells, every figure already rendered
 * through renderClaim() by seriesToTableRows(), so a cell cannot hold a number the badge gate
 * never saw.
 * ------------------------------------------------------------------------------------------ */

export function buildTable(doc, input, tableId) {
  const headCells = input.table.columns.map((c) => {
    const th = el(doc, 'th', { scope: 'col' });
    th.textContent = c;
    return th;
  });
  const bodyRows = input.table.rows.map((row) => el(doc, 'tr', {}, row.map((cell, i) => {
    const td = el(doc, 'td', { class: i === 0 ? null : 'num' });
    td.textContent = cell;
    return td;
  })));
  const table = el(doc, 'table', {}, [
    prose(doc, 'caption', input.figcaption),
    el(doc, 'thead', {}, [el(doc, 'tr', {}, headCells)]),
    el(doc, 'tbody', {}, bodyRows),
  ]);
  return el(doc, 'div', { class: 'tablewrap', id: tableId }, [table]);
}

/* --------------------------------------------------------------------------------------------
 * Keyboard. One tab stop, then the arrows. DESIGN 6.8.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Element} svg
 * @param {{x:number,y:number,w:number,h:number,point:any,series:any}[]} boxes
 * @param {Element} live
 * @returns {{show:(i:number)=>void, leave:()=>void, count:number, at:()=>number}}
 */
export function wireKeyboard(svg, boxes, live) {
  let index = -1;
  const focusRect = typeof svg.querySelector === 'function' ? svg.querySelector('.chart-focus') : null;

  const show = (i) => {
    if (i < 0 || i >= boxes.length) return;
    index = i;
    const b = boxes[i];
    if (focusRect) {
      focusRect.setAttribute('x', String(b.x - 3));
      focusRect.setAttribute('y', String(b.y - 3));
      focusRect.setAttribute('width', String(b.w + 6));
      focusRect.setAttribute('height', String(b.h + 6));
      focusRect.removeAttribute('hidden');
    }
    live.textContent = b.point.label + ', ' + renderClaim(b.point.valueClaim).a11yLabel;
  };

  const leave = () => {
    index = -1;
    if (focusRect) focusRect.setAttribute('hidden', '');
    clear(live);
  };

  svg.addEventListener('keydown', (ev) => {
    const key = ev.key;
    if (key === 'ArrowRight' || key === 'ArrowDown') {
      show(index < 0 ? 0 : Math.min(boxes.length - 1, index + 1));
    } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
      show(index <= 0 ? 0 : index - 1);
    } else if (key === 'Home') {
      show(0);
    } else if (key === 'End') {
      show(boxes.length - 1);
    } else if (key === 'Escape') {
      leave();
      return;
    } else {
      return;
    }
    if (typeof ev.preventDefault === 'function') ev.preventDefault();
  });

  svg.addEventListener('blur', leave);

  return { show, leave, count: boxes.length, at: () => index };
}
