// The whole page, driven end to end against a stub api and a document stand in.
//
// What this file is for. Every other UI test checks one piece; this one checks that the pieces
// are wired in the order DESIGN 6.3 requires and that the page behaves when the source does not.
//
//   Wave order. Identity resolves before anything heavy starts, and the heavy panels fill in
//   independently, so one slow or broken endpoint costs one panel rather than the page.
//   The generation counter. Changing the fiscal year while a slow request is in flight must not
//   let the old period's response paint into a page labelled with the new one. That is trap 2
//   arriving through the back door and it would be invisible in review.
//   The refusal path. A name matching more than one unlinked parent record produces the refusal
//   panel and NO figures at all.
//   The entity set filter. The award search endpoint ignores a recipient id filter, so a row for
//   another company reaching the hero would put that company's contract under this company's
//   name. The row is dropped and the drop is counted on the page.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boot, fiscalYearOf, fiscalYearWindow, awardSearchRequest, CHIPS, SPINE_YEARS, SUGGEST_DEBOUNCE_MS,
} from '../src/ui/app.js';
import { refuseIdentity } from '../src/contracts/identity.js';
import { parentDetailClaims } from '../src/api/parent.js';
import { failure, UPSTREAM_ERROR } from '../src/query/failure.js';
import { API_ORIGIN, FISCAL_YEAR_FLOOR } from '../src/core/constants.js';
import { createDocument } from './helpers/mini-dom.js';
import {
  REGION_IDS, testIdentity, testAwardRows, testAwardDetails, testAgencyRows, testOverTimePoints,
  TEST_FISCAL_YEAR, TEST_AS_OF,
} from './helpers/ui-fixtures.js';

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
  totalObligations: 1000,
  totalTransactions: 12,
  alternateNames: ['TEST PARENT ALIAS'],
  parentUei: null,
};

/**
 * A stub api with the same surface as createApi(). Every method is overridable per test, and
 * each records how many times it ran so a test can assert what did and did not happen.
 */
