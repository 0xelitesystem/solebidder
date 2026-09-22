#!/usr/bin/env node
// GATE 4: WCAG AA BY MATH, BOTH THEMES. DESIGN 6.8.
//
//   node scripts/gate-contrast.mjs             check every declared pair and every ramp
//   node scripts/gate-contrast.mjs --selftest  run the positive controls only
//
// BY MATH, NOT BY RENDERING, and the reason is a failure that has already happened in this
// account rather than a preference. A render based check only sees the colours painted at the
// moment it runs. Every semantic token in this product paints only once a figure arrives from
// the API, so an empty page has nothing to measure and the check passes while the token is
// broken. That is how one bad value reached many repositories.
//
// This gate reads src/core/tokens.js, walks PAIRS, and computes the WCAG 2.x relative luminance
// ratio for each pair in both themes. It never opens a browser.
//
// FOUR CHECKS.
//
//   A. TEXT PAIRS AT 4.5. Every declared pairing, in both themes. Nothing here uses the 3.0
//      large text allowance: the numbers are the product and a reader squinting at a dollar
//      figure is the wrong place to spend a concession.
//   B. RAMP FILLS AT 3.0 against their own theme ground, the non text minimum.
//   C. THE TWO MONEY RAMPS SEPARATED FROM EACH OTHER, at MIN_RAMP_SEPARATION, AND carrying
//      different geometric patterns AND different forced colours system colours. The pattern is
//      the carrier; the separation is the aid. DESIGN 6.8 measured series against series
//      separation of only 1.18 to 2.08 on this ground, which is the finding that colour alone
//      cannot distinguish series here, so the gate checks the thing that actually survives
//      greyscale and high contrast mode rather than only the thing that is easy to compute.
//   D. NO BANNED HOUSE COLOUR anywhere in the shipped tree.
//
// Every text token must appear in PAIRS at least once. An unpaired token is a colour nobody has
// ever checked, sitting in the file waiting for somebody to use it.

import {
  THEMES, PAIRS, UNIT_RAMPS, MONEY_RAMP_PAIR, AA_NORMAL, AA_NON_TEXT, MIN_RAMP_SEPARATION,
  contrastRatio, relativeLuminance,
} from '../src/core/tokens.js';
import { BANNED_COLOURS, scanForBannedColours } from './banned-colours.mjs';
import { shippedCopy, say, isMain } from './_shipped.mjs';

/* -----------------------------------------------------------------------------------------
 * POSITIVE CONTROLS. Two kinds, and both are needed.
 *
 *   arithmetic    values whose ratio is known independently, so a bug in the luminance formula
 *                 itself is caught. Black on white is exactly 21 and a colour against itself is
 *                 exactly 1. Those are not opinions.
 *   failing pair  a pairing that MUST be rejected. A near miss just under the threshold is
 *                 precisely the kind of thing an eye accepts and arithmetic does not.
 * --------------------------------------------------------------------------------------- */

const ARITHMETIC = [
  { a: '#000000', b: '#ffffff', expect: 21, tol: 1e-9, why: 'black on white is exactly 21:1' },
  { a: '#ffffff', b: '#ffffff', expect: 1, tol: 1e-9, why: 'a colour against itself is exactly 1:1' },
  { a: '#0a0a0a', b: '#0a0a0a', expect: 1, tol: 1e-9, why: 'order independence and identity' },
  { a: '#d4ff3a', b: '#0a0a0a', expect: 17.12, tol: 0.005, why: 'dark theme accent, DESIGN 6.8 table' },
  { a: '#e8ebef', b: '#0a0a0a', expect: 16.56, tol: 0.005, why: 'dark theme body text, DESIGN 6.8 table' },
  { a: '#9aa3ad', b: '#0a0a0a', expect: 7.75, tol: 0.005, why: 'dark theme secondary text, DESIGN 6.8 table' },
  { a: '#0a0a0a', b: '#e8ebef', expect: 16.56, tol: 0.005, why: 'light theme body text, DESIGN 6.8 table' },
  { a: '#2d6b00', b: '#e8ebef', expect: 5.46, tol: 0.005, why: 'light theme accent, DESIGN 6.8 table' },
  { a: '#4b5563', b: '#e8ebef', expect: 6.32, tol: 0.005, why: 'light theme secondary text, DESIGN 6.8 table' },
];

