// THE ONE OUTPUT SINK. Every character the command line shows a reader leaves through this file.
//
// It is the only module under src/cli that touches the process streams, and scripts/gate-badges.mjs
// fails the build when any other module under src/cli writes to them. The reason is the same one
// the page has for routing every figure through renderClaim: a rule that holds at one door holds
// everywhere, and a rule that has to be remembered at forty call sites does not hold at all.
//
// WHAT IT DOES TO EVERY LINE, AT WRITE TIME.
//
//   1. Removes terminal control sequences whole: CSI (screen clears, cursor moves, colours), OSC
//      (window titles, hyperlinks, clipboard writes), DCS, SOS, PM and APC, in their seven bit
//      and eight bit forms.
//   2. Strips whatever control characters remain: C0 except newline and tab, DEL, the C1 block,
//      the bidirectional controls that reorder text on screen, and every other invisible format
//      character, keeping only a zero width joiner or non joiner that sits inside a word.
//   3. Leaves printable text alone. An accented name or a curly quote in a name the source
//      REPORTED is the record, and it prints exactly as the source sent it.
//
// Sanitising happens here rather than where a string is built because the untrusted text is
// already welded into library sentences by the time it arrives: provenance lines carry the date
// string the source sent, share denominators carry recipient names, failure sentences carry what
// failed. Only the last step before the terminal sees every one of them.
//
// THIS SOURCE FILE IS PURE ASCII. The character classes below are assembled from numeric code
// points at load time, so no invisible or reordering character ever sits in the source itself,
// where it could hide from a reviewer the exact thing this file exists to remove.
//
// COLOUR IS DECORATION AND NEVER THE CARRIER. The badge word is always printed. Styling, when it
// is on at all, is bold on headings and badge words, applied here AFTER sanitising, so the only
// escape sequences that can reach a terminal are the two this file writes. It is off when the
// output is not a terminal, when NO_COLOR holds any value, with --no-color, --plain, --json and
// --csv, and for anything written to a file. FORCE_COLOR turns it on for a non terminal, unless
// NO_COLOR is also set: the reader's request for no styling wins.
//
// A READER THAT CLOSES THE PIPE IS NOT AN ERROR. Piping into a pager or into head closes the
// stream early. That arrives as EPIPE; the sink stops writing, tells the caller, and the run ends
// quietly with exit code zero.

import { open, lstat, realpath } from 'node:fs/promises';
import { constants as FS } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatUnitBare, OBLIGATIONS, AWARD_VALUE, UNIT_SPEC } from '../core/units.js';

/** The widest a line is laid out when nothing says otherwise. WCAG2ICT: readable at this width. */
export const DEFAULT_WIDTH = 80;

/** The narrowest layout honoured. Below this a figure would overflow on every line. */
export const MIN_WIDTH = 20;

/** The package root, which --out refuses to write inside. */
export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* ------------------------------------------------------------------------------------------
 * The sanitiser.
 * ---------------------------------------------------------------------------------------- */

/** @param {number} n @returns {string} A regular expression escape for one code point. */
function hex(n) {
  return '\\u' + n.toString(16).padStart(4, '0');
}

/**
 * A character class body from code points and inclusive ranges.
 * @param {(number|[number, number])[]} points
 * @returns {string}
 */
function cls(points) {
  return points.map((p) => (Array.isArray(p) ? hex(p[0]) + '-' + hex(p[1]) : hex(p))).join('');
}

/**
 * The bidirectional controls: the Arabic letter mark, the left to right and right to left marks,
 * the embeddings, overrides and pop, and the isolates.
 */
export const BIDI_CONTROLS = Object.freeze([0x061c, 0x200e, 0x200f, [0x202a, 0x202e], [0x2066, 0x2069]]);

/** The zero width non joiner and joiner, legitimate inside a word in several scripts. */
const JOINERS = cls([0x200c, 0x200d]);

/** A word character on either side of a joiner. */
const WORD = '[\\p{L}\\p{M}\\p{N}]';

