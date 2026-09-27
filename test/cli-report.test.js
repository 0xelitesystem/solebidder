// THE REPORT, END TO END, WITH NO NETWORK.
//
// Every test here runs the real command line over the real api facade, the real client, and the
// command line's own fetch wrapper, and replaces only what sits under that wrapper: a transport
// that answers from the recorded fixtures and from clearly synthetic award rows. What is asserted
// is what a reader receives: the exit code, the text, the JSON document, and the requests made.

import test from 'node:test';
import assert from 'node:assert/strict';

import { EXIT } from '../src/cli/main.js';
import { COPY, NOTICES, ATTRIBUTION, INDEPENDENCE, SCHEMA, requestPlan } from '../src/cli/copy.js';
import { ADVICE_DISCLAIMER, COLD_SOURCE_NOTICE } from '../src/core/constants.js';
import { NEVER_CLAIMED_ITEMS } from '../src/core/never-claimed.js';
import { SOURCE_AS_OF_UNAVAILABLE } from '../src/api/source-date.js';
import { createApi } from '../src/api/api.js';
import { createClient } from '../src/query/client.js';
import { gatherReport } from '../src/cli/report.js';
import { reportBlocks } from '../src/cli/render.js';
import { layout } from '../src/cli/out.js';
import {
  runCli, healthyRoutes, scripted, recorded, syntheticAwardSearch, syntheticCategory, PARENT_UEI,
  cliTransport,
} from './helpers/cli-harness.js';

/** A character from its code point. Nothing above the ASCII range is written raw in this file. */
const u = (...points) => String.fromCodePoint(...points);

const ESC = '\u001b';
const UEI_ARGS = ['lockheed', 'martin', '--uei', PARENT_UEI];

/** Every character a terminal could act on, or that could hide or reorder text. */
function unsafeIn(text) {
  return [...text].filter((c) => {
    const n = c.codePointAt(0);
    return (n < 0x20 && n !== 0x0a) || (n >= 0x7f && n <= 0x9f) || n === 0x061c
      || (n >= 0x200b && n <= 0x200f) || (n >= 0x202a && n <= 0x202e) || (n >= 0x2060 && n <= 0x2069)
      || n === 0xfeff || n === 0x2028 || n === 0x2029;
  });
}

/* --------------------------------------------------------------------------------------------
 * The refusal, which is the product's most important answer.
 * ------------------------------------------------------------------------------------------ */

test('MORE THAN ONE PARENT RECORD: the refusal sentence, every parent name with its UEI, no amount, exit three', async () => {
  const r = await runCli(['lockheed', 'martin']);
  assert.equal(r.code, EXIT.CHOICE_REQUIRED);
  assert.match(r.stdout.replace(/\s+/g, ' '), /No single parent record exists for "lockheed martin" in this dataset\. More than one parent level record matches\./);
  const list = recorded('recipient-list-lockheed.json').results.filter((row) => row.recipient_level === 'P');
  assert.equal(list.length, 16);
  for (const row of list) assert.ok(r.stdout.includes(row.name + ', UEI ' + row.uei), row.uei);
  assert.ok(!r.stdout.includes('$'), 'no amount of any kind reaches the chooser');
  assert.ok(!/obligated|percent/.test(r.stdout));
  assert.ok(r.stdout.includes(COPY.pickWithUei.slice(0, 40)));
  assert.ok(r.stdout.includes(NEVER_CLAIMED_ITEMS.find((i) => i.id === 'not-everything-a-company-gets').sentence.slice(0, 50)));
  assert.equal(r.transport.calls.length, requestPlan().refusal, 'the date and the list, nothing more');
  assert.deepEqual(r.transport.calls.map((c) => c.method + ' ' + c.path),
    ['GET /api/v2/awards/last_updated/', 'POST /api/v2/recipient/']);
});

/**
 * The prose left once every badged figure and every twelve character identifier is taken out.
 * @param {string} text
 * @returns {string}
 */
const unbadged = (text) => text.replace(/\s+/g, ' ')
  .replace(/[0-9][0-9,.]*(?: [a-z]+)+ \[(?:REPORTED|COMPUTED)\]/g, '')
  .replace(/\b[A-Z0-9]{12}\b/g, '');

/**
 * One passage of the output, from its first words to the words that end it, on one line.
 * @param {string} out @param {string} start @param {string} end
 * @returns {string}
 */
function passage(out, start, end) {
  const flat = out.replace(/\s+/g, ' ');
  const i = flat.indexOf(start);
  const j = flat.indexOf(end, i);
  assert.ok(i >= 0 && j > i, 'no passage from ' + start + ' to ' + end);
  return flat.slice(i, j + end.length);
}

