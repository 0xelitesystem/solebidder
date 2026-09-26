// EVERY WORD THE COMMAND LINE WRITES THAT IS NOT A FIGURE, A REGISTRY SENTENCE OR A LIBRARY
// SENTENCE, IN ONE TABLE.
//
// One table so that it can be checked as a table. scripts/gate-vocabulary.mjs scans the source of
// this file like every file under src/, and it also scans cliStringTables() below at run time,
// because a sentence assembled from pieces at run time is a sentence no source scan ever sees
// whole. test/cli-copy.test.js holds the same table to the same rules.
//
// WHAT IS NOT HERE, ON PURPOSE.
//
//   The ten NEVER CLAIMED statements. They are printed from src/core/never-claimed.js at run time
//   and never retyped, because a retyped boundary is a boundary somebody can soften.
//   The advice disclaimer. It is ADVICE_DISCLAIMER in src/core/constants.js, one copy for the page
//   footer, the README, USAGE and this tool.
//   Failure sentences, the as of notice, the cold source notice and every sentence the analysis
//   and identity layers build. The page prints those too, from the same code.
//   Figures. There is no number in this file that a reader could take for a measurement. The only
//   digits the command line prints outside a badged figure are fiscal year labels, identifiers,
//   its own version, and in --help the limits it runs under, each computed from the constant that
//   sets it rather than typed here.
//
// No dash of either long form appears here, and no dollar sign: the currency symbol lives in one
// file, src/core/units.js, and every figure reaches the reader through it.

import {
  ADVICE_DISCLAIMER, AWARD_TYPE_SETS, COLD_SOURCE_NOTICE, DEFAULT_AWARD_TYPE_SET, FISCAL_YEAR_FLOOR,
  HERO_AWARD_COUNT, API_ORIGIN,
} from '../core/constants.js';
import { DEFAULT_POLICY } from '../query/retry.js';
import { MAX_CATEGORY_PAGES } from '../api/categories.js';
import { CATEGORY_PANELS } from '../api/dimensions.js';
import { MIN_QUERY_LENGTH } from '../api/typeahead.js';
import { fiscalYearWindow } from '../query/fiscal-year.js';
import { BODY_CAP_BYTES, REPOSITORY_URL, userAgent } from './fetch.js';

/** The command name. */
export const TOOL = 'solebidder';

/** The machine output schema. */
export const SCHEMA = 'solebidder.cli/1';

/** The longest name the report sends as search text. */
export const MAX_NAME_LENGTH = 200;

/** The attribution, at the foot of every report and in every machine document. */
export const ATTRIBUTION = 'Source: USAspending.gov, United States Department of the Treasury.';

/**
 * The statement of independence, as the README and the page carry it, with "named on the page"
 * read as "named in this output". test/cli-copy.test.js holds it to the README's wording.
 */
export const INDEPENDENCE = 'Not affiliated with, endorsed by, or sponsored by the United States '
  + 'government, the Department of the Treasury, the Department of Defense, USAspending.gov, or any '
  + 'company named in this output. All data comes from public government APIs. All company names '
  + 'are used descriptively.';

/** One line: what this is. */
export const PURPOSE = 'Federal prime award obligations recorded against one parent UEI and its '
  + 'registered child UEIs, for one named fiscal year, fetched live from USAspending and printed '
  + 'with a badge on every figure. These are obligations, not revenue.';

/**
 * The privacy line, with the exact User-Agent this build sends.
 * @param {string} version
 * @returns {string}
 */
export function privacyLine(version) {
  return 'Your machine talks to api.usaspending.gov directly and to nothing else. There is no '
    + 'telemetry and no update check, nothing is cached, and nothing is written to disk unless you '
    + 'pass --out. The name you search is sent to USAspending, because that is the question being '
    + 'asked. Each request carries your IP address, as every request on the internet does, and '
    + 'this User-Agent: ' + userAgent(version) + '.';
}

/** Section titles. */
export const TITLES = Object.freeze({
  subject: 'What was summed',
  parent: 'The parent total',
  reconciliation: 'The same figure reached more than one way',
  competition: 'Awarded with exactly one bidder',
  buyers: 'Who the money came from, and what it was recorded against',
  concentration: 'How concentrated the contract book is',
  spine: 'Obligations by fiscal year',
  definition: 'Two definitions of the company, named separately',
  children: 'Every registered child entity that rolled into the sum',
  resolution: 'The name you searched',
  refusal: 'No single parent record exists for this name',
  records: 'Parent level records matching the name',
  about: 'About these figures',
  claims: 'What this tool never claims',
  suggest: 'Names in the bundled index',
});