/** Whole control sequences, removed before the leftover characters are stripped. */
const SEQUENCES = Object.freeze([
  // CSI, seven bit and eight bit: parameters, intermediates, one final byte.
  /\u001b\[[0-?]*[ -/]*[@-~]/g,
  /\u009b[0-?]*[ -/]*[@-~]/g,
  // OSC, ended by BEL or by the string terminator in either form.
  /\u001b\][^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)/g,
  /\u009d[^\u0007\u001b\u009c]*(?:\u0007|\u001b\\|\u009c)/g,
  // DCS, SOS, PM and APC, ended by the string terminator.
  /\u001b[PX^_][^\u001b\u009c]*(?:\u001b\\|\u009c)/g,
  /[\u0090\u0098\u009e\u009f][^\u001b\u009c]*(?:\u001b\\|\u009c)/g,
  // Any other escape: intermediates, then one final byte.
  /\u001b[ -/]*[0-~]/g,
]);

/** C0 except newline and tab, DEL, C1, and the bidirectional controls. */
const CONTROLS = new RegExp('[' + cls([[0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], ...BIDI_CONTROLS]) + ']', 'g');

/** Every other invisible format character, except the two joiners. */
const FORMAT = new RegExp('(?![' + JOINERS + '])\\p{Cf}', 'gu');

/** A joiner that does not sit between two word characters. */
const LOOSE_JOINER = new RegExp('(?<!' + WORD + ')[' + JOINERS + ']|[' + JOINERS + '](?!' + WORD + ')', 'gu');

/** Line and paragraph separators, which some terminals honour as a line break. */
const SEPARATORS = new RegExp('[' + cls([0x2028, 0x2029]) + ']', 'g');

/** What a JSON document escapes rather than carries raw. */
const JSON_UNSAFE = new RegExp('[' + cls([[0x7f, 0x9f], ...BIDI_CONTROLS, 0x2028, 0x2029]) + ']|\\p{Cf}', 'gu');

/**
 * Make one piece of text inert for a terminal. Idempotent.
 * @param {unknown} text
 * @returns {string}
 */
export function sanitize(text) {
  let s = String(text === undefined || text === null ? '' : text);
  for (const re of SEQUENCES) s = s.replace(re, '');
  return s
    .replace(CONTROLS, '')
    .replace(FORMAT, '')
    .replace(LOOSE_JOINER, '')
    .replace(SEPARATORS, ' ');
}

/**
 * The same characters, escaped instead of removed, for a JSON document. JSON.stringify already
 * escapes C0; it leaves DEL, C1, the bidirectional controls and the format characters raw, and a
 * raw one of those reorders or hides text when the document is printed. Escaping keeps the data
 * whole for a machine while making it inert for a terminal.
 * @param {string} json
 * @returns {string}
 */
export function escapeForJson(json) {
  // Every UTF-16 unit of the match is escaped, so a format character outside the basic plane,
  // which is two units long, becomes a valid surrogate pair escape rather than half of one.
  return String(json).replace(JSON_UNSAFE, (ch) => {
    let out = '';
    for (let i = 0; i < ch.length; i += 1) out += hex(ch.charCodeAt(i));
    return out;
  });
}

/* ------------------------------------------------------------------------------------------
 * Colour, width, layout.
 * ---------------------------------------------------------------------------------------- */

/**
 * Whether styling is on. Decoration only; see the header for the order these are read in.
 * @param {{env?:Record<string,string|undefined>, isTTY?:boolean, noColor?:boolean}} args
 * @returns {boolean}
 */
export function decideColour(args) {
  const env = args.env || {};
  if (args.noColor) return false;
  if (typeof env.NO_COLOR === 'string' && env.NO_COLOR.length > 0) return false;
  if (env.FORCE_COLOR !== undefined) {
    const v = String(env.FORCE_COLOR).trim().toLowerCase();
    return v !== '0' && v !== 'false';
  }
  if (env.TERM === 'dumb') return false;
  return args.isTTY === true;
}

/**
 * The layout width: COLUMNS when it is a sensible whole number, else the terminal's own width
 * when there is one, else eighty.
 * @param {{env?:Record<string,string|undefined>, columns?:number}} args
 * @returns {number}
 */
