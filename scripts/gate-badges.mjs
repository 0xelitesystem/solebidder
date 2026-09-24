#!/usr/bin/env node
// GATE 1: NO UNBADGED FIGURE, AND THE ESTIMATED BUDGET IS ZERO. DESIGN 2, DESIGN 7.1.
//
//   node scripts/gate-badges.mjs             scan the shipped page and the source
//   node scripts/gate-badges.mjs --selftest  run the positive controls only
//
// THREE CHECKS, because a number can reach a reader by three different routes.
//
//   A. THE HTML CHECK. Every text node containing a digit must sit inside an element carrying
//      data-claim-badge with one of the four kinds. That attribute is emitted by renderClaim()
//      in src/core/claim.js and by nothing else, so passing this check and going through the
//      claim system are the same act.
//
//   B. THE JAVASCRIPT CHECK. A number can also be written straight into the DOM at runtime,
//      which check A cannot see. Assignments to textContent, nodeValue and innerText are
//      inspected and any that formats a number without going through renderClaim is a failure.
//      innerHTML, outerHTML and insertAdjacentHTML are refused outright: this page builds DOM
//      with createElement and textContent, and the one construct that could smuggle an unbadged
//      number past check A is also the one that could smuggle in markup.
//
//   C. THE ESTIMATED CHECK, and it is the one this product cares about most. DESIGN 2.3 sets
//      the estimate budget to ZERO and says the kind exists only so this gate can detect an
//      attempt. So: no call to estimated() anywhere under src/, and no ESTIMATED badge anywhere
//      in the shipped page. The budget lives in scripts/badge-exception-budget.json as
//      maxEstimated, committed at 0, and raising it is a reviewed diff rather than a decision
//      somebody makes alone at the end of a build.
//
// THE POSITIVE CONTROLS ARE NOT OPTIONAL. They run on every invocation. A gate nobody has
// watched fail is not a gate, it is a hope.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { BADGE_KINDS, ESTIMATED } from '../src/core/claim.js';
import { REPO, shippedCopy, sourceFiles, say, isMain, coverageCases } from './_shipped.mjs';

const BUDGET_FILE = path.join(REPO, 'scripts', 'badge-exception-budget.json');

/** Elements whose text content is never rendered prose. */
const OPAQUE = new Set(['script', 'style', 'head', 'noscript', 'svg', 'template']);

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr']);

/**
 * @typedef {Object} BadgeHit
 * @property {string} file
 * @property {number} line
 * @property {string} detail
 * @property {string} why
 */

/**
 * Scan HTML for digit bearing text nodes outside a badged element.
 *
 * A deliberately small hand written scanner rather than a parser dependency: this repo has zero
 * dependencies, and the shape being looked for does not need a specification compliant tree.
 *
 * @param {string} html
 * @param {string} file
 * @returns {{hits:BadgeHit[], chrome:{line:number, reason:string}[], badged:number, estimated:{line:number}[]}}
 */
export function scanHtmlForBadges(html, file) {
  /** @type {BadgeHit[]} */
  const hits = [];
  /** @type {{line:number, reason:string}[]} */
  const chrome = [];
  /** @type {{line:number}[]} */
  const estimated = [];
  let badged = 0;

  /** @type {{name:string, badge:string|null, chrome:string|null}[]} */
  const stack = [];
  let i = 0;

  const lineOf = (offset) => {
    let n = 1;
    for (let k = 0; k < offset; k += 1) if (html[k] === '\n') n += 1;
    return n;
  };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    const textEnd = lt === -1 ? html.length : lt;
    const text = html.slice(i, textEnd);

    if (text.length) {
      const top = stack[stack.length - 1];
      const inOpaque = stack.some((s) => OPAQUE.has(s.name));
      if (!inOpaque && /\d/.test(text) && text.trim().length > 0) {
        const badgedAncestor = stack.find((s) => s.badge !== null);
        const chromeAncestor = stack.find((s) => s.chrome !== null);
        if (badgedAncestor) {
          badged += 1;
        } else if (chromeAncestor) {
          chrome.push({ line: lineOf(i), reason: /** @type {string} */ (chromeAncestor.chrome) });
        } else {
          hits.push({
            file,
            line: lineOf(i),
            detail: JSON.stringify(text.trim().slice(0, 70))
              + (top ? '  inside <' + top.name + '>' : '  at top level'),
            why: 'A digit reached a rendered text node with no data-claim-badge on it or on any '
              + 'ancestor. Every displayed figure is built with reported() or computed() from '
              + 'src/core/claim.js and written through renderClaim(), which emits the attribute '
              + 'along with the unit kind. If this digit really is page chrome rather than a '
              + 'claim, put data-claim-chrome with a stated reason on its element and raise the '
              + 'committed budget deliberately.',
          });
        }
      }
    }

    if (lt === -1) break;
    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    const raw = html.slice(lt + 1, gt);
    i = gt + 1;

    if (raw.startsWith('!') || raw.startsWith('?')) continue;

    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k].name === name) { stack.length = k; break; }
      }
      continue;
    }

    const name = (raw.match(/^[a-zA-Z0-9:-]+/) || [''])[0].toLowerCase();
    if (!name) continue;
    const selfClosing = raw.trimEnd().endsWith('/') || VOID.has(name);

    const badgeAttr = raw.match(/data-claim-badge\s*=\s*"([^"]*)"/);
    const chromeAttr = raw.match(/data-claim-chrome\s*=\s*"([^"]*)"/);
    if (badgeAttr && !BADGE_KINDS.includes(badgeAttr[1])) {
      hits.push({
        file,
        line: lineOf(lt),
        detail: 'data-claim-badge="' + badgeAttr[1] + '"',
        why: 'There are exactly four badge kinds: ' + BADGE_KINDS.join(', ') + '. There is no '
          + 'fifth and there is no unknown.',
      });
    }
    if (badgeAttr && badgeAttr[1] === ESTIMATED) {
      estimated.push({ line: lineOf(lt) });
    }
    if (chromeAttr && chromeAttr[1].trim().length === 0) {
      hits.push({
        file,
        line: lineOf(lt),
        detail: 'data-claim-chrome=""',
        why: 'A chrome exception must state its reason. An unexplained exception is an escape '
          + 'hatch with the label torn off.',
      });
    }
    if (selfClosing) continue;
    stack.push({
      name,
      badge: badgeAttr ? badgeAttr[1] : null,
      chrome: chromeAttr ? chromeAttr[1] : null,
    });
  }

  return { hits, chrome, badged, estimated };
}

