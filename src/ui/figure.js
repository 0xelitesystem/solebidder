// THE ONLY PLACE IN src/ui THAT PUTS A FIGURE ON THE PAGE.
//
// DESIGN 2.5 and INTERFACES 2. A number that is going to be displayed is never a number: it is
// a Claim, and renderClaim() in src/core/claim.js is the only function that turns one into text.
// Everything here is a thin wrapper around that call, so the rules travel with the figure:
//
//   the unit noun is welded to the value        "$65,405,410,468.25 obligated"
//   the badge is VISIBLE, not a tooltip         REPORTED, with a shape that needs no colour
//   the provenance is reachable                 endpoint, method, fiscal year, award type set,
//                                               and the date the source published about itself
//   the node carries data-claim-badge,          which is what scripts/gate-badges.mjs looks for
//   data-claim-method and data-unit-kind        and what scripts/gate-units.mjs looks for
//
// The badge SHAPE is load bearing. Four kinds, four shapes, drawn as inline SVG: a reader in
// forced-colors mode, a reader printing in greyscale and a reader with no colour vision at all
// get the same four distinctions, because colour is decoration layered on top of a shape and a
// word rather than the carrier of either.
//
// Isomorphic: no node:* imports, no global document.

import { renderClaim, isClaim, neverClaimed, BADGE_SPEC } from '../core/claim.js';
import { UNIT_SPEC } from '../core/units.js';
import { el, svgEl, prose, setAttrs } from './dom.js';

/**
 * The four badge glyphs as SVG path geometry on a ten by ten box. Each is a different silhouette
 * rather than a different colour of the same silhouette.
 * @type {Readonly<Record<string,{d:string, fill:boolean}>>}
 */
export const BADGE_GEOMETRY = Object.freeze({
  diamond: Object.freeze({ d: 'M5 0 L10 5 L5 10 L0 5 Z', fill: true }),
  triangle: Object.freeze({ d: 'M5 0 L10 10 L0 10 Z', fill: true }),
  'square-outline': Object.freeze({ d: 'M1 1 H9 V9 H1 Z', fill: false }),
  slash: Object.freeze({ d: 'M0 9 L9 0 M0 0 L9 9', fill: false }),
});

/**
 * The badge element: a shape, the kind in words, and the provenance as the accessible
 * description. The word is present for every reader; the shape is present for every reader; the
 * colour is present for the readers whose environment keeps it.
 *
 * @param {Document} doc
 * @param {unknown} claim
 * @returns {HTMLElement}
 */
