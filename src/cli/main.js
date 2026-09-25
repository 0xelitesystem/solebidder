// THE COMMAND LINE. It reads the arguments, decides what was asked, runs it, and returns the exit
// code. It computes no figure and writes no character itself: the report is gathered by
// src/cli/report.js from the same modules the page calls, rendered by src/cli/render.js through
// renderClaim alone, and everything a reader sees leaves through src/cli/out.js.
//
// THE PARSER IS WRITTEN BY HAND AND IT IS STRICT. There is no dependency to parse arguments, and
// a forgiving parser is how a mistyped option turns into a silently different question: a
// fiscal year that was not the one asked for, or a flag taken for part of a company name. So an
// unknown option, an option given twice, a value that is missing or malformed, and two options
// that cannot go together are each a usage error with a sentence naming it, exit code two, and no
// request is made.
//
// THE EXIT CODES ARE A CONTRACT, printed in --help:
//
//   0    done
//   1    a named failure: nothing matched the name, a section failed or its total was suppressed,
//        the output file was refused, or the environment was refused
//   2    a usage error
//   3    a choice is required: more than one parent level record matches the name
//   130  interrupted
//
// A reader that closes the pipe early, as a pager or head does, is not a failure: the run ends
// quietly with zero.
//
// WHAT THIS FILE READS FROM THE ENVIRONMENT, AND NOTHING ELSE: NO_COLOR, FORCE_COLOR, TERM and
// COLUMNS through the output sink; NODE_TLS_REJECT_UNAUTHORIZED, to refuse to run with
// certificate checks switched off; and the proxy variables, only to say when one is in use. It
// never prints a value it read from the environment.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createClient } from '../query/client.js';
import { createApi } from '../api/api.js';
import { parseIndex, searchIndex, MAX_SUGGESTIONS } from '../api/typeahead-index.js';
import { MIN_QUERY_LENGTH } from '../api/typeahead.js';
import { API_ORIGIN, AWARD_TYPE_SETS, DEFAULT_AWARD_TYPE_SET, FISCAL_YEAR_FLOOR } from '../core/constants.js';
import { fiscalYearWindow } from '../query/fiscal-year.js';
import { UEI_PATTERN } from '../query/endpoints.js';
import { createOut, writeOutFile, sanitize, PACKAGE_ROOT } from './out.js';
import { createCliFetch } from './fetch.js';
import { gatherReport, hasFailure } from './report.js';
import {
  reportBlocks, reportJSON, reportCsv, serialiseJSON, claimsBlocks, claimsJSON, claimsCsv,
  suggestBlocks, suggestJSON, suggestCsv,
} from './render.js';
import { helpBlocks, USAGE, NOTICES, PROGRESS, MAX_NAME_LENGTH, TOOL } from './copy.js';

/** The exit codes. */
export const EXIT = Object.freeze({
  DONE: 0,
  FAILURE: 1,
  USAGE: 2,
  CHOICE_REQUIRED: 3,
  INTERRUPTED: 130,
});

/** Options that take a value, written --name value or --name=value. */
const VALUE_OPTIONS = Object.freeze(['--fy', '--set', '--uei', '--out']);

/** Options that take none. */
const FLAG_OPTIONS = Object.freeze(['--json', '--csv', '--plain', '--no-color', '--force', '--help', '--version']);

/** Options that shape a report and mean nothing to the offline commands. */
const REPORT_ONLY = Object.freeze(['--fy', '--set', '--uei']);

/** The commands that are words rather than a name. Before --, a first word equal to one of these
 * is the command; after --, every word is part of the name. */
const COMMAND_WORDS = Object.freeze(['suggest', 'claims']);

/**
 * @typedef {Object} Parsed
 * @property {true} ok
 * @property {'report'|'suggest'|'claims'|'help'|'version'} command
 * @property {string} text The name or the suggestion text, cleaned.
 * @property {number} fiscalYear
 * @property {'default'|'flag'} fyChosen
 * @property {number} latestFiscalYear
 * @property {string} awardTypeSetId
 * @property {string|null} uei
 * @property {'text'|'plain'|'json'|'csv'} format
 * @property {boolean} noColor
 * @property {string|null} out
 * @property {boolean} force
 */

