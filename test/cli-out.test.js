// THE ONE OUTPUT SINK. Everything the command line shows a reader leaves through src/cli/out.js,
// so the terminal's safety rests on one function and these tests hold it to its word.
//
// Every hostile sequence below is written with escapes, never raw, so this file contains no
// invisible or reordering character a reviewer could miss.

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, symlink, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  sanitize, escapeForJson, decideColour, decideWidth, layoutParagraph, layout, createOut,
  writeOutFile, DEFAULT_WIDTH, MIN_WIDTH,
} from '../src/cli/out.js';
import { EXIT } from '../src/cli/main.js';
import { runCli, recordingStream } from './helpers/cli-harness.js';

const ESC = '\u001b';
const BEL = '\u0007';
const ST = ESC + '\\';

/** A character from its code point. Nothing above the ASCII range is written raw in this file. */
const u = (...points) => String.fromCodePoint(...points);

/** A regular expression class escape for a code point, built from the number. */
const esc = (n) => '\\u{' + n.toString(16) + '}';

/** Every character a terminal could act on, or that could hide or reorder text. */
const UNSAFE = new RegExp('[' + [
  [0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], [0x061c], [0x200b], [0x200e, 0x200f], [0x202a, 0x202e],
  [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff],
].map((r) => (r.length === 1 ? esc(r[0]) : esc(r[0]) + '-' + esc(r[1]))).join('') + ']', 'u');

const HOSTILE = Object.freeze({
  'a screen clear': 'A' + ESC + '[2J' + ESC + '[H' + 'B',
  'an OSC 8 hyperlink': ESC + ']8;;https://example.invalid/x' + ST + 'click here' + ESC + ']8;;' + ST,
  'an OSC 8 hyperlink ended by BEL': ESC + ']8;;https://example.invalid/' + BEL + 'here' + ESC + ']8;;' + BEL,
  'an OSC 52 clipboard write': ESC + ']52;c;cm0gLXJmIH4=' + BEL + 'after',
  'a window title': ESC + ']0;owned' + BEL + 'title',
  'an eight bit CSI': 'x\u009b31mred\u009b0m',
  'an eight bit OSC': '\u009d8;;https://example.invalid/\u009cz',
  'a DCS string': ESC + 'Pq#0;2;0;0;0' + ST + 'dcs',
  'a right to left override': 'abc' + u(0x202e) + 'dcba',
  'a first strong isolate': 'x' + u(0x2066) + 'y' + u(0x2069) + 'z',
  'the marks and embeddings': u(0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x061c) + 'm',
  'DEL': 'de\u007fl',
  'NUL, backspace and a carriage return': 'a\u0000b\u0008c\rd',
  'a zero width space and a byte order mark': 'z' + u(0x200b) + 'w' + u(0xfeff) + 's',
  'a line separator': 'one' + u(0x2028) + 'two' + u(0x2029) + 'three',
  'a lone joiner': u(0x200d) + 'start end' + u(0x200c),
  'a C1 NEL': 'next\u0085line',
});

test('the sanitiser leaves nothing a terminal could act on, for every hostile sequence', () => {
  for (const [name, text] of Object.entries(HOSTILE)) {
    const out = sanitize(text);
    assert.ok(!UNSAFE.test(out), name + ' survived: ' + JSON.stringify(out));
    assert.equal(sanitize(out), out, name + ' is not idempotent');
  }
  assert.equal(sanitize(HOSTILE['a screen clear']), 'AB');
  assert.equal(sanitize(HOSTILE['an OSC 8 hyperlink']), 'click here', 'the link text stays, the link goes');
  assert.equal(sanitize(HOSTILE['an OSC 52 clipboard write']), 'after');
  assert.equal(sanitize(HOSTILE['an eight bit CSI']), 'xred');
  assert.equal(sanitize(HOSTILE['a right to left override']), 'abcdcba');
  assert.equal(sanitize(HOSTILE['a line separator']), 'one two three');
  assert.equal(sanitize(HOSTILE['a lone joiner']), 'start end');
});

