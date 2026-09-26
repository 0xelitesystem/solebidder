// THE PACKAGE, AS npm WILL SHIP IT.
//
// The "files" whitelist in package.json is not a guess about what the command line needs. This
// test walks the static import graph from the installed command, src/cli/bin.js, adds the files
// the command reads by path at run time, and fails unless the whitelist packs exactly that set. A
// module the command imports that the tarball leaves out is a command that crashes on install; a
// module it packs that nothing imports is weight every reader downloads for nothing, and the
// page's own controller, panels and charts are exactly that. The page is served from the
// repository, so it never needed to be in the package.
//
// It also holds the release scripts to what they promise. prepublishOnly runs on a release runner
// with no browser, so it runs verify:ci: the tests, every gate that reads files, and the build
// check. The full verify, with the paint gate that opens a browser, is unchanged, and a gate added
// to scripts/gates.mjs later that needs no browser fails this test until verify:ci runs it too.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';

import { REPO } from './helpers/fake-client.js';

const BIN = 'src/cli/bin.js';
const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8'));

/** @param {string} file Repository relative, forward slashes. @returns {string} */
const source = (file) => readFileSync(path.join(REPO, ...file.split('/')), 'utf8');

/** Source text with comments removed, so a type annotation that names a module is not an import. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

/**
 * Every static import and re-export specifier in one module.
 * @param {string} text
 * @returns {string[]}
 */
