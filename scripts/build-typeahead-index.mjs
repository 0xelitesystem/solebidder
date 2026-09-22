#!/usr/bin/env node
// THE TYPEAHEAD INDEX GENERATOR. DESIGN 3.2.
//
//   node scripts/build-typeahead-index.mjs            regenerate src/data/typeahead-index.json
//   node scripts/build-typeahead-index.mjs --check    regenerate to a temp file and compare
//   node scripts/build-typeahead-index.mjs --pages 10 --rows 1000 --years 3
//
// AMOUNTS ARE STRIPPED HERE, AT BUILD TIME, AND THE STRIPPING IS THE PRODUCT OF THIS SCRIPT.
// The figures are read once, used to rank which rows are worth keeping, and then discarded
// before anything is written. src/api/typeahead-index.js does the discarding and this script
// asserts it again on the way out, so a bundled dollar figure cannot ship even if somebody
// changes the shape of an entry: assertStripped refuses an entry that is not exactly two
// strings, and the write is refused with it.
//
// WHY STRIPPED AT ALL. A bundled figure is a staleness claim. It would need a badge, an as of
// date and a defence of why it is still worth showing a week later. With no figure in the file,
// that entire question cannot arise, and the bundle becomes what it should be: a fast way to
// find a NAME, with every number on the page still fetched live.
//
// THIS SCRIPT IS NEVER SERVED. It runs in Node, where the browser network allowlist does not
// apply, and the flagship host check skips scripts/ for exactly that reason. It builds its own
// request body rather than importing the browser request builder, because the builder correctly
// refuses a query with no recipient filter and this query deliberately has none: it is asking
// the source who the largest recorded recipients are.
//
// UEI ONLY, NEVER THE LEGACY VENDOR NUMBER. Trap 13. The recipient rows this endpoint returns
// carry that identifier in their code field. Two fields are read here, uei and name, and nothing
// else is copied, so it has no path into a file that ships.
//
// THE RANKING WINDOW IS STATED RATHER THAN IMPLIED. Ranking needs a period and the source has no
// unbounded one, so the window is the last few complete fiscal years and it is printed on every
// run. It decides WHICH names are in the file and nothing else, because no figure survives it.

import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMain } from './_shipped.mjs';
import {
  buildTypeaheadIndex, assertStripped, serialiseIndex, parseIndex, DEFAULT_INDEX_ROWS,
} from '../src/api/typeahead-index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT = path.join(REPO, 'src', 'data', 'typeahead-index.json');

/** DESIGN 6.2. The build fails over this, measured on the gzip of the file that would ship. */
const GZIP_CEILING_BYTES = 120 * 1024;

/** The one host, written out here the same way it is written out at the one browser call site. */
const ORIGIN = 'https://api.usaspending.gov';

/** The API answers HTTP 422 above this page size. Trap 6. */
const PAGE_LIMIT = 100;

/**
 * NAMES THAT CANNOT GO IN THE BUNDLE, AND WHY THE ANSWER IS NOT TO WEAKEN A GATE.
 *
 * The generated file lands under src/, so every gate that reads the shipped tree reads it, and
 * the vocabulary gate is looking for words the PAGE may not use as a claim. A federal award
 * recipient is sometimes a state agency whose legal name contains one of those words. On the
 * 2026-09-22 generation exactly one row out of 4,940 did: a state department of revenue.
 *
 * Three ways out and only one of them is honest. Exempting the data file would blunt a
 * compliance gate for the convenience of a cache. Rewriting the government's name for an entity
 * would be worse. What is left costs the visitor nothing: the bundle is a SPEED cache over the
 * head of the distribution, and the live suggestion endpoint already answers for everything
 * outside it, so a name that is not bundled is still fully reachable, still resolvable and still
 * gets every figure on the page.
 *
 * So the generator holds the same bar the gate holds, and it prints every name it leaves out
 * with the pattern that excluded it. A silent filter would be the thing to object to; a counted
 * and printed one is a decision somebody can read and reverse.
 *
 * These patterns are here rather than in src/ for the same reason the gate's own registry lives
 * under scripts/: a file that has to name the forbidden words in order to hold the line cannot
 * also be a file that ships.
 */
export const EXCLUDED_NAME_PATTERNS = Object.freeze([
  Object.freeze({ id: 'revenue-claim', pattern: /\brevenues?\b|\bturnover\b/i }),
  Object.freeze({ id: 'outlays-claim', pattern: /\boutlays?\b|\bdisbursed\b/i }),
  Object.freeze({ id: 'audited-or-consolidated', pattern: /\baudited\b/i }),
  Object.freeze({ id: 'absent-financial-denominators', pattern: /\bbacklog\b|\bearnings\b|\bprofit margins?\b/i }),
  Object.freeze({ id: 'legacy-vendor-identifier', pattern: /\bduns\b|\bdun\s*&\s*bradstreet\b/i }),
  Object.freeze({ id: 'em-and-en-dashes', pattern: /[–—]/ }),
]);

/**
 * Split the rows into the ones that may be bundled and the ones that may not.
 * @param {{uei:string|null, name:string, amount:number}[]} rows
 * @returns {{keep:typeof rows, excluded:{name:string, ruleId:string}[]}}
 */
export function partitionByShippedCopyRules(rows) {
  /** @type {{name:string, ruleId:string}[]} */
  const excluded = [];
  const keep = rows.filter((row) => {
    const hit = EXCLUDED_NAME_PATTERNS.find((rule) => rule.pattern.test(row.name));
    if (hit === undefined) return true;
    excluded.push({ name: row.name, ruleId: hit.id });
    return false;
  });
  return { keep, excluded };
}

