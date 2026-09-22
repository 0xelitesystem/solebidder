#!/usr/bin/env node
// GATE 3: THE NEVER CLAIMED LIST CANNOT APPEAR AS A CLAIM. DESIGN 2.4.
//
//   node scripts/gate-vocabulary.mjs             scan the shipped copy
//   node scripts/gate-vocabulary.mjs --selftest  run the positive controls only
//
// TWO HALVES, and they pull in opposite directions on purpose.
//
//   THE PRESENCE HALF. All ten NEVER CLAIMED statements must appear in index.html, verbatim.
//   They are on the page, not in a footnote. Dropping one fails the build, so a rewrite that
//   makes the page friendlier cannot quietly make it less true.
//
//   THE ABSENCE HALF. None of the banned phrasings may appear anywhere in the shipped copy.
//   The ten statements are masked out first, so the page can say "obligations are not revenue"
//   and cannot say "revenue". That masking step is what makes the rule mechanical instead of a
//   matter of somebody reading carefully at the end of a long day.
//
// WHAT IS SCANNED AND WHAT IS NOT. index.html, README.md and docs/ are scanned in full: every
// character of those is copy. Files under src/ are scanned with their comments stripped, and
// the reason is worth stating rather than assuming: a comment explaining why a term is banned
// is doing the same job this gate does, while a string literal is a sentence on its way to a
// reader. Stripping comments keeps the gate pointed at claims rather than at the explanations of
// why those claims are forbidden. Nothing in src/ is exempt as a file; only the comments are.
//
// scripts/ is not scanned at all, because the registry of banned terms lives there and a
// registry that cannot name what it bans is not a registry. Nothing under scripts/ is served.

import { NEVER_CLAIMED_ITEMS, NEVER_CLAIMED_COUNT } from '../src/core/never-claimed.js';
import { BANNED, scanText, maskPermitted } from './banned-vocabulary.mjs';
import { stripComments } from './gate-units.mjs';
import { REPO, shippedCopy, sourceFiles, say, isMain, VOCABULARY_EXEMPT } from './_shipped.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/* -----------------------------------------------------------------------------------------
 * POSITIVE CONTROLS.
 * --------------------------------------------------------------------------------------- */

const MUST_FAIL = [
  { name: 'a revenue claim', scope: 'shipped', text: 'Lockheed Martin revenue for FY2025.' },
  { name: 'trending the outlay field', scope: 'shipped', text: 'Outlays by fiscal year, ten years.' },
  { name: 'everything the company gets', scope: 'shipped', text: 'See everything the company gets from the government.' },
  { name: 'an audited tree', scope: 'shipped', text: 'The audited corporate tree for this parent.' },
  { name: 'losing bidders', scope: 'shipped', text: 'See the losing bidders on each contract.' },
  { name: 'a completeness claim', scope: 'shipped', text: 'A complete record of federal contracting.' },
  { name: 'all time framing', scope: 'shipped', text: 'All-time obligations for this recipient.' },
  { name: 'the legacy vendor identifier', scope: 'shipped', text: 'Keyed on the DUNS number.' },
  { name: 'a backlog figure', scope: 'shipped', text: 'Backlog against obligations.' },
  { name: 'the rolling window literal', scope: 'query', text: "const url = base + '?year=latest';" },
  { name: 'assistant attribution', scope: 'shipped', text: 'Generated with Claude.' },
  { name: 'an em dash', scope: 'shipped', text: 'One host — one allowlist.' },
];

const MUST_PASS = [
  { name: 'the first NEVER CLAIMED statement', scope: 'shipped', text: NEVER_CLAIMED_ITEMS[0].sentence },
  { name: 'the second NEVER CLAIMED statement', scope: 'shipped', text: NEVER_CLAIMED_ITEMS[1].sentence },
  { name: 'the seventh NEVER CLAIMED statement', scope: 'shipped', text: NEVER_CLAIMED_ITEMS[6].sentence },
  { name: 'the tenth NEVER CLAIMED statement', scope: 'shipped', text: NEVER_CLAIMED_ITEMS[9].sentence },
  { name: 'ordinary product copy', scope: 'shipped', text: 'Type a federal contractor and see how concentrated its customer book is.' },
  { name: 'the field name that starts with the banned word', scope: 'query', text: 'const c = json.latest_transaction_contract_data;' },
  { name: 'an explicit fiscal year', scope: 'query', text: "const url = base + '?year=' + fiscalYear;" },
];