export function decideWidth(args) {
  const env = args.env || {};
  const raw = typeof env.COLUMNS === 'string' ? env.COLUMNS.trim() : '';
  let width = /^[1-9][0-9]{0,3}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isFinite(width)) {
    width = Number.isInteger(args.columns) && args.columns > 0 ? args.columns : DEFAULT_WIDTH;
  }
  return Math.max(MIN_WIDTH, width);
}

const BOLD_ON = '\u001b[1m';
const BOLD_OFF = '\u001b[22m';

/**
 * A figure inside a library sentence, a provenance line or a note: a number with the word that
 * follows it, or an amount with its unit noun. These are held together on one line too. The
 * currency symbol is read from the one formatter rather than typed here, so this file does not
 * become a second place that knows it.
 */
const CURRENCY = formatUnitBare(0, OBLIGATIONS).replace(/[0-9.,-]/g, '');
const PROSE_FIGURE = new RegExp('(?:-?[' + CURRENCY + '])?\\b[0-9][0-9,]*(?:\\.[0-9]+)?'
  + ' (?:' + UNIT_SPEC[AWARD_VALUE].noun + '|[A-Za-z]+)', 'g');

/**
 * The glue that holds those pieces together through the layout, turned back into a space as each
 * line is emitted. It is a character the sanitiser removes from all input, so no text a reader
 * or the source supplied can ever contain it.
 */
const GLUE = String.fromCharCode(1);

/**
 * @typedef {Object} Segment
 * @property {string} text
 * @property {boolean} [atomic] Never broken across lines. A figure with its unit and badge is one.
 * @property {'heading'|'badge'} [style]
 */

/**
 * @typedef {{kind:'para', segments:Segment[], indent?:number, hanging?:number}
 *   |{kind:'def', term:string, desc:Segment[], indent?:number}
 *   |{kind:'blank'}
 *   |{kind:'raw', text:string}} Block
 */

/**
 * Lay one paragraph out at a width, never splitting an atomic segment. Sanitises first, so a
 * control character never counts toward the width and never survives into the line.
 * @param {Segment[]} segments
 * @param {number} width
 * @param {{indent?:number, hanging?:number, colour?:boolean}} [options]
 * @returns {string[]}
 */
export function layoutParagraph(segments, width, options = {}) {
  const indent = options.indent === undefined ? 0 : options.indent;
  const hanging = options.hanging === undefined ? indent : options.hanging;
  /** @type {{ch:string, atomic:boolean, style:string|null}[]} */
  const chars = [];
  for (const seg of segments) {
    // Inside a paragraph a newline or a tab from the data is a space: a line break the source
    // sent must not be able to start a line that looks like one of ours.
    let text = sanitize(seg.text).replace(/[\n\t]/g, ' ');
    if (seg.atomic !== true) text = text.replace(PROSE_FIGURE, (m) => m.split(' ').join(GLUE));
    for (const ch of Array.from(text)) {
      chars.push({ ch, atomic: seg.atomic === true, style: seg.style === undefined ? null : seg.style });
    }
  }
  /** @type {{ch:string, style:string|null}[][]} */
  const words = [];
  let current = [];
  for (const c of chars) {
    if (c.ch === ' ' && !c.atomic) {
      if (current.length > 0) words.push(current);
      current = [];
    } else {
      current.push(c);
    }
  }
  if (current.length > 0) words.push(current);

  const lines = [];
  let line = [];
  let lineLength = 0;
  let pad = indent;
  for (const w of words) {
    const extra = (line.length === 0 ? 0 : 1) + w.length;
    if (line.length > 0 && pad + lineLength + extra > width) {
      lines.push(emit(line, pad, options.colour === true));
      line = [];
      lineLength = 0;
      pad = hanging;
    }
    if (line.length > 0) {
      line.push({ ch: ' ', style: null });
      lineLength += 1;
    }
    line.push(...w);
    lineLength += w.length;
  }
  if (line.length > 0 || lines.length === 0) lines.push(emit(line, pad, options.colour === true));
  return lines;
}

/**
 * @param {{ch:string, style:string|null}[]} line
 * @param {number} pad
 * @param {boolean} colour
 * @returns {string}
 */
