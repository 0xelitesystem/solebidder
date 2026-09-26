// WHAT THE DOCUMENTATION SAYS ABOUT THE COMMAND LINE, HELD TO THE CODE.
//
// The README ships in the npm package, so every limit, count and sentence it states about the
// command line is a claim a reader can act on. None of them is typed here as a fact: each is
// computed from the constant, table or function that sets it, and the test fails when the prose
// and the code part. The request plan comes from requestPlan(), the exit codes from EXIT, the
// User-Agent from userAgent(), the legal lines from the one copy each has, the CSV column names
// from CSV_HEADER, the environment variables from a scan of the source, and every command shown
// in a code block is run through the real argument parser.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { REPO } from './helpers/fake-client.js';
import { runCli, NOW, PARENT_UEI, healthyRoutes, scripted, recorded } from './helpers/cli-harness.js';
import { EXIT, parseArgs } from '../src/cli/main.js';
import {
  requestPlan, helpBlocks, privacyLine, ATTRIBUTION, INDEPENDENCE, SCHEMA,
} from '../src/cli/copy.js';
import { userAgent } from '../src/cli/fetch.js';
import { csvCell } from '../src/cli/csv.js';
import { CSV_HEADER } from '../src/cli/render.js';
import { DEFAULT_WIDTH } from '../src/cli/out.js';
import {
  ADVICE_DISCLAIMER, COLD_SOURCE_NOTICE_MS, FISCAL_YEAR_FLOOR, MAX_CONCURRENCY,
} from '../src/core/constants.js';
import { SPINE_YEARS } from '../src/api/dimensions.js';
import { NEVER_CLAIMED_COUNT } from '../src/core/never-claimed.js';
import { fiscalYearOf } from '../src/query/fiscal-year.js';
import { DEFAULT_POLICY } from '../src/query/retry.js';

const read = (file) => readFileSync(path.join(REPO, file), 'utf8');
const pkg = JSON.parse(read('package.json'));

/** Whitespace made single spaces and code marks removed, so wrapped prose compares as written. */
const flat = (text) => text.replace(/`/g, '').replace(/\s+/g, ' ');

/**
 * One section of a markdown file: from its heading to the next heading at the same level.
 * @param {string} text @param {string} heading e.g. '## Command line'
 * @returns {string}
 */
function section(text, heading) {
  const level = heading.split(' ')[0];
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l === heading);
  assert.ok(start !== -1, 'missing heading ' + heading);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    const m = /^(#+) /.exec(lines[i]);
    if (m && m[1].length <= level.length) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

/** Spelled numbers the prose uses, so a figure written as a word is still checked. */
const WORDS = Object.freeze({ 3: 'three', 4: 'four', 10: 'ten', 80: 'eighty' });

const README = read('README.md');
const CLI = section(README, '## Command line');
const USAGE_MD = read('USAGE.md');
const USAGE_CLI = section(USAGE_MD, '## Command line');

test('the README request plan is the one requestPlan() computes from the constants', () => {
  const plan = requestPlan();
  const s = flat(CLI);
  const must = [
    'A report makes at most ' + plan.report + ' requests',
    'the ' + plan.details + ' largest contracts and one competition record for each',
    plan.dimensions + ' category breakdowns',
    'up to ' + plan.pages + ' pages each of the entity breakdown and the name match',
    'stops after ' + plan.refusal + ' requests',
    'tried up to ' + plan.attempts + ' times in all',
    'an answer over ' + plan.capMiB + ' MiB is refused',
    'fetched at most ' + MAX_CONCURRENCY + ' at a time',
    'one line after ' + (COLD_SOURCE_NOTICE_MS / 1000) + ' seconds says so',
    'from FY' + FISCAL_YEAR_FLOOR + ' to the current one',
    'obligations by fiscal year for ' + WORDS[SPINE_YEARS] + ' years',
    'all ' + WORDS[NEVER_CLAIMED_COUNT] + ' statements of what this tool never claims',
    'Lines wrap at COLUMNS, ' + WORDS[DEFAULT_WIDTH] + ' when nothing says otherwise',
    'It needs Node ' + pkg.engines.node.replace('>=', '') + ' or later',
  ];
  for (const m of must) assert.ok(s.includes(m), 'the README command line section does not say: ' + m);
});

test('the README exit code table is exactly EXIT, and each meaning is the one --help prints', () => {
  const rows = [...CLI.matchAll(/^\| `([0-9]+)` \| (.+) \|$/gm)].map((m) => ({ code: Number(m[1]), text: m[2] }));
  assert.deepEqual(rows.map((r) => r.code).sort((a, b) => a - b), Object.values(EXIT).sort((a, b) => a - b));
  const help = helpBlocks({ version: pkg.version, now: NOW });
  for (const r of rows) {
    const def = help.find((b) => b.kind === 'def' && b.term === String(r.code));
    assert.ok(def, 'no --help entry for exit code ' + r.code);
    const first = def.desc.map((d) => d.text).join('').split(/(?<=\.) /)[0];
    assert.ok(flat(r.text).includes(first.replace(/\.$/, '')), 'exit ' + r.code + ' says something else in --help: ' + first);
  }
});

test('the README options and commands are exactly the ones --help documents and the parser takes', () => {
  const help = helpBlocks({ version: pkg.version, now: NOW });
  const helpOptions = help.filter((b) => b.kind === 'def' && b.term.startsWith('-'))
    .flatMap((b) => b.term.split(', ').map((t) => t.split(' ')[0]));
  const optionsTable = section(CLI, '### Options');
  const readmeOptions = [...optionsTable.matchAll(/^\| (`-[^|]+) \|/gm)]
    .flatMap((m) => [...m[1].matchAll(/`(-[a-z-]+)/g)].map((x) => x[1]));
  assert.deepEqual([...readmeOptions].sort(), [...helpOptions].sort());
  for (const o of readmeOptions) {
    const r = parseArgs(['x', o, ...(['--fy', '--set', '--uei', '--out'].includes(o) ? ['v'] : [])], { now: NOW });
    const refusal = r.ok ? '' : r.message;
    assert.ok(!/^Unknown option/.test(refusal), 'the parser does not know ' + o);
  }
  const commands = [...section(CLI, '### Commands').matchAll(/^\| `solebidder ([^`]+)` \|/gm)].map((m) => m[1]);
  assert.deepEqual(commands, ['<name>', 'suggest <text>', 'claims', '--help', '--version']);
});

test('the README User-Agent, privacy line, legal lines and schema are the ones the command prints', () => {
  const s = flat(CLI);
  assert.ok(CLI.includes(userAgent('<version>')), 'the User-Agent in the README is not the one sent');
  assert.ok(!/[0-9]+\.[0-9]+\.[0-9]+/.test(userAgent('<version>').replace('<version>', '')));
  assert.ok(s.includes(ATTRIBUTION));
  assert.ok(s.includes(flat(INDEPENDENCE)), 'the command line independence statement, named in this output');
  assert.ok(s.includes(ADVICE_DISCLAIMER));
  assert.ok(s.includes('schema ' + SCHEMA));

  const privacy = flat(section(section(README, '## Privacy'), '### Command line'));
  assert.ok(privacy.includes(flat(privacyLine('<version>'))), 'the README privacy line is not the one --help prints');
  assert.ok(section(README, '## Privacy').includes('### Page'), 'the page privacy statement is still there');
});

test('the README names exactly the environment variables the command line reads', () => {
  /** @type {Set<string>} */
  const used = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
      const rel = dir + '/' + name.name;
      if (name.isDirectory()) walk(rel);
      else if (/\.m?js$/.test(name.name)) {
        for (const m of readFileSync(path.join(REPO, rel), 'utf8').matchAll(/\benv\.([A-Za-z_]+)/g)) {
          used.add(m[1].toUpperCase());
        }
      }
    }
  };
  walk('src');
  const privacy = section(section(README, '## Privacy'), '### Command line');
  const named = new Set([...privacy.matchAll(/`([A-Z][A-Z_]+)`/g)].map((m) => m[1]));
  assert.deepEqual([...named].sort(), [...used].sort());
});

