// THE ARGUMENTS. A forgiving parser is how a mistyped option becomes a silently different
// question, so every way to get the command line wrong is a usage error with a sentence naming
// it, exit code two, and no request made. These tests hold the parser to that, and hold --fy to
// the one window the page uses: nothing before FY2008 and nothing after the current fiscal year.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, cleanText, EXIT, proxyInUse } from '../src/cli/main.js';
import { USAGE } from '../src/cli/copy.js';
import { runCli, NOW } from './helpers/cli-harness.js';

/** A character from its code point. Nothing above the ASCII range is written raw in this file. */
const u = (...points) => String.fromCodePoint(...points);

/** @param {string[]} argv @param {Date} [now] */
const parse = (argv, now = NOW) => parseArgs(argv, { now });

/** @param {string[]} argv @returns {string} */
function refusal(argv) {
  const r = parse(argv);
  assert.equal(r.ok, false, JSON.stringify(argv) + ' should be a usage error');
  return /** @type {any} */ (r).message;
}

test('a name with no options is the report on the default fiscal year and award type set', () => {
  const r = /** @type {any} */ (parse(['lockheed', 'martin']));
  assert.equal(r.ok, true);
  assert.equal(r.command, 'report');
  assert.equal(r.text, 'lockheed martin');
  assert.equal(r.fiscalYear, 2025, 'on 2026-09-24 the most recently completed fiscal year is FY2025');
  assert.equal(r.fyChosen, 'default');
  assert.equal(r.latestFiscalYear, 2026);
  assert.equal(r.awardTypeSetId, 'contracts');
  assert.equal(r.uei, null);
  assert.equal(r.format, 'text');
  assert.equal(r.noColor, false);
  assert.equal(r.out, null);
});

test('the fiscal year window moves on the first of October, not the first of January', () => {
  const october = /** @type {any} */ (parse(['x'], new Date(Date.UTC(2026, 9, 1))));
  assert.equal(october.latestFiscalYear, 2027);
  assert.equal(october.fiscalYear, 2026);
  const january = /** @type {any} */ (parse(['x', '--fy', '2027'], new Date(Date.UTC(2026, 0, 15))));
  assert.equal(january.ok, false, 'FY2027 has not started in January 2026');
});

test('--fy accepts four digits from FY2008 to the current fiscal year and nothing else', () => {
  for (const good of ['2008', '2016', '2025', '2026']) {
    const r = /** @type {any} */ (parse(['x', '--fy', good]));
    assert.equal(r.ok, true, good);
    assert.equal(r.fiscalYear, Number(good));
    assert.equal(r.fyChosen, 'flag');
  }
  assert.equal(/** @type {any} */ (parse(['x', '--fy=2019'])).fiscalYear, 2019);
  for (const bad of ['2007', '2027', '1999', 'latest', '2025.0', '+2025', '02025', '25', ' 2025', 'FY2025', '2e3']) {
    const message = refusal(['x', '--fy', bad]);
    assert.equal(message, USAGE.fiscalYear(bad, 2008, 2026), bad);
  }
});

test('--set takes one of the three award type sets by its exact id', () => {
  for (const id of ['contracts', 'contractsAndIdvs', 'all']) {
    assert.equal(/** @type {any} */ (parse(['x', '--set', id])).awardTypeSetId, id);
  }
  for (const bad of ['Contracts', 'idvs', '__proto__', 'toString', 'constructor', 'hasOwnProperty']) {
    assert.equal(refusal(['x', '--set', bad]), USAGE.set(bad), bad);
  }
});

test('--uei takes twelve letters and digits, upper cased, and nothing else', () => {
  assert.equal(/** @type {any} */ (parse(['x', '--uei', 'ZFN2JJXBLZT3'])).uei, 'ZFN2JJXBLZT3');
  assert.equal(/** @type {any} */ (parse(['x', '--uei', 'zfn2jjxblzt3'])).uei, 'ZFN2JJXBLZT3');
  for (const bad of ['ZFN2JJXBLZT', 'ZFN2JJXBLZT33', 'ZFN2JJ-BLZT3', 'ZFN2JJXBLZT\u0000', '008016958']) {
    assert.equal(refusal(['x', '--uei', bad]), USAGE.uei(bad), JSON.stringify(bad));
  }
});

test('an unknown option, a repeated option, a missing value and a value on a flag are each refused', () => {
  assert.equal(refusal(['x', '--year', '2025']), USAGE.unknown('--year'));
  assert.equal(refusal(['x', '-j']), USAGE.unknown('-j'));
  assert.equal(refusal(['x', '-']), USAGE.unknown('-'));
  assert.equal(refusal(['x', '--JSON']), USAGE.unknown('--JSON'));
  assert.equal(refusal(['x', '--json', '--json']), USAGE.twice('--json'));
  assert.equal(refusal(['x', '--fy', '2020', '--fy=2021']), USAGE.twice('--fy'));
  assert.equal(refusal(['x', '--fy']), USAGE.missingValue('--fy'));
  assert.equal(refusal(['x', '--out=']), USAGE.missingValue('--out'));
  assert.equal(refusal(['x', '--fy', '--json']), USAGE.noOptionValue('--fy'));
  assert.equal(refusal(['x', '--json=yes']), USAGE.noValue('--json'));
});

test('output modes that cannot go together are refused, and --force needs --out', () => {
  assert.equal(refusal(['x', '--json', '--csv']), USAGE.conflict('--json', '--csv'));
  assert.equal(refusal(['x', '--plain', '--json']), USAGE.conflict('--plain', '--json'));
  assert.equal(refusal(['x', '--csv', '--plain']), USAGE.conflict('--plain', '--csv'));
  assert.equal(refusal(['x', '--force']), USAGE.forceNeedsOut);
  const r = /** @type {any} */ (parse(['x', '--out', 'r.txt', '--force']));
  assert.equal(r.out, 'r.txt');
  assert.equal(r.force, true);
});