test('printable non ASCII passes untouched: accented names, curly quotes, scripts that need a joiner', () => {
  const legit = [
    'SOCI' + u(0xc9) + 'T' + u(0xc9) + ' G' + u(0xc9) + 'N' + u(0xc9) + 'RALE',
    'M' + u(0xdc) + 'NCHEN GMBH',
    u(0x2018) + 'QUOTED' + u(0x2019) + ' AND ' + u(0x201c) + 'DOUBLE' + u(0x201d),
    'O' + u(0x2019) + 'BRIEN & SONS',
    // Devanagari with a zero width joiner between a virama and a consonant.
    u(0x915, 0x94d, 0x200d, 0x937),
    // A zero width non joiner inside a Persian word.
    u(0x645, 0x6cc, 0x200c, 0x62e, 0x648, 0x627, 0x647, 0x645),
    'Z' + u(0xfc) + 'rich ' + u(0xe5) + ' ' + u(0xf8) + ' ' + u(0xdf) + ' ' + u(0x142),
  ];
  for (const s of legit) assert.equal(sanitize(s), s, JSON.stringify(s));
});

test('newline and tab survive the sanitiser, and a paragraph turns them into spaces', () => {
  assert.equal(sanitize('a\nb\tc'), 'a\nb\tc');
  assert.deepEqual(layoutParagraph([{ text: 'a\nb\tc' }], 80), ['a b c']);
});

test('JSON escapes what JSON.stringify leaves raw, and the data survives a round trip', () => {
  const value = 'x\u009b31m ' + u(0x202e) + ' ' + u(0x2066) + ' \u007f ' + u(0x200b) + ' '
    + u(0x2028) + ' ' + u(0xe0041) + ' end';
  const text = escapeForJson(JSON.stringify({ value }));
  assert.ok(!UNSAFE.test(text), text);
  assert.ok(![...text].some((c) => c.codePointAt(0) > 0x7e), 'the document is plain ASCII after escaping');
  assert.equal(JSON.parse(text).value, value, 'escaping must not change the data');
  assert.ok(text.includes('\\udb40\\udc41'), 'a character outside the basic plane is escaped as a full pair');
});

test('colour: only on a terminal, off for NO_COLOR with any value, FORCE_COLOR turns it on unless NO_COLOR', () => {
  const cases = [
    [{ isTTY: true, env: {} }, true],
    [{ isTTY: false, env: {} }, false],
    [{ isTTY: true, env: { NO_COLOR: '1' } }, false],
    [{ isTTY: true, env: { NO_COLOR: 'false' } }, false],
    [{ isTTY: true, env: { NO_COLOR: '' } }, true],
    [{ isTTY: false, env: { FORCE_COLOR: '1' } }, true],
    [{ isTTY: false, env: { FORCE_COLOR: '' } }, true],
    [{ isTTY: true, env: { FORCE_COLOR: '0' } }, false],
    [{ isTTY: false, env: { FORCE_COLOR: '1', NO_COLOR: '1' } }, false],
    [{ isTTY: true, env: { TERM: 'dumb' } }, false],
    [{ isTTY: true, env: {}, noColor: true }, false],
  ];
  for (const [args, want] of cases) assert.equal(decideColour(/** @type {any} */ (args)), want, JSON.stringify(args));
});

test('width: COLUMNS when it is a sane whole number, then the terminal, then eighty; never under the floor', () => {
  assert.equal(decideWidth({ env: {} }), DEFAULT_WIDTH);
  assert.equal(DEFAULT_WIDTH, 80);
  assert.equal(decideWidth({ env: { COLUMNS: '40' } }), 40);
  assert.equal(decideWidth({ env: { COLUMNS: '5' } }), MIN_WIDTH);
  assert.equal(decideWidth({ env: { COLUMNS: 'wide' } }), 80);
  assert.equal(decideWidth({ env: { COLUMNS: '-3' } }), 80);
  assert.equal(decideWidth({ env: {}, columns: 132 }), 132);
  assert.equal(decideWidth({ env: { COLUMNS: '60' }, columns: 132 }), 60);
});

test('a figure is never split across lines, even when it is wider than the line', () => {
  const figure = { text: '$65,405,410,468.25 obligated [REPORTED]', atomic: true };
  for (const width of [20, 30, 40, 80]) {
    const lines = layoutParagraph([{ text: 'Recorded against this parent identifier family: ' }, figure], width);
    assert.equal(lines.filter((l) => l.includes(figure.text)).length, 1, 'width ' + width);
    for (const l of lines) {
      if (!l.includes(figure.text)) assert.ok(l.length <= width, JSON.stringify(l));
    }
  }
});