const MUST_REJECT = [
  { a: '#6b7280', b: '#0a0a0a', why: 'the house value that computes to 4.10 and shipped broken once' },
  { a: '#777777', b: '#0a0a0a', why: 'a near miss at 4.42, which an eye accepts and arithmetic does not' },
  { a: '#d4ff3a', b: '#e8ebef', why: 'the dark theme accent on the light ground, 1.03, unreadable' },
  { a: '#8a8a8a', b: '#ffffff', why: 'mid grey on white, a classic secondary text failure' },
];

export function selftest() {
  say.head('gate-contrast positive controls');
  let bad = 0;

  for (const c of ARITHMETIC) {
    const r = contrastRatio(c.a, c.b);
    if (Math.abs(r - c.expect) <= c.tol) {
      say.pass(c.a + ' on ' + c.b + ' = ' + r.toFixed(4) + '  (' + c.why + ')');
    } else {
      say.fail(c.a + ' on ' + c.b + ' = ' + r.toFixed(4) + ', expected ' + c.expect + '  (' + c.why + ')');
      bad += 1;
    }
  }

  for (const c of MUST_REJECT) {
    const r = contrastRatio(c.a, c.b);
    if (r < AA_NORMAL) say.pass('correctly rejected ' + c.a + ' on ' + c.b + ' = ' + r.toFixed(2) + '  (' + c.why + ')');
    else {
      say.fail('NOT rejected: ' + c.a + ' on ' + c.b + ' = ' + r.toFixed(2) + ', this gate would let it ship');
      bad += 1;
    }
  }

  // A malformed colour must throw rather than return NaN, because a NaN ratio compares false
  // against the threshold and therefore passes silently.
  for (const junk of ['red', '#fff', '#12345', 'rgb(0,0,0)', '']) {
    let threw = false;
    try { relativeLuminance(/** @type {any} */ (junk)); } catch { threw = true; }
    if (threw) say.pass('rejected malformed colour ' + JSON.stringify(junk));
    else {
      say.fail('accepted malformed colour ' + JSON.stringify(junk) + ', which produces a NaN ratio '
        + 'that passes every comparison');
      bad += 1;
    }
  }

  // The banned colour scanner has to catch its own literal.
  if (scanForBannedColours('color: ' + BANNED_COLOURS[0].value + ';', 'control').length > 0) {
    say.pass('the banned colour scan catches its own literal');
  } else {
    say.fail('the banned colour scan did not catch its own literal');
    bad += 1;
  }

  return bad;
}

export function checkPairs() {
  say.head('gate-contrast: declared text pairs, both themes');
  let bad = 0;
  let checked = 0;

  for (const [themeName, theme] of Object.entries(THEMES)) {
    for (const pair of PAIRS) {
      const bg = theme.surface[pair.surface];
      const fg = theme.text[pair.text];
      if (!bg) { say.fail(themeName + ': PAIRS names surface "' + pair.surface + '" which does not exist'); bad += 1; continue; }
      if (!fg) { say.fail(themeName + ': PAIRS names text token "' + pair.text + '" which does not exist'); bad += 1; continue; }
      const r = contrastRatio(fg, bg);
      checked += 1;
      const label = themeName.padEnd(5) + ' ' + pair.text.padEnd(18) + fg + ' on '
        + pair.surface.padEnd(11) + bg + '  ' + r.toFixed(2) + ':1';
      if (r >= AA_NORMAL) say.pass(label);
      else { say.fail(label + '  BELOW ' + AA_NORMAL); bad += 1; }
    }
  }

  for (const [themeName, theme] of Object.entries(THEMES)) {
    for (const name of Object.keys(theme.text)) {
      if (!PAIRS.some((p) => p.text === name)) {
        say.fail(themeName + ': text token "' + name + '" is declared but appears in no PAIRS '
          + 'entry, so nothing has ever checked it. Pair it or delete it.');
        bad += 1;
      }
    }
  }

  if (bad === 0) say.pass(checked + ' declared pairs checked by math across both themes, all at or above ' + AA_NORMAL + ':1');
  return bad;
}

