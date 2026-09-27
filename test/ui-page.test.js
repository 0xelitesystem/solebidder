// The shipped page itself, and its colours, checked by arithmetic rather than by looking at it.
//
// TWO THINGS THIS FILE PROVES.
//
// One. index.html is the shell the render layer expects: it declares EXACTLY the one network
// host, it carries every region boot() mounts into, it loads the entry module, the ten NEVER
// CLAIMED statements are on the page rather than in a footnote, and the statement of independence
// ships with it. A shell missing a region does not throw; it silently drops a panel, and a
// dropped panel on this page is a missing qualification rather than a missing decoration.
//
// Two. Every foreground and background pairing the STYLESHEET actually uses clears WCAG AA in
// both themes, computed with the WCAG 2.x relative luminance formula. gate-contrast walks the
// declared token pairs; this walks the pairs this page paints with them, including the ones the
// charts introduce: chart text on the plot ground, the focus ring on the plot ground, and the
// hatch line against the fill it is drawn over. A ratio checked by eye is a ratio nobody checked.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { THEMES, contrastRatio, AA_NORMAL, AA_NON_TEXT, UNIT_RAMPS } from '../src/core/tokens.js';
import { NEVER_CLAIMED_ITEMS } from '../src/core/never-claimed.js';
import { API_ORIGIN, ADVICE_DISCLAIMER } from '../src/core/constants.js';
import { REGION_IDS } from './helpers/ui-fixtures.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(path.join(REPO, 'index.html'), 'utf8');

test('the entry page is at the REPO ROOT and loads the render layer as a module', () => {
  assert.match(html, /<script type="module" src="src\/ui\/main\.js"><\/script>/);
  assert.match(html, /<html lang="en">/);
});

test('THE CONTENT SECURITY POLICY DECLARES EXACTLY ONE NETWORK HOST', () => {
  const meta = /content="([^"]*connect-src[^"]*)"/.exec(html);
  assert.ok(meta, 'no Content-Security-Policy meta');
  const policy = meta[1].replace(/&#39;/g, "'");
  const connect = /connect-src ([^;]+)/.exec(policy)[1].trim();
  assert.equal(connect, "'self' " + API_ORIGIN);

  // Both directions. Nothing else that looks like a host may appear in the shipped page, so a
  // declaration that outgrew its use and a call that outgrew its declaration both fail here.
  const hosts = new Set((html.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map((h) => h.toLowerCase()));
  const allowed = new Set([
    API_ORIGIN,
    'https://0xelitesystem.github.io',
    'https://github.com',
    'https://elitesystem.ai',
    'https://www.usaspending.gov',
    'https://schema.org',
    'https://opensource.org',
    'http://www.w3.org',
  ]);
  for (const host of hosts) {
    assert.ok(allowed.has(host), 'an undeclared host appears in the page: ' + host);
  }
  assert.match(policy, /default-src 'self'/);
  // frame-ancestors is ignored when a CSP arrives in a meta element (browsers log an error on every load),
  // so the page must not carry it; framing protection needs an HTTP header, which GitHub Pages does not offer.
  assert.doesNotMatch(policy, /frame-ancestors/);
  assert.match(policy, /base-uri 'none'/);
});

test('every region the controller mounts into exists in the shell', () => {
  for (const id of REGION_IDS) {
    assert.ok(html.includes('id="' + id + '"'), 'the shell has no region ' + id);
  }
  assert.ok(html.includes('id="search-form"'));
  assert.ok(html.includes('id="q"'));
});

test('THE TEN NEVER CLAIMED STATEMENTS ARE ON THE PAGE, VERBATIM, NOT IN A FOOTNOTE', () => {
  const flat = html.replace(/\s+/g, ' ');
  for (const item of NEVER_CLAIMED_ITEMS) {
    assert.ok(flat.includes(item.sentence.replace(/\s+/g, ' ')), 'missing or paraphrased: ' + item.id);
  }
  // In the body, above the footer, inside a real list rather than a collapsed disclosure.
  const boundary = html.indexOf('id="boundary"');
  assert.ok(boundary > 0);
  assert.ok(boundary < html.indexOf('<footer'));
  assert.doesNotMatch(html.slice(boundary, html.indexOf('<footer')), /<details/);
});

test('the statement of independence and the privacy section ship with the page', () => {
  assert.match(html, /Not affiliated with, endorsed by, or sponsored by/);
  assert.match(html, /No account, no signup, no key, no analytics, no cookies/);
  assert.match(html, /USAspending\.gov, United States Department of the Treasury/);
});

test('THE ADVICE DISCLAIMER IS ONE SENTENCE IN ONE PLACE: generated into the page footer, and '
  + 'carried word for word by the README and USAGE', () => {
  const flat = (s) => s.replace(/\s+/g, ' ');
  const sentence = flat(ADVICE_DISCLAIMER);
  assert.match(sentence, /not investment, legal or procurement advice/);
  const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html);
  assert.ok(footer, 'the page has no footer');
  assert.ok(flat(footer[1]).includes(sentence), 'the footer does not carry the disclaimer');
  assert.ok(footer[1].includes('BUILD:DISCLAIMER'), 'the footer disclaimer is not the generated block');
  assert.ok(footer[1].indexOf(sentence) < footer[1].indexOf('MIT licence'),
    'the disclaimer should lead the footer, above the licence line');
  for (const rel of ['README.md', 'USAGE.md']) {
    const text = readFileSync(path.join(REPO, rel), 'utf8');
    assert.ok(flat(text).includes(sentence), rel + ' does not carry the disclaimer word for word');
  }
});

test('the page carries no em dash and no en dash', () => {
  assert.doesNotMatch(html, /[—–]/);
});

test('prefers-reduced-motion and forced-colors are both answered in the stylesheet', () => {
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /@media \(forced-colors: active\)/);
  // A money value is never animated, so there is no keyframe in this stylesheet to begin with.
  assert.doesNotMatch(html, /@keyframes/);
});

