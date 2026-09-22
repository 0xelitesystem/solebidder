// THE PALETTE, AS DATA. DESIGN 6.8 (WCAG AA verified by math, both themes) and the standing
// house rule that a palette is verified by arithmetic and never by looking at a render.
//
// The palette lives here rather than only in CSS for one reason: scripts/gate-contrast.mjs has
// to compute the ratio for every text token against every surface that token actually sits on,
// in both themes, and fail the build below 4.5:1. A gate that reads a rendered page only sees
// the colours painted at that moment. Every semantic token in this product paints only after a
// figure arrives from USAspending, so an empty page has nothing to measure and a broken token
// ships. This file is the single source of truth and the stylesheet is generated from it by
// scripts/build.mjs.
//
// THE RAMPS ARE PART OF THE CLAIM BOUNDARY, not decoration. DESIGN 2.5 requires obligations and
// award lifetime value to be visually incapable of being read as the same series. That is
// enforced here as three separate properties, all checked by gate-contrast:
//
//   1. each ramp fill clears 3.0:1 against its own theme background, the WCAG non text minimum,
//   2. the obligations fill and the awardValue fill are separated from each other by at least
//      MIN_RAMP_SEPARATION, and
//   3. they carry DIFFERENT geometric patterns and DIFFERENT forced-colors system colours, so
//      the distinction survives greyscale printing and Windows high contrast mode, where every
//      author supplied colour is thrown away.
//
// Property 3 is the load bearing one. DESIGN 6.8 measured series against series luminance
// separation of only 1.18 to 2.08 across six candidate colours on this ground, which is the
// finding that colour ALONE cannot carry a series distinction here. The pattern is the carrier.
// The luminance separation is a secondary aid and is gated at a number this palette actually
// meets rather than at an aspiration it does not.
//
// Isomorphic: no node:* imports and no DOM.

/**
 * @typedef {Object} Theme
 * @property {Record<string,string>} surface Opaque background colours.
 * @property {Record<string,string>} text Foreground colours.
 * @property {Record<string,string>} line Non text strokes, gated at the UI minimum, not as text.
 */

/**
 * Dark theme. House brand ground #0a0a0a with the #d4ff3a accent.
 * @type {Theme}
 */
export const DARK = Object.freeze({
  surface: Object.freeze({
    base: '#0a0a0a',
    raised: '#14171a',
    accentFill: '#d4ff3a',
  }),
  text: Object.freeze({
    ink: '#e8ebef',
    inkSoft: '#9aa3ad',
    accent: '#d4ff3a',
    onAccent: '#0a0a0a',
    badgeReported: '#8ab4f8',
    badgeComputed: '#c2c8d0',
    badgeEstimated: '#f0b429',
    badgeNeverClaimed: '#ffa8a8',
  }),
  line: Object.freeze({
    rule: '#2a2e33',
    focusRing: '#d4ff3a',
  }),
});

/**
 * Light theme. House brand ground #e8ebef with the #2d6b00 accent. The light ground is the
 * darker of the two light surfaces, so it is the worst case and every ratio is computed
 * against it as well as against raised.
 * @type {Theme}
 */
export const LIGHT = Object.freeze({
  surface: Object.freeze({
    base: '#e8ebef',
    raised: '#f7f8fa',
    accentFill: '#2d6b00',
  }),
  text: Object.freeze({
    ink: '#0a0a0a',
    inkSoft: '#4b5563',
    accent: '#2d6b00',
    onAccent: '#ffffff',
    badgeReported: '#0f4c96',
    badgeComputed: '#243b53',
    badgeEstimated: '#7a4a00',
    badgeNeverClaimed: '#8a3b00',
  }),
  line: Object.freeze({
    rule: '#c6ccd3',
    focusRing: '#2d6b00',
  }),
});

/** @type {Readonly<Record<'dark'|'light', Theme>>} */
export const THEMES = Object.freeze({ dark: DARK, light: LIGHT });

/**
 * Which text tokens the UI is permitted to place on which surface. gate-contrast walks exactly
 * this list, in both themes. Adding a pairing here is a commitment to pass the arithmetic.
 *
 * Every pairing is normal sized text and is gated at 4.5:1. Nothing in this product uses the
 * 3.0:1 large text allowance. The numbers here ARE the product and a reader squinting at a
 * dollar figure is the wrong place to spend a concession.
 */
export const PAIRS = Object.freeze([
  Object.freeze({ surface: 'base', text: 'ink' }),
  Object.freeze({ surface: 'base', text: 'inkSoft' }),
  Object.freeze({ surface: 'base', text: 'accent' }),
  Object.freeze({ surface: 'base', text: 'badgeReported' }),
  Object.freeze({ surface: 'base', text: 'badgeComputed' }),
  Object.freeze({ surface: 'base', text: 'badgeEstimated' }),
  Object.freeze({ surface: 'base', text: 'badgeNeverClaimed' }),
  Object.freeze({ surface: 'raised', text: 'ink' }),
  Object.freeze({ surface: 'raised', text: 'inkSoft' }),
  Object.freeze({ surface: 'raised', text: 'accent' }),
  Object.freeze({ surface: 'raised', text: 'badgeReported' }),
  Object.freeze({ surface: 'raised', text: 'badgeComputed' }),
  Object.freeze({ surface: 'raised', text: 'badgeEstimated' }),
  Object.freeze({ surface: 'raised', text: 'badgeNeverClaimed' }),
  Object.freeze({ surface: 'accentFill', text: 'onAccent' }),
]);

