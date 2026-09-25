// CSV A SPREADSHEET CANNOT RUN. Entity, agency and award names are text the source sent, and a
// spreadsheet reads a cell starting with = + - @ TAB or CR, or whitespace and then one of those,
// as a formula. Every such text cell gets a single quote in front. These tests hold the cell
// function to that rule, then hold a whole report's CSV to it cell by cell.

import test from 'node:test';
import assert from 'node:assert/strict';

import { csvCell, csvRow } from '../src/cli/csv.js';
import { CSV_HEADER } from '../src/cli/render.js';
import { EXIT } from '../src/cli/main.js';
import { runCli, healthyRoutes, syntheticCategory } from './helpers/cli-harness.js';

/** A character from its code point. Nothing above the ASCII range is written raw in this file. */
const u = (...points) => String.fromCodePoint(...points);

const Q = String.fromCharCode(39);

/**
 * Parse CSV the way a spreadsheet would, enough for these tests: every cell quoted, quotes doubled.
 * @param {string} text
 * @returns {string[][]}
 */
function parseCsv(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (line.length === 0) continue;
    const cells = [];
    let i = 0;
    while (i < line.length) {
      assert.equal(line[i], '"', 'every cell is quoted: ' + line.slice(i, i + 20));
      let j = i + 1;
      let cell = '';
      for (;;) {
        if (line[j] === '"' && line[j + 1] === '"') { cell += '"'; j += 2; continue; }
        if (line[j] === '"') break;
        cell += line[j];
        j += 1;
      }
      cells.push(cell);
      i = j + 1;
      if (line[i] === ',') i += 1;
    }
    rows.push(cells);
  }
  return rows;
}

/** A cell a spreadsheet would read as a formula. */
const FORMULA = /^\s*[=+\-@\t\r]/;

test('every formula lead is neutralised with a single quote, and the cell keeps its text', () => {
  const cases = [
    ['=1+1', Q + '=1+1'],
    ['+CMD|calc', Q + '+CMD|calc'],
    ['-2+3', Q + '-2+3'],
    ['@SUM(A1:A2)', Q + '@SUM(A1:A2)'],
    ['\t=HYPERLINK("x")', Q + '\t=HYPERLINK(""x"")'],
    ['\r=1', Q + ' =1'],
    ['   =cmd', Q + '   =cmd'],
    [' \t@x', Q + ' \t@x'],
    ['  -1', Q + '  -1'],
    ['-$1,234.50 obligated', Q + '-$1,234.50 obligated'],
    ['-5', Q + '-5'],
  ];
  for (const [input, want] of cases) {
    assert.equal(csvCell(input), '"' + want + '"', JSON.stringify(input));
  }
});

test('an invisible character in front of a formula lead cannot hide it, because the cell is sanitised first', () => {
  for (const lead of ['\u0000', u(0x200b), u(0x202e), u(0xfeff), '\u007f', '\u0085']) {
    const cell = csvCell(lead + '=HYPERLINK("http://example.invalid")');
    assert.ok(cell.startsWith('"' + Q + '='), JSON.stringify(lead) + ' produced ' + cell);
  }
  // An escape followed by = is a two character control sequence, and the sanitiser removes both,
  // so what reaches the spreadsheet does not start with a formula lead at all.
  for (const lead of ['\u001b', '\u009b']) {
    const cell = csvCell(lead + '=HYPERLINK("http://example.invalid")');
    assert.ok(!FORMULA.test(cell.slice(1)), JSON.stringify(lead) + ' produced ' + cell);
  }
});