/**
 * Scan JavaScript for DOM writes that could put an unbadged number on screen.
 * @param {string} js
 * @param {string} file
 * @returns {BadgeHit[]}
 */
export function scanJsForBadges(js, file) {
  /** @type {BadgeHit[]} */
  const hits = [];
  js.split('\n').forEach((text, idx) => {
    const line = idx + 1;
    const code = text.replace(/\/\/.*$/, '');
    if (/^\s*\*/.test(text) || /^\s*\/\*/.test(text)) return;

    if (/\.innerHTML\s*=/.test(code) || /\.outerHTML\s*=/.test(code) || /insertAdjacentHTML\s*\(/.test(code)) {
      hits.push({
        file,
        line,
        detail: code.trim().slice(0, 90),
        why: 'innerHTML, outerHTML and insertAdjacentHTML are refused in this repository. The '
          + 'page builds DOM with createElement and textContent. The one construct that could '
          + 'put an unbadged number past the HTML check is also the one that could put markup '
          + 'past it.',
      });
      return;
    }

    const write = /\.(textContent|nodeValue|innerText)\s*=\s*(.+)$/.exec(code);
    if (!write) return;
    const rhs = write[2];
    if (/renderClaim(Text)?\s*\(/.test(rhs)) return;
    if (/failureMessage\s*\(/.test(rhs)) return;
    if (/^\s*''\s*;?\s*$/.test(rhs) || /^\s*""\s*;?\s*$/.test(rhs)) return;

    const formatsANumber = /\btoFixed\s*\(|\btoPrecision\s*\(|\bMath\.round\s*\(|\bNumber\s*\(|\bformat\s*\(|\d/.test(rhs);
    if (formatsANumber) {
      hits.push({
        file,
        line,
        detail: code.trim().slice(0, 90),
        why: 'This writes a formatted number straight into the DOM. Route it through '
          + 'renderClaim() so it carries its badge, its unit kind and its method, or the reader '
          + 'receives a number with no statement of what it is or where it came from.',
      });
    }
  });
  return hits;
}

/**
 * Find attempts to construct an estimate. DESIGN 2.3: the budget is zero.
 * @param {string} js
 * @param {string} file
 * @returns {BadgeHit[]}
 */
export function scanJsForEstimates(js, file) {
  /** @type {BadgeHit[]} */
  const hits = [];
  js.split('\n').forEach((text, idx) => {
    const code = text.replace(/\/\/.*$/, '');
    if (/^\s*\*/.test(text) || /^\s*\/\*/.test(text)) return;
    if (/\bestimated\s*\(/.test(code) || /\bESTIMATED\b\s*[,)]/.test(code)) {
      hits.push({
        file,
        line: idx + 1,
        detail: code.trim().slice(0, 90),
        why: 'An ESTIMATED claim was constructed. The budget for estimates on this page is zero '
          + 'and it is enforced here. The kind exists so that this gate can detect exactly this '
          + 'line, which is the honest form of the rule: not a promise that nobody estimates, '
          + 'but a structure in which an estimate cannot reach a reader.',
      });
    }
  });
  return hits;
}

/* -----------------------------------------------------------------------------------------
 * POSITIVE CONTROLS. Each one is a violation this gate MUST catch, and a legitimate case it
 * must NOT flag. A gate with only the first half is a gate that fails a correct repository.
 * --------------------------------------------------------------------------------------- */

const HTML_MUST_FAIL = [
  { name: 'bare figure in a table cell', html: '<table><tr><td>65,405,410,468.25</td></tr></table>' },
  { name: 'bare figure in a sentence', html: '<p>The company received 65.41B last year.</p>' },
  { name: 'badged ancestor closed before the figure', html: '<span data-claim-badge="REPORTED">1</span><p>and 98.8 percent elsewhere</p>' },
  { name: 'invented badge kind', html: '<span data-claim-badge="GUESSED">63.9 percent</span>' },
  { name: 'chrome exception with no reason', html: '<span data-claim-chrome="">2026</span>' },
];

const HTML_MUST_PASS = [
  { name: 'badged figure', html: '<span data-claim-badge="REPORTED" data-unit-kind="obligations">65.41B obligated</span>' },
  { name: 'badge on an ancestor', html: '<td data-claim-badge="COMPUTED" data-unit-kind="share"><span class="n">98.8</span> percent</td>' },
  { name: 'digits inside a script block', html: '<script>const x = 251;</script>' },
  { name: 'digits inside a style block', html: '<style>.a{width:251px}</style>' },
  { name: 'prose with no digits', html: '<p>Obligations are not revenue.</p>' },
];

const JS_MUST_FAIL = [
  { name: 'toFixed straight into textContent', js: 'el.textContent = share.toFixed(1);' },
  { name: 'template carrying a number', js: 'cell.textContent = `${Math.round(v)} dollars`;' },
  { name: 'innerHTML at all', js: 'row.innerHTML = markup;' },
  { name: 'insertAdjacentHTML', js: 'root.insertAdjacentHTML("beforeend", frag);' },
];

const JS_MUST_PASS = [
  { name: 'through renderClaimText', js: 'el.textContent = renderClaimText(claim);' },
  { name: 'through renderClaim', js: 'el.textContent = renderClaim(claim).text;' },
  { name: 'clearing a node', js: 'el.textContent = "";' },
  { name: 'a named failure sentence', js: 'el.textContent = failureMessage(result.failure);' },
];

const ESTIMATE_MUST_FAIL = [
  { name: 'a call to estimated()', js: 'const c = estimated(0.42, SHARE, METHODS.SOLE_BIDDER_SHARE, extra);' },
];

const ESTIMATE_MUST_PASS = [
  { name: 'a call to computed()', js: 'const c = computed(0.639, SHARE, METHODS.SOLE_BIDDER_SHARE, extra);' },
  { name: 'a call to reported()', js: 'const c = reported(v, OBLIGATIONS, METHODS.RECIPIENT_PROFILE_TOTAL, extra);' },
];

export function selftest() {
  say.head('gate-badges positive controls');
  let bad = 0;

  for (const c of HTML_MUST_FAIL) {
    const { hits } = scanHtmlForBadges(c.html, 'control');
    if (hits.length > 0) say.pass('html caught: ' + c.name);
    else { say.fail('html NOT caught, a bare figure would ship: ' + c.name); bad += 1; }
  }
  for (const c of HTML_MUST_PASS) {
    const { hits } = scanHtmlForBadges(c.html, 'control');
    if (hits.length === 0) say.pass('html correctly allowed: ' + c.name);
    else { say.fail('html FALSE POSITIVE: ' + c.name + '  ' + hits[0].detail); bad += 1; }
  }
  for (const c of JS_MUST_FAIL) {
    if (scanJsForBadges(c.js, 'control').length > 0) say.pass('js caught: ' + c.name);
    else { say.fail('js NOT caught: ' + c.name); bad += 1; }
  }
  for (const c of JS_MUST_PASS) {
    const hits = scanJsForBadges(c.js, 'control');
    if (hits.length === 0) say.pass('js correctly allowed: ' + c.name);
    else { say.fail('js FALSE POSITIVE: ' + c.name + '  ' + hits[0].detail); bad += 1; }
  }
  for (const c of ESTIMATE_MUST_FAIL) {
    if (scanJsForEstimates(c.js, 'control').length > 0) say.pass('estimate caught: ' + c.name);
    else { say.fail('estimate NOT caught, the zero budget would not hold: ' + c.name); bad += 1; }
  }
  for (const c of ESTIMATE_MUST_PASS) {
    if (scanJsForEstimates(c.js, 'control').length === 0) say.pass('estimate correctly allowed: ' + c.name);
    else { say.fail('estimate FALSE POSITIVE: ' + c.name); bad += 1; }
  }

  // The HTML control for an ESTIMATED badge in the page.
  const est = scanHtmlForBadges('<span data-claim-badge="ESTIMATED">1.0</span>', 'control');
  if (est.estimated.length === 1) say.pass('html caught: an ESTIMATED badge in the page');
  else { say.fail('html NOT caught: an ESTIMATED badge in the page'); bad += 1; }

  return bad;
}

async function readBudget() {
  const j = JSON.parse(await readFile(BUDGET_FILE, 'utf8'));
  return {
    maxEstimated: typeof j.maxEstimated === 'number' ? j.maxEstimated : 0,
    maxChromeExceptions: typeof j.maxChromeExceptions === 'number' ? j.maxChromeExceptions : 0,
  };
}

/**
 * @param {string} [root] The tree to scan. The repository, except in the coverage controls.
 * @returns {Promise<number>}
 */
export async function scan(root = REPO) {
  say.head('gate-badges');
  const budget = await readBudget();
  const files = await shippedCopy(root);
  const html = files.filter((f) => f.rel.endsWith('.html'));
  const js = await sourceFiles(root);

  let bad = 0;
  let chromeTotal = 0;
  let badgedTotal = 0;
  let estimatedTotal = 0;

  if (html.length === 0) {
    say.note('no shipped HTML page yet. The HTML half of this gate is proven by its positive '
      + 'controls above and engages the moment index.html exists at the repo root.');
  }

  for (const f of html) {
    const r = scanHtmlForBadges(f.text, f.rel);
    badgedTotal += r.badged;
    chromeTotal += r.chrome.length;
    estimatedTotal += r.estimated.length;
    for (const c of r.chrome) say.note('chrome exception ' + f.rel + ':' + c.line + '  reason: ' + c.reason);
    for (const e of r.estimated) say.fail(f.rel + ':' + e.line + '  an ESTIMATED badge in the shipped page');
    for (const h of r.hits) {
      say.fail(h.file + ':' + h.line + '  ' + h.detail);
      console.log('          ' + h.why);
      bad += 1;
    }
  }

  for (const f of js) {
    // claim.js IS the badge system. It names the kinds in order to define them and it writes
    // nothing to the DOM.
    const isClaimSystem = f.rel === 'src/core/claim.js';
    if (!isClaimSystem) {
      for (const h of scanJsForBadges(f.text, f.rel)) {
        say.fail(h.file + ':' + h.line + '  ' + h.detail);
        console.log('          ' + h.why);
        bad += 1;
      }
      for (const h of scanJsForEstimates(f.text, f.rel)) {
        say.fail(h.file + ':' + h.line + '  ' + h.detail);
        console.log('          ' + h.why);
        estimatedTotal += 1;
      }
    }
  }

  if (estimatedTotal > budget.maxEstimated) {
    say.fail('ESTIMATED claims: ' + estimatedTotal + ' found, budget is ' + budget.maxEstimated
      + '. The budget is zero and it does not move. Recompute the figure from REPORTED values '
      + 'and badge it COMPUTED, or cut it.');
    bad += 1;
  } else {
    say.pass('ESTIMATED claims: ' + estimatedTotal + ' of ' + budget.maxEstimated + ' allowed');
  }

  if (chromeTotal > budget.maxChromeExceptions) {
    say.fail('chrome exceptions: ' + chromeTotal + ' used, budget is ' + budget.maxChromeExceptions);
    bad += 1;
  } else {
    say.pass('chrome exceptions: ' + chromeTotal + ' of ' + budget.maxChromeExceptions + ' allowed');
  }

  if (bad === 0) say.pass(badgedTotal + ' badged numeric nodes in the page, zero unbadged');
  return bad;
}

/**
 * COVERAGE. The command line will live under src/cli/. An estimate planted there, in a .js or
 * a .mjs module, must fail this gate's real scan, and the same module without it must not.
 * @returns {Promise<number>}
 */
export async function coverageControl() {
  const planted = 'export const KINDS = [' + ESTIMATED + ', 1];\n';
  return coverageCases('gate-badges', scan, [
    { name: 'an estimate token in a module under src/cli/', files: { 'src/cli/legend.js': planted } },
    { name: 'an estimate token in a .mjs module under src/cli/', files: { 'src/cli/legend.mjs': planted } },
  ], [
    {
      name: 'a legend built from the badge registry at runtime',
      files: { 'src/cli/legend.js': 'export const legend = (spec) => Object.values(spec).map((s) => s.label);\n' },
    },
  ]);
}

if (isMain(import.meta.url)) {
  const selftestOnly = process.argv.includes('--selftest');
  let failures = selftest();
  failures += await coverageControl();
  if (!selftestOnly) failures += await scan();
  console.log(failures === 0 ? '\ngate-badges: PASS' : '\ngate-badges: FAIL (' + failures + ')');
  process.exit(failures === 0 ? 0 : 1);
}