/** @param {string} message @returns {{ok:false, message:string}} */
function usage(message) {
  return { ok: false, message };
}

/**
 * Text a reader typed, made into one line of printable words: control and invisible characters
 * removed, runs of whitespace made one space.
 * @param {string} text
 * @returns {string}
 */
export function cleanText(text) {
  return sanitize(text).replace(/\s+/g, ' ').trim();
}

/**
 * Parse the arguments. Pure: no output, no clock but the one handed in, no environment.
 * @param {readonly string[]} argv The arguments after the command name.
 * @param {{now?:Date}} [options]
 * @returns {Parsed|{ok:false, message:string}}
 */
export function parseArgs(argv, options = {}) {
  const now = options.now === undefined ? new Date() : options.now;
  const window = fiscalYearWindow(now);
  const tokens = argv.map((t) => String(t));
  const dashes = tokens.indexOf('--');
  const optionPart = dashes === -1 ? tokens : tokens.slice(0, dashes);

  // Help and the version answer whatever else is on the line, so a reader who is stuck can always
  // get to the explanation.
  const base = {
    ok: /** @type {true} */ (true), text: '', fiscalYear: window.defaultYear, fyChosen: 'default',
    latestFiscalYear: window.latest, awardTypeSetId: DEFAULT_AWARD_TYPE_SET, uei: null,
    format: 'text', noColor: false, out: null, force: false,
  };
  if (optionPart.includes('--help') || optionPart.includes('-h')) {
    return /** @type {Parsed} */ ({ ...base, command: 'help' });
  }
  if (optionPart.includes('--version')) return /** @type {Parsed} */ ({ ...base, command: 'version' });

  /** @type {Map<string, string|true>} */
  const seen = new Map();
  /** @type {{text:string, literal:boolean}[]} */
  const positionals = [];
  let literal = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (literal) {
      positionals.push({ text: token, literal: true });
      continue;
    }
    if (token === '--') {
      literal = true;
      continue;
    }
    if (!token.startsWith('-')) {
      positionals.push({ text: token, literal: false });
      continue;
    }
    const eq = token.startsWith('--') ? token.indexOf('=') : -1;
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);
    const takesValue = VALUE_OPTIONS.includes(name);
    if (!takesValue && !FLAG_OPTIONS.includes(name)) return usage(USAGE.unknown(name));
    if (seen.has(name)) return usage(USAGE.twice(name));
    if (!takesValue) {
      if (inline !== undefined) return usage(USAGE.noValue(name));
      seen.set(name, true);
      continue;
    }
    let value = inline;
    if (value === undefined) {
      const next = tokens[i + 1];
      if (next === undefined) return usage(USAGE.missingValue(name));
      if (next.startsWith('-')) return usage(USAGE.noOptionValue(name));
      value = next;
      i += 1;
    }
    if (value.length === 0) return usage(USAGE.missingValue(name));
    seen.set(name, value);
  }

  const json = seen.has('--json');
  const csv = seen.has('--csv');
  const plain = seen.has('--plain');
  if (json && csv) return usage(USAGE.conflict('--json', '--csv'));
  if (plain && json) return usage(USAGE.conflict('--plain', '--json'));
  if (plain && csv) return usage(USAGE.conflict('--plain', '--csv'));
  if (seen.has('--force') && !seen.has('--out')) return usage(USAGE.forceNeedsOut);

  const first = positionals[0];
  /** @type {'report'|'suggest'|'claims'} */
  let command = 'report';
  let rest = positionals;
  if (first !== undefined && !first.literal && COMMAND_WORDS.includes(first.text)) {
    command = /** @type {'suggest'|'claims'} */ (first.text);
    rest = positionals.slice(1);
  }
  if (command !== 'report') {
    for (const option of REPORT_ONLY) {
      if (seen.has(option)) return usage(USAGE.notFor(option, command));
    }
  }

  const format = json ? 'json' : (csv ? 'csv' : (plain ? 'plain' : 'text'));
  const out = seen.has('--out') ? /** @type {string} */ (seen.get('--out')) : null;
  const common = {
    ...base,
    command,
    format,
    noColor: seen.has('--no-color') || format !== 'text',
    out,
    force: seen.has('--force'),
  };

  if (command === 'claims') {
    if (rest.length > 0) return usage(USAGE.claimsTakesNothing);
    return /** @type {Parsed} */ (common);
  }

  const text = cleanText(rest.map((p) => p.text).join(' '));
  if (command === 'suggest') {
    if (text.length === 0) return usage(USAGE.suggestMissing);
    if (text.length < MIN_QUERY_LENGTH) return usage(USAGE.suggestTooShort);
    if (text.length > MAX_NAME_LENGTH) return usage(USAGE.nameTooLong);
    return /** @type {Parsed} */ ({ ...common, text });
  }

  if (positionals.length === 0) return usage(USAGE.noCommand);
  if (text.length === 0) return usage(USAGE.nameMissing);
  if (text.length > MAX_NAME_LENGTH) return usage(USAGE.nameTooLong);

  let fiscalYear = window.defaultYear;
  let fyChosen = 'default';
  if (seen.has('--fy')) {
    const raw = /** @type {string} */ (seen.get('--fy'));
    const fy = /^[0-9]{4}$/.test(raw) ? Number(raw) : NaN;
    if (!(fy >= FISCAL_YEAR_FLOOR && fy <= window.latest)) {
      return usage(USAGE.fiscalYear(raw, FISCAL_YEAR_FLOOR, window.latest));
    }
    fiscalYear = fy;
    fyChosen = 'flag';
  }

  let awardTypeSetId = DEFAULT_AWARD_TYPE_SET;
  if (seen.has('--set')) {
    const raw = /** @type {string} */ (seen.get('--set'));
    if (!Object.prototype.hasOwnProperty.call(AWARD_TYPE_SETS, raw)) return usage(USAGE.set(raw));
    awardTypeSetId = raw;
  }

  let uei = null;
  if (seen.has('--uei')) {
    const raw = /** @type {string} */ (seen.get('--uei'));
    const upper = raw.toUpperCase();
    if (!UEI_PATTERN.test(upper)) return usage(USAGE.uei(raw));
    uei = upper;
  }

  return /** @type {Parsed} */ ({
    ...common, text, fiscalYear, fyChosen, awardTypeSetId, uei,
  });
}

