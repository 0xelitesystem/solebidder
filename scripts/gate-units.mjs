#!/usr/bin/env node
// GATE 2: NO CURRENCY WITHOUT A UNIT KIND, AND NO CHART WITH TWO OF THEM. DESIGN 2.5, trap 7.
//
//   node scripts/gate-units.mjs             scan the shipped page and the source
//   node scripts/gate-units.mjs --selftest  run the positive controls only
//
// OBLIGATIONS ARE NOT REVENUE, ENFORCED STRUCTURALLY. This gate is the build time half of that
// rule. The runtime half is src/core/units.js, whose only currency producing function takes
// (value, unitKind) and has no signature that omits the kind.
//
// FIVE CHECKS.
//
//   A. THE CURRENCY SYMBOL APPEARS IN ONE FILE. A dollar sign inside a quoted string anywhere
//      under src/ other than src/core/units.js is a second path from a number to a currency
//      string, and a second path is one that nobody made take a unit kind.
//
//   B. NOBODY ELSE FORMATS CURRENCY. Intl.NumberFormat with a currency style, and
//      toLocaleString with one, are both refused outside src/core/units.js for the same reason.
//
//   C. NO NUMERIC LITERAL REACHES THE DOM OUTSIDE THE RENDERER. Any write to textContent,
//      nodeValue or innerText whose right hand side contains a digit, or formats a number, and
//      which does not go through renderClaim, formatUnit, formatTally or failureMessage.
//
//   D. EVERY BADGED FIGURE IN THE PAGE CARRIES A UNIT KIND. data-claim-badge and data-unit-kind
//      ship together, because a badge says where a number came from and a unit kind says what
//      it is, and a reader needs both. The only exception is the NEVER CLAIMED kind, which is a
//      sentence rather than a figure and has no unit by construction.
//
//   E. ONE CHART, ONE UNIT KIND. Enforced at runtime by makeChartInput in
//      src/contracts/chart.js, which cannot build a mixed chart, and statically here: a module
//      that assembles a chart input by hand instead of calling makeChartInput would sidestep
//      the runtime check, so that is a failure too.

import { UNIT_KINDS, TALLY } from '../src/core/units.js';
import { makeChartInput } from '../src/contracts/chart.js';
import { computed, reported, METHODS } from '../src/core/claim.js';
import { OBLIGATIONS, AWARD_VALUE } from '../src/core/units.js';
import { shippedCopy, sourceFiles, say, isMain } from './_shipped.mjs';

/** The one file allowed to build a currency string. */
const CURRENCY_OWNER = 'src/core/units.js';

/** Valid values for the attribute the renderer emits. */
const VALID_UNIT_ATTR = new Set([...UNIT_KINDS, TALLY, 'none']);

/**
 * Strip line and block comments, so a comment that discusses a dollar sign is not mistaken for
 * code that builds one. Crude but sufficient: this repository has no regular expression literal
 * containing a quote character.
 * @param {string} js
 * @returns {string}
 */
export function stripComments(js) {
  return js
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)));
}

/**
 * A. A currency symbol inside a quoted string. Template literals are excluded on purpose: the
 * sequence that opens an interpolation begins with the same character and flagging it would
 * make the gate noise rather than signal.
 * @param {string} js
 * @param {string} file
 * @returns {{line:number, match:string}[]}
 */
export function scanForCurrencyLiteral(js, file) {
  const code = stripComments(js);
  const hits = [];
  const re = /'[^'\n]*\$[^'\n]*'|"[^"\n]*\$[^"\n]*"/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    hits.push({ line: code.slice(0, m.index).split('\n').length, match: m[0].slice(0, 60) });
  }
  return hits;
}

/**
 * B. Another currency formatter.
 * @param {string} js
 * @returns {{line:number, match:string}[]}
 */
