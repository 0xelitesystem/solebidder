// THE NAME TO UEI TYPEAHEAD INDEX. DESIGN 3.2 and 6.4.
//
// WHAT IS BUNDLED AND WHY THAT IS THE WHOLE DESIGN OF THIS FILE. The bundle carries name and
// UEI pairs and NOTHING ELSE. Amounts are used once, at build time, to decide which rows are
// worth keeping, and then they are thrown away before a single byte is written.
//
// The reason is not size. A bundled dollar figure is a staleness claim: the moment one ships,
// the page owes the reader a badge saying how old it is and a defence of why it is still worth
// showing. Strip the amounts and the question cannot arise, because there is no number in the
// bundle that could ever be displayed. That is a stronger guarantee than a fresh build date.
//
// THE STRIPPING IS STRUCTURAL, NOT A CONVENTION. An index entry is a two element array of
// strings. There is no third slot for an amount to live in, buildTypeaheadIndex never copies
// one forward, and assertStripped walks a parsed index and refuses any entry that is not
// exactly two strings with a well formed UEI in the first slot. So an amount cannot reach the
// bundle by being forgotten about; it can only reach it by somebody changing the shape of the
// entry, which fails the assertion, the test and the generator all at once.
//
// UEI ONLY, NEVER THE LEGACY VENDOR NUMBER. Trap 13. The list and children endpoints both still
// return a legacy identifier that belongs to a commercial data vendor and carries a written
// attribution obligation. buildTypeaheadIndex reads two fields by name and copies nothing else,
// so that identifier has no path into a file we publish.
//
// THE SEARCH IS A PREFIX PASS THEN A SUBSTRING PASS. DESIGN 6.4 fixes this shape and fixes the
// cap at 20 results. Prefix matches rank above substring matches because somebody typing "loc"
// means the company whose name starts that way.
//
// Isomorphic: no node:* imports and no DOM. The generator that writes the file is a separate
// Node script; this module holds the arithmetic so it can be tested without a network or a disk.

import { assertUei } from '../query/endpoints.js';

/**
 * The on disk format version. It is bumped when the shape changes, so a stale file from an old
 * build fails loudly at parse time rather than being read against the wrong assumptions.
 */
export const INDEX_FORMAT_VERSION = 1;

/** DESIGN 3.2: the top rows by lifetime obligation, ranked at build time, amounts discarded. */
export const DEFAULT_INDEX_ROWS = 5000;

/** DESIGN 6.4: the typeahead never offers more than this many rows at once. */
export const MAX_SUGGESTIONS = 20;

/**
 * One entry, as it exists in the bundle.
 * @typedef {[string, string]} IndexEntry First element the UEI, second the name.
 */

/**
 * @typedef {Object} TypeaheadIndex
 * @property {number} v Format version.
 * @property {readonly IndexEntry[]} rows
 */

/**
 * Build the index from ranked rows and DISCARD the amounts.
 *
 * The amount is read only inside the comparator. It is never written to the output, and the
 * output entry has no slot it could occupy.
 *
 * @param {{uei?:string|null, name?:string|null, amount?:number|null}[]} rows Raw rows as the
 *   category endpoint returns them, in any order.
 * @param {{max?:number}} [options]
 * @returns {TypeaheadIndex}
 */
export function buildTypeaheadIndex(rows, options = {}) {
  if (!Array.isArray(rows)) {
    throw new TypeError('buildTypeaheadIndex: rows must be an array of raw recipient rows.');
  }
  const max = options.max === undefined ? DEFAULT_INDEX_ROWS : options.max;
  if (!Number.isInteger(max) || max < 1) {
    throw new RangeError('buildTypeaheadIndex: max must be a positive integer, got ' + String(max));
  }

  /** @type {Map<string, {name:string, rank:number}>} */
  const byUei = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const uei = typeof row.uei === 'string' ? row.uei.trim().toUpperCase() : '';
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (uei.length === 0 || name.length === 0) continue;
    if (!/^[A-Z0-9]{12}$/.test(uei)) continue;
    // The ONLY use of the amount in this module. It orders the rows and then it is gone.
    const rank = typeof row.amount === 'number' && Number.isFinite(row.amount) ? row.amount : 0;
    const seen = byUei.get(uei);
    if (seen === undefined || rank > seen.rank) byUei.set(uei, { name, rank });
  }

  const ordered = [...byUei.entries()]
    .sort((a, b) => (b[1].rank - a[1].rank) || a[1].name.localeCompare(b[1].name))
    .slice(0, max);

  const out = ordered.map(([uei, v]) => /** @type {IndexEntry} */ ([uei, v.name]));
  return Object.freeze({ v: INDEX_FORMAT_VERSION, rows: Object.freeze(out) });
}

/**
 * Refuse an index that carries anything other than a UEI and a name.
 *
 * This is the check that makes "no bundled dollar amount" a fact rather than an intention. It
 * runs in the generator before the file is written, in the test suite against the committed
 * file, and at load time in the browser.
 *
 * @param {unknown} index
 * @param {string} [where]
 * @returns {TypeaheadIndex}
 */
