// A document stand in, for testing the render layer under node --test with zero dependencies.
//
// WHY THIS EXISTS RATHER THAN A DOM LIBRARY. The repository ships with `dependencies: {}` and
// `devDependencies: {}`, both empty and both enforced, so `npm test` works on a fresh clone with
// no install step at all. Every module in src/ui takes its document as an argument for exactly
// this reason: the whole page can be built and driven here in milliseconds.
//
// WHAT IT IMPLEMENTS is the surface src/ui actually uses and nothing more: createElement,
// createElementNS, setAttribute, appendChild, textContent, addEventListener, getElementById and
// a class or tag selector. If a render module ever reaches for something wider than this, the
// right answer is usually that the module has grown a dependency on the browser that it did not
// need, and the failing test here is the notice.

const SVG_NS = 'http://www.w3.org/2000/svg';

class MiniNode {
  constructor(tagName, namespaceURI = null) {
    this.tagName = String(tagName).toLowerCase();
    this.namespaceURI = namespaceURI;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this._text = '';
    this.nodeType = 1;
  }

  setAttribute(name, value) {
    this.attributes.set(String(name), String(value));
    if (name === 'value') this.value = String(value);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }

  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    return child;
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  /** Fire a listener, the way a browser would, so a test can click and type. */
  dispatch(type, event = {}) {
    const handlers = this.listeners.get(type) || [];
    const ev = { type, target: this, preventDefault() {}, ...event };
    for (const h of handlers) h(ev);
    return ev;
  }

  set textContent(value) {
    this._text = String(value);
    this.childNodes = [];
  }

  get textContent() {
    if (this.childNodes.length === 0) return this._text;
    return this._text + this.childNodes.map((c) => c.textContent).join('');
  }

  get className() {
    return this.getAttribute('class') || '';
  }

  get id() {
    return this.getAttribute('id') || '';
  }

  /** Depth first, self excluded. */
  descendants() {
    const out = [];
    for (const child of this.childNodes) {
      out.push(child);
      out.push(...child.descendants());
    }
    return out;
  }

  matches(selector) {
    if (selector.startsWith('.')) {
      return this.className.split(/\s+/).includes(selector.slice(1));
    }
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('[') && selector.endsWith(']')) {
      const name = selector.slice(1, -1).split('=')[0];
      return this.hasAttribute(name);
    }
    return this.tagName === selector.toLowerCase();
  }

  querySelectorAll(selector) {
    return this.descendants().filter((n) => n.matches(selector));
  }

  querySelector(selector) {
    const all = this.querySelectorAll(selector);
    return all.length > 0 ? all[0] : null;
  }
}

class MiniText extends MiniNode {
  constructor(text) {
    super('#text');
    this._text = String(text);
    this.nodeType = 3;
  }
}

/**
 * A document with a root element, plus the region nodes the page uses so boot() can find them.
 * @param {string[]} [regionIds]
 * @returns {any}
 */
export function createDocument(regionIds = []) {
  const root = new MiniNode('body');
  const doc = {
    body: root,
    readyState: 'complete',
    createElement: (tag) => new MiniNode(tag),
    createElementNS: (ns, tag) => new MiniNode(tag, ns),
    createTextNode: (text) => new MiniText(text),
    addEventListener() {},
    getElementById(id) {
      if (root.getAttribute('id') === id) return root;
      return root.descendants().find((n) => n.getAttribute('id') === id) || null;
    },
    querySelector: (sel) => root.querySelector(sel),
    querySelectorAll: (sel) => root.querySelectorAll(sel),
  };
  for (const id of regionIds) {
    const node = new MiniNode('div');
    node.setAttribute('id', id);
    root.appendChild(node);
  }
  return doc;
}

/** Every element in a subtree, self included. */
export function allNodes(node) {
  return [node, ...node.descendants()];
}

/** The concatenated text of a subtree. */
export function textOf(node) {
  return node.textContent;
}

export { MiniNode, MiniText, SVG_NS };