/** Figure labels, keyed by the stable id each figure carries in --json and --csv. */
export const LABELS = Object.freeze({
  parentTotal: 'Recorded against this parent identifier family',
  transactions: 'Transaction records',
  declaredNames: 'Names the registrant declared',
  soleBidderShare: 'Share of lifetime award value awarded with exactly one bidder',
  notCompetedValue: 'Lifetime award value the record marks as not competed',
  totalValue: 'Lifetime award value across the whole set',
  heroAwardCount: 'Contracts in the denominator',
  notCompetedCount: 'Marked not competed',
  noCompetitionFieldCount: 'No competition field',
  negativeValueCount: 'Negative lifetime value',
  arrivedRecordCount: 'Competition records that arrived',
  droppedRowCount: 'Rows dropped as outside the entity set',
  oneOfferShare: 'An independent cross check, counting records rather than dollars',
  topShare: 'Share of the largest row',
  topAmount: 'Recorded to that one row',
  categoryTotal: 'Across every row returned',
  rowCount: 'Rows returned',
  negativeRowCount: 'Rows carrying a negative amount',
  herfindahl: 'Herfindahl index across every buyer row returned, the sum of the squares of the shares',
  curve: 'the concentration curve',
  topAwardShare: 'The single largest contract as a share of the same set',
  parentRollupTotal: 'Definition one, the parent identifier rollup',
  nameMatchTotal: 'Definition two, everything matching the name searched',
  definitionGap: 'The gap between the two definitions',
  gapEntityCount: 'Entities in that gap',
  change: 'Change from',
  changeShare: 'The same change as a share of',
  offers: 'Offers received, as reported',
  awardValue: 'Lifetime award value, options included',
  childAmount: 'Recorded against this registered child entity',
  gapAmount: 'Recorded against this entity',
  categoryRow: 'Recorded against this row',
  curvePoint: 'Cumulative share of the set at this contract',
});

/** Progress, one discrete line each, on standard error. Never a spinner. */
export const PROGRESS = Object.freeze({
  asOf: 'Asking USAspending for the date it publishes about its own data.',
  list: 'Looking up the parent level records that match the name.',
  rest: 'Fetching the largest contracts and their competition records, obligations by fiscal year, '
    + 'the category breakdowns and the second definition. Nothing is printed until every part has '
    + 'answered or failed.',
  cold: COLD_SOURCE_NOTICE,
  /**
   * @param {string} name @param {string} uei @param {number} fy
   * @returns {string}
   */
  subject: (name, uei, fy) => 'Fetching the profile and the registered children of ' + name
    + ', UEI ' + uei + ', for FY' + fy + '.',
});

