// THE REPORT, RENDERED FOUR WAYS FROM ONE MODEL: text, plain sentences, JSON and CSV.
//
// EVERY FIGURE GOES THROUGH renderClaim. The text of a figure is renderClaim(claim).text, value
// and unit noun and badge in one string, and it is laid out as ONE unbreakable unit, so a line
// wrap can never part a number from its unit or its badge. The plain form is the claim's own
// accessible sentence. The JSON form is claimToJSON plus the rendered text, with the value at the
// precision the text shows, and the CSV form puts each unit kind in its own column. There is no
// other path from a number to a character in this directory.
//
// A FIGURE THAT COULD NOT BE COMPUTED IS A REASON, NEVER A ZERO. In text it is a sentence where the
// figure would be. In JSON it is an entry with a reason and no value key at all. In CSV it is a
// row whose value cells are empty and whose reason cell says why.
//
// A NOTE IS ALWAYS PRINTED. A claim carries a note because the figure cannot be read correctly
// without it, and printing the number while hiding the qualification is the one thing the page's
// renderer refuses to do. This one refuses too.
//
// This module builds strings and layout blocks and writes nothing. src/cli/out.js lays the blocks
// out, sanitises every line and is the only writer.

import { renderClaim, claimToJSON, neverClaimed } from '../core/claim.js';
import { formatUnitBare, TALLY, SHARE, OBLIGATIONS, AWARD_VALUE } from '../core/units.js';
import { ADVICE_DISCLAIMER, API_ORIGIN, AWARD_TYPE_SETS } from '../core/constants.js';
import { NEVER_CLAIMED_ITEMS, neverClaimedById } from '../core/never-claimed.js';
import { failureMessage } from '../query/failure.js';
import { competitionSentence, awardHref } from '../ui/view-model.js';
import {
  COPY, TITLES, LABELS, SCHEMA, TOOL, ATTRIBUTION, INDEPENDENCE, OFFLINE, privacyLine,
} from './copy.js';
import { escapeForJson } from './out.js';
import { csvRow } from './csv.js';

/** @typedef {import('./out.js').Block} Block */
/** @typedef {import('./out.js').Segment} Segment */

/* ------------------------------------------------------------------------------------------
 * A figure as layout segments.
 * ---------------------------------------------------------------------------------------- */

/**
 * The figure's text as segments that never break: the value with its unit, then the badge word,
 * which is the only part styling may touch.
 * @param {any} claim
 * @returns {Segment[]}
 */
export function figureSegments(claim) {
  const r = renderClaim(claim);
  const badge = '[' + r.badgeLabel + ']';
  if (!r.text.endsWith(' ' + badge)) {
    throw new TypeError('figureSegments: renderClaim text no longer ends with its badge.');
  }
  return [
    { text: r.text.slice(0, r.text.length - badge.length) + '[', atomic: true },
    { text: r.badgeLabel, atomic: true, style: 'badge' },
    { text: ']', atomic: true },
  ];
}

/**
 * The claim's accessible sentence as segments: value, unit and badge unbreakable, the note and the
 * provenance free to wrap.
 * @param {any} claim
 * @returns {Segment[]}
 */
export function plainSegments(claim) {
  const r = renderClaim(claim);
  const head = r.valueText + ', ' + r.badgeLabel + '.';
  if (!r.a11yLabel.startsWith(head)) {
    throw new TypeError('plainSegments: the accessible label no longer starts with the figure.');
  }
  return [{ text: head, atomic: true }, { text: r.a11yLabel.slice(head.length) }];
}

/**
 * The value at the precision the text shows, READ BACK FROM THE ONE RENDERER rather than
 * formatted a second time. A share is a decimal fraction, as the claim carries it; money is
 * dollars to the cent; a tally is a whole count. No rounding happens here: the digits are the
 * digits renderClaim printed, with the grouping and the currency sign taken off, and a share has
 * its decimal point moved two places by moving characters, not by dividing a float.
 * @param {any} claim
 * @returns {number}
 */
