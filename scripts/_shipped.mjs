// Which files count as SHIPPED COPY, and which are deliberately exempt. Shared by every gate.
//
// The page is assembled from src/ at build time, so a banned phrase written into a module today
// becomes shipped copy tomorrow. Catching it in the module is catching it earlier, which is the
// whole value of a gate.
//
// THERE IS EXACTLY ONE EXEMPT DIRECTORY AND IT IS STRUCTURAL RATHER THAN CONVENIENT:
//
//   scripts/   the gates themselves and their positive control fixtures, which must contain
//              violations in order to prove the violations are detected. Nothing under scripts/
//              is loaded by the page or packed for npm. It is not hidden: GitHub Pages serves
//              the repository root, so these files can be fetched at their paths. They are
//              exempt because they are tooling that has to name what it forbids.
//
// The registry of BANNED terms lives in scripts/banned-vocabulary.mjs precisely so that src/
// needs no exemption for it. Exactly one file under src/ is exempt from one gate, and only from
// that one: src/core/never-claimed.js, the registry of the PERMITTED phrasing. VOCABULARY_EXEMPT
// below states the reason and the vocabulary gate prints it on every run.
//
// There is no per line opt out marker and there will not be one: an opt out a copywriter can
// reach is an opt out that ends up in the copy.