/** Report sentences. */
export const COPY = Object.freeze({
  /** @param {string} name @param {string} uei */
  choiceByFlag: (name, uei) => 'You chose ' + name + ', UEI ' + uei + ', with the --uei option. '
    + 'Every figure below is recorded against that UEI family for the fiscal year selected.',
  /** @param {number} fy */
  fiscalYearDefault: (fy) => 'Fiscal year FY' + fy + ', the most recently completed fiscal year, '
    + 'chosen by default. Pass --fy to choose another.',
  /** @param {number} fy @param {boolean} current */
  fiscalYearChosen: (fy, current) => 'Fiscal year FY' + fy + ', chosen with --fy.' + (current
    ? ' It is the current fiscal year and it has not finished, so every figure for it is partial '
      + 'by the calendar rather than by any defect.'
    : ''),
  /** @param {{id:string, label:string, describe:string}} set */
  awardTypeSet: (set) => 'Award type set: ' + set.label + ' (' + set.id + '). ' + set.describe
    + ' The set is named on every badge, and it is never a hidden default.',
  rollupIncomplete: 'Part of the child list did not arrive, so the summed total is suppressed here '
    + 'rather than shown short. A rollup missing some of its parts is smaller than the truth and a '
    + 'reader would quote it.',
  thirdArmMissing: 'The third route to this figure, the paged entity breakdown under this parent '
    + 'id, did not arrive, so the figure is reconciled two ways only.',
  heroFloor: 'Some contracts in this set carry no competition field at all. Their value stays in '
    + 'the denominator and can never enter the numerator, so the share above is a floor for this '
    + 'set rather than the whole of it.',
  receipts: 'The largest contracts in the denominator by lifetime award value, each with the '
    + 'government record it came from:',
  offersNotRecorded: 'offers received not recorded',
  moreRows: 'The rows above are the largest by dollars obligated. Every row returned is in the '
    + '--json and --csv output.',
  rowsIntro: 'The largest rows returned, by dollars obligated:',
  curveIntro: 'The contracts in the competition split, largest first by lifetime award value. Beside '
    + 'each is the running share of the lifetime award value of the whole set once that contract is '
    + 'added, which is the table behind the concentration curve on the page.',
  curveMore: 'The rows above are the largest. Every contract in the set, with its running share, is '
    + 'in the --json and --csv output.',
  runningShare: 'running share',
  concentrationNeedsSearch: 'This view is drawn from the same contracts as the competition split, '
    + 'and they did not arrive.',
  definitionIntro: 'These are not two estimates of one truth. They are two different definitions of '
    + 'what the company means in this dataset, so they are printed one after the other and the '
    + 'entities in the gap are listed. Presenting them as a range would imply the truth lies '
    + 'between them, and it does not.',
  gapNone: 'No entity matching the name searched sits outside the parent chosen.',
  gapIntro: 'The entities that match the name searched but are not registered under the parent '
    + 'chosen:',
  childrenIntro: 'Each registered child entity of this parent for the same fiscal year, with the '
    + 'amount the source recorded against it. These amounts cover every award type, because the '
    + 'children endpoint takes no award type filter.',
  noRecordsHint: 'This tool resolves a name to a parent level record and its registered children. '
    + 'Guessing which unrelated records to add together is exactly what it refuses to do. Try the '
    + 'registered legal name rather than the brand, or run solebidder suggest with part of the name.',
  pickWithUei: 'To sum one of them, run the same command again with --uei and the identifier of '
    + 'the record you mean. This tool will not choose for you, and it never adds them together.',
  /** @param {string} uei */
  ueiNotFound: (uei) => 'The UEI given with --uei, ' + uei + ', is not one of the parent level '
    + 'records that match that name in this dataset. It may be registered under a parent rather '
    + 'than being one, or it may sit past the first page of matches, which is the only page read. '
    + 'The parent level records that do match are listed below.',
  /** @param {string} date */
  asOf: (date) => 'USAspending publishes this data as current to ' + date + '. That date comes from '
    + 'the source itself, fetched on this run.',
  claimsPointer: 'All ten statements of what this tool never claims: solebidder claims.',
  missing: 'This section is missing.',
  retryable: 'Running the command again may answer; the request was already retried.',
  notRetryable: 'Retrying will not change this.',
  /** @param {string} what */
  unavailable: (what) => 'No figure for ' + what + '.',
  /** @param {string} noun */
  dimensionHeading: (noun) => 'By ' + noun,
  /** @param {string} prior */
  changeFrom: (prior) => 'Change from ' + prior,
  /** @param {string} prior */
  changeShareOf: (prior) => 'The same change as a share of ' + prior,
  /** @param {'increase'|'decrease'|'unchanged'} direction */
  direction: (direction) => (direction === 'unchanged' ? 'unchanged'
    : (direction === 'increase' ? 'an increase' : 'a decrease')),
});

/** Sentences about the environment, the run and the file. */
export const NOTICES = Object.freeze({
  interrupted: 'Interrupted. The requests in flight were cancelled and no report was printed.',
  tlsRefused: 'NODE_TLS_REJECT_UNAUTHORIZED is set to zero in this environment, which turns '
    + 'certificate checks off. A figure received that way cannot be badged REPORTED, because '
    + 'anything on the network path could have written it. Unset that variable and run again.',
  proxyInUse: 'A proxy is set in the environment and NODE_USE_ENV_PROXY asks Node to use it, so '
    + 'these requests may pass through that proxy, which can see which host is contacted. '
    + 'Certificate checks still apply end to end.',
  refusal: Object.freeze({
    redirect: 'USAspending answered a request with a redirect. This tool never follows one, so '
      + 'that request counted as failed.',
    'content-type': 'USAspending answered a request with something other than JSON, so that '
      + 'answer was not read and counted as malformed.',
    'body-cap': 'USAspending answered a request with a body over the size cap this tool reads, so '
      + 'that answer was not read and counted as malformed.',
  }),
  /** @param {string} file */
  wrote: (file) => 'Wrote the output to ' + file + '.',
  outRefused: Object.freeze({
    exists: 'That file already exists. Pass --force to replace it.',
    link: 'That path is a link. This tool does not write through a link, with or without --force.',
    'inside-package': 'That path is inside the directory this tool is installed in, and nothing is '
      + 'written there.',
    'not-a-file': 'That path is not a plain file.',
    unwritable: 'That file could not be written.',
  }),
  /** @param {string} file */
  notWritten: (file) => 'Nothing was written to ' + file + '.',
  indexUnreadable: 'The name index bundled with this package could not be read, so there are no '
    + 'suggestions to give. The report does not need it: run solebidder with the name instead.',
  internal: 'This tool stopped on an internal error, and it printed no figure it could not stand '
    + 'behind. Running it again may help. If it repeats, it is a defect worth reporting at '
    + REPOSITORY_URL + '/issues.',
});