export function displayValue(claim) {
  const j = claimToJSON(claim);
  const lead = renderClaim(claim).valueText.split(' ')[0];
  if (j.unitKind === TALLY) return Number(lead.split(',').join(''));
  if (j.unitKind === SHARE) return Number(percentToFraction(lead));
  const bare = formatUnitBare(/** @type {number} */ (j.value), /** @type {any} */ (j.unitKind));
  return Number(bare.replace(/[^0-9.-]/g, ''));
}

/**
 * "98.8" to "0.988", "100.0" to "1.000", "5" to "0.05". Characters only.
 * @param {string} percent
 * @returns {string}
 */
export function percentToFraction(percent) {
  if (!/^[0-9]+(?:\.[0-9]+)?$/.test(percent)) {
    throw new TypeError('percentToFraction: expected the digits of a rendered share.');
  }
  const [whole, frac = ''] = percent.split('.');
  const padded = whole.padStart(3, '0');
  const head = padded.slice(0, padded.length - 2).replace(/^0+(?=[0-9])/, '');
  return head + '.' + padded.slice(-2) + frac;
}

/* ------------------------------------------------------------------------------------------
 * Text and plain.
 * ---------------------------------------------------------------------------------------- */

/** @param {string} text @param {number} [indent] @returns {Block} */
function para(text, indent) {
  return { kind: 'para', segments: [{ text }], indent: indent === undefined ? 2 : indent };
}

/** @param {string} text @param {boolean} plain @returns {Block[]} */
function heading(text, plain) {
  return [{ kind: 'blank' }, {
    kind: 'para',
    segments: [plain ? { text: text + '.' } : { text, style: 'heading' }],
  }];
}

/**
 * @param {any} claim
 * @param {string} label
 * @param {{plain:boolean, provenance?:boolean, indent?:number}} o
 * @returns {Block[]}
 */
function figureBlocks(claim, label, o) {
  const indent = o.indent === undefined ? 2 : o.indent;
  if (o.plain) {
    return [{ kind: 'para', segments: [{ text: label + ': ' }, ...plainSegments(claim)], indent: 0 }];
  }
  const r = renderClaim(claim);
  const out = [{ kind: 'para', segments: [{ text: label + ': ' }, ...figureSegments(claim)], indent, hanging: indent + 2 }];
  if (r.note) out.push(para(r.note, indent + 2));
  if (o.provenance) out.push(para(r.provenance, indent + 2));
  return /** @type {Block[]} */ (out);
}

/** @param {string} id @param {boolean} plain @returns {Block} */
function neverBlock(id, plain) {
  const item = neverClaimedById(id);
  const r = renderClaim(neverClaimed(item.sentence, { note: item.heading }));
  if (plain) return { kind: 'para', segments: [{ text: r.badgeLabel + ': ' + r.valueText }], indent: 0 };
  return {
    kind: 'para',
    segments: [
      { text: r.text.slice(0, r.text.length - r.badgeLabel.length - 2) },
      { text: '[', atomic: true },
      { text: r.badgeLabel, atomic: true, style: 'badge' },
      { text: ']', atomic: true },
    ],
    indent: 2,
  };
}

/**
 * Whether asking again could change a failure. The failure's own flag, unless the part that failed
 * says otherwise: an award set emptied by the entity filter is flagged retryable by its kind, but
 * asking again returns the same rows and drops them again.
 * @param {{failure:any, noRetry?:boolean}} item
 * @returns {boolean}
 */
export function retryHelps(item) {
  return item.noRetry !== true && item.failure.retryable === true;
}

/** @param {{failure:any, noRetry?:boolean}} item @param {boolean} plain @returns {Block[]} */
function failureBlocks(item, plain) {
  const indent = plain ? 0 : 2;
  return [
    { kind: 'para', segments: [{ text: COPY.missing + ' ' + failureMessage(item.failure) }], indent },
    { kind: 'para', segments: [{ text: retryHelps(item) ? COPY.retryable : COPY.notRetryable }], indent },
  ];
}

/**
 * @param {import('./report.js').Item} item
 * @param {boolean} plain
 * @returns {Block[]}
 */