test('THE FORCED COLOURS FALLBACKS MATCH THE RAMPS THEY STAND IN FOR', () => {
  const forced = html.slice(html.indexOf('@media (forced-colors: active)'));
  for (const ramp of Object.values(UNIT_RAMPS)) {
    const selector = 'ramp-' + ramp.id.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
    const line = forced.split('\n').find((l) => l.includes('.mark.' + selector));
    assert.ok(line, 'no forced colours rule for ' + ramp.id);
    assert.ok(line.includes(ramp.forcedColors),
      ramp.id + ' must fall back to ' + ramp.forcedColors + ' where author colours are discarded');
  }
});

test('the page never scrolls sideways: wide content scrolls inside its own container', () => {
  assert.match(html, /\.tablewrap \{ overflow-x: auto;/);
  assert.match(html, /\.chart-plot \{[\s\S]*?overflow-x: auto;/);
});

test('tap targets clear the forty four pixel minimum', () => {
  for (const rule of ['button {', 'select {', '.radio {']) {
    const start = html.indexOf(rule);
    assert.ok(start > 0, 'no rule for ' + rule);
    const block = html.slice(start, html.indexOf('}', start));
    assert.match(block, /min-height: 44px/, rule + ' must clear the tap target minimum');
  }
  const search = html.indexOf('.search input[type="search"] {');
  assert.match(html.slice(search, html.indexOf('}', search)), /min-height: 44px/);
});

/* --------------------------------------------------------------------------------------------
 * WCAG AA, by arithmetic, on the pairs this stylesheet actually paints.
 * ------------------------------------------------------------------------------------------ */

/** Every text pairing the page paints, named as token pairs so the arithmetic is reproducible. */
const TEXT_PAIRS = [
  { where: 'body text on the page ground', surface: 'base', text: 'ink' },
  { where: 'secondary text on the page ground', surface: 'base', text: 'inkSoft' },
  { where: 'a link on the page ground', surface: 'base', text: 'accent' },
  { where: 'panel text', surface: 'raised', text: 'ink' },
  { where: 'panel secondary text', surface: 'raised', text: 'inkSoft' },
  { where: 'a link inside a panel', surface: 'raised', text: 'accent' },
  { where: 'the primary button label', surface: 'accentFill', text: 'onAccent' },
  // The chart plot paints its own ground so that the ramps are checked against what is behind
  // them, rather than against a panel colour they never touch.
  { where: 'a chart axis label', surface: 'base', text: 'ink' },
  { where: 'a chart axis title', surface: 'base', text: 'inkSoft' },
  { where: 'a series end label', surface: 'base', text: 'inkSoft' },
];

test('EVERY TEXT PAIRING THE PAGE PAINTS CLEARS AA IN BOTH THEMES', () => {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    for (const pair of TEXT_PAIRS) {
      const bg = theme.surface[pair.surface];
      const fg = theme.text[pair.text];
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= AA_NORMAL,
        themeName + ': ' + pair.where + ' is ' + fg + ' on ' + bg + ' at ' + ratio.toFixed(2)
        + ':1, under ' + AA_NORMAL);
    }
  }
});

