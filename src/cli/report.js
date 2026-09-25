// THE REPORT, ASSEMBLED. It decides the order things are asked in and what each section holds.
//
// IT COMPUTES NOTHING AND FORMATS NOTHING. Every figure comes from the same modules the page
// calls: the identity layer resolves the name, src/api/hero.js builds the competition split and
// the concentration view, src/api/second-definition.js fetches and refuses the second
// definition, src/analysis turns rows into claims, and src/api/dimensions.js says which four
// category questions are asked and in what words. What comes back from here is a document model
// of sections holding claims, sentences and failures, and src/cli/render.js turns that model into
// text, JSON or CSV through renderClaim alone.
//
// THE ORDER IS THE PAGE'S, WITH THREE THINGS THE PAGE GOT WRONG PUT RIGHT.
//
//   1. The date the source publishes about itself is AWAITED before a single claim is built, so
//      every provenance line carries it. The page used to race it.
//   2. The entity breakdown is paged ONCE and handed to both of its consumers: the third route of
//      the reconciliation and definition one of the second definition.
//   3. The fiscal year was checked against the current fiscal year before the run started, in
//      src/cli/main.js, so a year that has not begun is never asked for.
//
// THE HUMAN STEP STAYS. More than one parent level record for the name ends the run with the
// records and their identifiers and no figure at all. --uei names one of them, and that choice is
// recorded as made by the option rather than borrowed from the page's wording.
//
// ONE FIGURE THE FACADE OFFERS IS NOT ASKED FOR: the award count. The award count endpoint
// answers a recipient filtered request with the count for every recipient in the fiscal year,
// and says so in its own response: the recorded answer in test/fixtures/api/award-count-fy2025.json
// carries the message that the recipient filter was not used, beside a count in the millions.
// Printed here it would be a REPORTED figure about this entity that is not about this entity, so
// it is left out, the same way the page leaves it out.
//
// Every part after the identity runs at once, as it does on the page, and each part fails on its
// own: a failed breakdown costs its sections and nothing else. An interrupt stops everything and
// the model says so.

import { metaOf, searchLargestAwards, fetchCompetitionRecords, assembleHero, assemblyFailure, HERO_WHAT } from '../api/hero.js';
import {
  fetchEntityBreakdown, fetchSecondDefinitionArms, secondDefinition, SECOND_DEFINITION_WHAT,
} from '../api/second-definition.js';
import { CATEGORY_PANELS, SPINE_YEARS } from '../api/dimensions.js';
import { categoryRowClaims } from '../api/categories.js';
import { SOURCE_AS_OF_UNAVAILABLE } from '../api/source-date.js';
import { topRowShare, herfindahlIndex, obligationsByYear } from '../analysis/index.js';
import { pickCandidate } from '../identity/candidates.js';
import { reported, METHODS } from '../core/claim.js';
import { OBLIGATIONS } from '../core/units.js';
import { FISCAL_YEAR_FLOOR, AWARD_TYPE_SETS } from '../core/constants.js';
import { revealSentence, RECEIPT_ROWS, RANKED_ROWS } from '../ui/view-model.js';
import { COPY, TITLES, LABELS, PROGRESS } from './copy.js';

/**
 * The date string the source sends is printed in every provenance line, so it is held to the
 * shape it has always had. Anything else is treated as no date at all rather than printed.
 */
const AS_OF_SHAPE = /^[0-9]{2}\/[0-9]{2}\/[0-9]{4}$/;

/**
 * @typedef {{t:'text', text:string}
 *   |{t:'subheading', text:string}
 *   |{t:'figure', id:string, label:string, claim:any, provenance?:boolean}
 *   |{t:'reveal', id:string, label:string, lead:string, claim:any, tail:string, provenance?:boolean}
 *   |{t:'unavailable', id:string, label:string, reason:string}
 *   |{t:'failure', failure:any, noRetry?:boolean}
 *   |{t:'never', id:string}
 *   |{t:'entity', id:string, name:string, uei:string|null, label?:string, claim?:any}
 *   |{t:'awards', rows:any[], shown:number}
 *   |{t:'year', row:any}
 *   |{t:'rows', id:string, rows:{name:string, claim:any}[], shown:number}
 *   |{t:'curve', points:any[], shown:number}
 *   |{t:'gap'}} Item
 */