/**
 * @param {string[]} argv
 * @returns {{check:boolean, pages:number, rows:number, years:number}}
 */
function parseArgs(argv) {
  const get = (flag, fallback) => {
    const at = argv.indexOf(flag);
    if (at === -1) return fallback;
    const value = Number(argv[at + 1]);
    if (!Number.isInteger(value) || value < 1) {
      throw new RangeError('build-typeahead-index: ' + flag + ' needs a positive integer.');
    }
    return value;
  };
  return {
    check: argv.includes('--check'),
    pages: get('--pages', Math.ceil(DEFAULT_INDEX_ROWS / PAGE_LIMIT)),
    rows: get('--rows', DEFAULT_INDEX_ROWS),
    years: get('--years', 3),
  };
}

/**
 * The ranking window, as complete federal fiscal years ending with the last one that has ended.
 * @param {number} years
 * @returns {{start_date:string, end_date:string}}
 */
function rankingWindow(years) {
  const now = new Date();
  // A federal fiscal year ends on 30 September. Before October, the last complete one is the
  // year before the current calendar year.
  const lastComplete = now.getUTCMonth() >= 9 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  const first = lastComplete - years + 1;
  return { start_date: (first - 1) + '-10-01', end_date: lastComplete + '-09-30' };
}

/**
 * One page of the government wide recipient breakdown.
 * @param {{start_date:string, end_date:string}} window
 * @param {number} page
 * @returns {Promise<{rows:{uei:string|null, name:string, amount:number}[], hasNext:boolean}>}
 */
async function fetchPage(window, page) {
  const response = await fetch(ORIGIN + '/api/v2/search/spending_by_category/recipient/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      category: 'recipient',
      filters: { time_period: [window], subawards: false },
      limit: PAGE_LIMIT,
      page,
      subawards: false,
    }),
  });
  if (!response.ok) {
    throw new Error('the source answered HTTP ' + response.status + ' on page ' + page);
  }
  const json = await response.json();
  const results = Array.isArray(json.results) ? json.results : [];
  return {
    // Two fields. Nothing else is copied out of the row.
    rows: results.map((r) => ({
      uei: typeof r.uei === 'string' ? r.uei : null,
      name: typeof r.name === 'string' ? r.name : '',
      amount: typeof r.amount === 'number' ? r.amount : 0,
    })),
    hasNext: Boolean(json.page_metadata && json.page_metadata.hasNext),
  };
}

/** @param {string} text @returns {string} */
function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const window = rankingWindow(args.years);
  console.log('ranking window: ' + window.start_date + ' to ' + window.end_date
    + '. It decides which names are kept and nothing else, because no figure survives it.');

  /** @type {{uei:string|null, name:string, amount:number}[]} */
  const raw = [];
  for (let page = 1; page <= args.pages; page += 1) {
    const started = Date.now();
    const result = await fetchPage(window, page);
    raw.push(...result.rows);
    console.log('  page ' + page + ': ' + result.rows.length + ' rows in '
      + (Date.now() - started) + ' ms, running total ' + raw.length);
    if (!result.hasNext) break;
  }

  const partitioned = partitionByShippedCopyRules(raw);
  if (partitioned.excluded.length > 0) {
    console.log('left out of the bundle, ' + partitioned.excluded.length + ' of ' + raw.length
      + ', each still reachable through the live suggestion endpoint:');
    for (const row of partitioned.excluded) {
      console.log('  [' + row.ruleId + '] ' + row.name);
    }
  }

  const index = buildTypeaheadIndex(partitioned.keep, { max: args.rows });
  assertStripped(index, 'build-typeahead-index');
  const text = serialiseIndex(index);

  // Read it back the way the browser will, so a file that cannot be parsed never ships.
  const reparsed = parseIndex(text);
  if (reparsed.rows.length !== index.rows.length) {
    throw new Error('the serialised index did not round trip.');
  }

  const gzipBytes = gzipSync(Buffer.from(text, 'utf8')).length;
  console.log('rows kept: ' + index.rows.length + ', raw bytes: ' + Buffer.byteLength(text, 'utf8')
    + ', gzip bytes: ' + gzipBytes + ', ceiling: ' + GZIP_CEILING_BYTES);
  if (gzipBytes > GZIP_CEILING_BYTES) {
    console.error('FAIL: the index is over the gzip ceiling. Lower --rows rather than raising '
      + 'the ceiling: the ceiling is a promise about what a visitor downloads before the page is '
      + 'useful.');
    process.exit(1);
  }

  if (args.check) {
    let existing = '';
    try {
      existing = await readFile(OUT, 'utf8');
    } catch {
      console.error('FAIL: there is no committed index to check against at ' + OUT);
      process.exit(1);
    }
    const same = sha256(existing) === sha256(text);
    console.log(same
      ? 'check: the committed index matches a fresh regeneration by sha256.'
      : 'check: the committed index DIFFERS from a fresh regeneration.');
    console.log('  committed ' + sha256(existing));
    console.log('  regenerated ' + sha256(text));
    process.exit(same ? 0 : 1);
  }

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, text, 'utf8');
  console.log('wrote ' + path.relative(REPO, OUT) + ', sha256 ' + sha256(text));
  console.log('no amount from the source appears in that file. It carries a UEI and a name per '
    + 'row and there is no third field for a figure to live in.');
}

// Guarded, so the test suite can import the name filter and test it without this script
// reaching for the network. Every gate in this repository is guarded the same way, for the same
// reason: a module that runs its own main on import cannot be unit tested.
if (isMain(import.meta.url)) {
  main().catch((e) => {
    console.error('build-typeahead-index FAILED: ' + (e && e.message));
    process.exit(1);
  });
}