function itemBlocks(item, plain) {
  const indent = plain ? 0 : 2;
  switch (item.t) {
    case 'gap':
      return [{ kind: 'blank' }];
    case 'text':
      return [para(item.text, indent)];
    case 'subheading':
      return [{ kind: 'blank' }, {
        kind: 'para',
        segments: [plain ? { text: item.text + '.' } : { text: item.text, style: 'heading' }],
        indent,
      }];
    case 'figure':
      return figureBlocks(item.claim, item.label, { plain, provenance: item.provenance });
    case 'reveal': {
      const r = renderClaim(item.claim);
      const segs = plain
        ? [{ text: r.valueText + ', ' + r.badgeLabel + ',', atomic: true }]
        : figureSegments(item.claim);
      /** @type {Segment[]} */
      const sentence = [];
      if (item.lead) sentence.push({ text: item.lead + ' ' });
      sentence.push(...segs);
      sentence.push({ text: ' ' + item.tail });
      const out = [{ kind: 'para', segments: sentence, indent, hanging: indent }];
      const inner = plain ? 0 : 4;
      if (r.note) out.push(para(r.note, inner));
      if (item.provenance || plain) out.push(para(r.provenance, inner));
      return /** @type {Block[]} */ (out);
    }
    case 'unavailable':
      return [para(COPY.unavailable(item.label) + ' ' + item.reason, indent)];
    case 'failure':
      return failureBlocks(item, plain);
    case 'never':
      return [neverBlock(item.id, plain)];
    case 'entity': {
      const who = item.uei ? item.name + ', UEI ' + item.uei : item.name;
      if (!item.claim) return [para(who, plain ? 0 : 4)];
      if (plain) {
        return [{ kind: 'para', segments: [{ text: who + ': ' }, ...plainSegments(item.claim)], indent: 0 }];
      }
      return [{ kind: 'para', segments: [{ text: who + ': ' }, ...figureSegments(item.claim)], indent: 4, hanging: 6 }];
    }
    case 'awards': {
      const out = [];
      for (const row of item.rows.slice(0, item.shown)) out.push(...awardBlocks(row, plain));
      return out;
    }
    case 'year':
      return yearBlocks(item.row, plain);
    case 'rows': {
      const out = [para(COPY.rowsIntro, indent)];
      for (const row of item.rows.slice(0, item.shown)) {
        out.push(plain
          ? { kind: 'para', segments: [{ text: row.name + ': ' }, ...plainSegments(row.claim)], indent: 0 }
          : { kind: 'para', segments: [{ text: row.name + ': ' }, ...figureSegments(row.claim)], indent: 4, hanging: 6 });
      }
      if (item.rows.length > item.shown) out.push(para(COPY.moreRows, indent));
      return /** @type {Block[]} */ (out);
    }
    case 'curve': {
      const out = [];
      for (const p of item.points.slice(0, item.shown)) {
        const value = plain ? plainSegments(p.awardValueClaim) : figureSegments(p.awardValueClaim);
        const share = plain ? plainSegments(p.cumulativeShareClaim) : figureSegments(p.cumulativeShareClaim);
        out.push({
          kind: 'para',
          segments: [{ text: p.label + ': ' }, ...value, { text: ' ' + COPY.runningShare + ' ' }, ...share],
          indent: plain ? 0 : 4,
          hanging: plain ? 0 : 6,
        });
      }
      if (item.points.length > item.shown) out.push(para(COPY.curveMore, indent));
      return /** @type {Block[]} */ (out);
    }
    default:
      return [];
  }
}