export function badgeNode(doc, claim) {
  const r = renderClaim(claim);
  const spec = BADGE_SPEC[r.badge];
  const geo = BADGE_GEOMETRY[spec.shape];
  const mark = svgEl(doc, 'svg', {
    class: 'badge-mark',
    viewBox: '0 0 10 10',
    width: '10',
    height: '10',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [
    svgEl(doc, 'path', {
      d: geo.d,
      fill: geo.fill ? 'currentColor' : 'none',
      stroke: 'currentColor',
      'stroke-width': geo.fill ? '0' : '1.5',
    }),
  ]);
  const label = el(doc, 'span', { class: 'badge-label' });
  label.textContent = renderClaim(claim).badgeLabel;
  return el(doc, 'span', {
    class: 'badge badge-' + badgeClass(r.badge),
    title: r.provenance,
  }, [mark, label]);
}

/** @param {string} kind @returns {string} */
function badgeClass(kind) {
  return kind.toLowerCase().replace(/_/g, '-');
}

/**
 * A figure: the value with its unit noun, the visible badge, and optionally the provenance line
 * and the qualifying NEVER CLAIMED sentence that belongs beside this unit kind.
 *
 * @param {Document} doc
 * @param {unknown} claim
 * @param {Object} [options]
 * @param {boolean} [options.provenance] Render the provenance sentence under the figure.
 * @param {boolean} [options.large] Headline sizing.
 * @param {string} [options.label] A short label printed above the figure, prose only.
 * @param {string} [options.id]
 * @returns {HTMLElement}
 */
export function figureNode(doc, claim, options = {}) {
  const r = renderClaim(claim);
  const value = el(doc, 'span', { class: 'fig-value num' });
  value.textContent = renderClaim(claim).valueText;

  const kids = [];
  if (options.label !== undefined) kids.push(prose(doc, 'span', options.label, { class: 'fig-label' }));
  kids.push(value);
  kids.push(badgeNode(doc, claim));
  // A note is ALWAYS rendered when the claim carries one. A note exists because the figure
  // cannot be read correctly without it: that the count is a floor, that the award type set for
  // this endpoint is fixed rather than chosen, that the record contradicts itself. Hiding it
  // behind a disclosure would be hiding the qualification and keeping the number.
  if (r.note) {
    const note = el(doc, 'span', { class: 'fig-note soft' });
    note.textContent = renderClaim(claim).note;
    kids.push(note);
  }
  if (options.provenance) {
    const p = el(doc, 'span', { class: 'fig-prov soft' });
    p.textContent = renderClaim(claim).provenance;
    kids.push(p);
  }

  const wrap = el(doc, 'span', {
    class: 'fig' + (options.large ? ' fig-large' : ''),
    id: options.id,
    'aria-label': r.a11yLabel,
  }, kids);
  setAttrs(wrap, r.dataAttrs);
  return wrap;
}

/**
 * The same figure as a table cell. Full value to the cent, right aligned, tabular figures.
 * DESIGN 6.9: never abbreviate in a table.
 * @param {Document} doc
 * @param {unknown} claim
 * @returns {HTMLElement}
 */
export function figureCell(doc, claim) {
  const r = renderClaim(claim);
  const cell = el(doc, 'td', { class: 'num' });
  setAttrs(cell, r.dataAttrs);
  cell.setAttribute('title', r.provenance);
  cell.textContent = renderClaim(claim).valueText;
  return cell;
}

/**
 * The sentence form of a NEVER CLAIMED item, for placing beside the figure it qualifies.
 * DESIGN 2.4: these are on the page rather than in a footnote, and this is how one of them gets
 * placed next to the number that needs it rather than only in the list at the bottom.
 * @param {Document} doc
 * @param {unknown} claim A NEVER_CLAIMED claim from neverClaimedById().
 * @returns {HTMLElement}
 */
export function neverClaimedNode(doc, itemOrClaim) {
  // neverClaimedById() returns the registry ENTRY, which is the sentence plus its heading and
  // its design reference. The claim is built here from that entry rather than written here, so
  // the sentence a reader sees and the sentence gate-vocabulary compares character for character
  // are the same string and a paraphrase is impossible by construction.
  const claim = isClaim(itemOrClaim)
    ? itemOrClaim
    : neverClaimed(itemOrClaim.sentence, { note: itemOrClaim.heading });
  const r = renderClaim(claim);
  const kids = [badgeNode(doc, claim)];
  if (r.note) {
    const heading = el(doc, 'strong', { class: 'nc-inline-head' });
    heading.textContent = renderClaim(claim).note;
    kids.push(heading);
  }
  const body = el(doc, 'span', { class: 'nc-inline-body' });
  body.textContent = renderClaim(claim).valueText;
  kids.push(body);
  const node = el(doc, 'p', { class: 'nc-inline' }, kids);
  setAttrs(node, r.dataAttrs);
  return node;
}

/**
 * The unit key: what this quantity is, in one sentence, with the swatch a chart will use for it.
 * DESIGN 2.5. It appears beside every chart, because "obligations" and "lifetime award value"
 * are two different quantities and a reader who has not been told that will read them as one.
 *
 * @param {Document} doc
 * @param {string} unitKind
 * @returns {HTMLElement}
 */
export function unitKeyNode(doc, unitKind) {
  const spec = UNIT_SPEC[unitKind];
  if (!spec) {
    throw new RangeError('unitKeyNode: unknown unit kind ' + JSON.stringify(unitKind)
      + '. There are three and there is no fourth money kind.');
  }
  const swatch = svgEl(doc, 'svg', {
    class: 'unit-swatch',
    width: '22',
    height: '12',
    viewBox: '0 0 22 12',
    'aria-hidden': 'true',
    focusable: 'false',
  }, [
    svgEl(doc, 'rect', {
      x: '0', y: '0', width: '22', height: '12',
      class: 'ramp-fill ramp-' + kebab(spec.rampId),
    }),
  ]);
  // The two sentences come from UNIT_SPEC rather than from copy written here, so the words a
  // reader sees beside a chart and the words the unit system defines are the same words. They
  // are not routed through prose(), which refuses a digit, because one of them cites an
  // accounting standard by number.
  const words = el(doc, 'span', { class: 'unit-key-text' });
  words.textContent = spec.meaning + ' ' + spec.notRevenue;
  return el(doc, 'p', { class: 'unit-key', 'data-unit-kind': unitKind }, [swatch, words]);
}

/** @param {string} s @returns {string} */
export function kebab(s) {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}