export function checkRamps() {
  say.head('gate-contrast: unit ramps');
  let bad = 0;

  for (const [themeName, theme] of Object.entries(THEMES)) {
    const ground = theme.surface.base;
    for (const ramp of Object.values(UNIT_RAMPS)) {
      const fill = ramp[/** @type {'dark'|'light'} */ (themeName)];
      const r = contrastRatio(fill, ground);
      const label = themeName.padEnd(5) + ' ramp ' + ramp.id.padEnd(12) + fill + ' on ' + ground
        + '  ' + r.toFixed(2) + ':1';
      if (r >= AA_NON_TEXT) say.pass(label);
      else { say.fail(label + '  BELOW ' + AA_NON_TEXT + ', a chart fill has to be visible against its own ground'); bad += 1; }
    }
  }

  const [aId, bId] = MONEY_RAMP_PAIR;
  const a = UNIT_RAMPS[aId];
  const b = UNIT_RAMPS[bId];
  for (const themeName of ['dark', 'light']) {
    const sep = contrastRatio(a[themeName], b[themeName]);
    const label = themeName.padEnd(5) + ' ' + aId + ' against ' + bId + '  ' + sep.toFixed(2) + ':1';
    if (sep >= MIN_RAMP_SEPARATION) say.pass(label);
    else {
      say.fail(label + '  BELOW ' + MIN_RAMP_SEPARATION + '. These two are the pair a reader must '
        + 'never confuse: money committed in a fiscal year against the lifetime value of an award.');
      bad += 1;
    }
  }

  if (a.pattern === b.pattern) {
    say.fail('the two money ramps share the fill pattern "' + a.pattern + '". The pattern is what '
      + 'survives greyscale printing and forced colours mode, where every author supplied colour '
      + 'is discarded. Without it the distinction is colour only, and colour alone was measured '
      + 'as insufficient on this palette.');
    bad += 1;
  } else {
    say.pass('the two money ramps carry different fill patterns: ' + a.pattern + ' and ' + b.pattern);
  }

  if (a.forcedColors === b.forcedColors) {
    say.fail('the two money ramps map to the same forced colours system colour, "' + a.forcedColors
      + '". In high contrast mode they would become the same fill.');
    bad += 1;
  } else {
    say.pass('the two money ramps map to different forced colours system colours: '
      + a.forcedColors + ' and ' + b.forcedColors);
  }

  return bad;
}

async function checkBannedColours() {
  say.head('gate-contrast: banned house colours');
  let bad = 0;
  for (const f of await shippedCopy()) {
    for (const h of scanForBannedColours(f.text, f.rel)) {
      say.fail(f.rel + ':' + h.line + '  ' + h.value);
      console.log('          ' + h.why);
      console.log('          ' + h.instead);
      bad += 1;
    }
  }
  if (bad === 0) say.pass('no banned house colour anywhere in the shipped tree');
  return bad;
}

if (isMain(import.meta.url)) {
  const selftestOnly = process.argv.includes('--selftest');
  let failures = selftest();
  if (!selftestOnly) {
    failures += checkPairs();
    failures += checkRamps();
    failures += await checkBannedColours();
  }
  console.log(failures === 0 ? '\ngate-contrast: PASS' : '\ngate-contrast: FAIL (' + failures + ')');
  process.exit(failures === 0 ? 0 : 1);
}
