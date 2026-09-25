// THE INSTALLED COMMAND, AS A REAL PROCESS. Only the paths that contact nothing are spawned: the
// help, the version, a usage error, the offline commands and a refused environment. Everything
// that would need the network is driven in process by test/cli-report.test.js instead.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { REPO } from './helpers/fake-client.js';

const BIN = path.join(REPO, 'src', 'cli', 'bin.js');

/** A child environment with nothing from this one that could change the output. */
function cleanEnv(extra = {}) {
  const env = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...extra };
  return env;
}

/** @param {string[]} args @param {Record<string,string>} [extra] */
function runBin(args, extra) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: cleanEnv(extra), timeout: 30000 });
}

test('--version prints the package version and exits zero', async () => {
  const pkg = JSON.parse(await readFile(path.join(REPO, 'package.json'), 'utf8'));
  const r = runBin(['--version']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'solebidder ' + pkg.version + '\n');
  assert.equal(r.stderr, '');
});

test('--help exits zero, fits eighty columns, and carries no escape code on a pipe', () => {
  const r = runBin(['--help']);
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes('Exit codes'));
  assert.ok(r.stdout.split('\n').every((l) => l.length <= 80));
  assert.ok(!r.stdout.includes('\u001b'));
});

test('a usage error exits two with its sentence on standard error and nothing on standard output', () => {
  const r = runBin(['lockheed', '--fy', '2007']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /--fy takes a whole fiscal year/);
});

test('the offline commands exit zero', () => {
  assert.equal(runBin(['claims']).status, 0);
  const s = runBin(['suggest', 'lockheed', '--json']);
  assert.equal(s.status, 0);
  const doc = JSON.parse(s.stdout);
  assert.equal(doc.schema, 'solebidder.cli/1');
  assert.ok(doc.suggestions.length > 0);
  assert.ok(doc.suggestions.every((x) => /^[A-Z0-9]{12}$/.test(x.uei) && !('amount' in x)));
});

test('certificate checks switched off: the report refuses to run and exits one', () => {
  const r = runBin(['lockheed', 'martin'], { NODE_TLS_REJECT_UNAUTHORIZED: '0' });
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /certificate checks off/);
});

test('NO_COLOR and a pipe: no escape code, even with FORCE_COLOR asking for one', () => {
  const r = runBin(['claims'], { NO_COLOR: '1', FORCE_COLOR: '1' });
  assert.ok(!r.stdout.includes('\u001b'));
  const forced = runBin(['claims'], { FORCE_COLOR: '1' });
  assert.ok(forced.stdout.includes('\u001b[1m'), 'FORCE_COLOR styles a pipe when NO_COLOR is not set');
});

test('EPIPE: a reader that closes the pipe at once ends the command quietly, exit zero, no stack trace', async () => {
  const child = spawn(process.execPath, [BIN, 'claims'], { env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.destroy();
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0);
  assert.ok(!/Error|EPIPE|at /.test(stderr), stderr);
});