test('the machine and plain formats switch styling off', () => {
  for (const flag of ['--json', '--csv', '--plain', '--no-color']) {
    assert.equal(/** @type {any} */ (parse(['x', flag])).noColor, true, flag);
  }
});

test('suggest and claims are commands only as the first word before --, and take no report options', () => {
  const s = /** @type {any} */ (parse(['suggest', 'lockheed', 'mar']));
  assert.equal(s.command, 'suggest');
  assert.equal(s.text, 'lockheed mar');
  assert.equal(/** @type {any} */ (parse(['claims'])).command, 'claims');
  assert.equal(/** @type {any} */ (parse(['claims', '--json'])).format, 'json');
  assert.equal(refusal(['claims', 'extra']), USAGE.claimsTakesNothing);
  assert.equal(refusal(['suggest']), USAGE.suggestMissing);
  assert.equal(refusal(['suggest', 'l']), USAGE.suggestTooShort);
  for (const opt of ['--fy', '--set', '--uei']) {
    const value = opt === '--fy' ? '2025' : (opt === '--set' ? 'all' : 'ZFN2JJXBLZT3');
    assert.equal(refusal(['claims', opt, value]), USAGE.notFor(opt, 'claims'));
    assert.equal(refusal(['suggest', 'lockheed', opt, value]), USAGE.notFor(opt, 'suggest'));
  }
  // A company that happens to be called Claims is still reachable.
  const literal = /** @type {any} */ (parse(['--', 'claims']));
  assert.equal(literal.command, 'report');
  assert.equal(literal.text, 'claims');
  const dashed = /** @type {any} */ (parse(['--', '--json']));
  assert.equal(dashed.text, '--json');
  assert.equal(dashed.format, 'text');
});

test('no name, an empty name and an overlong name are refused', () => {
  assert.equal(refusal([]), USAGE.noCommand);
  assert.equal(refusal(['--json']), USAGE.noCommand);
  assert.equal(refusal(['   ']), USAGE.nameMissing);
  assert.equal(refusal(['\u001b[2J']), USAGE.nameMissing);
  assert.equal(refusal(['x'.repeat(201)]), USAGE.nameTooLong);
  assert.equal(/** @type {any} */ (parse(['x'.repeat(200)])).ok, true);
});

test('a name is made into one printable line before it is sent or echoed', () => {
  assert.equal(cleanText('  lockheed\t\u001b[31mmartin' + u(0x202e) + ' ' + u(0x200b) + ' '), 'lockheed martin');
  const accented = 'SOCI' + u(0xc9) + 'T' + u(0xc9) + ' G' + u(0xc9) + 'N' + u(0xc9) + 'RALE';
  assert.equal(cleanText(accented), accented);
});

test('help and the version answer whatever else is on the line', () => {
  assert.equal(/** @type {any} */ (parse(['--bogus', '--help'])).command, 'help');
  assert.equal(/** @type {any} */ (parse(['-h'])).command, 'help');
  assert.equal(/** @type {any} */ (parse(['x', '--version', '--fy', '1900'])).command, 'version');
  assert.equal(/** @type {any} */ (parse(['--', '--help'])).command, 'report');
});

test('a usage error prints its sentence and the hint on standard error, exits two, and contacts nothing', async () => {
  for (const argv of [['x', '--fy', '2007'], ['x', '--bogus'], [], ['x', '--json', '--csv']]) {
    const r = await runCli(argv);
    assert.equal(r.code, EXIT.USAGE, JSON.stringify(argv));
    assert.equal(r.stdout, '');
    assert.ok(r.stderr.includes(USAGE.hint.slice(0, 20)), r.stderr);
    assert.equal(r.transport.calls.length, 0);
  }
});

test('a proxy is named whenever Node would send the report through one, the HTTP proxy included', () => {
  // Node's fetch reads the lower case name first, and sends an HTTPS request through the HTTP
  // proxy when no HTTPS proxy is set. The notice follows the same order, or a report goes through
  // a proxy without saying so.
  const proxy = 'http://proxy.invalid:8080';
  const on = { NODE_USE_ENV_PROXY: '1' };
  for (const env of [
    { ...on, HTTPS_PROXY: proxy },
    { ...on, https_proxy: proxy },
    { ...on, HTTP_PROXY: proxy },
    { ...on, http_proxy: proxy },
    { ...on, HTTPS_PROXY: ' ', HTTP_PROXY: proxy },
    { ...on, HTTP_PROXY: proxy, NO_PROXY: 'localhost' },
    { ...on, HTTP_PROXY: proxy, no_proxy: '', NO_PROXY: 'api.usaspending.gov' },
    { NODE_OPTIONS: '--use-env-proxy', http_proxy: proxy },
  ]) assert.equal(proxyInUse(env), true, JSON.stringify(env));
  for (const env of [
    { HTTP_PROXY: proxy },
    { NODE_USE_ENV_PROXY: 'true', HTTP_PROXY: proxy },
    { ...on },
    { ...on, HTTP_PROXY: '' },
    { ...on, https_proxy: '', HTTPS_PROXY: proxy },
    { ...on, HTTP_PROXY: proxy, NO_PROXY: 'api.usaspending.gov' },
    { ...on, HTTP_PROXY: proxy, no_proxy: '.usaspending.gov', NO_PROXY: '' },
    { ...on, http_proxy: proxy, no_proxy: '*' },
  ]) assert.equal(proxyInUse(env), false, JSON.stringify(env));
});