/** Usage errors. Each ends the run with exit code two. */
export const USAGE = Object.freeze({
  hint: 'Run solebidder --help for every option.',
  noCommand: 'Name a federal contractor, for example: solebidder "lockheed martin".',
  /** @param {string} option */
  unknown: (option) => 'Unknown option ' + option + '.',
  /** @param {string} option */
  missingValue: (option) => option + ' needs a value.',
  /** @param {string} option */
  noValue: (option) => option + ' takes no value.',
  /** @param {string} option */
  twice: (option) => option + ' was given more than once.',
  /** @param {string} a @param {string} b */
  conflict: (a, b) => a + ' and ' + b + ' cannot be used together.',
  /** @param {string} option @param {string} command */
  notFor: (option, command) => option + ' does not apply to ' + command + '.',
  forceNeedsOut: '--force only applies with --out.',
  nameMissing: 'Name a federal contractor to report on.',
  nameTooLong: 'That name is longer than any registered name this tool will search for.',
  suggestMissing: 'Give some text to suggest names for, for example: solebidder suggest lockheed.',
  suggestTooShort: 'Give at least two characters to suggest names for.',
  claimsTakesNothing: 'claims takes no further words.',
  /** @param {string} option */
  noOptionValue: (option) => option + ' needs a value after it, and the next word is an option.',
  /** @param {string} value @param {number} floor @param {number} latest */
  fiscalYear: (value, floor, latest) => '--fy takes a whole fiscal year from ' + floor + ' to '
    + latest + ', the current fiscal year, and ' + JSON.stringify(value) + ' is not one. A rolling '
    + 'window is not a fiscal year, nothing before ' + floor + ' exists in the source, and a year '
    + 'that has not started has nothing to report.',
  /** @param {string} value */
  set: (value) => '--set takes ' + Object.keys(AWARD_TYPE_SETS).join(', ') + ', and '
    + JSON.stringify(value) + ' is not one of them.',
  /** @param {string} value */
  uei: (value) => '--uei takes a unique entity identifier, twelve letters and digits, and '
    + JSON.stringify(value) + ' is not one.',
});

/** Offline commands. */
export const OFFLINE = Object.freeze({
  claimsIntro: 'These ten statements are published beside the figures they qualify, word for word, '
    + 'on the page and in every report.',
  /** @param {string} text */
  suggestIntro: (text) => 'Names in the index bundled with this package that match '
    + JSON.stringify(text) + '. Names and identifiers only: the index carries no amounts, and '
    + 'nothing was fetched.',
  suggestLevels: 'Many of these are child level records. The report resolves a name to parent '
    + 'level records, and says so when an identifier you pass with --uei is not one of them.',
  suggestNone: 'No name in the bundled index matches that text. The index covers the head of the '
    + 'recipient list, not all of it: run the report with the name to search the live list.',
});

/**
 * The request plan, computed from the constants that set it, so --help cannot drift from the
 * code. A report asks for the as of date, the list of names, the profile, the children, the award
 * search, one competition record per award, obligations by fiscal year, one page per category
 * dimension, and up to the page ceiling each for the entity breakdown and the name match.
 * @returns {{report:number, refusal:number, details:number, pages:number, attempts:number,
 *   dimensions:number, capMiB:number}}
 */
export function requestPlan() {
  const dimensions = CATEGORY_PANELS.length;
  return {
    report: 1 + 1 + 1 + 1 + 1 + HERO_AWARD_COUNT + 1 + dimensions + MAX_CATEGORY_PAGES * 2,
    refusal: 2,
    details: HERO_AWARD_COUNT,
    pages: MAX_CATEGORY_PAGES,
    attempts: DEFAULT_POLICY.maxAttempts,
    dimensions,
    capMiB: BODY_CAP_BYTES / (1024 * 1024),
  };
}