test('the CSV rules in the README are what csvCell and CSV_HEADER do', () => {
  const s = flat(CLI);
  for (const column of ['Dollars obligated in the fiscal year',
    'Lifetime award value in dollars, exercised options included',
    'Share of the stated denominator, as a decimal fraction', 'Count of records', 'Why there is no figure']) {
    assert.ok(CSV_HEADER.includes(column), 'not a column: ' + column);
    assert.ok(s.includes(column), 'the README does not name the column: ' + column);
  }
  for (const lead of ['=', '+', '-', '@', '\t', '\r', '  =', ' -1']) {
    assert.ok(csvCell(lead + 'x').startsWith('"\''), 'a formula lead the README promises to neutralise: ' + JSON.stringify(lead));
  }
  assert.equal(csvCell(-12.5), '"-12.5"', 'a value column the tool wrote stays a number');
});

test('the award count the README says is left out: the recorded answer really drops the recipient filter', () => {
  assert.ok(CLI.includes('test/fixtures/api/award-count-fy2025.json'));
  const answer = JSON.stringify(recorded('award-count-fy2025.json'));
  assert.match(answer, /were not used/);
  assert.match(answer, /recipient_id/);
});

test('the README JSON field names are the ones a real report and a real failure carry', async () => {
  const ok = await runCli(['lockheed', 'martin', '--uei', PARENT_UEI, '--fy', '2025', '--json']);
  const doc = JSON.parse(ok.stdout);
  for (const key of ['schema', 'neverClaimed', 'attribution', 'independence', 'disclaimer', 'privacy', 'exitCode']) {
    assert.ok(key in doc, 'no top level ' + key);
    assert.ok(CLI.includes('`' + key + '`') || key === 'schema', 'the README does not name ' + key);
  }
  const figures = doc.sections.flatMap((s) => s.items).filter((i) => i.type === 'figure');
  assert.ok(figures.length > 0);
  for (const key of ['badge', 'value', 'unit', 'method', 'text', 'provenance', 'fiscalYear', 'awardTypeSetId', 'sourceAsOf']) {
    assert.ok(figures.every((f) => key in f), 'a figure without ' + key);
  }
  for (const key of ['badge', 'value', 'unit', 'method', 'text', 'provenance']) assert.ok(CLI.includes('`' + key + '`'), key);

  const routes = healthyRoutes();
  routes['POST /api/v2/search/spending_over_time/'] = scripted({ status: 400 });
  const failed = await runCli(['lockheed', 'martin', '--uei', PARENT_UEI, '--fy', '2025', '--json'], { routes });
  assert.equal(failed.code, EXIT.FAILURE);
  const failures = JSON.parse(failed.stdout).sections.flatMap((s) => s.items).filter((i) => i.type === 'failure');
  assert.ok(failures.length > 0);
  for (const f of failures) assert.ok(typeof f.kind === 'string' && typeof f.reason === 'string' && !('value' in f));
  assert.ok(CLI.includes('failure `kind`') && CLI.includes('the `reason`'));
});