/** @param {any} row @param {boolean} plain @returns {Block[]} */
function awardBlocks(row, plain) {
  const link = awardHref(row.generatedInternalId === undefined ? row.awardId : row.generatedInternalId);
  const value = plain ? plainSegments(row.awardValueClaim) : figureSegments(row.awardValueClaim);
  const inner = plain ? 0 : 6;
  /** @type {Block[]} */
  const out = [
    { kind: 'para', segments: [{ text: row.awardId + ': ' }, ...value], indent: plain ? 0 : 4, hanging: inner },
  ];
  if (row.offersReceivedClaim) {
    const offers = plain ? plainSegments(row.offersReceivedClaim) : figureSegments(row.offersReceivedClaim);
    out.push({ kind: 'para', segments: [{ text: LABELS.offers + ': ' }, ...offers], indent: inner, hanging: plain ? 0 : inner + 2 });
    const offersNote = renderClaim(row.offersReceivedClaim).note;
    if (offersNote && !plain) out.push(para(offersNote, inner + 2));
  } else {
    out.push(para(LABELS.offers + ': ' + COPY.offersNotRecorded + '.', inner));
  }
  out.push(para(competitionSentence(row), inner));
  out.push({ kind: 'para', segments: [{ text: link, atomic: true }], indent: inner });
  return out;
}

/** @param {any} row @param {boolean} plain @returns {Block[]} */
function yearBlocks(row, plain) {
  const out = figureBlocks(row.obligationsClaim, row.label, { plain });
  const ch = row.change;
  const inner = plain ? 0 : 4;
  if (ch.deltaClaim) {
    out.push(...figureBlocks(ch.deltaClaim, COPY.changeFrom(ch.priorLabel) + ', ' + COPY.direction(ch.direction),
      { plain, indent: inner }));
  }
  if (ch.available === true) {
    out.push(...figureBlocks(ch.changeShareClaim, COPY.changeShareOf(ch.priorLabel), { plain, indent: inner, provenance: false }));
  } else if (ch.reason) {
    // With a dollar change above it, the reason explains the missing percentage; without one, it
    // explains why there is no change at all.
    const label = ch.deltaClaim ? COPY.changeShareOf(ch.priorLabel) : COPY.changeFrom(ch.priorLabel);
    out.push(para(label + ': ' + ch.reason, inner));
  }
  return out;
}

/**
 * The foot of every report: the date the source states about itself, the source, the statement
 * of independence, the advice disclaimer, and where the ten statements are.
 * @param {{sourceAsOf:string|null, sourceAsOfNotice:string|null}} report
 * @param {boolean} plain
 * @returns {Block[]}
 */
export function footerBlocks(report, plain) {
  const indent = plain ? 0 : 2;
  return [
    ...heading(TITLES.about, plain),
    para(report.sourceAsOf === null
      ? /** @type {string} */ (report.sourceAsOfNotice)
      : COPY.asOf(report.sourceAsOf), indent),
    para(ATTRIBUTION, indent),
    para(INDEPENDENCE, indent),
    para(ADVICE_DISCLAIMER, indent),
    // Nine of the ten statements sit beside the figures they qualify. The tenth qualifies the
    // report as a whole, so a report that printed figures closes with it, and all ten are
    // therefore in every full report, as all ten are on the page.
    ...(/** @type {any} */ (report).kind === 'report' ? [neverBlock('no-financial-denominators', plain)] : []),
    para(COPY.claimsPointer, indent),
  ];
}

/**
 * The report as layout blocks, for text or for plain sentences.
 * @param {import('./report.js').Report} report
 * @param {{plain?:boolean}} [options]
 * @returns {Block[]}
 */
export function reportBlocks(report, options = {}) {
  const plain = options.plain === true;
  /** @type {Block[]} */
  const out = [];
  for (const s of report.sections) {
    out.push(...heading(s.title, plain));
    for (const item of s.items) out.push(...itemBlocks(item, plain));
  }
  out.push(...footerBlocks(report, plain));
  // The first block is a blank line under nothing.
  if (out.length > 0 && out[0].kind === 'blank') out.shift();
  return out;
}

/* ------------------------------------------------------------------------------------------
 * JSON.
 * ---------------------------------------------------------------------------------------- */

/**
 * One figure, as the machine reads it: claimToJSON, the rendered text and provenance, and the
 * value at the precision the text shows.
 * @param {string} id
 * @param {string} label
 * @param {any} claim
 * @returns {object}
 */