function stubApi(overrides = {}) {
  const calls = {
    startQuery: 0, loadSubject: 0, spine: 0, category: 0, awards: 0, details: 0,
    nameMatch: 0, threeWay: 0, startQueryForUei: 0,
  };
  const identity = testIdentity();
  const api = {
    calls,
    sourceAsOf: async () => ({ sourceAsOf: TEST_AS_OF, notice: null }),
    startQueryForUei: async (args) => {
      calls.startQueryForUei += 1;
      const r = await api.startQuery(args);
      return { ...r, clickedUeiFound: true };
    },
    startQuery: async () => {
      calls.startQuery += 1;
      return {
        ok: true,
        outcome: 'only-candidate',
        candidates: [CANDIDATE],
        choice: { candidate: CANDIDATE, how: 'only-candidate' },
        refusal: null,
        sentence: 'One parent level record matches.',
        droppedChildLevel: 0,
        droppedNoUei: 0,
      };
    },
    loadSubject: async () => {
      calls.loadSubject += 1;
      return {
        ok: true,
        identity,
        profile: PROFILE,
        disclosures: [],
        linkageNotice: null,
        detail: parentDetailClaims({
          profile: PROFILE,
          fiscalYear: TEST_FISCAL_YEAR,
          awardTypeSetId: 'contracts',
          sourceAsOf: TEST_AS_OF,
        }),
        reconciliation: { ok: false, failure: failure(UPSTREAM_ERROR, 'the subsidiary rollup') },
      };
    },
    obligationsByFiscalYear: async () => {
      calls.spine += 1;
      return { ok: true, years: [2023, 2024, 2025], points: testOverTimePoints(), claims: [] };
    },
    category: async (args) => {
      calls.category += 1;
      return {
        ok: true,
        dimension: args === undefined ? 'awarding_agency' : args.dimension,
        rows: testAgencyRows(),
        hasNextPage: false,
      };
    },
    nameMatchTotal: async () => {
      calls.nameMatch += 1;
      return {
        ok: true,
        rows: [
          { name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', amount: 900, code: null, id: null },
          { name: 'AN ENTITY IN THE GAP', uei: 'TESTOTHER001', amount: 250, code: null, id: null },
        ],
        total: 1150,
      };
    },
    entityBreakdown: async () => ({
      ok: true,
      rows: [{ name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', amount: 900, code: null, id: null }],
      total: 900,
    }),
    reconcileThreeWays: async () => {
      calls.threeWay += 1;
      return {
        ok: true,
        armsMissing: true,
        breakdownFailure: failure(UPSTREAM_ERROR, 'the entity breakdown'),
        reconciliation: { ok: false, failure: failure(UPSTREAM_ERROR, 'the subsidiary rollup') },
      };
    },
    client: {
      request: async (spec) => {
        if (spec.id === 'spendingByAward') {
          calls.awards += 1;
          return { ok: true, value: { rows: testAwardRows(), hasNextPage: false }, attempts: 1 };
        }
        calls.details += 1;
        const details = testAwardDetails();
        const found = details.find((d) => spec.url.includes(d.generatedInternalId));
        return { ok: true, value: found === undefined ? details[0] : found, attempts: 1 };
      },
      mapWithCap: async (tasks) => Promise.all(tasks.map((t) => t())),
    },
  };
  return Object.assign(api, overrides);
}

function bootPage(api, now = () => new Date(Date.UTC(2026, 8, 22))) {
  const doc = createDocument(REGION_IDS);
  const form = doc.createElement('form');
  form.setAttribute('id', 'search-form');
  const input = doc.createElement('input');
  input.setAttribute('id', 'q');
  input.value = 'test parent';
  doc.body.appendChild(form);
  doc.body.appendChild(input);
  const app = boot(doc, { api, now });
  return { doc, app, form, input };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('THE FISCAL YEAR STARTS IN OCTOBER, and the default is the most recent COMPLETED year', () => {
  assert.equal(fiscalYearOf(new Date(Date.UTC(2026, 8, 30))), 2026, 'September is the old year');
  assert.equal(fiscalYearOf(new Date(Date.UTC(2026, 9, 1))), 2027, 'October starts the new one');
  const window_ = fiscalYearWindow(new Date(Date.UTC(2026, 8, 22)));
  assert.equal(window_.latest, 2026);
  assert.equal(window_.defaultYear, 2025, 'a partial year is selectable but is not the default');
  assert.ok(fiscalYearWindow(new Date(Date.UTC(2008, 0, 1))).defaultYear >= FISCAL_YEAR_FLOOR);
});

test('the shell paints the controls, the chips and the as-of line with no entity chosen', async () => {
  const { doc } = bootPage(stubApi());
  await settle();
  assert.match(doc.getElementById('panel-controls').textContent, /Award type set/);
  const chips = doc.getElementById('panel-chips');
  assert.equal(chips.querySelectorAll('button').length, CHIPS.length);
  assert.doesNotMatch(chips.textContent, /\$/, 'a chip carries a name and nothing else');
  assert.match(doc.getElementById('panel-source-as-of').textContent, /09\/21\/2026/);
});

test('A SEARCH RESOLVES AN ENTITY AND THEN EVERY PANEL FILLS IN', async () => {
  const api = stubApi();
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();

  assert.equal(api.calls.startQuery, 1);
  assert.equal(api.calls.loadSubject, 1);
  assert.match(doc.getElementById('panel-subject').textContent, /TESTPARENT01/);
  assert.match(doc.getElementById('panel-hero').textContent, /awarded with exactly one bidder/);
  assert.match(doc.getElementById('panel-mix').textContent, /TEST DEPARTMENT ALPHA/);
  assert.match(doc.getElementById('panel-spine').textContent, /FY2025/);
  assert.match(doc.getElementById('panel-concentration').textContent, /lifetime award value/i);
});

test('THE HERO AND THE FISCAL YEAR SPINE USE DIFFERENT RAMPS, on one page, side by side', async () => {
  const { doc, app } = bootPage(stubApi());
  await app.search('test parent');
  await settle();
  await settle();

  const ramps = doc.querySelectorAll('[data-ramp]').map((n) => n.getAttribute('data-ramp'));
  assert.ok(ramps.includes('obligations'), 'the fiscal year chart is on the accent ramp');
  assert.ok(ramps.includes('awardValue'), 'the award value chart is on the neutral hatched ramp');
  assert.ok(ramps.includes('share'));

  // And no single chart carries two of them, which is the structural half of the rule.
  for (const fig of doc.querySelectorAll('[data-ramp]')) {
    const kinds = new Set(fig.querySelectorAll('[data-unit-kind]')
      .map((n) => n.getAttribute('data-unit-kind'))
      .filter((k) => k !== 'none' && k !== 'tally'));
    assert.ok(kinds.size <= 1, 'a chart received more than one unit kind: ' + [...kinds].join(', '));
  }
});

test('A ROW FOR ANOTHER COMPANY IS DROPPED, AND THE DROP IS COUNTED ON THE PAGE', async () => {
  const api = stubApi();
  api.client = {
    ...api.client,
    request: async (spec) => {
      if (spec.id === 'spendingByAward') {
        return {
          ok: true,
          value: {
            rows: [
              ...testAwardRows(),
              {
                awardId: 'TESTOTHER0001',
                recipientName: 'A COMPLETELY DIFFERENT COMPANY',
                awardValue: 9999,
                generatedInternalId: 'gid-other',
              },
            ],
            hasNextPage: false,
          },
          attempts: 1,
        };
      }
      const details = testAwardDetails();
      const found = details.find((d) => spec.url.includes(d.generatedInternalId));
      return { ok: true, value: found === undefined ? details[0] : found, attempts: 1 };
    },
  };
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();

  const hero = doc.getElementById('panel-hero');
  assert.doesNotMatch(hero.textContent, /A COMPLETELY DIFFERENT COMPANY/);
  assert.doesNotMatch(hero.textContent, /TESTOTHER0001/);
  assert.match(hero.textContent, /1 dropped award row/, 'the drop is counted, visibly');
  assert.match(hero.textContent, /not in the resolved entity set/, 'and the reason is stated');
});

test('ONE BROKEN PANEL COSTS ONE PANEL, never the page', async () => {
  const api = stubApi({
    category: async () => ({ ok: false, failure: failure(UPSTREAM_ERROR, 'the agency breakdown') }),
  });
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();

  assert.match(doc.getElementById('panel-mix').textContent, /agency breakdown/);
  assert.match(doc.getElementById('panel-mix').textContent, /did not respond/);
  assert.match(doc.getElementById('panel-hero').textContent, /awarded with exactly one bidder/);
  assert.match(doc.getElementById('panel-spine').textContent, /FY2025/);
});

test('a retryable failure offers a retry that actually refetches', async () => {
  // Counted PER DIMENSION, because the page now asks for four of them and a retry on the agency
  // panel must refetch that panel and only that panel. A counter shared across every dimension
  // would go green on any four calls at all, including four calls to the wrong one.
  let attempts = 0;
  const api = stubApi({
    category: async (args) => {
      if (args.dimension !== 'awarding_agency') {
        return { ok: true, dimension: args.dimension, rows: testAgencyRows(), hasNextPage: false };
      }
      attempts += 1;
      if (attempts === 1) return { ok: false, failure: failure(UPSTREAM_ERROR, 'the agency breakdown') };
      return { ok: true, dimension: 'awarding_agency', rows: testAgencyRows(), hasNextPage: false };
    },
  });
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();

  const mix = doc.getElementById('panel-mix');
  mix.querySelector('button').dispatch('click');
  await settle();
  await settle();
  assert.equal(attempts, 2);
  assert.match(doc.getElementById('panel-mix').textContent, /TEST DEPARTMENT ALPHA/);
});

test('THE REFUSAL PATH RENDERS THE SPLIT RECORDS AND NO FIGURES AT ALL', async () => {
  const split = [
    { recipientId: 'r1', uei: 'TESTSPLIT001', name: 'TEST SPLIT ONE', level: 'PARENT' },
    { recipientId: 'r2', uei: 'TESTSPLIT002', name: 'TEST SPLIT TWO', level: 'PARENT' },
  ];
  const api = stubApi({
    startQuery: async () => ({
      ok: true,
      outcome: 'choice-required',
      candidates: split,
      choice: null,
      refusal: refuseIdentity('test split', split),
      sentence: 'x',
      droppedChildLevel: 0,
      droppedNoUei: 0,
    }),
  });
  const { doc, app } = bootPage(api);
  await app.search('test split');
  await settle();

  const chooser = doc.getElementById('panel-chooser');
  assert.match(chooser.textContent, /No single parent record exists/);
  assert.match(chooser.textContent, /TESTSPLIT001/);
  assert.equal(api.calls.loadSubject, 0, 'nothing is summed while the tool is refusing');
  assert.equal(doc.getElementById('panel-hero').textContent, '');
  assert.equal(doc.getElementById('panel-subject').textContent, '');
});

test('the refusal still lets a visitor pick one record DELIBERATELY', async () => {
  const split = [
    { recipientId: 'r1', uei: 'TESTSPLIT001', name: 'TEST SPLIT ONE', level: 'PARENT' },
    { recipientId: 'r2', uei: 'TESTSPLIT002', name: 'TEST SPLIT TWO', level: 'PARENT' },
  ];
  const api = stubApi({
    startQuery: async () => ({
      ok: true,
      outcome: 'choice-required',
      candidates: split,
      choice: null,
      refusal: refuseIdentity('test split', split),
      sentence: 'x',
      droppedChildLevel: 0,
      droppedNoUei: 0,
    }),
  });
  const { doc, app } = bootPage(api);
  await app.search('test split');
  await settle();
  doc.getElementById('panel-chooser').querySelectorAll('button')[0].dispatch('click');
  await settle();
  await settle();
  assert.equal(api.calls.loadSubject, 1);
});

test('a search that matches no parent record explains what that means', async () => {
  const api = stubApi({
    startQuery: async () => ({
      ok: true,
      outcome: 'no-records',
      candidates: [],
      choice: null,
      refusal: null,
      sentence: 'No parent level record matches that name in this dataset.',
      droppedChildLevel: 0,
      droppedNoUei: 0,
    }),
  });
  const { doc, app } = bootPage(api);
  await app.search('nothing at all');
  await settle();
  assert.match(doc.getElementById('panel-chooser').textContent, /No parent record matched/);
  assert.match(doc.getElementById('panel-chooser').textContent, /not that a company of that name received nothing|refuses to do/);
});

test('CHANGING THE PERIOD MID FLIGHT NEVER PAINTS THE OLD PERIOD INTO THE NEW PAGE', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let slowCalls = 0;
  const api = stubApi({
    category: async () => {
      slowCalls += 1;
      if (slowCalls === 1) {
        await gate;
        return {
          ok: true,
          dimension: 'awarding_agency',
          rows: [{ name: 'STALE PERIOD ROW', code: 'S', id: '9', amount: 500 }],
          hasNextPage: false,
        };
      }
      return { ok: true, dimension: 'awarding_agency', rows: testAgencyRows(), hasNextPage: false };
    },
  });
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();

  app.state.fiscalYear = 2024;
  app.reload();
  await settle();
  release();
  await settle();
  await settle();

  assert.doesNotMatch(doc.getElementById('panel-mix').textContent, /STALE PERIOD ROW/,
    'a response for the period the reader left must never paint into the period they chose');
});

test('an empty search does nothing rather than querying for an empty string', async () => {
  const api = stubApi();
  const { app } = bootPage(api);
  await app.search('   ');
  assert.equal(api.calls.startQuery, 0);
});

test('submitting the form searches for what is in the field', async () => {
  const api = stubApi();
  const { form, input } = bootPage(api);
  input.value = 'test parent';
  form.dispatch('submit');
  await settle();
  assert.equal(api.calls.startQuery, 1);
});

test('THE AWARD SEARCH IS BUILT WITH NO RECIPIENT ID, ON ONE HOST, AT THE CAPPED PAGE SIZE', () => {
  const spec = awardSearchRequest(testIdentity());
  assert.ok(spec.url.startsWith(API_ORIGIN), 'one host, and it is the declared one');
  assert.equal(spec.method, 'POST');
  assert.equal(spec.weight, 'heavy');
  const body = JSON.stringify(spec.body);
  assert.doesNotMatch(body, /recipient_id/, 'that filter is silently ignored by this endpoint');
  assert.match(body, /recipient_search_text/);
  assert.equal(spec.body.filters.subawards, false);
  assert.equal(spec.body.limit, 40);
});

test('the spine asks for a decade, and never for a rolling window', async () => {
  let asked = null;
  const api = stubApi({
    obligationsByFiscalYear: async (args) => {
      asked = args;
      return { ok: true, years: [], points: testOverTimePoints(), claims: [] };
    },
  });
  const { app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();
  assert.equal(asked.spanYears, SPINE_YEARS);
  assert.equal(asked.fiscalYear, TEST_FISCAL_YEAR);
  assert.equal(typeof asked.fiscalYear, 'number');
});

test('A WAITING TILE SAYS THE SOURCE IS COLD, and there is no spinner anywhere on this page', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const api = stubApi({
    category: async (args) => {
      // The client fires onCold after three seconds of quiet. The stub fires it immediately, so
      // the behaviour is tested rather than the timer.
      if (args.onCold) args.onCold({ attempt: 1, elapsedMs: 3000 });
      await gate;
      return { ok: true, dimension: 'awarding_agency', rows: testAgencyRows(), hasNextPage: false };
    },
  });
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();

  const mix = doc.getElementById('panel-mix');
  assert.match(mix.textContent, /source is cold/);
  assert.match(mix.textContent, /tens of seconds/);
  assert.doesNotMatch(mix.textContent, /spinner|please wait/i);
  release();
  await settle();
  await settle();
  assert.match(doc.getElementById('panel-mix').textContent, /TEST DEPARTMENT ALPHA/);
});

test('the finished page carries all four chart forms, each with its own table', async () => {
  const { doc, app } = bootPage(stubApi());
  await app.search('test parent');
  await settle();
  await settle();

  const forms = doc.querySelectorAll('[data-chart-form]').map((n) => n.getAttribute('data-chart-form'));
  assert.ok(forms.includes('columns'), 'the fiscal year spine');
  assert.ok(forms.includes('split-bar'), 'the competition split');
  assert.ok(forms.includes('ranked-bars'), 'the agency mix and the largest contracts');
  assert.ok(forms.includes('curve'), 'the concentration curve');

  for (const fig of doc.querySelectorAll('[data-chart-form]')) {
    assert.ok(fig.querySelector('figcaption'), 'a chart shipped with no caption');
    assert.ok(fig.querySelector('table'), 'a chart shipped with no equivalent table');
    assert.ok(fig.querySelector('.chart-table-toggle'), 'a chart shipped with no visible toggle');
    assert.equal(fig.querySelectorAll('[tabindex]').length, 1);
  }
});

test('EVERY FIGURE ON THE FINISHED PAGE CARRIES A BADGE AND A UNIT KIND', async () => {
  const { doc, app } = bootPage(stubApi());
  await app.search('test parent');
  await settle();
  await settle();

  const badged = doc.querySelectorAll('[data-claim-badge]');
  assert.ok(badged.length > 20, 'the page should be full of badged figures, found ' + badged.length);
  for (const node of badged) {
    assert.ok(node.hasAttribute('data-unit-kind'), 'a badge with no unit kind');
    assert.ok(node.hasAttribute('data-claim-method'), 'a badge with no method');
    const kind = node.getAttribute('data-unit-kind');
    assert.ok(['obligations', 'awardValue', 'share', 'tally', 'none'].includes(kind),
      'an invented unit kind reached the page: ' + kind);
  }
  // And nothing on the page claims to be an estimate. The budget is zero.
  for (const node of badged) {
    assert.notEqual(node.getAttribute('data-claim-badge'), 'ESTIMATED');
  }
});

test('A SUGGESTION IS A NAME, and picking one still goes through resolution', async () => {
  const api = stubApi({
    typeahead: {
      suggest: async (text) => ({
        ok: true,
        source: 'live',
        suggestions: [
          { name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', needsResolution: true, source: 'live' },
          { name: 'TEST PARENT OTHER', uei: null, needsResolution: true, source: 'live' },
        ],
        asked: text,
      }),
    },
  });
  const { doc, app } = bootPage(api);
  await app.suggest('test par');
  const panel = doc.getElementById('panel-suggestions');
  assert.match(panel.textContent, /TEST PARENT ENTITY/);
  assert.doesNotMatch(panel.textContent, /\$/, 'a suggestion never carries a dollar figure');
  assert.match(panel.textContent, /a suggestion is a name rather than a decision/);

  panel.querySelectorAll('button')[0].dispatch('click');
  await settle();
  await settle();
  assert.equal(api.calls.startQuery, 1, 'picking a suggestion resolves it like a typed name');
  assert.equal(doc.getElementById('panel-suggestions').textContent, '',
    'the list clears once a choice is made');
});

test('a failed suggestion costs a convenience, never a panel', async () => {
  const api = stubApi({
    typeahead: {
      suggest: async () => ({ ok: false, failure: failure(UPSTREAM_ERROR, 'name suggestions') }),
    },
  });
  const { doc, app } = bootPage(api);
  await app.suggest('test');
  assert.equal(doc.getElementById('panel-suggestions').textContent, '');
});

test('typing is debounced rather than firing a request per keystroke', async () => {
  let asks = 0;
  const api = stubApi({
    typeahead: { suggest: async () => { asks += 1; return { ok: true, source: 'live', suggestions: [] }; } },
  });
  const { input } = bootPage(api);
  input.value = 'l';
  input.dispatch('input');
  input.value = 'lo';
  input.dispatch('input');
  input.value = 'loc';
  input.dispatch('input');
  assert.equal(asks, 0, 'nothing is asked while the reader is still typing');
  await new Promise((resolve) => setTimeout(resolve, SUGGEST_DEBOUNCE_MS + 30));
  assert.equal(asks, 1, 'one request for the burst, not one per keystroke');
});

/* ------------------------------------------------------------------------------------------ *
 * WAVE THREE, joined up. Everything below this line exercises a panel that existed but was not
 * mounted by the controller until the four work streams were joined.
 * ------------------------------------------------------------------------------------------ */

test('ALL FOUR CATEGORY DIMENSIONS ARE ASKED FOR, AND EACH ONE MOUNTS ITS OWN PANEL', async () => {
  const asked = [];
  const api = stubApi({
    category: async (args) => {
      asked.push(args.dimension);
      return { ok: true, dimension: args.dimension, rows: testAgencyRows(), hasNextPage: false };
    },
  });
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();

  assert.deepEqual(asked.sort(), ['awarding_agency', 'awarding_subagency', 'naics', 'psc']);
  for (const id of ['panel-mix', 'panel-mix-subagency', 'panel-mix-psc', 'panel-mix-naics']) {
    assert.match(doc.getElementById(id).textContent, /TEST DEPARTMENT ALPHA/,
      'no panel was mounted into ' + id);
  }
  // Each panel names its OWN dimension in the sentence above the bars. One shared noun across
  // four panels would have three of them describing a quantity they did not measure.
  assert.match(doc.getElementById('panel-mix').textContent, /one department/);
  assert.match(doc.getElementById('panel-mix-naics').textContent, /one industry classification/);
});

test('ONE CATEGORY DIMENSION FAILING COSTS THAT PANEL AND NOTHING ELSE', async () => {
  const api = stubApi({
    category: async (args) => (args.dimension === 'naics'
      ? { ok: false, failure: failure(UPSTREAM_ERROR, 'the industry code breakdown') }
      : { ok: true, dimension: args.dimension, rows: testAgencyRows(), hasNextPage: false }),
  });
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();
  assert.match(doc.getElementById('panel-mix-naics').textContent, /did not respond|Retry/i);
  assert.match(doc.getElementById('panel-mix').textContent, /TEST DEPARTMENT ALPHA/);
  assert.match(doc.getElementById('panel-mix-psc').textContent, /TEST DEPARTMENT ALPHA/);
});

test('THE SECOND DEFINITION IS PUBLISHED BESIDE THE FIRST, AS A SECOND NAMED FIGURE AND NEVER '
  + 'AS A RANGE', async () => {
  const api = stubApi();
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();

  const panel = doc.getElementById('panel-definition');
  assert.equal(api.calls.nameMatch, 1, 'the second definition was never fetched');
  assert.match(panel.textContent, /Two definitions of the company/);
  assert.match(panel.textContent, /AN ENTITY IN THE GAP/, 'the gap entities are not itemised');
  assert.doesNotMatch(panel.textContent, /range(?! would)/i,
    'the two definitions are presented as a band');
  // Every figure in it is badged, like every other figure on the page.
  assert.ok(panel.querySelectorAll('[data-claim-badge]').length >= 3);
});

test('THE SECOND DEFINITION FAILING COSTS ONE PANEL, and the parent figures stay where they are',
  async () => {
    const api = stubApi({
      nameMatchTotal: async () => ({ ok: false, failure: failure(UPSTREAM_ERROR, 'the name match total') }),
    });
    // Half a comparison is not a comparison, so the panel refuses rather than substituting a
    // figure from a different award type set into the slot the missing one left.
    const { doc, app } = bootPage(api);
    await app.search('test parent');
    await settle();
    await settle();
    assert.match(doc.getElementById('panel-definition').textContent, /Retry|did not respond/i);
    assert.match(doc.getElementById('panel-subject').textContent, /TEST PARENT ENTITY/);
  });

test('THE THIRD ROLLUP ARM IS ASKED FOR, and a third arm that did not arrive leaves the two arm '
  + 'panel exactly where it was', async () => {
  const api = stubApi();
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();
  assert.equal(api.calls.threeWay, 1, 'the third arm was never requested');
  assert.ok(doc.getElementById('panel-rollup').textContent.length > 0,
    'the rollup panel was blanked by a third arm that did not arrive');
});

test('THE BUNDLED INDEX IS LOADED AFTER FIRST PAINT, and a bundled suggestion goes straight to '
  + 'the record it names', async () => {
  const api = stubApi();
  const doc = createDocument(REGION_IDS);
  const form = doc.createElement('form');
  form.setAttribute('id', 'search-form');
  const input = doc.createElement('input');
  input.setAttribute('id', 'q');
  doc.body.appendChild(form);
  doc.body.appendChild(input);

  const bundle = '{"v":1,"rows":[["TESTPARENT01","TEST PARENT ENTITY"]]}';
  const app = boot(doc, {
    api,
    now: () => new Date(Date.UTC(2026, 8, 22)),
    loadIndexText: async () => bundle,
  });
  await app.loadIndex();
  assert.equal(api.typeahead.hasIndex, true, 'the bundle never reached the typeahead');

  const picked = await api.typeahead.suggest('test parent');
  assert.equal(picked.source, 'bundled');
  assert.equal(picked.suggestions[0].uei, 'TESTPARENT01');
  assert.equal(picked.suggestions[0].needsResolution, false);

  await app.search('TEST PARENT ENTITY', 'TESTPARENT01');
  await settle();
  assert.equal(api.calls.startQueryForUei, 1,
    'a bundled hit went the long way round even though it carried an identifier');
  assert.equal(api.calls.startQuery, 1, 'the identifier path still resolves through the list');
});

test('A PAGE WITH NO BUNDLE STILL WORKS, because the bundle is speed and the live endpoint is '
  + 'coverage', async () => {
  const api = stubApi();
  const doc = createDocument(REGION_IDS);
  const app = boot(doc, {
    api,
    now: () => new Date(Date.UTC(2026, 8, 22)),
    loadIndexText: async () => { throw new Error('404'); },
  });
  await app.loadIndex();
  await app.search('test parent');
  await settle();
  assert.match(doc.getElementById('panel-subject').textContent, /TEST PARENT ENTITY/);
});

test('THE SECOND DEFINITION IS DIFFERENCED AGAINST A COMPARABLE DENOMINATOR, not against the '
  + 'parent profile total, which covers every award type and would move the gap', async () => {
  const asked = [];
  const api = stubApi({
    entityBreakdown: async (args) => {
      asked.push(args);
      return {
        ok: true,
        rows: [{ name: 'TEST PARENT ENTITY', uei: 'TESTPARENT01', amount: 900, code: null, id: null }],
        total: 900,
      };
    },
  });
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();

  assert.equal(asked.length, 1, 'the comparable denominator was never fetched');
  assert.equal(asked[0].awardTypeSetId, 'contracts',
    'the denominator was taken on a different award type set from the figure beside it');
  assert.equal(asked[0].fiscalYear, TEST_FISCAL_YEAR);

  // The stub's profile total is 1,000 and its breakdown total is 900, on purpose. A panel that
  // reached for the profile would print 1,000 as definition one and a gap of 150 rather than
  // 250, and both of those numbers would look perfectly plausible on screen.
  const text = doc.getElementById('panel-definition').textContent;
  assert.match(text, /\$900\.00 obligated/, 'definition one is not the entity breakdown total');
  assert.match(text, /\$250\.00 obligated/, 'the gap was computed against the wrong denominator');
  assert.doesNotMatch(text, /\$1,000\.00 obligated/, 'the parent profile total reached this panel');
});

test('a second definition with only ONE of its two arms refuses, because half a comparison is '
  + 'not a comparison', async () => {
  const api = stubApi({
    entityBreakdown: async () => ({ ok: false, failure: failure(UPSTREAM_ERROR, 'the entity breakdown') }),
  });
  const { doc, app } = bootPage(api);
  await app.search('test parent');
  await settle();
  await settle();
  const text = doc.getElementById('panel-definition').textContent;
  assert.match(text, /Retry|did not respond/i);
  assert.doesNotMatch(text, /Two definitions of the company/);
});
