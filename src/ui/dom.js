// Minimal DOM construction helpers for the page.
//
// WHY THIS FILE EXISTS AT ALL, when the platform already has a DOM:
//
//   1. innerHTML, outerHTML and insertAdjacentHTML are refused in this repository by
//      scripts/gate-badges.mjs. The one construct that could put an unbadged number past the
//      HTML half of that gate is also the one that could put markup past it. So the page is
//      built node by node, and this file is the only place that knows how.
//   2. Every function here takes an explicit `doc`. Nothing in src/ui reaches for a global
//      document. That is what makes the whole render layer testable under node --test with a
//      small document stand in and no browser, no bundler and no dependency.
//   3. Nothing here writes a figure. There is deliberately no `text:` option on el(), because
//      an option like that becomes the route by which a number reaches the DOM without passing
//      through renderClaim(). Figures are written by src/ui/figure.js and by nothing else.
//
// Isomorphic: no node:* imports.

/** SVG namespace. Elements in a chart must be created with it or they render as unknown HTML. */
export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Create an HTML element and set attributes.
 *
 * Attributes only, never properties: `class` rather than className, `hidden` as an attribute,
 * and no style object. A page whose appearance lives entirely in the stylesheet is a page whose
 * colours the contrast gate can check by reading tokens.js, which is the only way this product
 * verifies WCAG AA by arithmetic rather than by looking at it.
 *
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string,string|number|boolean|null|undefined>} [attrs]
 * @param {any[]} [children]
 * @returns {HTMLElement}
 */
export function el(doc, tag, attrs, children) {
  const node = doc.createElement(tag);
  setAttrs(node, attrs);
  appendAll(node, children);
  return /** @type {HTMLElement} */ (node);
}

/**
 * Create an SVG element in the SVG namespace.
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string,string|number|boolean|null|undefined>} [attrs]
 * @param {any[]} [children]
 * @returns {Element}
 */
export function svgEl(doc, tag, attrs, children) {
  const node = doc.createElementNS(SVG_NS, tag);
  setAttrs(node, attrs);
  appendAll(node, children);
  return node;
}

/**
 * Set attributes on a node. A null or undefined value removes nothing and sets nothing, so a
 * caller can pass a conditional attribute without branching around the call.
 * @param {Element} node
 * @param {Record<string,string|number|boolean|null|undefined>} [attrs]
 * @returns {Element}
 */
export function setAttrs(node, attrs) {
  if (!attrs) return node;
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    node.setAttribute(k, v === true ? '' : String(v));
  }
  return node;
}

/**
 * Append children, skipping null and undefined so a caller can build a list with conditional
 * members and no filter step.
 * @param {Element} parent
 * @param {any[]} [children]
 * @returns {Element}
 */
export function appendAll(parent, children) {
  if (!children) return parent;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child);
  }
  return parent;
}

/**
 * Empty a node.
 *
 * The assignment below is the empty string literal, which both gates allow by name: clearing a
 * panel is not writing a figure into it.
 * @param {Element} node
 * @returns {Element}
 */
export function clear(node) {
  node.textContent = '';
  return node;
}

/**
 * A paragraph, a heading or a span of PROSE. It throws on a digit, on purpose.
 *
 * Every number a reader sees is a Claim rendered by src/ui/figure.js. This function is what the
 * rest of the UI uses for the sentences around those numbers, and the check below means a
 * developer who reaches for it to print "40 awards" finds out here rather than in review. The
 * error names the alternative rather than only refusing.
 *
 * @param {Document} doc
 * @param {string} tag
 * @param {string} sentence
 * @param {Record<string,string|number|boolean|null|undefined>} [attrs]
 * @returns {HTMLElement}
 */
export function prose(doc, tag, sentence, attrs) {
  if (typeof sentence !== 'string') {
    throw new TypeError('prose: expected a string, got ' + typeof sentence);
  }
  // A FISCAL YEAR LABEL IS NOT A FIGURE, and it is the one exception.
  //
  // "FY2025" names the period a figure belongs to. It is not a quantity, it has no unit, nothing
  // computed it, and it is already welded into every badge, every axis label and every header
  // string in the product by weldHeader() and by the claim provenance. Refusing it here would
  // force a caption to say "the fiscal year selected" where it means a named year, which is less
  // precise rather than more. Every OTHER digit is a figure wearing prose, and it is refused.
  const withoutFiscalYears = sentence.replace(/\bFY[0-9]{4}\b/g, '');
  if (/[0-9]/.test(withoutFiscalYears)) {
    throw new TypeError('prose: this sentence carries a digit: ' + JSON.stringify(sentence.slice(0, 80))
      + '. Prose in this product does not carry figures. Build the figure with reported() or '
      + 'computed() and render it with figureNode() from src/ui/figure.js, so it arrives with a '
      + 'badge, a unit kind and the method that produced it. A number printed inside a sentence '
      + 'is a number with no statement of what it is.');
  }
  const node = el(doc, tag, attrs);
  node.textContent = sentence;
  return node;
}

/**
 * Attach a click and a keyboard activation handler to an element that is already a real button.
 * Kept here so every interactive element in the page is registered the same way and nothing
 * invents a div that behaves like a control.
 * @param {Element} node
 * @param {(ev:any) => void} handler
 * @returns {Element}
 */
export function onActivate(node, handler) {
  node.addEventListener('click', handler);
  return node;
}