/**
 * @param {string} text
 * @param {'heading'} [style]
 * @returns {import('./out.js').Block}
 */
function para(text, style) {
  return { kind: 'para', segments: [style === undefined ? { text } : { text, style }] };
}

/**
 * @param {string} text
 * @returns {import('./out.js').Block}
 */
function indented(text) {
  return { kind: 'para', segments: [{ text }], indent: 2 };
}

/**
 * A paragraph under a heading, built from pieces. A piece given as {n} is a number with the word
 * that belongs to it, and the layout never parts the two across a line.
 * @param {(string|{n:string})[]} pieces
 * @returns {import('./out.js').Block}
 */
function prose(...pieces) {
  return {
    kind: 'para',
    indent: 2,
    segments: pieces.map((p) => (typeof p === 'string' ? { text: p } : { text: p.n, atomic: true })),
  };
}

/** @param {number|string} value @param {string} word @returns {{n:string}} */
function n(value, word) {
  return { n: String(value) + ' ' + word };
}

/**
 * @param {string} term
 * @param {string} desc
 * @returns {import('./out.js').Block}
 */
function def(term, desc) {
  return { kind: 'def', term, desc: [{ text: desc }] };
}

/**
 * --help. Everything DESIGN-CLI section 0 item 15 asks for: the purpose, usage, every option, the
 * plan of what is contacted and how many requests, privacy, independence, the source, the advice
 * disclaimer, the licence and repository, and the exit codes. Laid out at the terminal width,
 * eighty columns when nothing says otherwise.
 * @param {{version:string, now:Date}} args
 * @returns {import('./out.js').Block[]}
 */