/**
 * Whether Node has been asked to send requests through a proxy from the environment, and the one
 * host this tool contacts is not excluded from it.
 * @param {Record<string, string|undefined>} env
 * @returns {boolean}
 */
export function proxyInUse(env) {
  const enabled = env.NODE_USE_ENV_PROXY === '1'
    || /(^|\s)--use-env-proxy(\s|=|$)/.test(String(env.NODE_OPTIONS === undefined ? '' : env.NODE_OPTIONS));
  if (!enabled) return false;
  const proxy = env.HTTPS_PROXY === undefined ? env.https_proxy : env.HTTPS_PROXY;
  if (typeof proxy !== 'string' || proxy.trim().length === 0) return false;
  const host = new URL(API_ORIGIN).hostname;
  const noProxy = env.NO_PROXY === undefined ? env.no_proxy : env.NO_PROXY;
  for (const entry of String(noProxy === undefined ? '' : noProxy).split(/[\s,]+/)) {
    const e = entry.trim().toLowerCase().replace(/:[0-9]+$/, '').replace(/^\*?\.?/, '');
    if (entry.trim() === '*') return false;
    if (e.length > 0 && (host === e || host.endsWith('.' + e))) return false;
  }
  return true;
}

/**
 * A sleep that ends early when the run is interrupted, so the retry ladder unwinds at once
 * instead of finishing a backoff window nobody is waiting for.
 * @param {AbortSignal} signal
 * @returns {(ms:number) => Promise<void>}
 */
