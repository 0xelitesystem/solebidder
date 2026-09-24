// THE PROBE PAGE, for the accessibility measurements only.
//
// WHY A PROBE PAGE EXISTS AT ALL. Forced colors and 200 percent zoom are questions about
// RENDERED PIXELS, and an empty shell has almost nothing to render: the charts, the arms table,
// the child entity table and every badged figure appear only once data arrives. Measuring the
// shell would answer "does the masthead survive high contrast", which nobody was worried about,
// and would report a clean bill of health for the parts the design actually stakes a claim on.
//
// So the probe serves the SHIPPED page byte for byte with exactly one substitution: the entry
// module src/ui/main.js is replaced by a module that calls the same boot() with a stubbed api
// instead of the live one. Every stylesheet, every element, every renderer and every SVG below
// that point is the shipped code. What changes is where the numbers came from, and the numbers
// are synthetic on purpose so this never touches the network and never quotes a figure about a
// real entity.
//
// The residual is planted at one cent, which is the value measured live on 2026-09-22 between
// the parent profile total and the child rollup. That is what makes the rollup panel render the
// case the design is about rather than a tidy zero.
//
// Nothing in this file is loaded by the shipped page or packed for npm. It lives under
// scripts/, which is the one exempt directory.

/** The parent total, one cent under the child rollup, so the residual is the measured cent. */
export const PROBE_CHILD_SUM = 1000;
export const PROBE_PARENT_TOTAL = 999.99;

/**
 * The module served at /probe.js. Written as a source string because it runs in the browser and
 * is never imported by node.
 * @returns {string}
 */
export function probeModule() {
  return `
import { boot } from './src/ui/app.js';
import { reconcileRollup } from './src/api/reconcile.js';
import { parentDetailClaims } from './src/api/parent.js';
import {
  testIdentity, testAwardRows, testAwardDetails, testAgencyRows, testOverTimePoints,
  TEST_FISCAL_YEAR, TEST_AS_OF,
} from './test/helpers/ui-fixtures.js';

const CANDIDATE = {
  recipientId: 'test-recipient-id',
  uei: 'TESTPARENT01',
  name: 'TEST PARENT ENTITY',
  level: 'PARENT',
  alternateNames: ['TEST PARENT ALIAS'],
};

const PROFILE = {
  recipientId: 'test-recipient-id',
  uei: 'TESTPARENT01',
  name: 'TEST PARENT ENTITY',
  level: 'P',
  totalObligations: ${PROBE_PARENT_TOTAL},
  totalTransactions: 12,
  alternateNames: ['TEST PARENT ALIAS'],
  parentUei: null,
};

const identity = testIdentity();

function reconciliation(breakdown) {
  return reconcileRollup({
    identity,
    parentReportedTotal: PROFILE.totalObligations,
    categoryBreakdown: breakdown,
    sourceAsOf: TEST_AS_OF,
  });
}

const api = {
  sourceAsOf: async () => ({ sourceAsOf: TEST_AS_OF, notice: null }),
  startQueryForUei: async (args) => ({ ...(await api.startQuery(args)), clickedUeiFound: true }),
  startQuery: async () => ({
    ok: true,
    outcome: 'only-candidate',
    candidates: [CANDIDATE],
    choice: { candidate: CANDIDATE, how: 'only-candidate' },
    refusal: null,
    sentence: 'One parent level record matches.',
    droppedChildLevel: 0,
    droppedNoUei: 0,
  }),
  loadSubject: async (args) => ({
    ok: true,
    identity,
    profile: PROFILE,
    disclosures: [],
    linkageNotice: null,
    detail: parentDetailClaims({
      profile: PROFILE,
      fiscalYear: args.fiscalYear,
      awardTypeSetId: args.awardTypeSetId,
      sourceAsOf: TEST_AS_OF,
    }),
    reconciliation: reconciliation(null),
  }),
  obligationsByFiscalYear: async () => ({
    ok: true, years: [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025],
    points: testOverTimePoints(), claims: [],
  }),
  category: async (args) => ({
    ok: true,
    dimension: args === undefined ? 'awarding_agency' : args.dimension,
    rows: testAgencyRows(),
    hasNextPage: false,
  }),
  nameMatchTotal: async () => ({
    ok: true,
    rows: [
      { name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', amount: 900, code: null, id: null },
      { name: 'AN ENTITY IN THE GAP', uei: 'TESTOTHER001', amount: 250, code: null, id: null },
    ],
    total: 1150,
  }),
  entityBreakdown: async () => ({
    ok: true,
    rows: [{ name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', amount: ${PROBE_CHILD_SUM}, code: null, id: null }],
    total: ${PROBE_CHILD_SUM},
  }),
  reconcileThreeWays: async () => ({
    ok: true,
    armsMissing: false,
    breakdownFailure: null,
    breakdown: { ok: true, rows: [], total: ${PROBE_CHILD_SUM} },
    reconciliation: reconciliation({ rows: [{ amount: ${PROBE_CHILD_SUM} }], total: ${PROBE_CHILD_SUM} }),
  }),
  client: {
    request: async (spec) => {
      if (spec.id === 'spendingByAward') {
        return { ok: true, value: { rows: testAwardRows(), hasNextPage: false }, attempts: 1 };
      }
      const details = testAwardDetails();
      const found = details.find((d) => spec.url.includes(d.generatedInternalId));
      return { ok: true, value: found === undefined ? details[0] : found, attempts: 1 };
    },
    mapWithCap: async (tasks) => Promise.all(tasks.map((t) => t())),
  },
  categoryRowClaims: (await import('./src/api/categories.js')).categoryRowClaims,
};

const app = boot(document, {
  api,
  now: () => new Date(Date.UTC(2026, 8, 22)),
  loadIndexText: async () => '',
});

await app.search('test parent');
await new Promise((r) => setTimeout(r, 0));
await new Promise((r) => setTimeout(r, 0));
await new Promise((r) => setTimeout(r, 30));
window.__probeReady = true;
`;
}

/**
 * The shipped page with the entry module swapped for the probe module. Everything else, the
 * whole stylesheet included, is byte for byte what ships.
 * @param {string} html
 * @returns {string}
 */
export function probePage(html) {
  const from = '<script type="module" src="src/ui/main.js"></script>';
  if (!html.includes(from)) {
    throw new Error('probe-page: index.html no longer loads ' + from + ', so the probe cannot '
      + 'substitute the entry module. Fix this file rather than measuring a page that booted '
      + 'against the live API.');
  }
  return html.replace(from, '<script type="module" src="probe.js"></script>');
}
