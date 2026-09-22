#!/usr/bin/env node
// Run every CI gate.
//
//   npm run gates            run all gates against the repository
//   npm run gates:selftest   run only the positive controls of every gate
//
// Each gate runs as a separate process, so one gate crashing cannot mask another and the exit
// code of each is reported individually. The aggregate exit code is non zero if any gate failed.
//
// THE POSITIVE CONTROLS ARE NOT OPTIONAL. Every gate here proves, on every run, that it fails
// when it should. A gate nobody has watched fail is not a gate, it is a hope, and the claim
// boundary of this product rests on these five.
//
// THE FIFTH GATE OPENS A BROWSER AND IT IS THE SLOW ONE. gate-fcp measures the first contentful
// paint of the shipped page over the Fast 3G constants in headless Edge, eight cold loads in
// total including its own positive control, which costs roughly forty seconds. It is in this
// list anyway, because DESIGN 6.2 states the 1.2 s budget with an enforcement column, and a
// budget that is only checked when somebody remembers to check it is not enforced. It fails
// rather than skips when no Edge is present: a green run on a machine with no browser would mean
// the budget is unenforced on exactly the machines that publish.
//
// The network host check is not in this list, and that is deliberate rather than an omission:
// it lives in the shared runner gate, which reads the page and the source, extracts the set of
// hosts used, extracts the set declared in the Content-Security-Policy allowlist, and fails on a
// difference in either direction. Reimplementing it here would produce a second answer to a
// question that already has an authoritative one.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const GATES = [
  { id: 'badges', file: 'gate-badges.mjs', what: 'no figure renders without a badge, estimates budget zero' },
  { id: 'units', file: 'gate-units.mjs', what: 'no currency without a unit kind, no chart with two kinds' },
  { id: 'vocabulary', file: 'gate-vocabulary.mjs', what: 'the NEVER CLAIMED list cannot appear as a claim' },
  { id: 'contrast', file: 'gate-contrast.mjs', what: 'WCAG AA by math, both themes, and the ramp separation' },
  { id: 'fcp', file: 'gate-fcp.mjs', what: 'first contentful paint under 1.2 s, measured in headless Edge' },
];

const passthrough = process.argv.slice(2);
/** @type {{id:string, code:number}[]} */
const results = [];

for (const g of GATES) {
  const r = spawnSync(process.execPath, [path.join(HERE, g.file), ...passthrough], { stdio: 'inherit' });
  results.push({ id: g.id, code: r.status === null ? 1 : r.status });
}

console.log('\n================ gate summary ================');
let failed = 0;
for (const g of GATES) {
  const r = results.find((x) => x.id === g.id);
  const ok = r && r.code === 0;
  if (!ok) failed += 1;
  console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + g.id.padEnd(11) + g.what);
}
console.log('==============================================');
console.log(failed === 0 ? 'ALL GATES PASS' : failed + ' GATE(S) FAILED');
process.exit(failed === 0 ? 0 : 1);