test('a figure inside a sentence stays with its unit when the sentence wraps', () => {
  const sentence = 'of $1,700.00 in lifetime award value across the 3 largest awards, 98.8 percent of '
    + 'which, and -$0.01 obligated in the gap.';
  for (let width = 20; width <= 60; width += 1) {
    const lines = layoutParagraph([{ text: sentence }], width);
    const joined = lines.join('\n');
    for (const piece of ['$1,700.00 in lifetime award value', '3 largest', '98.8 percent', '-$0.01 obligated']) {
      assert.ok(joined.split('\n').some((l) => l.includes(piece)), piece + ' split at width ' + width);
    }
  }
});

test('styling is bold on headings and badge words only, applied after sanitising, and off in a file', () => {
  const blocks = [
    { kind: 'para', segments: [{ text: 'Heading' + ESC + '[31m', style: 'heading' }] },
    { kind: 'para', segments: [{ text: 'x: $1.00 obligated [', atomic: true }, { text: 'REPORTED', atomic: true, style: 'badge' }, { text: ']', atomic: true }] },
  ];
  const coloured = layout(/** @type {any} */ (blocks), { width: 80, colour: true });
  assert.equal(coloured, ESC + '[1mHeading' + ESC + '[22m\nx: $1.00 obligated [' + ESC + '[1mREPORTED' + ESC + '[22m]\n');
  const plain = layout(/** @type {any} */ (blocks), { width: 80, colour: false });
  assert.ok(!plain.includes(ESC));
  assert.ok(plain.includes('[REPORTED]'), 'the badge word is always printed');
  const out = createOut({ stdout: recordingStream({ isTTY: true }), stderr: recordingStream(), env: {} });
  assert.equal(out.colour, true);
  assert.ok(!out.render(/** @type {any} */ (blocks)).includes(ESC), 'a file never carries styling');
});

test('standard error carries no styling and is sanitised like everything else', () => {
  const stdout = recordingStream({ isTTY: true });
  const stderr = recordingStream({ isTTY: true });
  const out = createOut({ stdout, stderr, env: {} });
  out.err('Notice ' + ESC + ']0;owned' + BEL + 'done');
  assert.equal(stderr.text(), 'Notice done\n');
});

test('raw machine output is sanitised line by line and keeps its line breaks', () => {
  const stdout = recordingStream();
  const out = createOut({ stdout, stderr: recordingStream(), env: {} });
  out.raw('a,"b' + ESC + '[2J"\nc,d');
  assert.equal(stdout.text(), 'a,"b"\nc,d\n');
});

test('EPIPE: a reader that closes the pipe stops the output quietly, whether it arrives as an event or a throw', () => {
  const async = /** @type {any} */ (new EventEmitter());
  async.isTTY = false;
  async.write = () => { setImmediate(() => async.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))); return false; };
  const out = createOut({ stdout: async, stderr: recordingStream(), env: {} });
  let told = 0;
  out.onReaderClosed(() => { told += 1; });
  out.write([{ kind: 'para', segments: [{ text: 'one' }] }]);
  return new Promise((resolve) => {
    setImmediate(() => {
      assert.equal(out.readerClosed(), true);
      assert.equal(told, 1);
      assert.doesNotThrow(() => out.write([{ kind: 'para', segments: [{ text: 'two' }] }]));
      const sync = /** @type {any} */ (new EventEmitter());
      sync.write = () => { throw Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }); };
      const out2 = createOut({ stdout: sync, stderr: recordingStream(), env: {} });
      assert.doesNotThrow(() => out2.raw('x'));
      assert.equal(out2.readerClosed(), true);
      resolve(undefined);
    });
  });
});

test('EPIPE through the whole command: a closed pipe ends the run with exit code zero', async () => {
  const closing = /** @type {any} */ (new EventEmitter());
  closing.isTTY = false;
  closing.write = () => { setImmediate(() => closing.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))); return false; };
  const r = await runCli(['claims'], { stdoutStream: closing });
  assert.equal(r.code, EXIT.DONE);
  assert.equal(r.stderr, '', 'a closed pipe is not an error and says nothing');
  const report = await runCli(['lockheed', 'martin'], { stdoutStream: closing });
  assert.equal(report.code, EXIT.DONE, 'even a refusal ends quietly once nobody is reading');
});

