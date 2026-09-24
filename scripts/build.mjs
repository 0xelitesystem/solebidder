#!/usr/bin/env node
// THE BUILD. It does one thing: it writes the palette into the page.
//
//   node scripts/build.mjs           regenerate index.html in place
//   node scripts/build.mjs --check   regenerate to memory and compare by sha256
//
// WHY A BUILD AT ALL FOR A STATIC PAGE. src/core/tokens.js is the single source of truth for
// every colour, and scripts/gate-contrast.mjs computes the WCAG arithmetic against exactly that
// file. If the stylesheet were maintained by hand, the gate would be checking one set of values
// while the page painted another, which is the failure mode the gate exists to prevent. So the
// custom properties block is GENERATED from the same module the gate reads, between two markers
// in index.html, and --check proves the committed page matches by hash.
//
// THE SECOND GENERATED BLOCK IS THE CLAIM BOUNDARY. The ten NEVER CLAIMED statements are
// written into the page from src/core/never-claimed.js, verbatim, for the same reason: the
// vocabulary gate asserts they are present word for word, and a block maintained by hand drifts
// from the registry the moment somebody tidies the page. Generating it means the statement a
// reader sees and the statement the gate checks are the same string by construction.
//
// THE THIRD GENERATED BLOCK IS THE ADVICE DISCLAIMER in the footer, written from
// ADVICE_DISCLAIMER in src/core/constants.js. The command line prints the same constant, so the
// page and the terminal can never carry two versions of the one sentence that says what this
// tool is not.
//
// Nothing else is generated. There is no bundler, no minifier and no dependency: the page is one
// file, the modules are plain ES modules the browser loads directly, and the payload budget is
// met by writing less rather than by compressing more.

import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { THEMES, themeToCssVars, rampsToCssVars } from '../src/core/tokens.js';
import { NEVER_CLAIMED_ITEMS } from '../src/core/never-claimed.js';
import { ADVICE_DISCLAIMER } from '../src/core/constants.js';
import { REPO, say, isMain } from './_shipped.mjs';

const PAGE = path.join(REPO, 'index.html');
const OPEN = '/* BUILD:TOKENS */';
const CLOSE = '/* /BUILD:TOKENS */';
const NC_OPEN = '<!-- BUILD:NEVER-CLAIMED -->';
const NC_CLOSE = '<!-- /BUILD:NEVER-CLAIMED -->';
const AD_OPEN = '<!-- BUILD:DISCLAIMER -->';
const AD_CLOSE = '<!-- /BUILD:DISCLAIMER -->';

/**
 * The generated block.
 *
 * DARK IS THE BARE ROOT AND IT IS DELIBERATE. This product is a reading instrument for money
 * figures and the house ground is #0a0a0a; it used to emit the LIGHT palette on the bare root,
 * which meant a visitor whose system expressed no preference at all got a pale grey document
 * rather than the instrument the design asked for. The light palette is complete, is gated by
 * exactly the same arithmetic, and is selected by prefers-color-scheme: light or by an explicit
 * data-theme, so neither theme is a tint of the other and a toggle still wins in both
 * directions. color-scheme is emitted with each block so the browser paints its own form
 * controls and scrollbars to match rather than leaving a white gutter beside a black page.
 *
 * @returns {string}
 */
export function generateTokensCss() {
  const lines = [];
  lines.push(':root {');
  lines.push(themeToCssVars(THEMES.dark));
  lines.push(rampsToCssVars('dark'));
  lines.push('  color-scheme: dark;');
  lines.push('}');
  lines.push('@media (prefers-color-scheme: light) {');
  lines.push('  :root:not([data-theme="dark"]) {');
  lines.push(indent(themeToCssVars(THEMES.light)));
  lines.push(indent(rampsToCssVars('light')));
  lines.push('    color-scheme: light;');
  lines.push('  }');
  lines.push('}');
  lines.push(':root[data-theme="dark"] {');
  lines.push(themeToCssVars(THEMES.dark));
  lines.push(rampsToCssVars('dark'));
  lines.push('  color-scheme: dark;');
  lines.push('}');
  lines.push(':root[data-theme="light"] {');
  lines.push(themeToCssVars(THEMES.light));
  lines.push(rampsToCssVars('light'));
  lines.push('  color-scheme: light;');
  lines.push('}');
  return lines.join('\n');
}