/**
 * @typedef {Object} Section
 * @property {string} id
 * @property {string} title
 * @property {Item[]} items
 */

/**
 * @typedef {Object} Report
 * @property {'report'|'refusal'|'uei-not-found'|'no-records'|'failed'|'interrupted'} kind
 * @property {object} query
 * @property {string|null} sourceAsOf
 * @property {string|null} sourceAsOfNotice
 * @property {object|null} identity
 * @property {{name:string, uei:string}[]} records
 * @property {Section[]} sections
 */

/**
 * @param {string} id @param {string} title @param {Item[]} items
 * @returns {Section}
 */
function section(id, title, items) {
  return { id, title, items };
}

/**
 * A part that threw is a named failure, never a crash and never a partial figure.
 * @template T
 * @param {Promise<T>} p
 * @param {string} what
 * @returns {Promise<T|{ok:false, failure:any, threw:true}>}
 */
async function settle(p, what) {
  try {
    return await p;
  } catch (e) {
    return { ok: false, failure: assemblyFailure(what, e), threw: true };
  }
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
export function checkedAsOf(value) {
  return typeof value === 'string' && AS_OF_SHAPE.test(value) ? value : null;
}

/**
 * Whether any section holds a named failure, or the rollup was suppressed because part of the
 * child list did not arrive. Either one makes the run exit with code one. A figure the analysis
 * declined to compute, with its reason, is an answer rather than a failure and does not.
 * @param {Report} report
 * @returns {boolean}
 */
export function hasFailure(report) {
  if (report.identity && /** @type {any} */ (report.identity).rollupComplete === false) return true;
  return report.sections.some((s) => s.items.some((i) => i.t === 'failure'));
}

/**
 * Gather the report.
 *
 * @param {Object} args
 * @param {any} args.api From createApi(), over the command line's fetch.
 * @param {string} args.text What the reader typed.
 * @param {number} args.fiscalYear
 * @param {'default'|'flag'} args.fyChosen
 * @param {number} args.latestFiscalYear
 * @param {string} args.awardTypeSetId
 * @param {string|null} args.uei
 * @param {AbortSignal} args.signal
 * @param {(line:string) => void} [args.progress]
 * @param {() => void} [args.onCold]
 * @returns {Promise<Report>}
 */
export async function gatherReport(args) {
  const { api, text, fiscalYear, awardTypeSetId, signal } = args;
  const progress = args.progress === undefined ? () => {} : args.progress;
  const onCold = args.onCold;
  const uei = args.uei === undefined ? null : args.uei;
  const query = {
    text,
    fiscalYear,
    fyChosen: args.fyChosen,
    latestFiscalYear: args.latestFiscalYear,
    awardTypeSetId,
    uei,
  };
  const empty = {
    query, sourceAsOf: null, sourceAsOfNotice: null, identity: null, records: [], sections: [],
  };
  const stopped = () => signal !== undefined && signal.aborted;

  // ONE. The date first, because every claim below carries it.
  progress(PROGRESS.asOf);
  const asOf = await api.sourceAsOf({ signal });
  if (stopped()) return { ...empty, kind: 'interrupted' };
  const sourceAsOf = checkedAsOf(asOf && asOf.sourceAsOf);
  const base = {
    ...empty,
    sourceAsOf,
    sourceAsOfNotice: sourceAsOf === null ? SOURCE_AS_OF_UNAVAILABLE : null,
  };

  // TWO. The name to parent level records, and the decision.
  progress(PROGRESS.list);
  const found = await settle(api.startQuery({ text, signal, onCold }), 'the list of entities matching that name');
  if (stopped()) return { ...base, kind: 'interrupted' };
  if (!found.ok) {
    return { ...base, kind: 'failed', sections: [section('resolution', TITLES.resolution, [{ t: 'failure', failure: found.failure }])] };
  }
  if (found.outcome === 'no-records') {
    return {
      ...base,
      kind: 'no-records',
      sections: [section('resolution', TITLES.resolution, [
        { t: 'text', text: found.sentence },
        { t: 'text', text: COPY.noRecordsHint },
      ])],
    };
  }

  let choice;
  let choiceSentence;
  if (uei !== null) {
    const match = found.candidates.find((c) => c.uei === uei);
    if (match === undefined) {
      return {
        ...base,
        kind: 'uei-not-found',
        records: found.candidates.map((c) => ({ name: c.name, uei: c.uei })),
        sections: [section('resolution', TITLES.resolution, [
          { t: 'text', text: COPY.ueiNotFound(uei) },
          { t: 'subheading', text: TITLES.records },
          ...found.candidates.map((c) => recordItem(c)),
          { t: 'gap' },
          { t: 'text', text: COPY.pickWithUei },
        ])],
      };
    }
    choice = pickCandidate(found.candidates, uei, 'picked-by-flag');
    choiceSentence = COPY.choiceByFlag(match.name, match.uei);
  } else if (found.outcome === 'choice-required') {
    const refusal = found.refusal;
    return {
      ...base,
      kind: 'refusal',
      records: refusal.splitRecords.map((c) => ({ name: c.name, uei: c.uei })),
      sections: [section('refusal', TITLES.refusal, [
        { t: 'text', text: refusal.sentence },
        { t: 'subheading', text: TITLES.records },
        ...refusal.splitRecords.map((c) => recordItem(c)),
        { t: 'gap' },
        { t: 'text', text: COPY.pickWithUei },
        { t: 'never', id: 'not-everything-a-company-gets' },
      ])],
    };
  } else {
    choice = found.choice;
    choiceSentence = found.sentence;
  }

  // THREE. The identity, the parent claims and the two way reconciliation.
  progress(PROGRESS.subject(choice.candidate.name, choice.candidate.uei, fiscalYear));
  const subject = await settle(api.loadSubject({ choice, fiscalYear, awardTypeSetId, sourceAsOf, signal, onCold }),
    'the profile for the entity you chose');
  if (stopped()) return { ...base, kind: 'interrupted' };
  if (!subject.ok) {
    return { ...base, kind: 'failed', sections: [section('subject', TITLES.subject, [{ t: 'failure', failure: subject.failure }])] };
  }
  const identity = subject.identity;

  // FOUR. Everything else at once. The breakdown is started ONCE and both consumers await it.
  progress(PROGRESS.rest);
  const breakdown = fetchEntityBreakdown(api, identity, { signal, onCold });
  const [hero, spine, categories, arms, three] = await Promise.all([
    settle(loadHero(api, identity, signal, onCold), HERO_WHAT.hero),
    settle(api.obligationsByFiscalYear({
      recipientId: identity.recipientId,
      fiscalYear: identity.fiscalYear,
      spanYears: SPINE_YEARS,
      awardTypeSetId: identity.awardTypeSetId,
      sourceAsOf: identity.sourceAsOf,
      signal,
      onCold,
    }), 'obligations by fiscal year'),
    Promise.all(CATEGORY_PANELS.map((spec) => settle(api.category({
      dimension: spec.dimension,
      recipientId: identity.recipientId,
      fiscalYear: identity.fiscalYear,
      awardTypeSetId: identity.awardTypeSetId,
      signal,
      onCold,
    }), 'the ' + spec.rowNoun + ' breakdown'))),
    settle(fetchSecondDefinitionArms(api, { identity, queryText: text, breakdown, signal, onCold }),
      SECOND_DEFINITION_WHAT),
    settle(api.reconcileThreeWays({
      identity,
      parentReportedTotal: subject.profile.totalObligations,
      sourceAsOf: identity.sourceAsOf,
      breakdown,
      signal,
      onCold,
    }), 'the entity breakdown'),
  ]);
  if (stopped()) return { ...base, kind: 'interrupted' };

  return {
    ...base,
    kind: 'report',
    identity: {
      name: identity.name,
      uei: identity.uei,
      level: identity.level,
      chosenHow: identity.chosenHow,
      subjectSentence: identity.subjectSentence,
      choiceSentence,
      rollupComplete: identity.rollupComplete,
      alternateNames: [...identity.alternateNames],
    },
    sections: [
      subjectSection(identity, choiceSentence, query, subject),
      parentSection(subject.detail),
      reconciliationSection(subject, three),
      competitionSection(identity, hero),
      buyersSection(identity, categories),
      concentrationSection(hero),
      spineSection(identity, spine),
      definitionSection(identity, arms),
      childrenSection(identity),
    ],
  };
}

/** @param {{name:string, uei:string}} c @returns {Item} */
function recordItem(c) {
  return { t: 'entity', id: 'record', name: c.name, uei: c.uei };
}

/**
 * The hero, through the same three steps the page takes.
 * @returns {Promise<any>}
 */
async function loadHero(api, identity, signal, onCold) {
  const search = await searchLargestAwards(api.client, identity, { signal, onCold });
  if (!search.ok) return { ok: false, search };
  const awardDetails = await fetchCompetitionRecords(api.client, search.kept, { signal });
  return {
    ok: true,
    search,
    assembled: assembleHero({ kept: search.kept, awardDetails, meta: search.meta }),
  };
}

/* ------------------------------------------------------------------------------------------
 * The sections, in the order they print.
 * ---------------------------------------------------------------------------------------- */

function subjectSection(identity, choiceSentence, query, subject) {
  /** @type {Item[]} */
  const items = [
    { t: 'text', text: identity.subjectSentence },
    { t: 'text', text: choiceSentence },
    {
      t: 'text',
      text: query.fyChosen === 'flag'
        ? COPY.fiscalYearChosen(identity.fiscalYear, identity.fiscalYear === query.latestFiscalYear)
        : COPY.fiscalYearDefault(identity.fiscalYear),
    },
  ];
  items.push({ t: 'text', text: COPY.awardTypeSet(AWARD_TYPE_SETS[identity.awardTypeSetId]) });
  if (subject.detail && subject.detail.noFederalAwards && subject.detail.sentence) {
    items.push({ t: 'text', text: subject.detail.sentence });
  }
  for (const d of subject.disclosures) {
    items.push({ t: 'text', text: d.sentence === undefined ? d.note : d.sentence });
  }
  if (!identity.rollupComplete) items.push({ t: 'text', text: COPY.rollupIncomplete });
  items.push({ t: 'never', id: 'obligations-are-not-revenue' });
  items.push({ t: 'never', id: 'parent-tree-self-reported' });
  return section('subject', TITLES.subject, items);
}

function parentSection(detail) {
  /** @type {Item[]} */
  const items = [
    { t: 'figure', id: 'parentTotal', label: LABELS.parentTotal, claim: detail.totalClaim, provenance: true },
    { t: 'figure', id: 'transactions', label: LABELS.transactions, claim: detail.transactionsClaim },
    { t: 'figure', id: 'declaredNames', label: LABELS.declaredNames, claim: detail.alternateNamesClaim },
  ];
  return section('parent', TITLES.parent, items);
}

function reconciliationSection(subject, three) {
  const arrived = three && three.ok === true && three.armsMissing === false;
  const rec = arrived ? three.reconciliation : subject.reconciliation;
  /** @type {Item[]} */
  const items = [];
  if (!rec.ok) {
    items.push({ t: 'failure', failure: rec.failure });
    return section('reconciliation', TITLES.reconciliation, items);
  }
  // Each claim in the narrative gets the stable id of the arm or residual it came from.
  const ids = new Map();
  ids.set(rec.childCountClaim, 'registeredChildren');
  for (const arm of rec.arms) ids.set(arm.claim, arm.id);
  for (const r of rec.residuals) ids.set(r.claim, r.id);
  // The narrative is one sentence on the page: a figure, then the words that continue it. Where a
  // text segment carries on from the figure before it, starting in lower case, the two print as
  // one sentence here too rather than as a figure followed by a fragment.
  const narrative = rec.narrative;
  for (let i = 0; i < narrative.length; i += 1) {
    const seg = narrative[i];
    const next = narrative[i + 1];
    if (seg.kind === 'claim') {
      const id = ids.has(seg.claim) ? ids.get(seg.claim) : 'reconciliation';
      if (next && next.kind === 'text' && /^[a-z]/.test(next.text)) {
        items.push({
          t: 'reveal', id, label: seg.label, lead: '', claim: seg.claim, tail: next.text, provenance: true,
        });
        i += 1;
      } else {
        items.push({ t: 'figure', id, label: seg.label, claim: seg.claim, provenance: true });
      }
    } else {
      items.push({ t: 'text', text: seg.text });
    }
  }
  if (!arrived) {
    items.push({ t: 'text', text: COPY.thirdArmMissing });
    const why = three && three.ok === true ? three.breakdownFailure : (three ? three.failure : null);
    if (why) items.push({ t: 'failure', failure: why });
  }
  // The arm that answers a different question says so beside its figure, as a note on its claim,
  // and the narrative repeats it once as a sentence. Nothing is differenced across the two.
  items.push({ t: 'never', id: 'parent-tree-self-reported' });
  return section('reconciliation', TITLES.reconciliation, items);
}

function competitionSection(identity, hero) {
  /** @type {Item[]} */
  const items = [];
  if (hero.threw) {
    items.push({ t: 'failure', failure: hero.failure });
    return section('competition', TITLES.competition, items);
  }
  if (!hero.ok) {
    // An emptied set is not a request that failed: asking again returns the same rows and drops
    // them again, so it offers no retry, exactly as the page does.
    items.push({ t: 'failure', failure: hero.search.failure, noRetry: hero.search.emptied === true });
    if (hero.search.excludedRowCountClaim) {
      items.push({ t: 'figure', id: 'droppedRowCount', label: LABELS.droppedRowCount, claim: hero.search.excludedRowCountClaim });
    }
    return section('competition', TITLES.competition, items);
  }
  const { assembled, search } = hero;
  const h = assembled.hero;
  if (!h.ok) {
    items.push({ t: 'failure', failure: h.failure });
    return section('competition', TITLES.competition, items);
  }
  const sb = h.soleBidder;
  if (sb.available === true) {
    const reveal = revealSentence(identity);
    items.push({
      t: 'reveal', id: 'soleBidderShare', label: LABELS.soleBidderShare,
      lead: reveal.lead, claim: sb.soleBidderShareClaim, tail: reveal.tail, provenance: true,
    });
    if (sb.isFloor) items.push({ t: 'text', text: COPY.heroFloor });
    items.push({ t: 'figure', id: 'notCompetedValue', label: LABELS.notCompetedValue, claim: sb.notCompetedValueClaim });
    items.push({ t: 'figure', id: 'totalValue', label: LABELS.totalValue, claim: sb.totalValueClaim });
  } else {
    items.push({ t: 'unavailable', id: 'soleBidderShare', label: LABELS.soleBidderShare, reason: sb.reason });
  }
  items.push({ t: 'figure', id: 'heroAwardCount', label: LABELS.heroAwardCount, claim: sb.awardCountClaim });
  items.push({ t: 'figure', id: 'notCompetedCount', label: LABELS.notCompetedCount, claim: sb.notCompetedCountClaim });
  items.push({ t: 'figure', id: 'noCompetitionFieldCount', label: LABELS.noCompetitionFieldCount, claim: sb.noCompetitionFieldCountClaim });
  items.push({ t: 'figure', id: 'negativeValueCount', label: LABELS.negativeValueCount, claim: sb.negativeRowCountClaim });
  items.push({ t: 'figure', id: 'arrivedRecordCount', label: LABELS.arrivedRecordCount, claim: assembled.detailCountClaim });
  items.push({ t: 'figure', id: 'droppedRowCount', label: LABELS.droppedRowCount, claim: search.excludedRowCountClaim });
  if (h.oneOffer && h.oneOffer.available === true) {
    items.push({ t: 'figure', id: 'oneOfferShare', label: LABELS.oneOfferShare, claim: h.oneOffer.oneOfferShareClaim, provenance: true });
  } else if (h.oneOffer) {
    items.push({ t: 'unavailable', id: 'oneOfferShare', label: LABELS.oneOfferShare, reason: h.oneOffer.reason });
  }
  items.push({ t: 'text', text: COPY.receipts });
  items.push({
    t: 'awards',
    rows: [...h.awards].sort((a, b) => b.awardValueClaim.value - a.awardValueClaim.value),
    shown: RECEIPT_ROWS,
  });
  items.push({ t: 'never', id: 'award-value-is-lifetime' });
  items.push({ t: 'never', id: 'no-losing-bidders' });
  return section('competition', TITLES.competition, items);
}

function buyersSection(identity, categories) {
  /** @type {Item[]} */
  const items = [];
  const meta = metaOf(identity);
  CATEGORY_PANELS.forEach((spec, i) => {
    const result = categories[i];
    const key = spec.dimension;
    items.push({ t: 'subheading', text: COPY.dimensionHeading(spec.rowNoun) });
    if (!result.ok) {
      items.push({ t: 'failure', failure: result.failure });
      return;
    }
    let top;
    let rows;
    let hhi = null;
    try {
      top = topRowShare({ rows: result.rows, method: spec.method, rowNoun: spec.rowNoun, meta });
      rows = categoryRowClaims(result.rows, meta);
      if (spec.herfindahl) hhi = herfindahlIndex(result.rows, spec.rowNoun, meta);
    } catch (e) {
      items.push({ t: 'failure', failure: assemblyFailure('the ' + spec.rowNoun + ' breakdown', e) });
      return;
    }
    if (top.available === true) {
      items.push({
        t: 'reveal', id: key + '.topShare', label: LABELS.topShare + ', by ' + spec.rowNoun,
        lead: '', claim: top.topShareClaim, tail: spec.tailText.trim(), provenance: true,
      });
      items.push({ t: 'text', text: spec.topLabel + top.topName + '.' });
      items.push({ t: 'figure', id: key + '.topAmount', label: LABELS.topAmount, claim: top.topAmountClaim });
      items.push({ t: 'figure', id: key + '.total', label: LABELS.categoryTotal, claim: top.totalClaim });
    } else {
      items.push({ t: 'unavailable', id: key + '.topShare', label: 'the single ' + spec.noun + ' share', reason: top.reason });
    }
    items.push({ t: 'figure', id: key + '.rowCount', label: LABELS.rowCount, claim: top.rowCountClaim });
    items.push({ t: 'figure', id: key + '.negativeRowCount', label: LABELS.negativeRowCount, claim: top.negativeRowCountClaim });
    if (hhi !== null) {
      if (hhi.available === true) {
        items.push({ t: 'figure', id: key + '.herfindahl', label: LABELS.herfindahl, claim: hhi.indexClaim, provenance: true });
      } else {
        items.push({ t: 'unavailable', id: key + '.herfindahl', label: LABELS.herfindahl, reason: hhi.reason });
      }
    }
    if (rows.length > 0) {
      items.push({
        t: 'rows',
        id: key,
        rows: [...rows].sort((a, b) => b.claim.value - a.claim.value),
        shown: RANKED_ROWS,
      });
    }
  });
  items.push({ t: 'never', id: 'classified-gap-unmeasurable' });
  return section('buyers', TITLES.buyers, items);
}

function concentrationSection(hero) {
  /** @type {Item[]} */
  const items = [];
  if (hero.threw || !hero.ok) {
    items.push({ t: 'text', text: COPY.concentrationNeedsSearch });
    return section('concentration', TITLES.concentration, items);
  }
  const c = hero.assembled.concentration;
  if (!c.ok) {
    items.push({ t: 'failure', failure: c.failure });
    return section('concentration', TITLES.concentration, items);
  }
  // The page draws this as a curve with an equivalent table, one row per contract. The same
  // rows print here, the largest first, each with the running share of the whole set it brings
  // the total to. No single point is lifted out and interpreted: the rows are the figure.
  if (c.cumulative.available === true) {
    items.push({ t: 'text', text: COPY.curveIntro });
    items.push({ t: 'curve', points: c.cumulative.points, shown: RANKED_ROWS });
  } else {
    items.push({ t: 'unavailable', id: 'curve', label: LABELS.curve, reason: c.cumulative.reason });
  }
  if (c.topAward.available === true) {
    items.push({ t: 'figure', id: 'topAwardShare', label: LABELS.topAwardShare, claim: c.topAward.topShareClaim, provenance: true });
  } else {
    items.push({ t: 'unavailable', id: 'topAwardShare', label: LABELS.topAwardShare, reason: c.topAward.reason });
  }
  items.push({ t: 'never', id: 'subawards-excluded' });
  return section('concentration', TITLES.concentration, items);
}

function spineSection(identity, result) {
  /** @type {Item[]} */
  const items = [];
  if (!result.ok) {
    items.push({ t: 'failure', failure: result.failure });
    return section('spine', TITLES.spine, items);
  }
  let spine;
  try {
    spine = obligationsByYear({ points: result.points, meta: metaOf(identity) });
  } catch (e) {
    items.push({ t: 'failure', failure: assemblyFailure('obligations by fiscal year', e) });
    return section('spine', TITLES.spine, items);
  }
  if (spine.available !== true) {
    items.push({ t: 'unavailable', id: 'spine', label: 'obligations by fiscal year', reason: spine.reason });
  } else {
    for (const row of spine.points) items.push({ t: 'year', row });
    if (spine.points[0].fiscalYear === FISCAL_YEAR_FLOOR) items.push({ t: 'text', text: result.floorNotice });
  }
  items.push({ t: 'never', id: 'not-outlays' });
  items.push({ t: 'never', id: 'floor-2008' });
  return section('spine', TITLES.spine, items);
}

function definitionSection(identity, arms) {
  /** @type {Item[]} */
  const items = [];
  if (arms.threw) {
    items.push({ t: 'failure', failure: arms.failure });
    return section('definition', TITLES.definition, items);
  }
  const result = secondDefinition({ ...arms, identity });
  if (!result.ok) {
    items.push({ t: 'failure', failure: result.failure });
    return section('definition', TITLES.definition, items);
  }
  const v = result.delta;
  if (v.available !== true) {
    items.push({ t: 'unavailable', id: 'definitionGap', label: 'the second definition of the company', reason: v.reason });
    return section('definition', TITLES.definition, items);
  }
  items.push({ t: 'text', text: COPY.definitionIntro });
  items.push({ t: 'figure', id: 'parentRollupTotal', label: LABELS.parentRollupTotal, claim: v.parentRollupTotalClaim, provenance: true });
  items.push({ t: 'figure', id: 'nameMatchTotal', label: LABELS.nameMatchTotal, claim: v.nameMatchTotalClaim, provenance: true });
  items.push({ t: 'figure', id: 'definitionGap', label: LABELS.definitionGap, claim: v.deltaClaim, provenance: true });
  items.push({ t: 'figure', id: 'gapEntityCount', label: LABELS.gapEntityCount, claim: v.gapEntityCountClaim });
  if (v.gapEntities.length === 0) {
    items.push({ t: 'text', text: COPY.gapNone });
  } else {
    items.push({ t: 'text', text: COPY.gapIntro });
    for (const e of v.gapEntities) {
      items.push({ t: 'entity', id: 'gapEntity', name: e.name, uei: e.uei, label: LABELS.gapAmount, claim: e.amountClaim });
    }
  }
  items.push({ t: 'never', id: 'not-everything-a-company-gets' });
  return section('definition', TITLES.definition, items);
}

function childrenSection(identity) {
  /** @type {Item[]} */
  const items = [{ t: 'text', text: COPY.childrenIntro }];
  // Badged, where the page prints these amounts bare in a table under a badged total. Each one is
  // REPORTED by the children endpoint for the same explicit fiscal year, on every award type,
  // which is exactly what the reconciliation's own child claims say.
  for (const c of identity.children) {
    items.push({
      t: 'entity',
      id: 'childEntity',
      name: c.name,
      uei: c.uei,
      label: LABELS.childAmount,
      claim: reported(c.obligations, OBLIGATIONS, METHODS.RECIPIENT_CHILDREN, {
        fiscalYear: identity.fiscalYear,
        awardTypeSetId: 'all',
        sourceAsOf: identity.sourceAsOf,
      }),
    });
  }
  return section('children', TITLES.children, items);
}