export function figureJSON(id, label, claim) {
  const j = claimToJSON(claim);
  const r = renderClaim(claim);
  return {
    id,
    label,
    badge: j.badge,
    value: displayValue(claim),
    unit: j.unitKind,
    method: j.method,
    text: r.text,
    valueText: r.valueText,
    fiscalYear: j.fiscalYear,
    awardTypeSetId: j.awardTypeSetId,
    sourceAsOf: j.sourceAsOf,
    denominatorText: j.denominatorText,
    tallyNoun: j.tallyNoun,
    note: j.note,
    provenance: r.provenance,
  };
}

/** @param {{failure:any, noRetry?:boolean}} item @returns {object} */
function failureJSON(item) {
  const f = item.failure;
  return { kind: f.kind, what: f.what, reason: failureMessage(f), retryable: retryHelps(item) };
}

/** @param {string} id @returns {object} */
function neverJSON(id) {
  const item = neverClaimedById(id);
  return { id: item.id, heading: item.heading, sentence: item.sentence, badge: 'NEVER_CLAIMED' };
}

/**
 * @param {import('./report.js').Item} item
 * @returns {object|null}
 */
function itemJSON(item) {
  switch (item.t) {
    case 'text': return { type: 'text', text: item.text };
    case 'subheading': return { type: 'heading', text: item.text };
    case 'figure': return { type: 'figure', ...figureJSON(item.id, item.label, item.claim) };
    case 'reveal':
      return { type: 'figure', ...figureJSON(item.id, item.label, item.claim), sentence: { lead: item.lead, tail: item.tail } };
    case 'unavailable': return { type: 'unavailable', id: item.id, label: item.label, reason: item.reason };
    case 'failure': return { type: 'failure', ...failureJSON(item) };
    case 'never': return { type: 'neverClaimed', ...neverJSON(item.id) };
    case 'entity':
      return {
        type: 'entity',
        name: item.name,
        uei: item.uei,
        ...(item.claim ? { figure: figureJSON(item.id, /** @type {string} */ (item.label), item.claim) } : {}),
      };
    case 'awards':
      return {
        type: 'awards',
        // A figure that is not there is an absent key with a reason beside it, never a null.
        rows: item.rows.map((row) => ({
          awardId: row.awardId,
          link: awardHref(row.generatedInternalId === undefined ? row.awardId : row.generatedInternalId),
          figure: figureJSON('awardValue', LABELS.awardValue, row.awardValueClaim),
          ...(row.offersReceivedClaim
            ? { offers: figureJSON('offers', LABELS.offers, row.offersReceivedClaim) }
            : { offersUnavailable: COPY.offersNotRecorded }),
          competition: competitionSentence(row),
        })),
      };
    case 'year': {
      const row = item.row;
      const ch = row.change;
      return {
        type: 'year',
        label: row.label,
        fiscalYear: row.fiscalYear,
        figure: figureJSON('obligations', row.label, row.obligationsClaim),
        change: {
          priorLabel: ch.priorLabel,
          direction: ch.direction,
          available: ch.available === true,
          ...(ch.reason ? { reason: ch.reason } : {}),
          ...(ch.deltaClaim ? { delta: figureJSON('change', COPY.changeFrom(ch.priorLabel), ch.deltaClaim) } : {}),
          ...(ch.available === true
            ? { share: figureJSON('changeShare', COPY.changeShareOf(ch.priorLabel), ch.changeShareClaim) }
            : {}),
        },
      };
    }
    case 'rows':
      return {
        type: 'rows',
        id: item.id,
        rows: item.rows.map((row) => ({ name: row.name, figure: figureJSON(item.id, LABELS.categoryRow, row.claim) })),
      };
    case 'curve':
      return {
        type: 'curve',
        points: item.points.map((p) => ({
          awardId: p.label,
          rank: p.rank,
          awardValue: figureJSON('awardValue', LABELS.awardValue, p.awardValueClaim),
          cumulativeShare: figureJSON('curvePoint', LABELS.curvePoint, p.cumulativeShareClaim),
        })),
      };
    default:
      return null;
  }
}