/**
 * Every command line shown in a fenced block of a markdown file, as argument lists.
 * @param {string} text
 * @returns {string[][]}
 */
function commandsIn(text) {
  const out = [];
  for (const block of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
    for (const raw of block[1].split('\n')) {
      const line = raw.trim().split(/\s[|>]\s/)[0];
      const words = [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => (m[1] === undefined ? m[2] : m[1]));
      while (words.length > 0 && /^[A-Z_]+=/.test(words[0])) words.shift();
      const at = words[0] === 'npx' ? 1 : 0;
      if (words[at] !== 'solebidder') continue;
      // A placeholder stands for a value of its kind; the name placeholders are already words.
      out.push(words.slice(at + 1).map((w) => (w === '<UEI>' ? PARENT_UEI : w)));
    }
  }
  return out;
}

test('the USAGE command line chapter states the limits the code sets', () => {
  const s = flat(USAGE_CLI);
  const plan = requestPlan();
  const must = [
    'One report makes at most ' + plan.report + ' requests',
    'after ' + WORDS[COLD_SOURCE_NOTICE_MS / 1000] + ' seconds one line on standard error says the source is cold',
    'prints the ' + WORDS[NEVER_CLAIMED_COUNT] + ' statements of what this tool never claims',
    'It needs Node ' + pkg.engines.node.replace('>=', '') + ' or later',
    'exits with code ' + EXIT.CHOICE_REQUIRED,
    'starts on the first of October, counted in UTC',
  ];
  for (const m of must) assert.ok(s.includes(m), 'the USAGE command line chapter does not say: ' + m);
  assert.equal(fiscalYearOf(new Date(Date.UTC(2026, 9, 1, 0, 0, 0))), 2027);
  assert.equal(fiscalYearOf(new Date(Date.UTC(2026, 8, 30, 23, 59, 59))), 2026);
  // The page's own troubleshooting names the retry ceiling too.
  assert.ok(flat(USAGE_MD).includes('tried the request ' + WORDS[DEFAULT_POLICY.maxAttempts] + ' times in all'));
  for (const column of ['Section', 'Figure id', 'Fiscal year', 'Why there is no figure',
    'Dollars obligated in the fiscal year', 'Lifetime award value in dollars, exercised options included',
    'Share of the stated denominator, as a decimal fraction', 'Count of records']) {
    assert.ok(CSV_HEADER.includes(column), 'not a column: ' + column);
    assert.ok(s.includes(column), 'the chapter does not name the column: ' + column);
  }
});

test('every figure id and section the USAGE chapter names is one a real report prints', async () => {
  const r = await runCli(['lockheed', 'martin', '--uei', PARENT_UEI, '--fy', '2025', '--json']);
  const doc = JSON.parse(r.stdout);
  const sections = new Map(doc.sections.map((sec) => [sec.id, sec]));
  const ids = [...USAGE_CLI.matchAll(/`([a-z_]+\.[a-zA-Z]+)`/g)].map((m) => m[1]);
  assert.ok(ids.length >= 3, 'found too few figure ids to be reading the chapter');
  for (const id of ids) {
    const figure = doc.sections.flatMap((sec) => sec.items).find((i) => i.id === id);
    assert.ok(figure, 'no figure with id ' + id);
    assert.equal(typeof figure.denominatorText, 'string', id + ' carries no denominator sentence');
  }
  for (const m of USAGE_CLI.matchAll(/In the `([a-z]+)` section/g)) assert.ok(sections.has(m[1]), 'no section ' + m[1]);
});

test('every command shown in the README and USAGE is one the parser accepts', () => {
  const lines = [...commandsIn(README), ...commandsIn(USAGE_MD)];
  assert.ok(lines.length >= 12, 'found too few example commands to be reading the right blocks');
  for (const argv of lines) {
    const r = parseArgs(argv, { now: NOW });
    assert.ok(r.ok, 'the parser refuses a documented command: solebidder ' + argv.join(' ') + ' -> ' + (r.ok ? '' : r.message));
  }
});