export function assertStripped(index, where = 'assertStripped') {
  const ix = /** @type {any} */ (index);
  if (!ix || typeof ix !== 'object' || !Array.isArray(ix.rows)) {
    throw new TypeError(where + ': an index is an object with a rows array.');
  }
  if (ix.v !== INDEX_FORMAT_VERSION) {
    throw new TypeError(where + ': index format version ' + JSON.stringify(ix.v) + ' is not the '
      + 'version this build reads, which is ' + INDEX_FORMAT_VERSION + '.');
  }
  for (const key of Object.keys(ix)) {
    if (key !== 'v' && key !== 'rows') {
      throw new TypeError(where + ': the index carries an unexpected key ' + JSON.stringify(key)
        + '. The bundle holds a version and a rows array, because any other field is a place a '
        + 'figure could hide, and a bundled figure is a staleness claim this product does not '
        + 'make.');
    }
  }
  ix.rows.forEach((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw new TypeError(where + ': rows[' + i + '] must be exactly two elements, the UEI and '
        + 'the name. A third element is where an amount would live and there is no amount in '
        + 'this file.');
    }
    if (typeof entry[0] !== 'string' || typeof entry[1] !== 'string') {
      throw new TypeError(where + ': rows[' + i + '] must be two strings. A number anywhere in '
        + 'this file is a figure that could reach a reader with no badge and no as of date.');
    }
    assertUei(entry[0], where + ' rows[' + i + ']');
    if (entry[1].trim().length === 0) {
      throw new TypeError(where + ': rows[' + i + '] has an empty name, which no visitor could '
        + 'recognise or choose.');
    }
  });
  return /** @type {TypeaheadIndex} */ (ix);
}

/**
 * Serialise for the bundle. One row per line, so a diff on a refresh is readable and a reviewer
 * can see exactly which names entered and left.
 * @param {TypeaheadIndex} index
 * @returns {string}
 */
export function serialiseIndex(index) {
  const ix = assertStripped(index, 'serialiseIndex');
  const lines = ix.rows.map((r) => ' ' + JSON.stringify(r));
  return '{"v":' + ix.v + ',"rows":[\n' + lines.join(',\n') + '\n]}\n';
}

/**
 * Parse and validate a bundle. Throws rather than returning a partial index, because a half
 * readable index would quietly narrow what a visitor can find.
 * @param {string} text
 * @returns {TypeaheadIndex}
 */
export function parseIndex(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new TypeError('parseIndex: the bundled index is not valid JSON: '
      + (e && /** @type {Error} */ (e).message));
  }
  return assertStripped(json, 'parseIndex');
}

/**
 * Build the lowercase prefix map DESIGN 6.4 specifies. One pass on load.
 *
 * The map is keyed by the first three characters of the name, which is the shortest query the
 * typeahead answers from the bundle. Shorter queries fall through to a linear scan, which is
 * fine at this size: 5,000 rows is a single digit millisecond scan.
 *
 * @param {TypeaheadIndex} index
 * @returns {Map<string, number[]>} Key to row indices.
 */
export function buildPrefixMap(index) {
  const ix = assertStripped(index, 'buildPrefixMap');
  /** @type {Map<string, number[]>} */
  const map = new Map();
  ix.rows.forEach((row, i) => {
    const key = row[1].toLowerCase().slice(0, 3);
    const bucket = map.get(key);
    if (bucket === undefined) map.set(key, [i]);
    else bucket.push(i);
  });
  return map;
}

/**
 * Search the bundle. Prefix matches first, then substring matches, capped.
 *
 * Every result carries a UEI, which is the point: a bundled hit can be resolved to a parent
 * record without a network call, while the live fallback returns names only and has to go back
 * to the list endpoint to find out which entity a name means.
 *
 * @param {TypeaheadIndex} index
 * @param {string} query
 * @param {{limit?:number, prefixMap?:Map<string, number[]>}} [options]
 * @returns {{uei:string, name:string, matched:'prefix'|'substring'}[]}
 */
export function searchIndex(index, query, options = {}) {
  const ix = assertStripped(index, 'searchIndex');
  const limit = options.limit === undefined ? MAX_SUGGESTIONS : options.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_SUGGESTIONS) {
    throw new RangeError('searchIndex: limit must be an integer in [1, ' + MAX_SUGGESTIONS
      + ']. A longer list is a list nobody reads and it pushes the honest refusal panel off the '
      + 'screen.');
  }
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (q.length === 0) return [];

  /** @type {number[]} */
  let searchSpace;
  if (q.length >= 3 && options.prefixMap) {
    const bucket = options.prefixMap.get(q.slice(0, 3));
    searchSpace = bucket === undefined ? [] : bucket;
  } else {
    searchSpace = ix.rows.map((_r, i) => i);
  }

  /** @type {{uei:string, name:string, matched:'prefix'|'substring'}[]} */
  const prefix = [];
  for (const i of searchSpace) {
    const row = ix.rows[i];
    if (row[1].toLowerCase().startsWith(q)) {
      prefix.push({ uei: row[0], name: row[1], matched: 'prefix' });
    }
    if (prefix.length >= limit) break;
  }
  if (prefix.length >= limit) return prefix;

  /** @type {{uei:string, name:string, matched:'prefix'|'substring'}[]} */
  const substring = [];
  const already = new Set(prefix.map((r) => r.uei));
  for (const row of ix.rows) {
    if (already.has(row[0])) continue;
    const lower = row[1].toLowerCase();
    if (lower.includes(q) && !lower.startsWith(q)) {
      substring.push({ uei: row[0], name: row[1], matched: 'substring' });
    }
    if (prefix.length + substring.length >= limit) break;
  }
  return prefix.concat(substring).slice(0, limit);
}