import { readdir, stat, readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Directories scanned for shipped copy, relative to the repo root. */
const SCAN_DIRS = ['src', 'docs'];

/**
 * Individual files scanned.
 *
 * index.html is the SHIPPED PAGE and it lives at the repo ROOT. Several checks in the
 * authoritative runner gate read that exact path, so listing it here is what makes the local
 * gates scan the same file the authoritative gate scans. A failure then arrives at the desk of
 * whoever caused it rather than at ship time.
 *
 * USAGE.md is on this list because it is PROSE THAT SHIPS. It is one of the files the flagship
 * tier of the runner gate permits at the repo root, a reader reaches it from the README, and it
 * describes the same figures the page publishes. A document that explains the claim boundary in
 * its own words is exactly where a banned phrasing gets rewritten back in by somebody trying to
 * be helpful, so it is scanned like every other shipped file rather than trusted.
 */
const SCAN_FILES = ['README.md', 'USAGE.md', 'index.html'];

/**
 * Exempt from the VOCABULARY scan only, with the reason. Printed by that gate on every run so
 * the list cannot grow unnoticed. There is exactly one entry.
 *
 * src/core/never-claimed.js holds the ten permitted statements, and it holds them as source
 * strings broken across several concatenated literals. The gate masks the RUNTIME sentence out
 * of the text before its patterns run, and the runtime sentence does not appear in the source
 * in that form, so the registry of permitted phrasing would fail the rule it exists to define.
 * The file is still scanned by every other gate.
 */
export const VOCABULARY_EXEMPT = Object.freeze([
  Object.freeze({
    file: 'src/core/never-claimed.js',
    reason: 'It is the registry of the permitted phrasing and must contain the terms in order '
      + 'to define them. Its sentences are split across concatenated string literals, so the '
      + 'masking step that protects every other file cannot match them here.',
  }),
]);

const TEXT_EXT = new Set(['.js', '.mjs', '.html', '.css', '.md', '.json', '.svg', '.txt']);

/** @param {string} dir @returns {Promise<string[]>} */
async function walk(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      out.push(...await walk(full));
    } else if (TEXT_EXT.has(path.extname(e.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Every shipped copy file, as {rel, abs, text}.
 * @param {string} [root]
 * @returns {Promise<{rel:string, abs:string, text:string}[]>}
 */
export async function shippedCopy(root = REPO) {
  /** @type {string[]} */
  const files = [];
  for (const d of SCAN_DIRS) files.push(...await walk(path.join(root, d)));
  for (const f of SCAN_FILES) {
    const abs = path.join(root, f);
    try { await stat(abs); files.push(abs); } catch { /* not written yet */ }
  }
  const out = [];
  for (const abs of files.sort()) {
    const rel = path.relative(root, abs).split(path.sep).join('/');
    out.push({ rel, abs, text: await readFile(abs, 'utf8') });
  }
  return out;
}

/**
 * Only the JavaScript under src/, for the gates that reason about code rather than copy.
 * @param {string} [root]
 * @returns {Promise<{rel:string, abs:string, text:string}[]>}
 */
export async function sourceFiles(root = REPO) {
  const files = await walk(path.join(root, 'src'));
  const out = [];
  for (const abs of files.sort()) {
    if (!/\.(js|mjs)$/.test(abs)) continue;
    const rel = path.relative(root, abs).split(path.sep).join('/');
    out.push({ rel, abs, text: await readFile(abs, 'utf8') });
  }
  return out;
}

/**
 * A throwaway repository tree, for the COVERAGE controls.
 *
 * A gate's positive controls prove its patterns catch a violation handed to them as a string.
 * They cannot prove the gate ever READS the file the violation would ship in: a scan set that
 * stopped reaching a directory passes forever, because it finds nothing to fail on. So each gate
 * also plants a violation in a throwaway tree, in exactly the places new shipped code and copy
 * will live (src/cli/ for the command line, USAGE.md for its long form documentation), runs its
 * own real scan over that tree, and fails unless the scan catches it. The tree is written under
 * the operating system's temporary directory, never inside this repository, and removed after.
 *
 * @param {Record<string, string>} files Relative path, forward slashes, to file text.
 * @returns {Promise<{root:string, cleanup:() => Promise<void>}>}
 */
export async function plantTree(files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'solebidder-gate-'));
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, text, 'utf8');
  }
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/**
 * Run a scan over a planted tree and report whether it failed, with its own output silenced, so
 * a control's deliberate failures never read as real ones in the log.
 * @param {(root:string) => Promise<number>} scan A gate scan that returns its failure count.
 * @param {Record<string, string>} files
 * @returns {Promise<number>} The failure count the scan returned over the planted tree.
 */
export async function scanPlanted(scan, files) {
  const { root, cleanup } = await plantTree(files);
  const log = console.log;
  console.log = () => {};
  try {
    return await scan(root);
  } finally {
    console.log = log;
    await cleanup();
  }
}

/**
 * Run a gate's coverage cases: every MUST_FAIL tree must make the scan fail and every MUST_PASS
 * tree must leave it clean. Returns the number of cases that did the wrong thing.
 * @param {string} gate
 * @param {(root:string) => Promise<number>} scan
 * @param {{name:string, files:Record<string,string>}[]} mustFail
 * @param {{name:string, files:Record<string,string>}[]} mustPass
 * @returns {Promise<number>}
 */
export async function coverageCases(gate, scan, mustFail, mustPass) {
  say.head(gate + ' coverage controls');
  let bad = 0;
  for (const c of mustFail) {
    if (await scanPlanted(scan, c.files) > 0) say.pass('covered: ' + c.name);
    else {
      say.fail('NOT covered: ' + c.name + '. The scan never reached the file, so a violation '
        + 'there would ship.');
      bad += 1;
    }
  }
  for (const c of mustPass) {
    const n = await scanPlanted(scan, c.files);
    if (n === 0) say.pass('correctly clean: ' + c.name);
    else { say.fail('FALSE POSITIVE on a clean tree: ' + c.name); bad += 1; }
  }
  return bad;
}

/** Console helpers, so every gate reports in the same shape. */
export const say = {
  /** @param {string} m */
  pass: (m) => console.log('  PASS  ' + m),
  /** @param {string} m */
  fail: (m) => console.log('  FAIL  ' + m),
  /** @param {string} m */
  note: (m) => console.log('  NOTE  ' + m),
  /** @param {string} m */
  head: (m) => console.log('\n== ' + m + ' =='),
};

/**
 * True when this module file is the process entry point.
 *
 * Every gate is both a runnable script and a library of scanner functions the test suite
 * imports. Without this guard, importing a gate in order to unit test its scanner RUNS the gate
 * and calls process.exit, which kills the test runner.
 *
 * @param {string} importMetaUrl
 * @returns {boolean}
 */
export function isMain(importMetaUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(fileURLToPath(importMetaUrl)) === path.resolve(entry);
  } catch {
    return false;
  }
}