test('THE REFUSAL AND THE SUBJECT SENTENCE print no count outside a badged figure', async () => {
  const refusal = await runCli(['lockheed', 'martin']);
  const statement = passage(refusal.stdout, 'No single parent record exists for "', 'deliberately.');
  assert.ok(!/[0-9]/.test(unbadged(statement)), statement);

  const report = await runCli([...UEI_ARGS, '--fy', '2025']);
  const children = recorded('recipient-children-fy2025.json').length;
  const sentence = passage(report.stdout, ', parent UEI ' + PARENT_UEI, 'not SEC consolidation.');
  assert.ok(sentence.includes('summed with ' + children + ' registered child entities [REPORTED] for the '
    + 'fiscal year selected.'), sentence);
  assert.ok(!/[0-9]/.test(unbadged(sentence)), sentence);

  // In JSON the count is a badged figure with the sentence around it, and no string carries it bare.
  const doc = JSON.parse((await runCli([...UEI_ARGS, '--fy', '2025', '--json'])).stdout);
  const figure = doc.sections.find((sec) => sec.id === 'subject').items[0];
  assert.equal(figure.id, 'subjectChildren');
  assert.equal(figure.badge, 'REPORTED');
  assert.equal(figure.unit, 'tally');
  assert.equal(figure.value, children);
  assert.ok(!/[0-9]/.test(figure.sentence.tail + figure.sentence.lead.replace(PARENT_UEI, '')));
  assert.ok(!('subjectSentence' in doc.identity));
  const refused = JSON.parse((await runCli(['lockheed', 'martin', '--json'])).stdout);
  for (const item of refused.sections.flatMap((sec) => sec.items)) {
    if (item.type === 'text') assert.ok(!/[0-9]/.test(item.text), item.text);
  }
});

test('a rollup that came back short badges both counts: the children that arrived and the number expected', async () => {
  const transport = cliTransport();
  const api = createApi({ client: createClient({ fetch: transport.fetch, sleep: async () => {} }) });
  const short = {
    ...api,
    loadSubject: async (args) => {
      const s = await api.loadSubject(args);
      return { ...s, identity: { ...s.identity, childrenExpected: s.identity.childCount + 3, rollupComplete: false } };
    },
  };
  const report = await gatherReport({
    api: short, text: 'lockheed martin', fiscalYear: 2025, fyChosen: 'flag', latestFiscalYear: 2026,
    awardTypeSetId: 'contracts', uei: PARENT_UEI, signal: new AbortController().signal,
  });
  const out = layout(reportBlocks(report), { width: 80, colour: false });
  const flat = out.replace(/\s+/g, ' ');
  const children = recorded('recipient-children-fy2025.json').length;
  const sentence = passage(out, ', parent UEI ' + PARENT_UEI, 'not SEC consolidation.');
  assert.ok(sentence.includes(children + ' registered child entities [REPORTED] that arrived'), sentence);
  assert.ok(!/[0-9]/.test(unbadged(sentence)), sentence);
  assert.ok(flat.includes(': ' + (children + 3) + ' expected registered child entities [REPORTED]'), flat.slice(0, 600));
  assert.ok(flat.includes(COPY.rollupIncomplete));
});

test('the refusal as JSON names every record and carries no figure', async () => {
  const r = await runCli(['lockheed', 'martin', '--json']);
  assert.equal(r.code, EXIT.CHOICE_REQUIRED);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.schema, SCHEMA);
  assert.equal(doc.outcome, 'choice-required');
  assert.equal(doc.exitCode, 3);
  assert.equal(doc.records.length, 16);
  assert.ok(doc.records.every((x) => /^[A-Z0-9]{12}$/.test(x.uei) && typeof x.name === 'string'));
  assert.ok(!/"value"/.test(r.stdout), 'no figure in a refusal');
  assert.equal(doc.identity, null);
});

test('--uei chooses one record, is recorded as a choice made with the option, and lower case is accepted', async () => {
  const r = await runCli(['lockheed', 'martin', '--uei', PARENT_UEI.toLowerCase(), '--json']);
  assert.equal(r.code, EXIT.DONE);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.identity.uei, PARENT_UEI);
  assert.equal(doc.identity.chosenHow, 'picked-by-flag');
  assert.ok(doc.identity.choiceSentence.includes('with the --uei option'));
});

test('a --uei that is not one of the parent records lists the ones that are and exits three', async () => {
  const r = await runCli(['lockheed', 'martin', '--uei', 'G4KDGE4JFFK7']);
  assert.equal(r.code, EXIT.CHOICE_REQUIRED);
  assert.ok(r.stdout.includes(COPY.ueiNotFound('G4KDGE4JFFK7').slice(0, 60)));
  assert.ok(r.stdout.includes('LOCKHEED MARTIN CORP, UEI ' + PARENT_UEI));
  assert.equal(r.transport.calls.length, 2);
});

test('a name that matches nothing says so in words and exits one', async () => {
  const routes = healthyRoutes();
  routes['POST /api/v2/recipient/'] = { results: [], page_metadata: { hasNext: false } };
  const r = await runCli(['nobody', 'at', 'all', '--json'], { routes });
  assert.equal(r.code, EXIT.FAILURE);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.outcome, 'no-records');
  assert.match(JSON.stringify(doc.sections), /No parent level record matches \\"nobody at all\\"/);
});

test('a name with exactly one parent record resolves without --uei and says which', async () => {
  const routes = healthyRoutes();
  const list = recorded('recipient-list-lockheed.json');
  list.results = list.results.filter((row) => row.uei === PARENT_UEI);
  routes['POST /api/v2/recipient/'] = list;
  const r = await runCli(['lockheed', 'martin'], { routes });
  assert.equal(r.code, EXIT.DONE);
  assert.match(r.stdout.replace(/\s+/g, ' '), /One parent level record matches "lockheed martin": LOCKHEED MARTIN CORP, UEI ZFN2JJXBLZT3\./);
});

