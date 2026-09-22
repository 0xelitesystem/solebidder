#!/usr/bin/env node
// GATE 5: FIRST CONTENTFUL PAINT, MEASURED, AGAINST THE BUDGET IN DESIGN 6.2.
//
//   node scripts/gate-fcp.mjs             the positive controls, then the real measurement
//   node scripts/gate-fcp.mjs --selftest  the positive controls only
//   node scripts/gate-fcp.mjs --runs 9    more samples in the real measurement
//
// WHY THIS GATE EXISTS AS A GATE AND NOT AS A SCRIPT SOMEBODY RUNS. DESIGN 6.2 lists four
// budgets with an enforcement column, and three of them fail a build. The first contentful paint
// row named a script that did not exist, so the budget was a sentence rather than a limit. A
// budget nothing enforces is a budget that is already broken and nobody has looked.
//
// THE THREE CHECKS.
//
//   A. THE DECISION IS ARITHMETIC AND IT IS PROVED FIRST. decide() is the whole judgement of
//      this gate reduced to one comparison, and it is checked against values whose verdict is
//      not a matter of opinion: one millisecond over the budget must fail, the budget itself
//      must pass, and a measurement that produced no number at all must fail rather than be
//      treated as a zero. That last one is the failure mode that matters: a rig that silently
//      reports nothing would otherwise pass this gate forever.
//
//   B. THE BROWSER POSITIVE CONTROL. A page that is genuinely too slow is measured through the
//      same rig as the real one, and this gate FAILS if that page passes. The control page is
//      the real page with 400 KB of incompressible random bytes welded into an HTML comment. It
//      changes no pixel and no layout; the only thing it changes is how many bytes must arrive
//      before the first paint, which is precisely what the budget is about. On the Fast 3G
//      constants that padding costs about two seconds on its own, so the control is over budget
//      by physics rather than by a threshold somebody moved.
//
//   C. THE REAL MEASUREMENT. Five cold loads of the shipped page, fresh browser context each
//      time, cache disabled, served gzipped over the Fast 3G constants. The median decides.
//
// Checks B and C share ONE headless Edge process and one measurement rig, so proving the gate
// fires costs a browser launch rather than a second one.
//
// Nothing here weakens if Edge is missing. A gate that cannot run is a FAILURE, not a skip: a
// green build on a machine with no browser would mean the budget is unenforced on exactly the
// machines that publish.

import {
  FCP_BUDGET_MS, FAST_3G, CONTROL_PAD_BYTES, buildRoutes, serveGzipped, withBrowser, measureFcp,
  padPage, report,
} from './measure-fcp.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { REPO, say, isMain } from './_shipped.mjs';

/**
 * The entire judgement of this gate, as one function, so it can be checked against values whose
 * verdict is arithmetic rather than a matter of taste.
 *
 * @param {number|null|undefined} medianMs
 * @returns {{pass:boolean, why:string}}
 */
export function decide(medianMs) {
  if (typeof medianMs !== 'number' || !Number.isFinite(medianMs)) {
    return {
      pass: false,
      why: 'the rig produced no first contentful paint at all. That is a failure and never a '
        + 'pass: a measurement that reports nothing would otherwise satisfy any budget.',
    };
  }
  if (medianMs <= FCP_BUDGET_MS) {
    return { pass: true, why: medianMs.toFixed(0) + ' ms at or under the ' + FCP_BUDGET_MS + ' ms budget' };
  }
  return { pass: false, why: medianMs.toFixed(0) + ' ms over the ' + FCP_BUDGET_MS + ' ms budget' };
}

/* -----------------------------------------------------------------------------------------
 * A. THE ARITHMETIC CONTROL. No browser, no network, runs on every invocation.
 * --------------------------------------------------------------------------------------- */

const DECISIONS = [
  { in: 0, pass: true, why: 'a page that paints instantly is inside any budget' },
  { in: FCP_BUDGET_MS - 1, pass: true, why: 'one millisecond under the budget passes' },
  { in: FCP_BUDGET_MS, pass: true, why: 'the budget itself is inclusive, DESIGN 6.2 says under 1.2 s' },
  { in: FCP_BUDGET_MS + 1, pass: false, why: 'ONE MILLISECOND OVER THE BUDGET MUST FAIL' },
  { in: 5000, pass: false, why: 'a page that takes five seconds fails' },
  { in: null, pass: false, why: 'NO MEASUREMENT IS A FAILURE, never a pass' },
  { in: NaN, pass: false, why: 'a measurement that came back as not a number is a failure' },
];