/**
 * The fields every machine document carries.
 * @param {string} version
 * @returns {object}
 */
function common(version) {
  return {
    schema: SCHEMA,
    tool: { name: TOOL, version },
  };
}

/**
 * @param {string} version
 * @returns {object}
 */
function legal(version) {
  return {
    attribution: ATTRIBUTION,
    independence: INDEPENDENCE,
    disclaimer: ADVICE_DISCLAIMER,
    privacy: privacyLine(version),
  };
}

/**
 * The report as one JSON document.
 * @param {import('./report.js').Report} report
 * @param {{version:string, exitCode:number}} ctx
 * @returns {object}
 */
export function reportJSON(report, ctx) {
  const set = AWARD_TYPE_SETS[report.query.awardTypeSetId];
  return {
    ...common(ctx.version),
    command: 'report',
    outcome: report.kind === 'report' ? 'report'
      : (report.kind === 'refusal' || report.kind === 'uei-not-found' ? 'choice-required' : report.kind),
    query: {
      text: report.query.text,
      fiscalYear: report.query.fiscalYear,
      fiscalYearChosen: report.query.fyChosen,
      awardTypeSet: { id: set.id, label: set.label, codes: set.codes === null ? null : [...set.codes] },
      uei: report.query.uei,
    },
    source: {
      host: API_ORIGIN,
      asOf: report.sourceAsOf,
      asOfNotice: report.sourceAsOfNotice,
    },
    identity: report.identity,
    records: report.records.map((r) => ({ name: r.name, uei: r.uei })),
    sections: report.sections.map((s) => ({
      id: s.id,
      title: s.title,
      items: s.items.map(itemJSON).filter((x) => x !== null),
    })),
    neverClaimed: NEVER_CLAIMED_ITEMS.map((i) => neverJSON(i.id)),
    ...legal(ctx.version),
    exitCode: ctx.exitCode,
  };
}

/**
 * Serialise a machine document. Two space indent, the characters a terminal would act on escaped.
 * @param {object} doc
 * @returns {string}
 */
export function serialiseJSON(doc) {
  return escapeForJson(JSON.stringify(doc, null, 2)) + '\n';
}

/* ------------------------------------------------------------------------------------------
 * CSV.
 * ---------------------------------------------------------------------------------------- */

/**
 * The column headers. Each value column names its unit, and the four unit kinds never share one:
 * obligations and lifetime award value are different quantities, and a column that held both
 * would invite a sum nobody should do.
 */
export const CSV_HEADER = Object.freeze([
  'Section',
  'Figure',
  'Figure id',
  'Entity',
  'Unique entity identifier',
  'Figure as printed, with its unit and badge',
  'Badge',
  'Unit kind',
  'Dollars obligated in the fiscal year',
  'Lifetime award value in dollars, exercised options included',
  'Share of the stated denominator, as a decimal fraction',
  'Count of records',
  'Fiscal year',
  'Award type set',
  'Source as of',
  'Method',
  'Denominator in words',
  'Note',
  'Why there is no figure',
  'Detail',
]);

/**
 * @param {{section:string, label:string, id?:string, entity?:string|null, uei?:string|null,
 *   claim?:any, reason?:string|null, detail?:string|null}} r
 * @returns {unknown[]}
 */
function csvLine(r) {
  const cells = new Array(CSV_HEADER.length).fill(null);
  cells[0] = r.section;
  cells[1] = r.label;
  cells[2] = r.id === undefined ? null : r.id;
  cells[3] = r.entity === undefined ? null : r.entity;
  cells[4] = r.uei === undefined ? null : r.uei;
  if (r.claim) {
    const j = claimToJSON(r.claim);
    const rr = renderClaim(r.claim);
    const value = displayValue(r.claim);
    cells[5] = rr.text;
    cells[6] = j.badge;
    cells[7] = j.unitKind;
    cells[8] = j.unitKind === OBLIGATIONS ? value : null;
    cells[9] = j.unitKind === AWARD_VALUE ? value : null;
    cells[10] = j.unitKind === SHARE ? value : null;
    cells[11] = j.unitKind === TALLY ? value : null;
    cells[12] = j.fiscalYear;
    cells[13] = j.awardTypeSetId;
    cells[14] = j.sourceAsOf;
    cells[15] = j.method;
    cells[16] = j.denominatorText;
    cells[17] = j.note;
  }
  cells[18] = r.reason === undefined ? null : r.reason;
  cells[19] = r.detail === undefined ? null : r.detail;
  return cells;
}