test('--out: exclusive create, refuses an existing file and a link, --force replaces a file and still refuses a link', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'solebidder-out-'));
  const pkg = path.join(dir, 'pkg');
  await mkdir(pkg);
  try {
    const target = path.join(dir, 'report.txt');
    const first = await writeOutFile(target, 'one ' + ESC + '[2Jline\n', { packageRoot: pkg });
    assert.deepEqual(first, { ok: true, path: target });
    assert.equal(await readFile(target, 'utf8'), 'one line\n', 'the file is sanitised like the terminal');

    const again = await writeOutFile(target, 'two', { packageRoot: pkg });
    assert.equal(again.ok, false);
    assert.equal(/** @type {any} */ (again).reason, 'exists');
    assert.equal(await readFile(target, 'utf8'), 'one line\n', 'a refused write leaves the file alone');

    const forced = await writeOutFile(target, 'two', { packageRoot: pkg, force: true });
    assert.equal(forced.ok, true);
    assert.equal(await readFile(target, 'utf8'), 'two');

    const dirTarget = await writeOutFile(dir, 'x', { packageRoot: pkg, force: true });
    assert.equal(/** @type {any} */ (dirTarget).reason, 'not-a-file');

    const inside = await writeOutFile(path.join(pkg, 'src', 'x.txt'), 'x', { packageRoot: pkg });
    assert.equal(/** @type {any} */ (inside).reason, 'inside-package');
    const insideRoot = await writeOutFile('x.txt', 'x', { packageRoot: pkg, cwd: pkg });
    assert.equal(/** @type {any} */ (insideRoot).reason, 'inside-package');

    const missingDir = await writeOutFile(path.join(dir, 'nope', 'x.txt'), 'x', { packageRoot: pkg });
    assert.equal(/** @type {any} */ (missingDir).reason, 'unwritable');

    // Links. Creating one needs a privilege Windows does not always grant, so the link half runs
    // wherever the platform lets the test make one, and says so where it does not.
    const victim = path.join(dir, 'victim.txt');
    await writeFile(victim, 'keep');
    const link = path.join(dir, 'link.txt');
    let linked = true;
    try { await symlink(victim, link, 'file'); } catch { linked = false; }
    if (linked) {
      const viaLink = await writeOutFile(link, 'x', { packageRoot: pkg });
      assert.equal(viaLink.ok, false);
      const viaLinkForced = await writeOutFile(link, 'x', { packageRoot: pkg, force: true });
      assert.equal(/** @type {any} */ (viaLinkForced).reason, 'link');
      assert.equal(await readFile(victim, 'utf8'), 'keep', 'nothing was written through the link');

      const dirLink = path.join(dir, 'pkglink');
      let dirLinked = true;
      try { await symlink(pkg, dirLink, 'junction'); } catch { dirLinked = false; }
      if (dirLinked) {
        const through = await writeOutFile(path.join(dirLink, 'x.txt'), 'x', { packageRoot: pkg });
        assert.equal(/** @type {any} */ (through).reason, 'inside-package', 'a directory link into the package is followed and refused');
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--out through the command: the output goes to the file, a notice to standard error, and a refusal exits one', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'solebidder-cli-out-'));
  try {
    const r = await runCli(['claims', '--json', '--out', 'claims.json'], { cwd: dir });
    assert.equal(r.code, EXIT.DONE);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /Wrote the output to\s/);
    const doc = JSON.parse(await readFile(path.join(dir, 'claims.json'), 'utf8'));
    assert.equal(doc.schema, 'solebidder.cli/1');
    const again = await runCli(['claims', '--out', 'claims.json'], { cwd: dir });
    assert.equal(again.code, EXIT.FAILURE);
    assert.match(again.stderr, /already exists\. Pass --force/);
    assert.match(again.stderr, /Nothing was written to\s/);
    const forced = await runCli(['claims', '--out', 'claims.json', '--force'], { cwd: dir });
    assert.equal(forced.code, EXIT.DONE);
    assert.match(await readFile(path.join(dir, 'claims.json'), 'utf8'), /^What this tool never claims/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