/* --------------------------------------------------------------------------------------------
 * The report.
 * ------------------------------------------------------------------------------------------ */

test('THE REPORT: the as of date first, the breakdown once, the award count never, one host, the wrapper on every request', async () => {
  const r = await runCli(UEI_ARGS);
  assert.equal(r.code, EXIT.DONE, r.stderr);
  const t = r.transport;
  assert.deepEqual(t.unrouted, []);
  assert.equal(t.calls[0].path, '/api/v2/awards/last_updated/', 'the date is asked for before anything else');
  assert.equal(t.countFor('GET /api/v2/awards/last_updated/'), 1);
  const recipientCategory = t.calls.filter((c) => c.path === '/api/v2/search/spending_by_category/recipient/');
  assert.equal(recipientCategory.length, 2, 'the entity breakdown once and the name match once');
  assert.equal(recipientCategory.filter((c) => 'recipient_id' in c.body.filters).length, 1);
  assert.equal(recipientCategory.filter((c) => 'recipient_search_text' in c.body.filters).length, 1);
  assert.equal(t.countFor('POST /api/v2/search/spending_by_award_count/'), 0,
    'the award count endpoint ignores the recipient filter, so it is never asked');
  for (const c of t.calls) {
    assert.ok(c.url.startsWith('https://api.usaspending.gov/'), c.url);
    assert.equal(c.redirect, 'error', 'every request refuses redirects');
    assert.match(c.headers.get('user-agent'), /^solebidder\/[0-9]+\.[0-9]+\.[0-9]+ \(\+https:\/\/github\.com\/0xelitesystem\/solebidder\)$/);
    if (c.body && c.body.filters) {
      assert.equal(c.body.filters.subawards, false);
      assert.ok(!('recipient_id' in c.body.filters) || c.path.includes('spending_by_category')
        || c.path.includes('spending_over_time'), 'the award search never carries a recipient id');
    }
  }
  assert.equal(t.calls.filter((c) => c.path.startsWith('/api/v2/awards/SYNTH_GID_')).length, 3,
    'one competition record per kept award, none for the dropped row');
  assert.ok(t.calls.length <= requestPlan().report);
});

test('THE REPORT TEXT: the recorded figures, badged, beside their NEVER CLAIMED statements, with the footer', async () => {
  const r = await runCli(UEI_ARGS);
  const out = r.stdout;
  const flat = out.replace(/\s+/g, ' ');
  // Figures a committed fixture recomputes.
  assert.ok(out.includes('$65,405,410,468.25 obligated [REPORTED]'), 'the parent total');
  assert.ok(out.includes('$65,405,410,468.26 obligated [COMPUTED]'), 'the child rollup');
  assert.ok(out.includes('$0.01 obligated [COMPUTED]'), 'the published cent');
  assert.ok(out.includes('217 registered child entities [REPORTED]'));
  assert.ok(out.includes('98.8 percent [COMPUTED]'), 'the agency share the concentration test recomputes');
  assert.ok(out.includes('That one buyer is Department of Defense.'));
  // The year over year change the page does not print.
  assert.match(flat, /Change from FY2024, an increase: \$33,067,927,322\.99 obligated \[COMPUTED\]/);
  assert.match(flat, /The same change as a share of FY2016: 14\.4 percent \[COMPUTED\]/);
  // The sole bidder share over the synthetic rows, with the dropped row counted.
  assert.ok(out.includes('1 dropped award row [COMPUTED]'));
  assert.ok(out.includes('3 arrived competition records [COMPUTED]'));
  assert.ok(flat.includes('52.9 percent [COMPUTED] was awarded with exactly one bidder'));
  // Every placement the page makes, printed from the registry.
  for (const id of ['obligations-are-not-revenue', 'parent-tree-self-reported', 'award-value-is-lifetime',
    'no-losing-bidders', 'classified-gap-unmeasurable', 'subawards-excluded', 'not-outlays', 'floor-2008',
    'not-everything-a-company-gets', 'no-financial-denominators']) {
    const sentence = NEVER_CLAIMED_ITEMS.find((i) => i.id === id).sentence;
    assert.ok(flat.includes(sentence.replace(/\s+/g, ' ') + ' [NEVER CLAIMED]'), id);
  }
  // Provenance names the source date on every figure.
  assert.ok((out.match(/Source as of 09\/21\/2026\./g) || []).length >= 10);
  assert.ok(!out.includes('Source as of date unavailable'));
  // The footer.
  for (const line of [ATTRIBUTION, INDEPENDENCE, ADVICE_DISCLAIMER, COPY.asOf('09/21/2026'), COPY.claimsPointer]) {
    assert.ok(flat.includes(line), 'footer is missing: ' + line);
  }
  assert.ok(flat.includes(COPY.fiscalYearDefault(2025)));
  assert.ok(flat.includes(COPY.choiceByFlag('LOCKHEED MARTIN CORP', PARENT_UEI)));
  assert.ok(flat.includes('https://www.usaspending.gov/award/SYNTH_GID_1'), 'a receipt is printed as a plain link');
  assert.ok(!out.includes(ESC), 'no styling on a pipe');
  assert.deepEqual(unsafeIn(out + r.stderr), []);
});