/**
 * @param {string} sectionId
 * @param {import('./report.js').Item} item
 * @returns {unknown[][]}
 */
function itemCsv(sectionId, item) {
  const s = sectionId;
  switch (item.t) {
    case 'text':
      // A spreadsheet of a refusal or of a name that matched nothing still says why, in words.
      return s === 'refusal' || s === 'resolution'
        ? [csvLine({ section: s, label: 'Statement', id: 'statement', detail: item.text })]
        : [];
    case 'figure':
    case 'reveal':
      return [csvLine({ section: s, label: item.label, id: item.id, claim: item.claim })];
    case 'unavailable':
      return [csvLine({ section: s, label: item.label, id: item.id, reason: item.reason })];
    case 'failure':
      return [csvLine({
        section: s, label: COPY.missing, id: 'failure', reason: failureMessage(item.failure),
        detail: retryHelps(item) ? COPY.retryable : COPY.notRetryable,
      })];
    case 'entity':
      return [csvLine({
        section: s, label: item.label === undefined ? TITLES.records : item.label, id: item.id,
        entity: item.name, uei: item.uei, claim: item.claim,
      })];
    case 'awards': {
      const out = [];
      for (const row of item.rows) {
        const link = awardHref(row.generatedInternalId === undefined ? row.awardId : row.generatedInternalId);
        out.push(csvLine({
          section: s, label: LABELS.awardValue, id: 'awardValue', entity: row.awardId,
          claim: row.awardValueClaim, detail: competitionSentence(row) + ' ' + link,
        }));
        if (row.offersReceivedClaim) {
          out.push(csvLine({ section: s, label: LABELS.offers, id: 'offers', entity: row.awardId, claim: row.offersReceivedClaim }));
        } else {
          out.push(csvLine({ section: s, label: LABELS.offers, id: 'offers', entity: row.awardId, reason: COPY.offersNotRecorded }));
        }
      }
      return out;
    }
    case 'year': {
      const row = item.row;
      const ch = row.change;
      const out = [csvLine({ section: s, label: row.label, id: 'obligations', claim: row.obligationsClaim })];
      if (ch.deltaClaim) {
        out.push(csvLine({ section: s, label: COPY.changeFrom(ch.priorLabel), id: 'change', claim: ch.deltaClaim, detail: ch.direction }));
      }
      if (ch.available === true) {
        out.push(csvLine({ section: s, label: COPY.changeShareOf(ch.priorLabel), id: 'changeShare', claim: ch.changeShareClaim }));
      } else if (ch.reason) {
        out.push(csvLine({ section: s, label: COPY.changeShareOf(ch.priorLabel), id: 'changeShare', reason: ch.reason }));
      }
      return out;
    }
    case 'rows':
      return item.rows.map((row) => csvLine({ section: s, label: LABELS.categoryRow, id: item.id, entity: row.name, claim: row.claim }));
    case 'curve':
      return item.points.map((p) => csvLine({ section: s, label: LABELS.curvePoint, id: 'curvePoint', entity: p.label, claim: p.cumulativeShareClaim }));
    default:
      return [];
  }
}

/**
 * The rows every CSV ends with: the date, the source, independence and the disclaimer, in the
 * detail column.
 * @param {{sourceAsOf:string|null, sourceAsOfNotice:string|null}} report
 * @returns {unknown[][]}
 */