/** WCAG 2.x AA threshold for normal sized text. */
export const AA_NORMAL = 4.5;
/** WCAG 2.x minimum for a non text UI boundary, a focus ring or a chart fill. */
export const AA_NON_TEXT = 3.0;

/**
 * Minimum contrast ratio required BETWEEN the obligations fill and the awardValue fill, in each
 * theme. Measured values for this palette: dark 3.23, light 2.72. The gate is set just under
 * the worse of the two on purpose, so a future palette edit that degrades the separation fails,
 * while the honest ceiling of what a fixed brand ground allows is not pretended away.
 */
export const MIN_RAMP_SEPARATION = 2.5;

/**
 * The unit ramps. One entry per unit kind in src/core/units.js, keyed by the same strings.
 *
 * `pattern` is the carrier of meaning. `fill` is an aid. `forcedColors` is what the fill
 * becomes in Windows high contrast mode, where author colours are discarded entirely, so the
 * two money kinds must map to different system colours as well as different patterns.
 *
 * @typedef {Object} Ramp
 * @property {string} id
 * @property {string} dark Fill in the dark theme.
 * @property {string} light Fill in the light theme.
 * @property {'solid'|'hatch45'|'dots'} pattern SVG pattern id used as the fill.
 * @property {string} forcedColors CSS system colour used when forced-colors is active.
 * @property {string} why One sentence stating what this ramp is for.
 */

/** @type {Readonly<Record<string, Ramp>>} */
export const UNIT_RAMPS = Object.freeze({
  obligations: Object.freeze({
    id: 'obligations',
    dark: '#d4ff3a',
    light: '#2d6b00',
    pattern: 'solid',
    forcedColors: 'Highlight',
    why: 'Money the government committed in one named fiscal year. The accent ramp, solid fill.',
  }),
  awardValue: Object.freeze({
    id: 'awardValue',
    dark: '#7d858f',
    light: '#111827',
    pattern: 'hatch45',
    forcedColors: 'CanvasText',
    why: 'Lifetime value of an award including exercised options. A neutral ramp with a 45 degree '
      + 'hatch, so it cannot be read as the fiscal year figure even in greyscale or high contrast.',
  }),
  share: Object.freeze({
    id: 'share',
    dark: '#8ab4f8',
    light: '#0f4c96',
    pattern: 'dots',
    forcedColors: 'LinkText',
    why: 'A proportion of a stated denominator. It never shares a chart with a money kind, so its '
      + 'separation is checked against the background only.',
  }),
});

/**
 * The two ramps that must never be mistaken for each other. DESIGN 2.5 and trap 7.
 * @type {readonly string[]}
 */
export const MONEY_RAMP_PAIR = Object.freeze(['obligations', 'awardValue']);

// One house grey is banned as a text colour, and the rule is stated as a number rather than as
// a preference: it computes to 4.10 against the dark ground, which is under AA, and it reached
// many repositories before anybody did the arithmetic. Its literal value is not in this file.
// The literal and the scan live in scripts/banned-colours.mjs, because a file that has to name a
// banned string in order to forbid it must not be a file that ships.

/**
 * sRGB relative luminance, WCAG 2.x definition. Input is #rrggbb, either case.
 * @param {string} hex
 * @returns {number}
 */
export function relativeLuminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) {
    throw new TypeError('relativeLuminance: expected #rrggbb, got ' + JSON.stringify(hex)
      + '. A malformed colour must throw rather than return NaN, because a NaN ratio compares '
      + 'false against every threshold and therefore passes every check silently.');
  }
  const v = m[1];
  const chan = [0, 2, 4].map((i) => {
    const s = parseInt(v.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

/**
 * WCAG 2.x contrast ratio between two opaque colours. Order independent.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Emit one theme as CSS custom properties, so the stylesheet is generated from this file and
 * cannot drift from what the gate checked.
 * @param {Theme} theme
 * @returns {string}
 */
export function themeToCssVars(theme) {
  const lines = [];
  for (const [k, v] of Object.entries(theme.surface)) lines.push('  --surface-' + kebab(k) + ': ' + v + ';');
  for (const [k, v] of Object.entries(theme.text)) lines.push('  --text-' + kebab(k) + ': ' + v + ';');
  for (const [k, v] of Object.entries(theme.line)) lines.push('  --line-' + kebab(k) + ': ' + v + ';');
  return lines.join('\n');
}

/**
 * Emit the ramp fills for one theme.
 * @param {'dark'|'light'} themeName
 * @returns {string}
 */
export function rampsToCssVars(themeName) {
  return Object.values(UNIT_RAMPS)
    .map((r) => '  --ramp-' + kebab(r.id) + ': ' + r[themeName] + ';')
    .join('\n');
}

/** @param {string} s @returns {string} */
function kebab(s) {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}