/** @returns {number} failures */
export function selftestDecision() {
  say.head('gate-fcp: the decision, checked against known verdicts');
  let bad = 0;
  for (const c of DECISIONS) {
    const got = decide(c.in);
    const label = String(c.in).padEnd(6) + ' expected ' + (c.pass ? 'PASS' : 'FAIL')
      + ', got ' + (got.pass ? 'PASS' : 'FAIL') + '   ' + c.why;
    if (got.pass === c.pass) say.pass(label);
    else { say.fail(label); bad += 1; }
  }
  return bad;
}

/* -----------------------------------------------------------------------------------------
 * B and C. THE BROWSER PASS. One Edge process, two origins: the shipped page and the control.
 * --------------------------------------------------------------------------------------- */

/**
 * @param {{runs?:number, controlRuns?:number, selftestOnly?:boolean}} [options]
 * @returns {Promise<{failures:number, real:object|null, control:object|null}>}
 */
export async function runBrowserPass(options = {}) {
  const runs = options.runs === undefined ? 5 : options.runs;
  const controlRuns = options.controlRuns === undefined ? 3 : options.controlRuns;
  const selftestOnly = options.selftestOnly === true;

  const html = await readFile(path.join(REPO, 'index.html'), 'utf8');
  const realRoutes = await buildRoutes({ html });
  const controlRoutes = await buildRoutes({ html: padPage(html, CONTROL_PAD_BYTES) });

  const realServer = await serveGzipped(realRoutes.routes);
  const controlServer = await serveGzipped(controlRoutes.routes);

  let failures = 0;
  /** @type {object|null} */
  let real = null;
  /** @type {object|null} */
  let control = null;

  try {
    await withBrowser(async (browser) => {
      control = await measureFcp({
        browser,
        origin: controlServer.origin,
        misses: controlServer.misses,
        speculative: controlServer.speculative,
        pageBytes: controlRoutes.pageBytes,
        treeBytes: controlRoutes.treeBytes,
        runs: controlRuns,
        label: 'POSITIVE CONTROL, the page plus ' + CONTROL_PAD_BYTES
          + ' B of incompressible padding',
      });
      report(control);
      const verdict = decide(control.medianMs);
      if (verdict.pass) {
        say.fail('THE POSITIVE CONTROL PASSED, so this gate does not fire. A page carrying '
          + CONTROL_PAD_BYTES + ' B of incompressible padding needs at least '
          + (CONTROL_PAD_BYTES / FAST_3G.downloadBytesPerSecond * 1000).toFixed(0)
          + ' ms of transfer on the Fast 3G constants, on top of ' + FAST_3G.latencyMs
          + ' ms of latency, and it still came in at ' + control.medianMs.toFixed(0)
          + ' ms. Either the throttle is not being applied or the budget is not being read.');
        failures += 1;
      } else {
        say.pass('the positive control fired: ' + verdict.why + '. This gate fails when a page '
          + 'is too slow, which is the only thing that makes the green run below mean anything.');
      }

      if (selftestOnly) return;

      real = await measureFcp({
        browser,
        origin: realServer.origin,
        misses: realServer.misses,
        speculative: realServer.speculative,
        pageBytes: realRoutes.pageBytes,
        treeBytes: realRoutes.treeBytes,
        runs,
        label: 'index.html, the shipped page',
      });
      report(real);
      if (real.routeMisses.length > 0) failures += 1;
      const realVerdict = decide(real.medianMs);
      if (!realVerdict.pass) failures += 1;
    });
  } finally {
    await realServer.close();
    await controlServer.close();
  }

  return { failures, real, control };
}

if (isMain(import.meta.url)) {
  const selftestOnly = process.argv.includes('--selftest');
  const runsAt = process.argv.indexOf('--runs');
  const runs = runsAt > -1 ? Number(process.argv[runsAt + 1]) : 5;

  let failures = selftestDecision();
  const pass = await runBrowserPass({ runs, selftestOnly });
  failures += pass.failures;

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ budgetMs: FCP_BUDGET_MS, real: pass.real, control: pass.control }, null, 2));
  }

  console.log(failures === 0 ? '\ngate-fcp: PASS' : '\ngate-fcp: FAIL (' + failures + ')');
  process.exit(failures === 0 ? 0 : 1);
}