function emit(line, pad, colour) {
  let out = ' '.repeat(pad);
  let styled = false;
  for (const c of line) {
    const want = colour && c.style !== null;
    if (want && !styled) { out += BOLD_ON; styled = true; }
    if (!want && styled) { out += BOLD_OFF; styled = false; }
    out += c.ch === GLUE ? ' ' : c.ch;
  }
  if (styled) out += BOLD_OFF;
  return out.trimEnd();
}

/**
 * Lay a whole document out as text.
 * @param {Block[]} blocks
 * @param {{width:number, colour:boolean}} options
 * @returns {string}
 */
export function layout(blocks, options) {
  const lines = [];
  for (const b of blocks) {
    if (b.kind === 'blank') {
      lines.push('');
    } else if (b.kind === 'raw') {
      for (const l of String(b.text).split('\n')) lines.push(sanitize(l));
    } else if (b.kind === 'def') {
      const indent = b.indent === undefined ? 2 : b.indent;
      const column = 20;
      const head = ' '.repeat(indent) + sanitize(b.term);
      if (options.width >= 60 && head.length + 2 <= column) {
        // The term, then its description starting at a fixed column and wrapped under itself.
        const desc = layoutParagraph(b.desc, options.width - column, { colour: options.colour });
        desc.forEach((l, i) => lines.push((i === 0 ? head.padEnd(column) : ' '.repeat(column)) + l));
      } else {
        lines.push(...layoutParagraph([{ text: b.term }], options.width, { indent, colour: options.colour }));
        lines.push(...layoutParagraph(b.desc, options.width, { indent: indent + 4, colour: options.colour }));
      }
    } else {
      lines.push(...layoutParagraph(b.segments, options.width, {
        indent: b.indent, hanging: b.hanging, colour: options.colour,
      }));
    }
  }
  return lines.join('\n') + '\n';
}

/* ------------------------------------------------------------------------------------------
 * The sink.
 * ---------------------------------------------------------------------------------------- */

/**
 * @typedef {Object} Sink
 * @property {boolean} colour
 * @property {number} width
 * @property {(blocks:Block[]) => void} write Lay out and write a document to standard output.
 * @property {(text:string) => void} raw Write a machine document, sanitised line by line.
 * @property {(blocks:Block[]|string) => void} err Write words to standard error.
 * @property {(blocks:Block[]) => string} render The same layout with no styling, for a file.
 * @property {() => boolean} readerClosed
 * @property {(fn:() => void) => void} onReaderClosed
 */

/**
 * @param {Object} [args]
 * @param {any} [args.stdout] Defaults to the process stream.
 * @param {any} [args.stderr] Defaults to the process stream.
 * @param {Record<string,string|undefined>} [args.env]
 * @param {boolean} [args.noColor] --no-color, --plain, --json or --csv.
 * @returns {Sink}
 */
export function createOut(args = {}) {
  const stdout = args.stdout === undefined ? process.stdout : args.stdout;
  const stderr = args.stderr === undefined ? process.stderr : args.stderr;
  const env = args.env === undefined ? {} : args.env;
  const colour = decideColour({ env, isTTY: Boolean(stdout && stdout.isTTY), noColor: args.noColor });
  const width = decideWidth({ env, columns: stdout && stdout.isTTY ? stdout.columns : undefined });
  const errWidth = decideWidth({ env, columns: stderr && stderr.isTTY ? stderr.columns : undefined });

  let closed = false;
  /** @type {(() => void)[]} */
  const closers = [];
  // Any failure to write standard output is a reader that is no longer there. EPIPE is the
  // ordinary case, EOF is how Windows reports the same pipe, and a destroyed stream is how Node
  // reports a write after either. Anything else is treated the same way rather than crashing
  // with a stack trace over output nobody can read.
  const readerGone = () => {
    if (closed) return;
    closed = true;
    for (const fn of closers) fn();
  };
  if (stdout && typeof stdout.on === 'function') stdout.on('error', readerGone);
  if (stderr && typeof stderr.on === 'function') stderr.on('error', () => {});

  /** @param {any} stream @param {string} text */
  const put = (stream, text) => {
    if (stream === stdout && closed) return;
    try {
      stream.write(text);
    } catch {
      if (stream === stdout) readerGone();
    }
  };

  return {
    colour,
    width,
    write(blocks) { put(stdout, layout(blocks, { width, colour })); },
    raw(text) {
      const s = String(text);
      const lines = s.split('\n').map((l) => sanitize(l));
      put(stdout, lines.join('\n') + (s.endsWith('\n') ? '' : '\n'));
    },
    err(blocks) {
      const doc = typeof blocks === 'string'
        ? [{ kind: 'para', segments: [{ text: blocks }] }]
        : blocks;
      put(stderr, layout(/** @type {Block[]} */ (doc), { width: errWidth, colour: false }));
    },
    render(blocks) {
      return layout(blocks, { width, colour: false });
    },
    readerClosed: () => closed,
    onReaderClosed(fn) { closers.push(fn); },
  };
}