test('progress goes to standard error as discrete lines, never to the report', async () => {
  const r = await runCli(UEI_ARGS);
  const lines = r.stderr.trim().split('\n');
  assert.ok(lines.length >= 4 && lines.length <= 8, r.stderr);
  assert.ok(r.stderr.startsWith('Asking USAspending for the date'));
  assert.ok(!r.stdout.includes('Asking USAspending'));
  assert.ok(!r.stderr.includes(COLD_SOURCE_NOTICE), 'the cold notice waits three seconds and this run took less');
});

test('--fy is the one period of every request, and a chosen current year says it is partial', async () => {
  const r = await runCli([...UEI_ARGS, '--fy', '2026', '--json']);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.query.fiscalYear, 2026);
  assert.equal(doc.query.fiscalYearChosen, 'flag');
  for (const c of r.transport.calls) {
    if (c.path.includes('/recipient/') && c.method === 'GET') assert.match(c.url, /year=2026/);
    if (c.body && c.body.filters && c.body.filters.time_period && !c.path.includes('spending_over_time')) {
      assert.deepEqual(c.body.filters.time_period, [{ start_date: '2025-10-01', end_date: '2026-09-30' }]);
    }
  }
  const text = await runCli([...UEI_ARGS, '--fy', '2026']);
  assert.ok(text.stdout.replace(/\s+/g, ' ').includes(COPY.fiscalYearChosen(2026, true)));
});

/* --------------------------------------------------------------------------------------------
 * JSON.
 * ------------------------------------------------------------------------------------------ */

/**
 * Visit every value in a JSON document with its key and its parent.
 * @param {any} node
 * @param {(value:any, key:string, parent:any) => void} visit
 */
function walk(node, visit) {
  if (Array.isArray(node)) node.forEach((v, i) => { visit(v, String(i), node); walk(v, visit); });
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) { visit(v, k, node); walk(v, visit); }
  }
}