function specifiers(text) {
  const out = [];
  const re = /^\s*(?:import|export)\s[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|^\s*import\s*['"]([^'"]+)['"]/gm;
  const body = code(text);
  let m;
  while ((m = re.exec(body)) !== null) out.push(m[1] === undefined ? m[2] : m[1]);
  return out;
}

/**
 * The modules the command loads, walked from its entry point.
 * @returns {{modules:Set<string>, bare:Set<string>}}
 */
function importGraph() {
  const modules = new Set();
  const bare = new Set();
  const walk = (file) => {
    if (modules.has(file)) return;
    modules.add(file);
    for (const spec of specifiers(source(file))) {
      if (spec.startsWith('.')) walk(path.posix.normalize(path.posix.join(path.posix.dirname(file), spec)));
      else bare.add(spec);
    }
  };
  walk(BIN);
  return { modules, bare };
}

/**
 * The files the command reads by path from its own package at run time: every
 * path.join(PACKAGE_ROOT, ...) with literal segments.
 * @param {Iterable<string>} modules
 * @returns {Set<string>}
 */
function runtimeReads(modules) {
  const out = new Set();
  for (const file of modules) {
    const re = /path\.join\(\s*PACKAGE_ROOT\s*,([^)]*)\)/g;
    const body = code(source(file));
    let m;
    while ((m = re.exec(body)) !== null) {
      const parts = m[1].split(',').map((s) => s.trim());
      assert.ok(parts.every((p) => /^'[^']+'$/.test(p)), 'a run time read by a path that is not literal: ' + m[0]);
      out.add(parts.map((p) => p.slice(1, -1)).join('/'));
    }
  }
  return out;
}

/** What the "files" whitelist packs, expanded the way npm expands it: a directory means all of it. */
function packedFiles() {
  const out = new Set();
  const walk = (file) => {
    const abs = path.join(REPO, ...file.split('/'));
    if (statSync(abs).isDirectory()) {
      for (const name of readdirSync(abs)) walk(file + '/' + name);
    } else {
      out.add(file);
    }
  };
  for (const entry of pkg.files) {
    assert.ok(existsSync(path.join(REPO, ...entry.split('/'))), 'the whitelist names a path that does not exist: ' + entry);
    walk(entry);
  }
  return out;
}

test('the command is on the path as solebidder, and its entry point runs as a script on any platform', () => {
  assert.deepEqual(pkg.bin, { solebidder: BIN });
  const text = source(BIN);
  assert.equal(text.split('\n')[0], '#!/usr/bin/env node');
  assert.ok(!text.includes('\r'), 'a carriage return after the shebang breaks the script on Linux and macOS');
  assert.match(pkg.version, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.equal(pkg.engines.node, '>=22');
});

test('THE WHITELIST PACKS EXACTLY WHAT THE COMMAND IMPORTS AND READS, and nothing else', () => {
  const { modules } = importGraph();
  const reads = runtimeReads(modules);
  // npm always packs package.json; the command reads it for --version and the User-Agent.
  assert.deepEqual([...reads].sort(), ['package.json', 'src/data/typeahead-index.json']);

  const needed = new Set([...modules, ...[...reads].filter((f) => f !== 'package.json')]);
  const packed = packedFiles();
  const packedSrc = new Set([...packed].filter((f) => f.startsWith('src/')));
  const missing = [...needed].filter((f) => !packedSrc.has(f)).sort();
  const extra = [...packedSrc].filter((f) => !needed.has(f)).sort();
  assert.deepEqual(missing, [], 'the command needs these and the tarball would leave them out');
  assert.deepEqual(extra, [], 'the tarball would carry these and nothing in the command loads them');

  assert.ok(packed.has('LICENSE'));
  for (const f of packed) {
    assert.ok(f === 'LICENSE' || f.startsWith('src/'), 'outside src/ and the licence: ' + f);
    assert.ok(!/^(test|scripts|docs)\//.test(f) && f !== 'index.html', 'a file that must never ship: ' + f);
  }
  assert.equal(new Set(pkg.files).size, pkg.files.length, 'a whitelist entry is listed twice');
});

test('the command imports nothing but its own files and Node itself: no dependency, no dynamic import', () => {
  const { modules, bare } = importGraph();
  for (const spec of bare) assert.match(spec, /^node:/, 'an import from outside the package and Node: ' + spec);
  for (const file of modules) {
    assert.doesNotMatch(code(source(file)), /\bimport\s*\(/, file + ' loads a module the static walk cannot see');
    assert.doesNotMatch(code(source(file)), /\brequire\s*\(/, file + ' loads a module the static walk cannot see');
  }
  assert.deepEqual(pkg.dependencies, {});
  assert.deepEqual(pkg.devDependencies, {});
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
    assert.equal(pkg.scripts[hook], undefined, 'an install time script: ' + hook);
  }
});

test('prepublishOnly runs every gate that needs no browser, and the full verify is unchanged', () => {
  assert.equal(pkg.scripts.prepublishOnly, 'npm run verify:ci');
  assert.equal(pkg.scripts.verify, 'npm test && npm run gates && npm run build:check');

  const steps = pkg.scripts['verify:ci'].split('&&').map((s) => s.trim());
  assert.equal(steps[0], 'npm test');
  assert.equal(steps[steps.length - 1], 'npm run build:check');

  // The gates scripts/gates.mjs runs, read from its own list.
  const gates = [...source('scripts/gates.mjs').matchAll(/\{\s*id:\s*'([a-z]+)',\s*file:\s*'([a-z-]+\.mjs)'/g)]
    .map((m) => ({ id: m[1], file: m[2] }));
  assert.ok(gates.length >= 5, 'could not read the gate list');
  const browserOnly = ['fcp'];
  const ci = steps.slice(1, -1);
  const expected = gates.filter((g) => !browserOnly.includes(g.id)).map((g) => 'npm run gate:' + g.id);
  assert.deepEqual(ci, expected, 'verify:ci must run every gate but the paint gate, in the same order');
  for (const g of gates) {
    assert.equal(pkg.scripts['gate:' + g.id], 'node scripts/' + g.file, 'gate:' + g.id + ' runs a different file');
  }
  for (const step of steps) {
    assert.doesNotMatch(step, /fcp|measure|npm run gates\b/, 'a step on the publish path needs a browser: ' + step);
  }
});