/* ------------------------------------------------------------------------------------------
 * The one file this tool will write, and only when asked.
 * ---------------------------------------------------------------------------------------- */

/**
 * Write the output to the path the reader named with --out.
 *
 * Without --force the file is opened exclusive and created: an existing file is refused, and so
 * is an existing link of any kind, because the exclusive create fails on a path that exists at
 * all. With --force an existing plain file is replaced, and a link is STILL refused, checked
 * first and refused again at open time where the platform can refuse to follow one. Nothing is
 * ever written inside the package directory, which is where this tool's own code lives.
 *
 * The text is sanitised on the way out like everything else, so a report saved today and printed
 * with cat next week is as inert as the one printed now.
 *
 * @param {string} target
 * @param {string} text
 * @param {{force?:boolean, packageRoot?:string, cwd?:string}} [options]
 * @returns {Promise<{ok:true, path:string}
 *   |{ok:false, reason:'exists'|'link'|'inside-package'|'not-a-file'|'unwritable', path:string}>}
 */
export async function writeOutFile(target, text, options = {}) {
  const cwd = options.cwd === undefined ? process.cwd() : options.cwd;
  const abs = path.resolve(cwd, target);
  const root = options.packageRoot === undefined ? PACKAGE_ROOT : options.packageRoot;
  // Checked twice: once as written, and once with every link in the directory part resolved, so
  // a directory link that points into the package cannot carry a write there.
  const inside = (dir, file) => {
    const rel = path.relative(dir, file);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  if (inside(root, abs)) return { ok: false, reason: 'inside-package', path: abs };
  const realRoot = await realpath(root).catch(() => root);
  const realDir = await realpath(path.dirname(abs)).catch(() => null);
  if (realDir === null) return { ok: false, reason: 'unwritable', path: abs };
  if (inside(realRoot, path.join(realDir, path.basename(abs)))) {
    return { ok: false, reason: 'inside-package', path: abs };
  }
  const body = String(text).split('\n').map((l) => sanitize(l)).join('\n');
  let flags;
  if (options.force === true) {
    try {
      const st = await lstat(abs);
      if (st.isSymbolicLink()) return { ok: false, reason: 'link', path: abs };
      if (!st.isFile()) return { ok: false, reason: 'not-a-file', path: abs };
    } catch (e) {
      if (!e || e.code !== 'ENOENT') return { ok: false, reason: 'unwritable', path: abs };
    }
    // Write only, create, truncate, and never follow a link where the platform offers that.
    flags = FS.O_WRONLY | FS.O_CREAT | FS.O_TRUNC | (typeof FS.O_NOFOLLOW === 'number' ? FS.O_NOFOLLOW : 0);
  } else {
    flags = 'wx';
  }
  let handle;
  try {
    handle = await open(abs, flags, 0o644);
  } catch (e) {
    const code = e && e.code;
    if (code === 'EEXIST') return { ok: false, reason: 'exists', path: abs };
    if (code === 'ELOOP') return { ok: false, reason: 'link', path: abs };
    if (code === 'EISDIR') return { ok: false, reason: 'not-a-file', path: abs };
    return { ok: false, reason: 'unwritable', path: abs };
  }
  try {
    await handle.writeFile(body, 'utf8');
  } catch {
    return { ok: false, reason: 'unwritable', path: abs };
  } finally {
    await handle.close();
  }
  return { ok: true, path: abs };
}