export function selftest() {
  say.head('gate-vocabulary positive controls');
  let bad = 0;

  for (const c of MUST_FAIL) {
    const hits = scanText(c.text, 'control', /** @type {any} */ (c.scope));
    if (hits.length > 0) say.pass('caught: ' + c.name + '  [' + hits[0].ruleId + ']');
    else { say.fail('NOT caught: ' + c.name + '  ' + JSON.stringify(c.text)); bad += 1; }
  }
  for (const c of MUST_PASS) {
    const hits = scanText(c.text, 'control', /** @type {any} */ (c.scope));
    if (hits.length === 0) say.pass('correctly allowed: ' + c.name);
    else {
      say.fail('FALSE POSITIVE: ' + c.name + '  [' + hits[0].ruleId + '] on ' + JSON.stringify(hits[0].match));
      bad += 1;
    }
  }

  if (NEVER_CLAIMED_ITEMS.length === NEVER_CLAIMED_COUNT) {
    say.pass('the NEVER CLAIMED registry holds exactly ' + NEVER_CLAIMED_COUNT + ' statements');
  } else {
    say.fail('the NEVER CLAIMED registry holds ' + NEVER_CLAIMED_ITEMS.length + ' statements, not '
      + NEVER_CLAIMED_COUNT + '. One of the ten was dropped or duplicated.');
    bad += 1;
  }

  // The masking step itself, because if it stops working the presence half starts failing the
  // absence half and the gate eats its own page.
  const masked = maskPermitted(NEVER_CLAIMED_ITEMS[0].sentence);
  if (!/revenue/i.test(masked)) say.pass('masking removes the permitted phrasing before the patterns run');
  else { say.fail('masking did not remove a permitted statement, so the page cannot state its own boundary'); bad += 1; }

  return bad;
}

async function checkPresence() {
  say.head('gate-vocabulary: the ten statements are on the page');
  let bad = 0;
  let html = '';
  try {
    html = await readFile(path.join(REPO, 'index.html'), 'utf8');
  } catch {
    say.note('no index.html at the repo root yet. The presence half of this gate engages the '
      + 'moment it exists; the absence half and the positive controls run regardless.');
    return 0;
  }
  const normalised = html.replace(/\s+/g, ' ');
  for (const item of NEVER_CLAIMED_ITEMS) {
    const needle = item.sentence.replace(/\s+/g, ' ');
    if (normalised.includes(needle)) say.pass('present: ' + item.id);
    else {
      say.fail('MISSING from index.html: ' + item.id + '  (' + item.designRef + ')');
      console.log('          ' + item.sentence);
      console.log('          These are on the page, not in a footnote, because a reader who '
        + 'misses one will misread every figure above it.');
      bad += 1;
    }
  }
  return bad;
}

async function checkAbsence() {
  say.head('gate-vocabulary: no banned phrasing in the shipped copy');
  let bad = 0;
  const copy = await shippedCopy();
  const src = await sourceFiles();
  const srcPaths = new Set(src.map((f) => f.rel));
  const exempt = new Set(VOCABULARY_EXEMPT.map((e) => e.file));
  for (const e of VOCABULARY_EXEMPT) say.note('exempt: ' + e.file + '  ' + e.reason);

  for (const f of copy) {
    if (exempt.has(f.rel)) continue;
    const isSource = srcPaths.has(f.rel);
    const text = isSource ? stripComments(f.text) : f.text;
    for (const h of scanText(text, f.rel, 'shipped')) {
      say.fail(f.rel + ':' + h.line + '  [' + h.ruleId + '] ' + JSON.stringify(h.match));
      console.log('          ' + h.why);
      console.log('          ' + h.designRef);
      bad += 1;
    }
  }

  for (const f of src) {
    if (!f.rel.startsWith('src/query/')) continue;
    for (const h of scanText(stripComments(f.text), f.rel, 'query')) {
      say.fail(f.rel + ':' + h.line + '  [' + h.ruleId + '] ' + JSON.stringify(h.match));
      console.log('          ' + h.why);
      bad += 1;
    }
  }

  if (bad === 0) {
    say.pass(copy.length + ' shipped files checked against ' + BANNED.length + ' rules, none matched');
  }
  return bad;
}

if (isMain(import.meta.url)) {
  const selftestOnly = process.argv.includes('--selftest');
  let failures = selftest();
  if (!selftestOnly) {
    failures += await checkPresence();
    failures += await checkAbsence();
  }
  console.log(failures === 0 ? '\ngate-vocabulary: PASS' : '\ngate-vocabulary: FAIL (' + failures + ')');
  process.exit(failures === 0 ? 0 : 1);
}