function aboutCsv(report) {
  const about = (label, id, detail) => csvLine({ section: 'about', label, id, detail });
  return [
    about('Source as of', 'sourceAsOf', report.sourceAsOf === null ? report.sourceAsOfNotice : COPY.asOf(report.sourceAsOf)),
    about('Source', 'attribution', ATTRIBUTION),
    about('Independence', 'independence', INDEPENDENCE),
    about('Not advice', 'disclaimer', ADVICE_DISCLAIMER),
  ];
}

/**
 * The report as CSV text.
 * @param {import('./report.js').Report} report
 * @returns {string}
 */
export function reportCsv(report) {
  const rows = [CSV_HEADER.slice()];
  for (const sec of report.sections) {
    for (const item of sec.items) rows.push(...itemCsv(sec.id, item));
  }
  rows.push(...aboutCsv(report));
  return rows.map((r) => csvRow(r)).join('\n') + '\n';
}

/* ------------------------------------------------------------------------------------------
 * The offline commands.
 * ---------------------------------------------------------------------------------------- */

/**
 * @param {{plain?:boolean}} [options]
 * @returns {Block[]}
 */
export function claimsBlocks(options = {}) {
  const plain = options.plain === true;
  /** @type {Block[]} */
  const out = [
    { kind: 'para', segments: [plain ? { text: TITLES.claims + '.' } : { text: TITLES.claims, style: 'heading' }] },
    para(OFFLINE.claimsIntro, plain ? 0 : 2),
  ];
  for (const item of NEVER_CLAIMED_ITEMS) {
    out.push({ kind: 'blank' });
    out.push({
      kind: 'para',
      segments: [plain ? { text: item.heading } : { text: item.heading, style: 'heading' }],
      indent: plain ? 0 : 2,
    });
    out.push(neverBlock(item.id, plain));
  }
  return out;
}

/** @param {string} version @returns {object} */
export function claimsJSON(version) {
  return {
    ...common(version),
    command: 'claims',
    neverClaimed: NEVER_CLAIMED_ITEMS.map((i) => neverJSON(i.id)),
    ...legal(version),
  };
}

/** @returns {string} */
export function claimsCsv() {
  const rows = [['Identifier', 'Heading', 'Statement', 'Badge']];
  for (const i of NEVER_CLAIMED_ITEMS) rows.push([i.id, i.heading, i.sentence, 'NEVER_CLAIMED']);
  return rows.map((r) => csvRow(r)).join('\n') + '\n';
}

/**
 * @param {string} text
 * @param {{uei:string, name:string, matched:string}[]} found
 * @param {{plain?:boolean}} [options]
 * @returns {Block[]}
 */
export function suggestBlocks(text, found, options = {}) {
  const plain = options.plain === true;
  const indent = plain ? 0 : 2;
  /** @type {Block[]} */
  const out = [
    { kind: 'para', segments: [plain ? { text: TITLES.suggest + '.' } : { text: TITLES.suggest, style: 'heading' }] },
  ];
  if (found.length === 0) {
    out.push(para(OFFLINE.suggestNone, indent));
    return out;
  }
  out.push(para(OFFLINE.suggestIntro(text), indent));
  out.push(para(OFFLINE.suggestLevels, indent));
  out.push({ kind: 'blank' });
  for (const f of found) out.push(para(f.name + ', UEI ' + f.uei, plain ? 0 : 4));
  return out;
}

/**
 * @param {string} version
 * @param {string} text
 * @param {{uei:string, name:string, matched:string}[]} found
 * @returns {object}
 */
export function suggestJSON(version, text, found) {
  return {
    ...common(version),
    command: 'suggest',
    query: { text },
    source: 'the name index bundled with this package; names and identifiers only',
    note: found.length === 0 ? OFFLINE.suggestNone : OFFLINE.suggestLevels,
    suggestions: found.map((f) => ({ name: f.name, uei: f.uei, matched: f.matched })),
  };
}

/**
 * @param {{uei:string, name:string, matched:string}[]} found
 * @returns {string}
 */
export function suggestCsv(found) {
  const rows = [['Name', 'Unique entity identifier', 'How it matched']];
  for (const f of found) rows.push([f.name, f.uei, f.matched]);
  return rows.map((r) => csvRow(r)).join('\n') + '\n';
}