export function abortableSleep(signal) {
  return (ms) => new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * The exit code a gathered report earns.
 * @param {import('./report.js').Report} report
 * @returns {number}
 */
export function exitCodeFor(report) {
  switch (report.kind) {
    case 'report': return hasFailure(report) ? EXIT.FAILURE : EXIT.DONE;
    case 'refusal':
    case 'uei-not-found': return EXIT.CHOICE_REQUIRED;
    case 'interrupted': return EXIT.INTERRUPTED;
    default: return EXIT.FAILURE;
  }
}

/** @returns {Promise<string>} */
async function readVersion() {
  try {
    const pkg = JSON.parse(await readFile(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));
    return typeof pkg.version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+/.test(pkg.version)
      ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

/** @returns {Promise<string>} */
function readBundledIndex() {
  return readFile(path.join(PACKAGE_ROOT, 'src', 'data', 'typeahead-index.json'), 'utf8');
}

/**
 * @param {string} text
 * @returns {import('./out.js').Block[]}
 */
function words(text) {
  return [{ kind: 'para', segments: [{ text }] }];
}

/**
 * Run the command line.
 *
 * Every dependency has a real default, so the installed command calls run() with nothing; the
 * test suite hands in the arguments, the environment, the streams, the clock and the fetch
 * underneath the command line's own wrapper, which it cannot replace.
 *
 * @param {Object} [options]
 * @param {readonly string[]} [options.argv]
 * @param {Record<string, string|undefined>} [options.env]
 * @param {any} [options.stdout]
 * @param {any} [options.stderr]
 * @param {() => Date} [options.now]
 * @param {typeof globalThis.fetch} [options.fetch] The fetch beneath the wrapper.
 * @param {{now?:() => number, sleep?:(ms:number) => Promise<void>, random?:() => number}} [options.clientDeps]
 * @param {{on:Function, removeListener:Function, exit:(code:number) => void}} [options.proc]
 * @param {string} [options.cwd]
 * @param {string} [options.packageRoot]
 * @param {string} [options.version]
 * @param {() => Promise<string>} [options.readIndex]
 * @param {(e:unknown) => void} [options.onError] Told about an internal error, for tests.
 * @returns {Promise<number>}
 */
export async function run(options = {}) {
  const argv = options.argv === undefined ? process.argv.slice(2) : options.argv;
  const env = options.env === undefined ? process.env : options.env;
  const now = options.now === undefined ? () => new Date() : options.now;
  const parsed = parseArgs(argv, { now: now() });
  const sink = createOut({
    stdout: options.stdout,
    stderr: options.stderr,
    env,
    noColor: !parsed.ok || parsed.noColor,
  });

  try {
    if (!parsed.ok) {
      sink.err([...words(parsed.message), ...words(USAGE.hint)]);
      return EXIT.USAGE;
    }
    const version = options.version === undefined ? await readVersion() : options.version;

    /**
     * Put the output where it was asked for: the terminal, or the one file named with --out.
     * @param {{blocks?:import('./out.js').Block[], text?:string}} doc
     * @returns {Promise<boolean>} False when the file was refused.
     */
    const deliver = async (doc) => {
      if (parsed.out !== null) {
        const text = doc.blocks === undefined ? /** @type {string} */ (doc.text) : sink.render(doc.blocks);
        const written = await writeOutFile(parsed.out, text, {
          force: parsed.force,
          cwd: options.cwd,
          packageRoot: options.packageRoot,
        });
        if (written.ok) {
          sink.err(NOTICES.wrote(written.path));
          return true;
        }
        sink.err(NOTICES.outRefused[written.reason] + ' ' + NOTICES.notWritten(written.path));
        return false;
      }
      if (doc.blocks === undefined) sink.raw(/** @type {string} */ (doc.text));
      else sink.write(doc.blocks);
      return true;
    };
    const finish = (delivered, code) => {
      if (!delivered) return EXIT.FAILURE;
      return sink.readerClosed() ? EXIT.DONE : code;
    };

    if (parsed.command === 'help') {
      sink.write(helpBlocks({ version, now: now() }));
      return EXIT.DONE;
    }
    if (parsed.command === 'version') {
      sink.write(words(TOOL + ' ' + version));
      return EXIT.DONE;
    }

    if (parsed.command === 'claims') {
      const doc = parsed.format === 'json' ? { text: serialiseJSON(claimsJSON(version)) }
        : parsed.format === 'csv' ? { text: claimsCsv() }
          : { blocks: claimsBlocks({ plain: parsed.format === 'plain' }) };
      return finish(await deliver(doc), EXIT.DONE);
    }

    if (parsed.command === 'suggest') {
      let index;
      try {
        index = parseIndex(await (options.readIndex === undefined ? readBundledIndex() : options.readIndex()));
      } catch {
        sink.err(NOTICES.indexUnreadable);
        return EXIT.FAILURE;
      }
      const found = searchIndex(index, parsed.text, { limit: MAX_SUGGESTIONS });
      const doc = parsed.format === 'json' ? { text: serialiseJSON(suggestJSON(version, parsed.text, found)) }
        : parsed.format === 'csv' ? { text: suggestCsv(found) }
          : { blocks: suggestBlocks(parsed.text, found, { plain: parsed.format === 'plain' }) };
      return finish(await deliver(doc), EXIT.DONE);
    }

    // THE REPORT. The only command that contacts anything.
    if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
      sink.err(NOTICES.tlsRefused);
      return EXIT.FAILURE;
    }
    if (proxyInUse(env)) sink.err(NOTICES.proxyInUse);

    const proc = options.proc === undefined ? process : options.proc;
    const controller = new AbortController();
    let interrupts = 0;
    const onInterrupt = () => {
      interrupts += 1;
      if (interrupts === 1) {
        controller.abort();
        sink.err(NOTICES.interrupted);
      } else {
        // A second interrupt means the reader is not waiting for the unwinding either.
        proc.exit(EXIT.INTERRUPTED);
      }
    };
    proc.on('SIGINT', onInterrupt);

    try {
      /** @type {Set<string>} */
      const refused = new Set();
      const cliFetch = createCliFetch({
        fetch: options.fetch,
        version,
        signal: controller.signal,
        onRefusal: (kind) => {
          if (refused.has(kind)) return;
          refused.add(kind);
          sink.err(NOTICES.refusal[kind]);
        },
      });
      const deps = options.clientDeps === undefined ? {} : options.clientDeps;
      const client = createClient({
        fetch: cliFetch,
        sleep: deps.sleep === undefined ? abortableSleep(controller.signal) : deps.sleep,
        now: deps.now,
        random: deps.random,
      });
      const api = createApi({ client });

      let coldSaid = false;
      const report = await gatherReport({
        api,
        text: parsed.text,
        fiscalYear: parsed.fiscalYear,
        fyChosen: /** @type {'default'|'flag'} */ (parsed.fyChosen),
        latestFiscalYear: parsed.latestFiscalYear,
        awardTypeSetId: parsed.awardTypeSetId,
        uei: parsed.uei,
        signal: controller.signal,
        progress: (line) => sink.err(line),
        onCold: () => {
          if (coldSaid) return;
          coldSaid = true;
          sink.err(PROGRESS.cold);
        },
      });
      if (report.kind === 'interrupted' || controller.signal.aborted) return EXIT.INTERRUPTED;

      const code = exitCodeFor(report);
      const doc = parsed.format === 'json' ? { text: serialiseJSON(reportJSON(report, { version, exitCode: code })) }
        : parsed.format === 'csv' ? { text: reportCsv(report) }
          : { blocks: reportBlocks(report, { plain: parsed.format === 'plain' }) };
      return finish(await deliver(doc), code);
    } finally {
      proc.removeListener('SIGINT', onInterrupt);
    }
  } catch (e) {
    if (options.onError) options.onError(e);
    sink.err(NOTICES.internal);
    return EXIT.FAILURE;
  }
}
