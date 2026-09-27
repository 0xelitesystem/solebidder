// THE COMMAND LINE'S WORDS, AND ITS ONE DOOR TO THE TERMINAL.
//
// Two rules that the gates also enforce, checked here directly so a broken gate cannot hide a
// broken command line: only src/cli/out.js writes to a terminal, and no sentence the command
// line prints, as assembled at run time, carries a banned phrase. Then --help is held to DESIGN
// CLI section 0 item 15: everything a reader needs, readable at eighty columns.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { scanText } from '../scripts/banned-vocabulary.mjs';
import { scanJsForTerminalWrites, scanJsForEstimates, OUTPUT_SINK } from '../scripts/gate-badges.mjs';
import { scanForCurrencyLiteral, stripComments } from '../scripts/gate-units.mjs';
import {
  cliStringTables, requestPlan, ATTRIBUTION, INDEPENDENCE, PURPOSE, SCHEMA, TITLES,
  LABELS, COPY, NOTICES, OFFLINE, PROGRESS, privacyLine,
} from '../src/cli/copy.js';
import { ADVICE_DISCLAIMER, HERO_AWARD_COUNT, FISCAL_YEAR_FLOOR } from '../src/core/constants.js';
import { MAX_CATEGORY_PAGES } from '../src/api/categories.js';
import { CATEGORY_PANELS } from '../src/api/dimensions.js';
import { userAgent } from '../src/cli/fetch.js';
import { DEFAULT_POLICY } from '../src/query/retry.js';
import { EXIT } from '../src/cli/main.js';
import { REPO } from './helpers/fake-client.js';
import { runCli, NOW } from './helpers/cli-harness.js';

const CLI = path.join(REPO, 'src', 'cli');

/** The two long dashes, built from their code points so neither is ever typed into this file. */
const LONG_DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');

/** @returns {Promise<{rel:string, text:string}[]>} */
async function cliFiles() {
  const names = (await readdir(CLI)).filter((n) => /\.(js|mjs)$/.test(n)).sort();
  return Promise.all(names.map(async (n) => ({ rel: 'src/cli/' + n, text: await readFile(path.join(CLI, n), 'utf8') })));
}