test('THE FOCUS RING CLEARS THREE TO ONE AGAINST THE GROUND IT IS DRAWN ON', () => {
  for (const [themeName, theme] of Object.entries(THEMES)) {
    // The ring is offset outside the mark it names, so the surface behind it is the plot ground.
    const ratio = contrastRatio(theme.line.focusRing, theme.surface.base);
    assert.ok(ratio >= AA_NON_TEXT,
      themeName + ': the focus ring is ' + ratio.toFixed(2) + ':1 against the plot ground');
    const onPanel = contrastRatio(theme.line.focusRing, theme.surface.raised);
    assert.ok(onPanel >= AA_NON_TEXT,
      themeName + ': the focus ring is ' + onPanel.toFixed(2) + ':1 against a panel');
  }
});

test('EVERY CHART FILL CLEARS THREE TO ONE AGAINST THE PLOT GROUND, IN BOTH THEMES', () => {
  for (const themeName of ['dark', 'light']) {
    const ground = THEMES[themeName].surface.base;
    for (const ramp of Object.values(UNIT_RAMPS)) {
      const ratio = contrastRatio(ramp[themeName], ground);
      assert.ok(ratio >= AA_NON_TEXT,
        themeName + ': the ' + ramp.id + ' fill is ' + ratio.toFixed(2) + ':1 against the plot');
    }
  }
});

test('THE HATCH LINE IS VISIBLE AGAINST THE FILL IT IS DRAWN OVER', () => {
  // The hatch is stroked in the plot ground colour over the ramp fill, so the separation between
  // them IS the visibility of the pattern. If this ever drops the hatch stops carrying the
  // distinction between obligations and lifetime award value in greyscale.
  for (const themeName of ['dark', 'light']) {
    const ground = THEMES[themeName].surface.base;
    for (const ramp of Object.values(UNIT_RAMPS)) {
      const ratio = contrastRatio(ground, ramp[themeName]);
      assert.ok(ratio >= AA_NON_TEXT,
        themeName + ': the hatch over the ' + ramp.id + ' fill is only ' + ratio.toFixed(2) + ':1');
    }
  }
});

test('THE BOUNDARY OF EVERY CONTROL CLEARS THREE TO ONE, IN BOTH THEMES', () => {
  // WCAG 1.4.11. A text field, a select and a button are identified by their edge, so that edge
  // is a non text contrast requirement rather than a taste call. The stylesheet draws all three
  // with the secondary text token for exactly this reason; the rule token computes to 1.35:1 on
  // the light ground and would fail here, which is why it is reserved for decoration.
  for (const [themeName, theme] of Object.entries(THEMES)) {
    const ratio = contrastRatio(theme.text.inkSoft, theme.surface.base);
    assert.ok(ratio >= AA_NON_TEXT,
      themeName + ': a control boundary is ' + ratio.toFixed(2) + ':1');
  }
  for (const rule of ['button {', 'select {', '.search input[type="search"] {']) {
    const start = html.indexOf(rule);
    const block = html.slice(start, html.indexOf('}', start));
    assert.match(block, /border: 1px solid var\(--text-ink-soft\)/,
      rule + ' must draw its boundary with a token that clears three to one');
  }
});

test('a decorative rule is decorative, and nothing is identified by it alone', () => {
  // The softer rule token separates sections and panels, each of which also carries a heading or
  // its own text. It is documented here as decoration so that a future reader does not mistake
  // the number below for an accessibility failure, or promote it to one by using it on a control.
  for (const [themeName, theme] of Object.entries(THEMES)) {
    const ratio = contrastRatio(theme.line.rule, theme.surface.base);
    assert.ok(ratio > 1, themeName + ': the rule must at least be visible');
    assert.ok(ratio < AA_NON_TEXT,
      themeName + ': the rule token now clears the control threshold, so either it was changed '
      + 'or a control has quietly started using it. Check which.');
  }
});

test('the dark theme accent is never painted on the light ground, or the reverse', () => {
  // Both of these are under three to one and neither pairing appears in the stylesheet, which
  // uses tokens rather than literals. This asserts the arithmetic that makes that rule real.
  assert.ok(contrastRatio(THEMES.dark.text.accent, THEMES.light.surface.base) < AA_NORMAL);
  assert.ok(contrastRatio(THEMES.light.text.accent, THEMES.dark.surface.base) < AA_NORMAL);
});

test('the stylesheet paints from tokens, so every colour it uses has been through the arithmetic', () => {
  const styleStart = html.indexOf('/* /BUILD:TOKENS */');
  const styleEnd = html.indexOf('</style>');
  const authored = html.slice(styleStart, styleEnd);
  const literals = authored.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert.deepEqual(literals, [],
    'a colour literal outside the generated token block has not been through gate-contrast: '
    + literals.join(', '));
});