export function scanForCurrencyFormatter(js) {
  const code = stripComments(js);
  const hits = [];
  const re = /Intl\.NumberFormat[\s\S]{0,200}?style\s*:\s*['"]currency['"]|toLocaleString\s*\([^)]*currency/g;
  let m;
  while ((m = re.exec(code)) !== null) {
    hits.push({ line: code.slice(0, m.index).split('\n').length, match: m[0].slice(0, 60).replace(/\s+/g, ' ') });
  }
  return hits;
}

/**
 * C. A numeric literal on its way to the DOM.
 * @param {string} js
 * @param {string} file
 * @returns {{line:number, detail:string, why:string}[]}
 */
export function scanForUnbadgedDomWrites(js, file) {
  const hits = [];
  js.split('\n').forEach((text, idx) => {
    const code = text.replace(/\/\/.*$/, '');
    if (/^\s*\*/.test(text) || /^\s*\/\*/.test(text)) return;
    const write = /\.(textContent|nodeValue|innerText)\s*=\s*(.+)$/.exec(code);
    if (!write) return;
    const rhs = write[2];
    if (/renderClaim(Text)?\s*\(|formatUnit\s*\(|formatUnitBare\s*\(|formatTally\s*\(|weldHeader\s*\(|failureMessage\s*\(/.test(rhs)) return;
    if (/^\s*''\s*;?\s*$/.test(rhs) || /^\s*""\s*;?\s*$/.test(rhs)) return;
    if (/\d|\btoFixed\s*\(|\btoPrecision\s*\(|\bMath\.round\s*\(|\bNumber\s*\(|\bString\s*\(/.test(rhs)) {
      hits.push({
        line: idx + 1,
        detail: code.trim().slice(0, 90),
        why: 'A number is reaching the DOM without passing through the unit renderer. There is '
          + 'exactly one function in this product that turns a number into a currency string and '
          + 'it takes a unit kind. A figure that skips it is a figure a reader cannot tell apart '
          + 'from a different quantity of the same size.',
      });
    }
  });
  return hits;
}

/**
 * D. Attribute pairing in the shipped page.
 * @param {string} html
 * @returns {{line:number, detail:string, why:string}[]}
 */
export function scanHtmlForUnitAttrs(html) {
  const hits = [];
  const re = /<([a-zA-Z0-9:-]+)([^>]*)>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[2];
    const line = html.slice(0, m.index).split('\n').length;
    const badge = /data-claim-badge\s*=\s*"([^"]*)"/.exec(attrs);
    const unit = /data-unit-kind\s*=\s*"([^"]*)"/.exec(attrs);
    if (unit && !VALID_UNIT_ATTR.has(unit[1])) {
      hits.push({
        line,
        detail: 'data-unit-kind="' + unit[1] + '"',
        why: 'The unit kinds are ' + [...VALID_UNIT_ATTR].join(', ') + ' and there is no fourth '
          + 'money kind. Anything else is a kind nobody defined a ramp, an axis label or a '
          + 'meaning for.',
      });
    }
    if (badge && badge[1] !== 'NEVER_CLAIMED' && !unit) {
      hits.push({
        line,
        detail: 'data-claim-badge="' + badge[1] + '" with no data-unit-kind',
        why: 'A badge says where a figure came from and a unit kind says what it is. A reader '
          + 'needs both, so they ship together. The only element that carries a badge and no '
          + 'unit kind is a NEVER CLAIMED statement, which is a sentence rather than a figure.',
      });
    }
  }
  return hits;
}

/**
 * E. A chart input assembled by hand rather than through the contract.
 * @param {string} js
 * @param {string} file
 * @returns {{line:number, detail:string, why:string}[]}
 */
export function scanForHandRolledChart(js, file) {
  if (file === 'src/contracts/chart.js') return [];
  const code = stripComments(js);
  if (!/figcaption\s*:/.test(code) || !/series\s*:/.test(code)) return [];
  if (/makeChartInput\s*\(/.test(code)) return [];
  return [{
    line: code.slice(0, code.indexOf('figcaption')).split('\n').length,
    detail: 'assembles a chart input without calling makeChartInput',
    why: 'makeChartInput in src/contracts/chart.js is where a chart with two unit kinds becomes '
      + 'impossible to construct. A module that builds the same object literal by hand has '
      + 'stepped around that check, and the thing it stepped around is the rule that fiscal year '
      + 'obligations and lifetime award value never share an axis.',
  }];
}

/* -----------------------------------------------------------------------------------------
 * POSITIVE CONTROLS.
 * --------------------------------------------------------------------------------------- */

const CURRENCY_MUST_FAIL = [
  { name: 'a dollar sign in a single quoted string', js: "const s = '$' + n.toFixed(2);" },
  { name: 'a dollar sign in a double quoted string', js: 'const s = "$" + amount;' },
];
const CURRENCY_MUST_PASS = [
  { name: 'arithmetic with no symbol', js: 'const s = formatUnit(n, OBLIGATIONS);' },
  { name: 'a template interpolation', js: 'const s = `${label} ${value}`;' },
];

const FORMATTER_MUST_FAIL = [
  { name: 'a second Intl currency formatter', js: 'const f = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });' },
  { name: 'toLocaleString with a currency', js: 'const s = n.toLocaleString("en-US", { style: "currency", currency: "USD" });' },
];
const FORMATTER_MUST_PASS = [
  { name: 'a plain grouped integer formatter', js: 'const f = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });' },
];

const DOM_MUST_FAIL = [
  { name: 'a raw number into textContent', js: 'el.textContent = String(amount);' },
  { name: 'a rounded number into textContent', js: 'el.textContent = amount.toFixed(2);' },
  { name: 'a literal into textContent', js: 'el.textContent = "40 awards";' },
];
const DOM_MUST_PASS = [
  { name: 'through the renderer', js: 'el.textContent = renderClaimText(claim);' },
  { name: 'through the unit renderer', js: 'el.textContent = formatUnit(v, OBLIGATIONS);' },
  { name: 'a named failure sentence', js: 'el.textContent = failureMessage(result.failure);' },
  { name: 'prose with no digits', js: 'el.textContent = subjectSentence;' },
];

const HTML_MUST_FAIL = [
  { name: 'a badged figure with no unit kind', html: '<span data-claim-badge="REPORTED">1</span>' },
  { name: 'an invented unit kind', html: '<span data-claim-badge="REPORTED" data-unit-kind="dollars">1</span>' },
];
const HTML_MUST_PASS = [
  { name: 'a badged figure with a unit kind', html: '<span data-claim-badge="REPORTED" data-unit-kind="obligations">1</span>' },
  { name: 'a NEVER CLAIMED sentence', html: '<p data-claim-badge="NEVER_CLAIMED">Obligations are not revenue.</p>' },
];

/** The runtime control: a chart with two unit kinds must be impossible to construct. */
function mixedChartControl() {
  const meta = { fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: '09/21/2026' };
  const obligationClaim = reported(1000, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, meta);
  const awardClaim = reported(2000, AWARD_VALUE, METHODS.AWARD_LIFETIME_VALUE, meta);
  const table = { columns: ['Fiscal year', 'Dollars obligated'], rows: [['FY2025', 'x']] };
  const series = [
    { id: 'a', label: 'Obligations', unitKind: OBLIGATIONS, dash: 'none', pattern: 'solid', points: [{ label: 'FY2025', valueClaim: obligationClaim }] },
    { id: 'b', label: 'Award value', unitKind: AWARD_VALUE, dash: '6 3', pattern: 'hatch45', points: [{ label: 'FY2025', valueClaim: awardClaim }] },
  ];
  try {
    makeChartInput({
      form: 'columns',
      series,
      figcaption: 'Two kinds on one axis',
      ariaLabel: 'FY2025, 1000 and 2000',
      table,
      axisLabel: 'dollars obligated in the fiscal year',
    });
    return false;
  } catch {
    return true;
  }
}

/** The matching control: a single kind chart must build. */
function singleKindChartControl() {
  const meta = { fiscalYear: 2025, awardTypeSetId: 'contracts', sourceAsOf: '09/21/2026' };
  const claim = computed(0.639, 'share', METHODS.SOLE_BIDDER_SHARE, {
    ...meta,
    denominatorText: 'Sum of award value where the record says not competed, over the sum across '
      + 'the largest 40 awards active in the year.',
  });
  try {
    makeChartInput({
      form: 'split-bar',
      series: [{
        id: 'split',
        label: 'Not competed',
        unitKind: 'share',
        dash: 'none',
        pattern: 'solid',
        points: [{ label: 'Not competed', valueClaim: claim }],
      }],
      figcaption: 'Share of award value awarded with exactly one bidder',
      ariaLabel: '63.9 percent of the value across the largest 40 contracts',
      table: { columns: ['Segment', 'Share of award value'], rows: [['Not competed', '63.9 percent']] },
      axisLabel: 'percent of the stated denominator',
    });
    return true;
  } catch (e) {
    console.log('          unexpected: ' + e.message);
    return false;
  }
}

export function selftest() {
  say.head('gate-units positive controls');
  let bad = 0;

  for (const c of CURRENCY_MUST_FAIL) {
    if (scanForCurrencyLiteral(c.js, 'control').length > 0) say.pass('currency caught: ' + c.name);
    else { say.fail('currency NOT caught: ' + c.name); bad += 1; }
  }
  for (const c of CURRENCY_MUST_PASS) {
    if (scanForCurrencyLiteral(c.js, 'control').length === 0) say.pass('currency correctly allowed: ' + c.name);
    else { say.fail('currency FALSE POSITIVE: ' + c.name); bad += 1; }
  }
  for (const c of FORMATTER_MUST_FAIL) {
    if (scanForCurrencyFormatter(c.js).length > 0) say.pass('formatter caught: ' + c.name);
    else { say.fail('formatter NOT caught: ' + c.name); bad += 1; }
  }
  for (const c of FORMATTER_MUST_PASS) {
    if (scanForCurrencyFormatter(c.js).length === 0) say.pass('formatter correctly allowed: ' + c.name);
    else { say.fail('formatter FALSE POSITIVE: ' + c.name); bad += 1; }
  }
  for (const c of DOM_MUST_FAIL) {
    if (scanForUnbadgedDomWrites(c.js, 'control').length > 0) say.pass('dom write caught: ' + c.name);
    else { say.fail('dom write NOT caught: ' + c.name); bad += 1; }
  }
  for (const c of DOM_MUST_PASS) {
    if (scanForUnbadgedDomWrites(c.js, 'control').length === 0) say.pass('dom write correctly allowed: ' + c.name);
    else { say.fail('dom write FALSE POSITIVE: ' + c.name); bad += 1; }
  }
  for (const c of HTML_MUST_FAIL) {
    if (scanHtmlForUnitAttrs(c.html).length > 0) say.pass('html caught: ' + c.name);
    else { say.fail('html NOT caught: ' + c.name); bad += 1; }
  }
  for (const c of HTML_MUST_PASS) {
    if (scanHtmlForUnitAttrs(c.html).length === 0) say.pass('html correctly allowed: ' + c.name);
    else { say.fail('html FALSE POSITIVE: ' + c.name); bad += 1; }
  }

  if (mixedChartControl()) say.pass('runtime: a chart with two unit kinds cannot be constructed');
  else { say.fail('runtime: a chart with two unit kinds WAS constructed. The single rule this gate exists for is not holding.'); bad += 1; }
  if (singleKindChartControl()) say.pass('runtime: a chart with one unit kind builds normally');
  else { say.fail('runtime FALSE POSITIVE: a correct single kind chart was refused'); bad += 1; }

  const handRolled = scanForHandRolledChart(
    'const input = { form: "columns", series: [], figcaption: "x" };',
    'src/ui/panel.js',
  );
  if (handRolled.length > 0) say.pass('static: a hand rolled chart input is caught');
  else { say.fail('static: a hand rolled chart input is NOT caught'); bad += 1; }

  return bad;
}

async function scan() {
  say.head('gate-units');
  let bad = 0;
  const src = await sourceFiles();
  const html = (await shippedCopy()).filter((f) => f.rel.endsWith('.html'));

  for (const f of src) {
    if (f.rel !== CURRENCY_OWNER) {
      for (const h of scanForCurrencyLiteral(f.text, f.rel)) {
        say.fail(f.rel + ':' + h.line + '  currency symbol in a string literal: ' + h.match);
        console.log('          The only file allowed to build a currency string is ' + CURRENCY_OWNER
          + ', whose single formatting function takes a unit kind and has no signature without one.');
        bad += 1;
      }
      for (const h of scanForCurrencyFormatter(f.text)) {
        say.fail(f.rel + ':' + h.line + '  a second currency formatter: ' + h.match);
        bad += 1;
      }
    }
    for (const h of scanForUnbadgedDomWrites(f.text, f.rel)) {
      say.fail(f.rel + ':' + h.line + '  ' + h.detail);
      console.log('          ' + h.why);
      bad += 1;
    }
    for (const h of scanForHandRolledChart(f.text, f.rel)) {
      say.fail(f.rel + ':' + h.line + '  ' + h.detail);
      console.log('          ' + h.why);
      bad += 1;
    }
  }

  if (html.length === 0) {
    say.note('no shipped HTML page yet. The attribute half of this gate is proven by its positive '
      + 'controls above and engages the moment index.html exists at the repo root.');
  }
  for (const f of html) {
    for (const h of scanHtmlForUnitAttrs(f.text)) {
      say.fail(f.rel + ':' + h.line + '  ' + h.detail);
      console.log('          ' + h.why);
      bad += 1;
    }
  }

  if (bad === 0) {
    say.pass('one currency path, ' + src.length + ' source files checked, every badged figure in '
      + 'the page carries a unit kind, and no chart can receive two kinds');
  }
  return bad;
}

if (isMain(import.meta.url)) {
  const selftestOnly = process.argv.includes('--selftest');
  let failures = selftest();
  if (!selftestOnly) failures += await scan();
  console.log(failures === 0 ? '\ngate-units: PASS' : '\ngate-units: FAIL (' + failures + ')');
  process.exit(failures === 0 ? 0 : 1);
}