test('ONLY src/cli/out.js WRITES TO A TERMINAL: no other module under src/cli touches console or the process streams', async () => {
  const files = await cliFiles();
  assert.ok(files.length >= 8, 'the command line modules are all here');
  assert.ok(files.some((f) => f.rel === OUTPUT_SINK));
  for (const f of files) {
    const code = stripComments(f.text);
    const direct = /\bconsole\s*[.[]|\bprocess\s*(?:\.\s*|\[\s*['"`])(?:stdout|stderr)/.test(code);
    if (f.rel === OUTPUT_SINK) {
      assert.ok(direct, 'the sink is where the streams are reached');
      continue;
    }
    assert.equal(direct, false, f.rel + ' reaches a terminal without the sink');
    assert.deepEqual(scanJsForTerminalWrites(f.text, f.rel), [], f.rel);
  }
});

test('the installed command holds no words: its only string is the module it imports', async () => {
  const text = await readFile(path.join(CLI, 'bin.js'), 'utf8');
  assert.ok(text.startsWith('#!/usr/bin/env node\n'), 'a shebang, and LF line endings');
  const strings = stripComments(text).match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) || [];
  assert.deepEqual(strings, ["'./main.js'"]);
});

test('no module under src/cli builds an estimate, a currency string, or a long dash', async () => {
  for (const f of await cliFiles()) {
    assert.deepEqual(scanJsForEstimates(f.text, f.rel), [], f.rel);
    assert.deepEqual(scanForCurrencyLiteral(f.text, f.rel), [], f.rel);
    assert.ok(!LONG_DASH.test(f.text), f.rel + ' carries a long dash');
    assert.ok(![...f.text].some((c) => c.codePointAt(0) > 0x7e), f.rel + ' is not plain ASCII');
  }
});

test('EVERY STRING THE COMMAND LINE PRINTS FROM, as assembled at run time, passes the vocabulary rules', () => {
  const strings = cliStringTables({ version: '0.2.0', now: NOW });
  assert.ok(strings.length > 100, 'the tables are all there: ' + strings.length);
  for (const s of strings) {
    assert.deepEqual(scanText(s, 'cli', 'shipped').map((h) => h.ruleId + ' ' + h.match), [], s);
    assert.ok(!/estimated\s*\(/i.test(s), s);
    assert.ok(!LONG_DASH.test(s), s);
  }
  // A banned phrase assembled from pieces, the way a builder would, is caught whole.
  assert.ok(scanText('See everything the ' + 'company gets.', 'cli', 'shipped').length > 0);
});

test('outside --help and the usage errors, the command line prints no digit that is not a fiscal year label', () => {
  const tables = [TITLES, LABELS, COPY, NOTICES, OFFLINE, PROGRESS];
  /** @param {any} v @returns {string[]} */
  const flatten = (v) => (typeof v === 'string' ? [v]
    : typeof v === 'function' ? [String(v('Sample Name', 'SAMPLEUEIABC', FISCAL_YEAR_FLOOR))]
      : Object.values(v).flatMap(flatten));
  for (const s of tables.flatMap(flatten)) {
    const residue = s.replace(/FY[0-9]{4}/g, '').replace(/https:\/\/\S+/g, '');
    assert.ok(!/[0-9]/.test(residue), 'a bare number in copy: ' + s);
  }
});

test('the legal lines are the ones the README and DESIGN carry', async () => {
  assert.equal(ATTRIBUTION, 'Source: USAspending.gov, United States Department of the Treasury.');
  const readme = (await readFile(path.join(REPO, 'README.md'), 'utf8')).replace(/\s+/g, ' ');
  const pageForm = INDEPENDENCE.replace('named in this output', 'named on the page');
  assert.ok(readme.includes(pageForm), 'the independence statement is the README one, with this output for the page');
  assert.ok(readme.includes(ADVICE_DISCLAIMER));
  assert.equal(SCHEMA, 'solebidder.cli/1');
  assert.ok(PURPOSE.includes('obligations, not revenue'));
  assert.ok(privacyLine('1.2.3').includes(userAgent('1.2.3')));
  assert.ok(!/@|\\|\/Users\/|home/i.test(userAgent('1.2.3')), 'the User-Agent carries nothing personal');
});

test('the request plan in --help is computed from the constants that set it', () => {
  const plan = requestPlan();
  assert.equal(plan.report, 5 + HERO_AWARD_COUNT + 1 + CATEGORY_PANELS.length + 2 * MAX_CATEGORY_PAGES);
  assert.equal(plan.report, 60);
  // Each distinct request can be tried up to the retry ceiling, so the wire ceiling is the product.
  assert.equal(plan.attempts, DEFAULT_POLICY.maxAttempts);
  assert.equal(plan.report * plan.attempts, 240);
  assert.equal(plan.refusal, 2);
  assert.equal(plan.capMiB, 4);
});

test('--help at eighty columns carries everything DESIGN CLI section 0 item 15 asks for', async () => {
  const r = await runCli(['--help']);
  assert.equal(r.code, EXIT.DONE);
  assert.equal(r.stderr, '');
  const text = r.stdout;
  for (const line of text.split('\n')) assert.ok(line.length <= 80, 'wider than eighty: ' + JSON.stringify(line));
  const flat = text.replace(/\s+/g, ' ');
  const must = [
    PURPOSE,
    'Usage',
    'solebidder <name> [--fy <year>] [--set <set>] [--uei <UEI>]',
    'solebidder suggest <text>',
    'solebidder claims',
    '--fy <year>', '--set <set>', '--uei <UEI>', '--json', '--csv', '--plain', '--no-color',
    '--out <path>', '--force', '-h, --help', '--version',
    'https://api.usaspending.gov and nothing else',
    'at most 60 distinct requests',
    'tried up to 4 times in all, so at most 240 requests are sent',
    'Every command except --help and --version also takes',
    'NO_COLOR set to any non-empty value does the same',
    'stops after 2 requests',
    privacyLine('0.1.0').slice(0, 60),
    ATTRIBUTION,
    INDEPENDENCE,
    ADVICE_DISCLAIMER,
    'MIT licence',
    'https://github.com/0xelitesystem/solebidder',
    'Exit codes',
    'NODE_TLS_REJECT_UNAUTHORIZED',
    'FY2008 to FY2026',
  ];
  for (const m of must) assert.ok(flat.includes(m.replace(/\s+/g, ' ')), 'help is missing: ' + m);
  for (const code of ['0', '1', '2', '3', '130']) {
    assert.match(text, new RegExp('^  ' + code + ' +[A-Z]', 'm'), 'exit code ' + code);
  }
  assert.ok(!text.includes('\u001b'), 'no styling when the output is not a terminal');
});

test('--help at forty columns wraps every line except a single word too long to break', async () => {
  const r = await runCli(['--help'], { env: { COLUMNS: '40' } });
  for (const line of r.stdout.split('\n')) {
    if (line.length > 40) assert.ok(!/\S\s+\S/.test(line.trim()), 'a breakable line is wider than forty: ' + JSON.stringify(line));
  }
  assert.ok(r.stdout.includes('4 MiB'), 'a limit and its unit are never parted');
});

test('the version, and the offline commands, contact nothing', async () => {
  const v = await runCli(['--version']);
  assert.match(v.stdout, /^solebidder [0-9]+\.[0-9]+\.[0-9]+\n$/);
  for (const argv of [['--help'], ['--version'], ['claims'], ['suggest', 'lockheed'], ['claims', '--json'], ['suggest', 'lockheed', '--csv']]) {
    const r = await runCli(argv);
    assert.equal(r.code, EXIT.DONE, JSON.stringify(argv));
    assert.equal(r.transport.calls.length, 0, JSON.stringify(argv));
  }
});