test('ordinary text is quoted and left alone; quotes are doubled; a line break becomes a space', () => {
  assert.equal(csvCell('LOCKHEED MARTIN CORP'), '"LOCKHEED MARTIN CORP"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('one\ntwo\r\nthree'), '"one two three"');
  const accented = 'SOCI' + u(0xc9) + 'T' + u(0xc9) + ' ' + u(0x2018) + 'X' + u(0x2019);
  assert.equal(csvCell(accented), '"' + accented + '"');
  assert.equal(csvCell(null), '""');
  assert.equal(csvRow(['a', null, 'b']), '"a","","b"');
});

test('a number this tool serialised is a number cell, even when negative; a string that looks numeric is text', () => {
  assert.equal(csvCell(-0.01), '"-0.01"');
  assert.equal(csvCell(65405410468.25), '"65405410468.25"');
  assert.equal(csvCell(0.988), '"0.988"');
  assert.equal(csvCell('-0.01'), '"' + Q + '-0.01"', 'the exception is by type, not by appearance');
  assert.throws(() => csvCell(Number.NaN), TypeError);
  assert.throws(() => csvCell(Number.POSITIVE_INFINITY), TypeError);
  assert.equal(csvCell(1e21), '"1e+21"', 'an exponent form is not a plain number and is judged as text');
  assert.equal(csvCell(-1e21), '"' + Q + '-1e+21"', 'and judged as text, a minus in front is neutralised');
});

test('the column headers name their unit, and the four unit kinds never share a column', () => {
  const money = CSV_HEADER.filter((h) => /dollar/i.test(h));
  assert.deepEqual(money, [
    'Dollars obligated in the fiscal year',
    'Lifetime award value in dollars, exercised options included',
  ]);
  assert.ok(CSV_HEADER.includes('Share of the stated denominator, as a decimal fraction'));
  assert.ok(CSV_HEADER.includes('Count of records'));
  assert.equal(new Set(CSV_HEADER).size, CSV_HEADER.length);
  for (const h of CSV_HEADER) assert.ok(!/\$/.test(h), 'no currency symbol in a header');
});

test('a whole report as CSV: every text cell is safe, value cells are plain numbers, hostile names are neutralised', async () => {
  const routes = healthyRoutes();
  // Category rows whose names are formula payloads, as a hostile or broken upstream could send.
  const hostile = syntheticCategory('psc');
  hostile.results[0].name = '=HYPERLINK("http://example.invalid","click")';
  hostile.results[1].name = '@SUM(1+1)';
  hostile.results[2].name = ' +cmd';
  routes['POST /api/v2/search/spending_by_category/psc/'] = hostile;
  const r = await runCli(['lockheed', 'martin', '--uei', 'ZFN2JJXBLZT3', '--csv'], { routes });
  assert.equal(r.code, EXIT.DONE);
  const rows = parseCsv(r.stdout);
  assert.deepEqual(rows[0], [...CSV_HEADER]);
  const valueColumns = [8, 9, 10, 11];
  let numbers = 0;
  for (const row of rows.slice(1)) {
    assert.equal(row.length, CSV_HEADER.length);
    row.forEach((cell, i) => {
      if (valueColumns.includes(i) && cell !== '') {
        assert.match(cell, /^-?[0-9]+(?:\.[0-9]+)?$/, 'a value cell is a plain number: ' + cell);
        numbers += 1;
      } else {
        assert.ok(!FORMULA.test(cell), 'column ' + CSV_HEADER[i] + ' reads as a formula: ' + JSON.stringify(cell));
      }
    });
  }
  assert.ok(numbers > 100, 'the report carries its figures as numbers too');
  const figureTexts = rows.slice(1).map((row) => row[5]).filter((c) => c !== '');
  assert.ok(figureTexts.some((t) => t === Q + '-$50.00 obligated [REPORTED]'), 'a negative figure as printed is neutralised');
  assert.ok(figureTexts.includes('$65,405,410,468.25 obligated [REPORTED]'));
  const entities = rows.slice(1).map((row) => row[3]);
  assert.ok(entities.includes(Q + '=HYPERLINK("http://example.invalid","click")'));
  assert.ok(entities.includes(Q + '@SUM(1+1)'));
  assert.ok(entities.includes(Q + ' +cmd'));
  const about = rows.filter((row) => row[0] === 'about').map((row) => row[19]);
  assert.equal(about.length, 4, 'the date, the source, independence and the disclaimer close every CSV');
});

test('a refusal as CSV carries the statement and the records with their identifiers, and no amount', async () => {
  const r = await runCli(['lockheed', 'martin', '--csv']);
  assert.equal(r.code, EXIT.CHOICE_REQUIRED);
  const rows = parseCsv(r.stdout);
  const records = rows.filter((row) => row[0] === 'refusal' && row[2] === 'record');
  assert.equal(records.length, 16);
  assert.ok(records.every((row) => /^[A-Z0-9]{12}$/.test(row[4])));
  assert.ok(rows.some((row) => row[0] === 'refusal' && row[2] === 'statement' && /No single parent record/.test(row[19])));
  for (const row of rows.slice(1)) {
    for (const i of [8, 9, 10, 11]) assert.equal(row[i], '', 'a refusal carries no figure');
  }
});