test('JSON: one document, schema solebidder.cli/1, every figure an object with its badge, and no bare number anywhere', async () => {
  const r = await runCli([...UEI_ARGS, '--json']);
  assert.equal(r.code, EXIT.DONE);
  const doc = JSON.parse(r.stdout);
  assert.equal(doc.schema, 'solebidder.cli/1');
  assert.equal(doc.tool.name, 'solebidder');
  assert.equal(doc.outcome, 'report');
  assert.equal(doc.exitCode, 0);
  assert.equal(doc.source.host, 'https://api.usaspending.gov');
  assert.equal(doc.source.asOf, '09/21/2026');
  assert.equal(doc.attribution, ATTRIBUTION);
  assert.equal(doc.independence, INDEPENDENCE);
  assert.equal(doc.disclaimer, ADVICE_DISCLAIMER);
  assert.match(doc.privacy, /User-Agent: solebidder\//);
  assert.deepEqual(doc.query.awardTypeSet, { id: 'contracts', label: 'Contracts only', codes: ['A', 'B', 'C', 'D'] });
  assert.deepEqual(doc.neverClaimed.map((n) => n.sentence), NEVER_CLAIMED_ITEMS.map((i) => i.sentence));

  let figures = 0;
  const ALLOWED_NUMBER_KEYS = new Set(['fiscalYear', 'exitCode', 'rank']);
  walk(doc, (value, key, parent) => {
    assert.notEqual(key.toLowerCase(), 'duns');
    assert.notEqual(key, 'code', 'the legacy vendor identifier travels as code on one endpoint and is never emitted');
    if (typeof value === 'number') {
      if (key === 'value') {
        assert.ok(typeof parent.badge === 'string' && typeof parent.unit === 'string'
          && typeof parent.method === 'string' && typeof parent.text === 'string',
        'a number with no badge, unit, method and text beside it: ' + JSON.stringify(parent).slice(0, 120));
      } else {
        assert.ok(ALLOWED_NUMBER_KEYS.has(key) && !Array.isArray(parent), 'a bare number at ' + key + ': ' + value);
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && 'badge' in value && value.badge !== 'NEVER_CLAIMED') {
      figures += 1;
      assert.equal(typeof value.value, 'number', JSON.stringify(value).slice(0, 120));
      assert.ok(['REPORTED', 'COMPUTED'].includes(value.badge), 'no estimate reaches the document');
      assert.ok(value.text.endsWith(' [' + value.badge + ']'));
      assert.equal(typeof value.provenance, 'string');
      // The value is the figure at the precision the text shows.
      if (value.unit === 'obligations' || value.unit === 'awardValue') {
        const digits = value.text.replace(/ .*$/, '').replace(/[^0-9.-]/g, '');
        assert.equal(value.value, Number(digits), value.text);
      }
      if (value.unit === 'share') {
        const percent = Number(value.text.split(' ')[0]);
        assert.ok(Math.abs(value.value * 100 - percent) < 1e-9, value.text);
        assert.ok(value.value >= 0 && value.value <= 1);
      }
    }
    if (value && typeof value === 'object' && value.type === 'unavailable') {
      assert.equal(typeof value.reason, 'string');
      assert.ok(!('value' in value), 'a suppressed figure is an absent value with a reason');
    }
    if (value && typeof value === 'object' && value.type === 'failure') {
      assert.equal(typeof value.kind, 'string');
      assert.equal(typeof value.reason, 'string');
    }
  });
  assert.ok(figures > 250, 'every figure travels, including all the rows the text abbreviates: ' + figures);
  const agency = doc.sections.find((s) => s.id === 'buyers').items.find((i) => i.id === 'awarding_agency.topShare');
  assert.equal(agency.value, 0.988);
  assert.equal(agency.unit, 'share');
  const residual = doc.sections.find((s) => s.id === 'reconciliation').items.find((i) => i.id === 'children-minus-parent');
  assert.equal(residual.value, 0.01);
  const years = doc.sections.find((s) => s.id === 'spine').items.filter((i) => i.type === 'year');
  assert.equal(years.length, 10);
  assert.equal(years[9].change.delta.value, 33067927322.99);
  assert.equal(years[9].change.available, false);
  assert.ok(!('share' in years[9].change));
  assert.equal(typeof years[9].change.reason, 'string');
  const awards = doc.sections.find((s) => s.id === 'competition').items.find((i) => i.type === 'awards');
  assert.ok(awards.rows.every((row) => row.offers || row.offersUnavailable), 'offers are a figure or a reason, never a null');
});

/* --------------------------------------------------------------------------------------------
 * Plain, colour and width.
 * ------------------------------------------------------------------------------------------ */

test('--plain: one complete sentence per figure, linear, with the badge as a word and no layout indent', async () => {
  const r = await runCli([...UEI_ARGS, '--plain']);
  assert.equal(r.code, EXIT.DONE);
  const out = r.stdout;
  assert.ok(!/\[(REPORTED|COMPUTED|NEVER CLAIMED)\]/.test(out), 'plain sentences carry the badge as a word, not a bracket');
  assert.ok(out.replace(/\s+/g, ' ').includes('Recorded against this parent identifier family: $65,405,410,468.25 obligated, REPORTED.'));
  assert.ok(out.includes('NEVER CLAIMED: These are obligations, not revenue.'));
  for (const line of out.split('\n')) assert.ok(!line.startsWith(' '), 'plain output is not indented: ' + JSON.stringify(line));
  assert.ok(!out.includes(ESC));
});

test('colour is decoration: bold only on a terminal, and never with NO_COLOR, --json or --plain; FORCE_COLOR turns it on for a pipe', async () => {
  const tty = await runCli(['lockheed', 'martin'], { stdout: { isTTY: true, columns: 100 } });
  assert.ok(tty.stdout.includes(ESC + '[1m'), 'a terminal gets bold headings');
  assert.deepEqual(tty.stdout.match(/\u001b\[[0-9;]*m/g).filter((s) => s !== ESC + '[1m' && s !== ESC + '[22m'), []);
  assert.ok(tty.stdout.includes('[' + ESC + '[1mNEVER CLAIMED' + ESC + '[22m]'), 'the badge word is printed whole, styled or not');
  const noColor = await runCli(['lockheed', 'martin'], { stdout: { isTTY: true }, env: { NO_COLOR: '1' } });
  assert.ok(!noColor.stdout.includes(ESC));
  const flag = await runCli(['lockheed', 'martin', '--no-color'], { stdout: { isTTY: true } });
  assert.ok(!flag.stdout.includes(ESC));
  const pipe = await runCli(['lockheed', 'martin']);
  assert.ok(!pipe.stdout.includes(ESC), 'a pipe gets no escape codes');
  const forced = await runCli(['lockheed', 'martin'], { env: { FORCE_COLOR: '1' } });
  assert.ok(forced.stdout.includes(ESC + '[1m'));
  const forcedButNo = await runCli(['lockheed', 'martin'], { env: { FORCE_COLOR: '1', NO_COLOR: 'x' } });
  assert.ok(!forcedButNo.stdout.includes(ESC));
  for (const f of ['--json', '--csv', '--plain']) {
    const machine = await runCli(['lockheed', 'martin', f], { stdout: { isTTY: true }, env: { FORCE_COLOR: '1' } });
    assert.ok(!machine.stdout.includes(ESC), f);
  }
  assert.ok(!tty.stderr.includes(ESC), 'standard error is never styled');
});

test('COLUMNS=40: every line fits unless it is one unbreakable figure, and no figure is split across lines', async () => {
  const json = JSON.parse((await runCli([...UEI_ARGS, '--json'])).stdout);
  /** @type {string[]} */
  const texts = [];
  walk(json, (v, k) => { if (k === 'text' && typeof v === 'string' && / \[(REPORTED|COMPUTED)\]$/.test(v)) texts.push(v); });
  const r = await runCli(UEI_ARGS, { env: { COLUMNS: '40' } });
  const lines = r.stdout.split('\n');
  const flat = r.stdout.replace(/\s+/g, ' ');
  let checked = 0;
  for (const t of new Set(texts)) {
    if (!flat.includes(t)) continue;
    checked += 1;
    assert.ok(lines.some((l) => l.includes(t)), 'split across lines at forty columns: ' + t);
  }
  assert.ok(checked > 100, 'figures checked: ' + checked);
  for (const l of lines) {
    if (l.length > 40) {
      assert.ok(/\[(REPORTED|COMPUTED|NEVER CLAIMED)\]/.test(l) || !/\S\s+\S/.test(l.trim()),
        'too wide, and neither a figure nor one unbreakable word: ' + JSON.stringify(l));
    }
  }
});

/* --------------------------------------------------------------------------------------------
 * Each part fails on its own.
 * ------------------------------------------------------------------------------------------ */

test('a failed award search costs the competition split and the concentration view, nothing else, and exits one', async () => {
  const routes = healthyRoutes();
  routes['POST /api/v2/search/spending_by_award/'] = scripted({ status: 500 });
  const r = await runCli([...UEI_ARGS, '--json'], { routes });
  assert.equal(r.code, EXIT.FAILURE);
  const doc = JSON.parse(r.stdout);
  const comp = doc.sections.find((s) => s.id === 'competition').items;
  assert.equal(comp[0].type, 'failure');
  assert.equal(comp[0].kind, 'UPSTREAM_ERROR');
  assert.equal(comp[0].retryable, true);
  assert.equal(r.transport.countFor('POST /api/v2/search/spending_by_award/'), 4, 'the retry policy is unchanged');
  assert.ok(doc.sections.find((s) => s.id === 'concentration').items.some((i) => i.type === 'text'));
  assert.ok(doc.sections.find((s) => s.id === 'parent').items.some((i) => i.type === 'figure'), 'the parent total still stands');
  assert.ok(doc.sections.find((s) => s.id === 'buyers').items.some((i) => i.id === 'awarding_agency.topShare'));
  const text = await runCli(UEI_ARGS, { routes });
  assert.ok(text.stdout.includes(COPY.missing));
  assert.ok(text.stdout.includes(COPY.retryable.slice(0, 30)));
});

test('an award set emptied by the entity filter is a failure with its dropped tally, and offers no retry', async () => {
  const routes = healthyRoutes();
  routes['POST /api/v2/search/spending_by_award/'] = syntheticAwardSearch({ name: () => 'SYNTHETIC SOMEBODY ELSE' });
  const r = await runCli(UEI_ARGS, { routes });
  assert.equal(r.code, EXIT.FAILURE);
  assert.ok(r.stdout.includes('4 dropped award rows [COMPUTED]'));
  assert.ok(r.stdout.replace(/\s+/g, ' ').includes('0 of 4 expected parts arrived.'));
  const comp = r.stdout.slice(r.stdout.indexOf('Awarded with exactly one bidder'), r.stdout.indexOf('Who the money came from'));
  assert.ok(comp.includes(COPY.notRetryable));
  assert.ok(!comp.includes(COPY.retryable));
  assert.equal(r.transport.calls.filter((c) => c.path.startsWith('/api/v2/awards/SYNTH')).length, 0);
  const json = JSON.parse((await runCli([...UEI_ARGS, '--json'], { routes })).stdout);
  const failure = json.sections.find((s) => s.id === 'competition').items.find((i) => i.type === 'failure');
  assert.equal(failure.retryable, false);
});

test('a rejected category request says retrying will not help, and the other three dimensions still print', async () => {
  const routes = healthyRoutes();
  routes['POST /api/v2/search/spending_by_category/naics/'] = scripted({ status: 404 });
  const r = await runCli([...UEI_ARGS, '--json'], { routes });
  assert.equal(r.code, EXIT.FAILURE);
  const buyers = JSON.parse(r.stdout).sections.find((s) => s.id === 'buyers').items;
  const failure = buyers.find((i) => i.type === 'failure');
  assert.equal(failure.kind, 'BAD_REQUEST');
  assert.equal(failure.retryable, false);
  for (const d of ['awarding_agency', 'awarding_subagency', 'psc']) assert.ok(buyers.some((i) => i.id === d + '.topShare'), d);
  assert.equal(r.transport.countFor('POST /api/v2/search/spending_by_category/naics/'), 1);
});

test('when the as of date does not answer, no date is asserted anywhere and every figure still prints', async () => {
  for (const answer of [scripted({ status: 500 }), { last_updated: '2026-09-21' }, { last_updated: '09/21/2026' + ESC + '[2J' }]) {
    const routes = healthyRoutes();
    routes['GET /api/v2/awards/last_updated/'] = answer;
    const r = await runCli(UEI_ARGS, { routes });
    assert.equal(r.code, EXIT.DONE);
    assert.ok(r.stdout.includes('Source as of date unavailable.'));
    assert.ok(!/Source as of [0-9]/.test(r.stdout), 'a date that did not arrive in its own shape is not printed');
    assert.ok(r.stdout.replace(/\s+/g, ' ').includes(SOURCE_AS_OF_UNAVAILABLE));
    assert.ok(r.stdout.includes('$65,405,410,468.25 obligated [REPORTED]'));
  }
});

test('a redirect or a body that is not JSON is refused in words on standard error, once, and is not retried', async () => {
  const routes = healthyRoutes();
  routes['POST /api/v2/search/spending_by_category/naics/'] = scripted({ status: 302, headers: { location: 'https://example.invalid/' } });
  routes['POST /api/v2/search/spending_by_category/psc/'] = scripted({ headers: { 'content-type': 'text/html' }, raw: '<html></html>' });
  routes['POST /api/v2/search/spending_by_category/awarding_subagency/'] = scripted({ headers: { 'content-type': 'text/html' }, raw: '<p>' });
  const r = await runCli(UEI_ARGS, { routes });
  assert.equal(r.code, EXIT.FAILURE);
  assert.equal(r.stderr.split(NOTICES.refusal.redirect.slice(0, 40)).length - 1, 1);
  assert.equal(r.stderr.replace(/\s+/g, ' ').split(NOTICES.refusal['content-type']).length - 1, 1, 'said once, not per request');
  assert.equal(r.transport.countFor('POST /api/v2/search/spending_by_category/naics/'), 1);
  assert.equal(r.transport.countFor('POST /api/v2/search/spending_by_category/psc/'), 1);
});

/* --------------------------------------------------------------------------------------------
 * Terminal injection through every field the source controls.
 * ------------------------------------------------------------------------------------------ */

test('TERMINAL INJECTION: a recipient, agency and competition text carrying ESC[2J, OSC 8, OSC 52, CSI, U+202E and U+2066 prints inert, and real names survive', async () => {
  const hostileName = 'SIKORSKY ' + ESC + '[2J' + ESC + ']8;;https://example.invalid' + ESC + '\\LINK'
    + ESC + ']8;;' + ESC + '\\ \u009b31m' + u(0x202e) + 'EKAF' + u(0x2066) + ' CO\u007f';
  const accented = 'SOCI' + u(0xc9) + 'T' + u(0xc9) + ' D' + u(0x2019) + u(0xc9) + 'TUDES ' + u(0x201c) + 'A' + u(0x201d);
  const routes = healthyRoutes();
  const children = recorded('recipient-children-fy2025.json');
  children[0].name = hostileName;
  children[1].name = accented;
  routes['GET /api/v2/recipient/children/'] = children;
  routes['POST /api/v2/search/spending_by_award/'] = syntheticAwardSearch({ name: (i) => (i === 1 ? hostileName : 'LOCKHEED MARTIN CORP') });
  const agency = recorded('category-awarding-agency-fy2025.json');
  agency.results[0].name = 'Department of ' + ESC + ']52;c;cm0gLXJmIH4=\u0007Defense' + u(0x202e);
  routes['POST /api/v2/search/spending_by_category/awarding_agency/'] = agency;
  routes['GET /api/v2/awards/'] = (url) => {
    const d = { generated_unique_award_id: 'SYNTH_GID_2', piid: 'SYNTH-AWARD-2' + ESC + '[1A', latest_transaction_contract_data: {
      extent_competed_description: ESC + ']8;;https://example.invalid' + ESC + '\\NOT COMPETED' + ESC + ']8;;' + ESC + '\\',
      number_of_offers_received: '1', solicitation_procedures_description: u(0x2066) + 'X', type_set_aside_description: null } };
    d.generated_unique_award_id = decodeURIComponent(url.split('/').filter(Boolean).pop());
    return d;
  };
  for (const format of [[], ['--plain'], ['--csv']]) {
    const r = await runCli([...UEI_ARGS, ...format], { routes });
    assert.deepEqual(unsafeIn(r.stdout), [], 'format ' + format.join(''));
    assert.deepEqual(unsafeIn(r.stderr), []);
    assert.ok(r.stdout.includes('SIKORSKY LINK EKAF CO'), 'the hostile name is printed inert, its words kept');
    assert.ok(r.stdout.includes(accented), 'a real accented name and curly quotes pass untouched');
    assert.ok(!r.stdout.includes('example.invalid'), 'no hyperlink target survives');
  }
  const json = await runCli([...UEI_ARGS, '--json'], { routes });
  assert.deepEqual(unsafeIn(json.stdout), [], 'raw in the JSON text');
  const doc = JSON.parse(json.stdout);
  assert.ok(JSON.stringify(doc).includes(accented));
  assert.ok(doc.identity.name === 'LOCKHEED MARTIN CORP');
});

test('the name the reader typed is cleaned before it is sent or echoed', async () => {
  const r = await runCli(['lockheed' + ESC + '[2J', u(0x202e) + 'martin']);
  assert.equal(r.code, EXIT.CHOICE_REQUIRED);
  assert.equal(r.transport.calls[1].body.keyword, 'lockheed martin');
  assert.ok(r.stdout.includes('"lockheed martin"'));
});

/* --------------------------------------------------------------------------------------------
 * The environment and the interrupt.
 * ------------------------------------------------------------------------------------------ */

test('NODE_TLS_REJECT_UNAUTHORIZED=0: the report refuses to run and contacts nothing; offline commands still work', async () => {
  const env = { NODE_TLS_REJECT_UNAUTHORIZED: '0' };
  const r = await runCli(UEI_ARGS, { env });
  assert.equal(r.code, EXIT.FAILURE);
  assert.equal(r.transport.calls.length, 0);
  assert.equal(r.stdout, '');
  assert.ok(r.stderr.replace(/\s+/g, ' ').includes(NOTICES.tlsRefused));
  assert.equal((await runCli(['claims'], { env })).code, EXIT.DONE);
  assert.equal((await runCli(UEI_ARGS, { env: { NODE_TLS_REJECT_UNAUTHORIZED: '1' } })).code, EXIT.DONE);
});

test('a proxy from the environment is named when Node is told to use it, and its address is never printed', async () => {
  const proxy = 'http://user:secret@proxy.invalid:8080';
  const on = await runCli(['lockheed', 'martin'], { env: { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: proxy } });
  assert.ok(on.stderr.replace(/\s+/g, ' ').includes(NOTICES.proxyInUse));
  assert.ok(!on.stderr.includes('secret') && !on.stderr.includes('proxy.invalid'));
  const flagged = await runCli(['lockheed', 'martin'], { env: { NODE_OPTIONS: '--use-env-proxy', https_proxy: proxy } });
  assert.ok(flagged.stderr.includes('A proxy is set'));
  // With no HTTPS proxy set, Node sends the HTTPS requests through the HTTP proxy.
  const httpOnly = await runCli(['lockheed', 'martin'], { env: { NODE_USE_ENV_PROXY: '1', HTTP_PROXY: proxy } });
  assert.ok(httpOnly.stderr.replace(/\s+/g, ' ').includes(NOTICES.proxyInUse));
  assert.ok(!httpOnly.stderr.includes('secret') && !httpOnly.stderr.includes('proxy.invalid'));
  for (const env of [
    { HTTPS_PROXY: proxy },
    { NODE_USE_ENV_PROXY: '1' },
    { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: proxy, NO_PROXY: '.usaspending.gov' },
    { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: proxy, NO_PROXY: 'localhost, api.usaspending.gov:443' },
    { NODE_USE_ENV_PROXY: '1', HTTPS_PROXY: proxy, no_proxy: '*' },
  ]) {
    const r = await runCli(['lockheed', 'martin'], { env });
    assert.ok(!r.stderr.includes('A proxy is set'), JSON.stringify(env));
  }
});

test('SIGINT: the requests in flight are cancelled, one line says so, nothing is printed, exit 130; a second interrupt exits at once', async () => {
  const routes = healthyRoutes();
  routes['POST /api/v2/recipient/'] = scripted({ hang: true });
  const r = await runCli(UEI_ARGS, {
    routes,
    during: (t, proc) => {
      const poll = () => {
        if (t.calls.length >= 2) {
          assert.equal(proc.listenerCount('SIGINT'), 1);
          proc.emit('SIGINT');
          proc.emit('SIGINT');
        } else setImmediate(poll);
      };
      poll();
    },
  });
  assert.equal(r.code, EXIT.INTERRUPTED);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr.split(NOTICES.interrupted.slice(0, 30)).length - 1, 1);
  assert.deepEqual(r.proc.exits, [130]);
  assert.equal(r.proc.listenerCount('SIGINT'), 0, 'the handler is removed when the run ends');
  assert.equal(r.transport.countFor('POST /api/v2/recipient/'), 1, 'an interrupt is not retried');
});

test('SIGINT during the parallel wave unwinds every part and prints no partial report', async () => {
  const routes = healthyRoutes();
  routes['POST /api/v2/search/spending_over_time/'] = scripted({ hang: true });
  const r = await runCli(UEI_ARGS, {
    routes,
    during: (t, proc) => {
      const poll = () => {
        if (t.calls.some((c) => c.path.includes('spending_over_time'))) setImmediate(() => proc.emit('SIGINT'));
        else setImmediate(poll);
      };
      poll();
    },
  });
  assert.equal(r.code, EXIT.INTERRUPTED);
  assert.equal(r.stdout, '');
});

/* --------------------------------------------------------------------------------------------
 * The plan in --help is the plan the code runs.
 * ------------------------------------------------------------------------------------------ */

test('THE REQUEST PLAN IN --help IS EXACT: a report at every ceiling makes exactly that many requests', async () => {
  const routes = healthyRoutes();
  const rows = syntheticAwardSearch();
  rows.results = Array.from({ length: 40 }, (_, i) => ({
    'Award ID': 'SYNTH-AWARD-' + (i + 1), 'Recipient Name': 'LOCKHEED MARTIN CORP', 'Award Amount': 1000 - i,
    generated_internal_id: 'SYNTH_GID_' + (i + 1),
  }));
  routes['POST /api/v2/search/spending_by_award/'] = rows;
  routes['POST /api/v2/search/spending_by_category/recipient/'] = (url, init) => {
    const page = JSON.parse(init.body).page;
    return {
      category: 'recipient',
      results: [{ name: 'LOCKHEED MARTIN CORP', uei: PARENT_UEI, amount: 1 }],
      page_metadata: { hasNext: page < 5 },
    };
  };
  const r = await runCli([...UEI_ARGS, '--json'], { routes });
  assert.deepEqual(r.transport.unrouted, []);
  assert.equal(r.transport.calls.length, requestPlan().report);
  assert.equal(new Set(r.transport.calls.map((c) => c.method + ' ' + c.path + ' ' + JSON.stringify(c.body))).size,
    requestPlan().report, 'every one of them a distinct request');
});

test('the dimensions the report asks for are the table the page asks for, in order', async () => {
  const r = await runCli(UEI_ARGS);
  const asked = r.transport.calls.map((c) => c.path).filter((p) => p.startsWith('/api/v2/search/spending_by_category/'))
    .map((p) => p.split('/')[5]).filter((d) => d !== 'recipient');
  assert.deepEqual(asked, ['awarding_agency', 'awarding_subagency', 'psc', 'naics']);
  assert.ok(syntheticCategory('psc').results.length > 0);
});