/** @param {string} block @returns {string} */
function indent(block) {
  return block.split('\n').map((l) => '  ' + l).join('\n');
}

/**
 * @param {string} html
 * @returns {string}
 */
export function injectTokens(html) {
  const start = html.indexOf(OPEN);
  const end = html.indexOf(CLOSE);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('build: index.html is missing the token markers ' + OPEN + ' and ' + CLOSE
      + '. The palette is generated from src/core/tokens.js so that the gate and the page can '
      + 'never disagree, and without the markers there is nowhere to put it.');
  }
  return html.slice(0, start + OPEN.length)
    + '\n' + generateTokensCss() + '\n'
    + html.slice(end);
}

/**
 * The ten NEVER CLAIMED statements as list items, each badged so the badge gate sees the digits
 * inside them as claimed rather than loose, and each carrying its id so a panel elsewhere on the
 * page can point at the one that qualifies the figure it is showing.
 * @returns {string}
 */
export function generateNeverClaimedHtml() {
  return NEVER_CLAIMED_ITEMS.map((item) => [
    '        <li class="nc" id="nc-' + item.id + '" data-claim-badge="NEVER_CLAIMED">',
    '          <span class="nc-badge" aria-hidden="true">X</span>',
    '          <strong class="nc-head">' + escapeHtml(item.heading) + '</strong>',
    '          <span class="nc-body">' + escapeHtml(item.sentence) + '</span>',
    '        </li>',
  ].join('\n')).join('\n');
}

/** @param {string} s @returns {string} */
function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * @param {string} html
 * @returns {string}
 */
export function injectNeverClaimed(html) {
  const start = html.indexOf(NC_OPEN);
  const end = html.indexOf(NC_CLOSE);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('build: index.html is missing the claim boundary markers ' + NC_OPEN + ' and '
      + NC_CLOSE + '. The ten statements are generated from src/core/never-claimed.js so that the '
      + 'sentence a reader sees and the sentence the gate checks are the same string.');
  }
  return html.slice(0, start + NC_OPEN.length)
    + '\n' + generateNeverClaimedHtml() + '\n      '
    + html.slice(end);
}

/**
 * The advice disclaimer as the first paragraph of the footer.
 * @returns {string}
 */
export function generateDisclaimerHtml() {
  return '    <p>' + escapeHtml(ADVICE_DISCLAIMER) + '</p>';
}

/**
 * @param {string} html
 * @returns {string}
 */
export function injectDisclaimer(html) {
  const start = html.indexOf(AD_OPEN);
  const end = html.indexOf(AD_CLOSE);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('build: index.html is missing the disclaimer markers ' + AD_OPEN + ' and '
      + AD_CLOSE + '. The advice disclaimer is generated from src/core/constants.js so that the '
      + 'page and the command line print the same sentence.');
  }
  return html.slice(0, start + AD_OPEN.length)
    + '\n' + generateDisclaimerHtml() + '\n    '
    + html.slice(end);
}

/** @param {string} s @returns {string} */
function sha256(s) {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

async function main() {
  const check = process.argv.includes('--check');
  const current = await readFile(PAGE, 'utf8');
  const next = injectDisclaimer(injectNeverClaimed(injectTokens(current)));

  if (check) {
    const a = sha256(current);
    const b = sha256(next);
    if (a === b) {
      say.pass('build:check  index.html matches the generated palette  sha256 ' + a.slice(0, 16));
      return 0;
    }
    say.fail('build:check  index.html does NOT match what the build generates from '
      + 'src/core/tokens.js, src/core/never-claimed.js and src/core/constants.js');
    console.log('          committed  sha256 ' + a);
    console.log('          generated  sha256 ' + b);
    console.log('          Run npm run build and commit the result. The gate computes its '
      + 'arithmetic against tokens.js, so a page that paints anything else has not been checked.');
    return 1;
  }

  if (current === next) {
    say.pass('build  index.html already current  sha256 ' + sha256(next).slice(0, 16));
    return 0;
  }
  await writeFile(PAGE, next, 'utf8');
  say.pass('build  index.html palette regenerated  sha256 ' + sha256(next).slice(0, 16));
  return 0;
}

if (isMain(import.meta.url)) {
  process.exit(await main());
}