export function helpBlocks(args) {
  const latest = fiscalYearWindow(args.now).latest;
  const plan = requestPlan();
  const blank = { kind: 'blank' };
  return [
    para(TOOL + ' ' + args.version, 'heading'),
    para(PURPOSE),
    blank,
    para('Usage', 'heading'),
    indented(TOOL + ' <name> [--fy <year>] [--set <set>] [--uei <UEI>]'),
    indented(TOOL + ' suggest <text>'),
    indented(TOOL + ' claims'),
    indented(TOOL + ' --help | --version'),
    indented('Every command also takes --json, --csv, --plain, --no-color, --out <path> and --force.'),
    blank,
    para('Commands', 'heading'),
    def('<name>', 'The report for the parent level record that matches the name: the parent total, '
      + 'the same figure reached more than one way, the share of lifetime award value awarded with '
      + 'exactly one bidder, who the money came from, how concentrated the contract book is, '
      + 'obligations by fiscal year with the change from the year before, and a second definition '
      + 'of the company beside the first. When more than one parent level record matches, it lists '
      + 'them with their identifiers and stops. Nothing is ever added together.'),
    def('suggest <text>', 'Names and identifiers from the index bundled with this package. No '
      + 'network and no amounts.'),
    def('claims', 'The ten statements of what this tool never claims, word for word.'),
    blank,
    para('Options', 'heading'),
    def('--fy <year>', 'A whole fiscal year from FY' + FISCAL_YEAR_FLOOR + ' to FY' + latest
      + ', the current one, written as four digits. Default: the most recently completed fiscal '
      + 'year, which the report names.'),
    def('--set <set>', 'The award type set: ' + Object.keys(AWARD_TYPE_SETS).join(', ') + '. Default: '
      + DEFAULT_AWARD_TYPE_SET + '. The set is named on every badge.'),
    def('--uei <UEI>', 'Choose one parent level record by its unique entity identifier, twelve '
      + 'letters and digits, when a name matches more than one.'),
    def('--json', 'One JSON document, schema ' + SCHEMA + '. Every figure carries its badge, value, '
      + 'unit, method, printed text and provenance; a figure that could not be computed is a '
      + 'reason with no value.'),
    def('--csv', 'One row per figure, with the unit named in each column header. A cell a '
      + 'spreadsheet could read as a formula starts with a single quote.'),
    def('--plain', 'One complete sentence per figure, for a screen reader or a plain log.'),
    def('--no-color', 'No text styling. NO_COLOR set to any value does the same. FORCE_COLOR turns '
      + 'styling on when the output is not a terminal, unless NO_COLOR is set. Styling is only ever '
      + 'bold: every badge is a word.'),
    def('--out <path>', 'Write the output to that file rather than the terminal. An existing file '
      + 'or a link is refused.'),
    def('--force', 'With --out, replace an existing file. A link is still refused.'),
    def('-h, --help', 'This text.'),
    def('--version', 'The version.'),
    blank,
    para('Exit codes', 'heading'),
    def('0', 'Done.'),
    def('1', 'A named failure: nothing matched the name, a section failed or was suppressed, the '
      + 'output file was refused, or the environment was refused.'),
    def('2', 'A usage error.'),
    def('3', 'A choice is required: more than one parent level record matches the name, or the '
      + 'UEI given with --uei is not one of those that match. Run it again with --uei.'),
    def('130', 'Interrupted.'),
    blank,
    para('What it contacts', 'heading'),
    prose(API_ORIGIN + ' and nothing else, over HTTPS with certificate checks on. suggest, claims, '
      + '--help and --version contact nothing. A report makes at most ', n(plan.report, 'requests'),
    ': the date the source publishes about itself, the list of records matching the name, the '
      + 'parent profile, its registered children, the ', n(plan.details, 'largest'), ' contracts and '
      + 'one competition record for each, obligations by fiscal year, ', n(plan.dimensions, 'category'),
    ' breakdowns, and up to ', n(plan.pages, 'pages'), ' each of the entity breakdown and the name '
      + 'match. A name that matches more than one parent level record stops after ',
    n(plan.refusal, 'requests'), '. A request that meets a server error or a dropped connection is '
      + 'tried up to ', n(plan.attempts, 'times'), ' in all. Redirects are refused, never followed, '
      + 'and an answer over ', n(plan.capMiB, 'MiB'), ' is refused. Nothing is cached.'),
    prose('If NODE_TLS_REJECT_UNAUTHORIZED is set to zero the report refuses to run. A proxy from '
      + 'the environment is used only when Node is told to use one with NODE_USE_ENV_PROXY, and '
      + 'the report says so when it is.'),
    blank,
    para('Privacy', 'heading'),
    prose(privacyLine(args.version)),
    blank,
    para('Source and independence', 'heading'),
    prose(ATTRIBUTION),
    prose(INDEPENDENCE),
    prose(ADVICE_DISCLAIMER),
    blank,
    para('Licence', 'heading'),
    prose('MIT licence. Source code: ' + REPOSITORY_URL),
    prose('Made by 0xelitesystem: https://elitesystem.ai'),
  ];
}

/**
 * Every string table the command line prints from, flattened, with each builder called on
 * sample arguments that carry no digits of their own. The vocabulary gate and the copy tests scan
 * this, so a sentence assembled at run time is checked whole.
 * @param {{version?:string, now?:Date}} [args]
 * @returns {string[]}
 */
export function cliStringTables(args = {}) {
  const version = args.version === undefined ? 'test' : args.version;
  const now = args.now === undefined ? new Date() : args.now;
  const out = [TOOL, SCHEMA, ATTRIBUTION, INDEPENDENCE, PURPOSE, privacyLine(version), ADVICE_DISCLAIMER];
  const sample = {
    string: 'Sample Name',
    uei: 'SAMPLEUEIABC',
  };
  const collect = (table) => {
    for (const value of Object.values(table)) {
      if (typeof value === 'string') out.push(value);
      else if (typeof value === 'function') {
        out.push(String(value(sample.string, sample.uei, FISCAL_YEAR_FLOOR)));
      } else if (value && typeof value === 'object') collect(value);
    }
  };
  collect(TITLES);
  collect(LABELS);
  collect(PROGRESS);
  collect(COPY);
  collect(NOTICES);
  collect(USAGE);
  collect(OFFLINE);
  out.push(COPY.fiscalYearChosen(FISCAL_YEAR_FLOOR, true));
  for (const set of Object.values(AWARD_TYPE_SETS)) out.push(COPY.awardTypeSet(set));
  for (const d of ['increase', 'decrease', 'unchanged']) out.push(COPY.direction(/** @type {any} */ (d)));
  for (const b of helpBlocks({ version, now })) {
    if (b.kind === 'para') out.push(b.segments.map((s) => s.text).join(''));
    if (b.kind === 'def') out.push(b.term + ' ' + b.desc.map((s) => s.text).join(''));
  }
  return out;
}
