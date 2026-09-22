// The controller. It owns the one period, the chosen entity, and the order the panels fill in.
//
// IT COMPUTES NOTHING. Fetching belongs to src/api, arithmetic belongs to src/analysis, and
// resolution belongs to src/identity. This file decides WHEN each of those runs and WHERE the
// result is mounted, which is the only part of the page that is genuinely a render concern.
//
// WAVE RENDERING IS MANDATORY, DESIGN 6.3, because the source is slow when it is cold and fast
// once it is warm: the same query was measured at 26.5 seconds cold and 0.41 seconds warm.
//
//   Wave 0   the date the source publishes about itself. It never blocks anything and its
//            failure costs a date, not a figure.
//   Wave 1   identity. The profile and the registered children, which are sub second, so the
//            page can say what it is about to sum before anything heavy starts.
//   Wave 2   the hero and the fiscal year spine. The award list and the competition fields
//            behind it are fanned out with a hard concurrency cap of six.
//   Wave 3   the category panels, which are the slowest and are never allowed to block the rest.
//
// EVERY PANEL FAILS ON ITS OWN. A failure in the agency breakdown does not blank the hero, and
// no panel renders a partial rollup as a total. There is no spinner anywhere in this file: a
// spinner implies progress it cannot see, and after three seconds a waiting tile says out loud
// that the source is cold.
//
// THE GENERATION COUNTER IS NOT DECORATION. Changing the fiscal year or the award type set while
// a slow request is in flight would otherwise let a response for the old period paint into a
// page labelled with the new one, which is trap 2 arriving through the back door.
//
// Isomorphic apart from the DOM it is handed: no node:* imports and no global document. Every
// dependency has a default so main.js can call boot(document) with nothing else, and a test can
// call it with a stub document and a stub api and drive the whole page in milliseconds.

import { createApi } from '../api/api.js';
import { url, awardDetailRequest, validateAwardDetail, validateSpendingByAward } from '../query/endpoints.js';
import { buildAwardSearchBody, filterRowsToEntitySet } from '../query/award-query.js';
import { staleLinkageDisclosures } from '../identity/stale-tree.js';
import {
  soleBidderShare, oneOfferShare, competitionRows,
  topRowShare, herfindahlIndex, cumulativeConcentration, topAwardShare,
  obligationsByYear,
} from '../analysis/index.js';
import { categoryRowClaims } from '../api/categories.js';
import { methodDelta } from '../analysis/rollup.js';
import { parseIndex } from '../api/typeahead-index.js';
import { createTypeahead } from '../api/typeahead.js';
import { METHODS } from '../core/claim.js';
import { tallyClaim } from '../analysis/share.js';
import {
  DEFAULT_AWARD_TYPE_SET, FISCAL_YEAR_FLOOR, HERO_AWARD_COUNT, MAX_CONCURRENCY,
} from '../core/constants.js';
import { failure, INCOMPLETE_ROLLUP, MALFORMED_RESPONSE } from '../query/failure.js';
import {
  spineChart, agencyMixChart, soleBidderChart, largestAwardsChart, concentrationCurveChart,
  revealSentence,
} from './view-model.js';
import {
  controlsPanel, chooserPanel, refusalPanel, subjectPanel, heroPanel, customerMixPanel,
  spinePanel, concentrationPanel, rollupPanel, secondDefinitionPanel, skeletonPanel,
  failurePanel, suggestionsPanel, sourceAsOfLine, hookPanel, hookMethodPanel, mount,
} from './panels.js';
import { el, prose, clear, onActivate } from './dom.js';

/** How many fiscal years the spine chart shows. DESIGN 6.9 chart one. */
export const SPINE_YEARS = 10;

/** How long to wait after a keystroke before asking for suggestions. */
export const SUGGEST_DEBOUNCE_MS = 180;

/** Where the bundled name index is served from. Same origin, so it needs no host allowance. */
export const INDEX_URL = './src/data/typeahead-index.json';

/**
 * The four category dimensions, each with the region it mounts into, the noun the sentence uses
 * and the METHOD its top share is badged with.
 *
 * EVERY DIMENSION HAS ITS OWN METHOD, and that is the point of the table rather than a loop over
 * bare strings. The method is what the badge prints, so a single shared method would have every
 * panel claiming its share was computed over awarding agencies while three of them were not.
 * They run in this order because the agency panel is the one DESIGN C2 calls the headline and
 * the slowest endpoints should not delay it.
 */
export const CATEGORY_PANELS = Object.freeze([
  Object.freeze({
    dimension: 'awarding_agency',
    region: 'mix',
    noun: 'department',
    rowNoun: 'awarding agency',
    chartNoun: 'buying agency',
    method: METHODS.ONE_CUSTOMER_SHARE,
    herfindahl: true,
  }),
  Object.freeze({
    dimension: 'awarding_subagency',
    region: 'mixSubagency',
    noun: 'sub agency',
    rowNoun: 'awarding sub agency',
    chartNoun: 'buying sub agency',
    method: METHODS.SUBAGENCY_SHARE,
    herfindahl: false,
  }),
  Object.freeze({
    dimension: 'psc',
    region: 'mixPsc',
    noun: 'product service code',
    rowNoun: 'product service code',
    chartNoun: 'product service code',
    method: METHODS.PRODUCT_SERVICE_SHARE,
    herfindahl: false,
    tailText: ' of the dollars obligated to this entity in the fiscal year selected was recorded '
      + 'against one product service code, which is the government classification of what was '
      + 'bought rather than of who bought it.',
    topLabel: 'That one product service code is ',
  }),
  Object.freeze({
    dimension: 'naics',
    region: 'mixNaics',
    noun: 'industry classification',
    rowNoun: 'industry classification',
    chartNoun: 'industry classification',
    method: METHODS.INDUSTRY_SHARE,
    herfindahl: false,
    tailText: ' of the dollars obligated to this entity in the fiscal year selected was recorded '
      + 'against one industry classification.',
    topLabel: 'That one industry classification is ',
  }),
]);

/**
 * Starting points for the search box. NAMES ONLY, and that is deliberate: a bundled identifier
 * would be a claim about the registry that we would have to badge and defend, and a bundled
 * dollar figure would be a staleness claim we would have to defend every day. A chip does
 * exactly what typing the name does, and nothing else.
 */
export const CHIPS = Object.freeze([
  'Lockheed Martin',
  'RTX',
  'Northrop Grumman',
  'General Dynamics',
  'Boeing',
  'Leidos',
  'Booz Allen Hamilton',
  'Huntington Ingalls',
  'L3Harris',
  'Humana',
]);

/**
 * THE OPENING EXAMPLE. DESIGN 5 second zero.
 *
 * A NAME and a dimension. No identifier, no dollar figure, no share: everything the opening
 * frame states is fetched live from the same host as every other figure on the page, through
 * the same client and the same validator, and it arrives badged.
 *
 * It is one of the chips, on purpose. The upstream cache is shared by every visitor, so the
 * names that are asked for most are the names that answer fastest, and the opening frame should
 * not be the one request on the page that lands cold.
 */
export const HOOK_EXAMPLE = Object.freeze({
  name: 'Lockheed Martin',
  dimension: 'awarding_agency',
  rowNoun: 'awarding agency',
});

/**
 * The fiscal year a date falls in. The federal fiscal year starts on the first of October, so
 * October through December belong to the NEXT calendar year's fiscal year.
 * @param {Date} date
 * @returns {number}
 */
export function fiscalYearOf(date) {
  return date.getUTCMonth() >= 9 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

/**
 * The year the control defaults to: the most recently COMPLETED fiscal year. The current one is
 * selectable and it is partial by definition, which is a fact about the calendar rather than a
 * defect, but it is not the year a reader should land on without having asked for it.
 * @param {Date} date
 * @returns {{latest:number, defaultYear:number}}
 */
export function fiscalYearWindow(date) {
  const latest = fiscalYearOf(date);
  return { latest, defaultYear: Math.max(FISCAL_YEAR_FLOOR, latest - 1) };
}

/**
 * The award search request. It is assembled here rather than in src/query/endpoints.js because
 * the body builder lives in its own module ON PURPOSE: that module has no recipient id parameter
 * at all, and the field name does not appear anywhere in it. The award search endpoint SILENTLY
 * IGNORES a recipient id filter, and four different filters returned byte identical results
 * topped by an entirely different company, so the only filter that does anything is the name
 * text and every returned row is validated against the resolved entity set afterwards.
 *
 * @param {any} identity
 * @param {number} [limit]
 * @returns {{id:string, method:'POST', url:string, body:object, weight:'heavy'}}
 */
export function awardSearchRequest(identity, limit = HERO_AWARD_COUNT) {
  return {
    id: 'spendingByAward',
    method: 'POST',
    url: url('/api/v2/search/spending_by_award/'),
    body: buildAwardSearchBody({
      recipientSearchText: identity.name,
      fiscalYear: identity.fiscalYear,
      awardTypeSetId: identity.awardTypeSetId,
      limit,
    }),
    weight: 'heavy',
  };
}

/**
 * The default index loader. It is a function rather than an inline fetch so that the whole page
 * stays drivable under a document stand in: a test hands boot() its own loader and no global is
 * touched anywhere in this file.
 *
 * @param {Document} doc
 * @returns {(() => Promise<string>)|null}
 */
export function defaultIndexLoader(doc) {
  const scope = /** @type {any} */ (typeof globalThis === 'undefined' ? null : globalThis);
  if (!scope || typeof scope.fetch !== 'function') return null;
  const base = doc && doc.baseURI ? doc.baseURI : undefined;
  return async () => {
    const href = base === undefined ? INDEX_URL : new URL(INDEX_URL, base).href;
    const response = await scope.fetch(href, { credentials: 'omit' });
    if (!response || response.ok !== true) return '';
    return response.text();
  };
}

/**
 * Boot the page.
 *
 * @param {Document} doc
 * @param {Object} [deps]
 * @param {any} [deps.api] An api from createApi().
 * @param {() => Date} [deps.now]
 * @returns {Object} The app handle, so a test can drive it without touching the DOM by hand.
 */
export function boot(doc, deps = {}) {
  const api = deps.api === undefined ? createApi() : deps.api;
  const now = deps.now === undefined ? (() => new Date()) : deps.now;
  const loadIndexText = deps.loadIndexText === undefined
    ? defaultIndexLoader(doc)
    : deps.loadIndexText;
  const years = fiscalYearWindow(now());

  const region = (id) => doc.getElementById(id);
  const regions = {
    controls: region('panel-controls'),
    chips: region('panel-chips'),
    chooser: region('panel-chooser'),
    suggestions: region('panel-suggestions'),
    subject: region('panel-subject'),
    hero: region('panel-hero'),
    mix: region('panel-mix'),
    mixSubagency: region('panel-mix-subagency'),
    mixPsc: region('panel-mix-psc'),
    mixNaics: region('panel-mix-naics'),
    spine: region('panel-spine'),
    definition: region('panel-definition'),
    concentration: region('panel-concentration'),
    rollup: region('panel-rollup'),
    source: region('panel-source-as-of'),
    hook: region('panel-hook'),
    hookMethod: region('panel-hook-detail'),
  };

  // Pinned at boot. The opening example does not follow the period control: see loadHook.
  const hookFiscalYear = years.defaultYear;

  const state = {
    fiscalYear: years.defaultYear,
    awardTypeSetId: DEFAULT_AWARD_TYPE_SET,
    queryText: '',
    clickedUei: null,
    choice: null,
    identity: null,
    parentReportedTotal: null,
    sourceAsOf: null,
    generation: 0,
  };

  const bump = () => {
    state.generation += 1;
    return state.generation;
  };
  const stale = (gen) => gen !== state.generation;

  /* ---- controls and chips ---- */

  function paintControls() {
    mount(regions.controls, controlsPanel(doc, {
      fiscalYear: state.fiscalYear,
      latestFiscalYear: years.latest,
      awardTypeSetId: state.awardTypeSetId,
      onFiscalYear: (fy) => {
        if (!Number.isInteger(fy)) return;
        state.fiscalYear = fy;
        reload();
      },
      onAwardTypeSet: (setId) => {
        state.awardTypeSetId = setId;
        reload();
      },
    }));
  }

  function paintChips() {
    const list = el(doc, 'div', { class: 'chips' });
    for (const name of CHIPS) {
      // A company NAME is not prose and it is not a figure. Some of them carry a digit, which is
      // part of the name rather than a quantity, so it is written the way every other entity name
      // on this page is written: as text content, never through the prose helper.
      const chip = el(doc, 'button', { type: 'button', class: 'chip ghost' });
      chip.textContent = name;
      onActivate(chip, () => search(name));
      list.appendChild(chip);
    }
    mount(regions.chips, el(doc, 'div', {}, [
      prose(doc, 'p', 'Starting points. Each one runs the same live search that typing the name '
        + 'would run. They carry a name and nothing else: no identifier and no dollar figure is '
        + 'bundled into this page.', { class: 'soft' }),
      list,
    ]));
  }

  /* ---- the typeahead. A name, never an answer. ---- */

  /**
   * Suggest names for what has been typed so far.
   *
   * A suggestion is a NAME. Picking one runs the same resolution that typing it runs, so a
   * visitor who clicks a suggestion still sees which entity was chosen and still gets the
   * refusal when a name resolves to more than one unlinked parent record.
   *
   * @param {string} text
   */
  async function suggest(text) {
    if (!api.typeahead || !regions.suggestions) return;
    const result = await api.typeahead.suggest(text);
    // A failed suggestion costs a convenience, never a figure, so it clears the list quietly
    // rather than raising a panel over the search field.
    if (!result.ok) {
      mount(regions.suggestions, null);
      return;
    }
    mount(regions.suggestions, suggestionsPanel(doc, {
      suggestions: result.suggestions,
      source: result.source,
      onPick: (name, suggestion) => {
        if (input) input.value = name;
        mount(regions.suggestions, null);
        // A bundled suggestion carries a verified identifier, so the entity is not in doubt and
        // the sixteen way chooser is skipped. A live one carries only text and goes the long way
        // round, which is where a name matching several unrelated parent records is SHOWN rather
        // than guessed at.
        const uei = suggestion && suggestion.needsResolution === false
          && typeof suggestion.uei === 'string' ? suggestion.uei : null;
        search(name, uei);
      },
    }));
  }

  /* ---- wave zero and one: text to an entity ---- */

  /**
   * @param {string} text
   * @param {string|null} [clickedUei] Present only when a BUNDLED suggestion was clicked. The
   *   resolution is identical either way; the identifier only decides which of the parent
   *   records that answer to this name the visitor already picked. When it names no parent
   *   record the list is shown and nothing is chosen on their behalf.
   */
  async function search(text, clickedUei = null) {
    const trimmed = String(text === undefined ? '' : text).trim();
    if (trimmed.length === 0) return;
    state.queryText = trimmed;
    state.clickedUei = clickedUei;
    state.choice = null;
    const gen = bump();

    resetPanels();
    mount(regions.chooser, skeletonPanel(doc, 'the parent records matching that name'));

    const query = {
      text: trimmed,
      fiscalYear: state.fiscalYear,
      awardTypeSetId: state.awardTypeSetId,
    };
    const result = clickedUei === null || !api.startQueryForUei
      ? await api.startQuery(query)
      : await api.startQueryForUei({ ...query, uei: clickedUei });
    if (stale(gen)) return;
    if (!result.ok) {
      mount(regions.chooser, failurePanel(doc, result.failure, () => search(trimmed, clickedUei)));
      return;
    }

    if (result.refusal) {
      // DESIGN C9. The refusal is a capability with its own panel. It still lets a visitor pick
      // one record deliberately, which is a different act from the tool adding them together.
      mount(regions.chooser, refusalPanel(doc, result.refusal,
        (candidate) => choose({ candidate, how: 'picked-from-list' })));
      return;
    }
    if (result.outcome === 'no-records' || result.candidates.length === 0) {
      const sentence = el(doc, 'p');
      sentence.textContent = result.sentence;
      mount(regions.chooser, el(doc, 'div', { class: 'panel' }, [
        prose(doc, 'h3', 'No parent record matched that name'),
        sentence,
        prose(doc, 'p', 'This tool resolves to a parent level record and its registered children. '
          + 'Guessing which unrelated records to add together is exactly what it refuses to do. '
          + 'Try the registered legal name rather than the brand.', { class: 'soft' }),
      ]));
      return;
    }

    mount(regions.chooser, chooserPanel(doc, {
      candidates: result.candidates,
      sentence: result.sentence,
      onChoose: (candidate) => choose({ candidate, how: 'picked-from-list' }),
    }));
    if (result.choice) choose(result.choice);
  }

  /**
   * @param {{candidate:any, how:string}} choice
   */
  async function choose(choice) {
    state.choice = choice;
    const gen = bump();
    resetPanels();
    mount(regions.subject, skeletonPanel(doc, 'the entity profile and its registered children'));

    const subject = await api.loadSubject({
      choice,
      fiscalYear: state.fiscalYear,
      awardTypeSetId: state.awardTypeSetId,
      sourceAsOf: state.sourceAsOf,
      onCold: () => coldNotice(regions.subject, 'the entity profile'),
    });
    if (stale(gen)) return;
    if (!subject.ok) {
      mount(regions.subject, failurePanel(doc, subject.failure, () => choose(choice)));
      return;
    }

    const { identity } = subject;
    state.identity = identity;

    mount(regions.subject, subjectPanel(doc, {
      identity,
      detail: subject.detail,
      linkage: staleLinkageDisclosures(identity),
    }));
    mount(regions.rollup, rollupPanel(doc, {
      reconciliation: subject.reconciliation,
      identity,
      onRetry: () => choose(choice),
    }));

    // The parent reported total is the denominator of the second definition and the anchor of
    // the third reconciliation arm. It is held on state rather than refetched, so both of them
    // difference against the SAME figure the subject panel printed.
    state.parentReportedTotal = subject.profile.totalObligations;

    loadHero(identity, gen);
    loadSpine(identity, gen);
    loadMix(identity, gen);
    loadSecondDefinition(identity, gen);
    loadThirdArm(identity, gen);
  }

  /* ---- wave two: the hero ---- */

  /**
   * @param {any} identity
   * @param {number} gen
   */
  async function loadHero(identity, gen) {
    mount(regions.hero, skeletonPanel(doc, 'the largest contracts and their competition fields'));
    const result = await api.client.request(
      awardSearchRequest(identity),
      validateSpendingByAward,
      {
        what: 'the largest contracts active in the fiscal year',
        onCold: () => coldNotice(regions.hero, 'the largest contracts'),
      },
    );
    if (stale(gen)) return;
    if (!result.ok) {
      mount(regions.hero, failurePanel(doc, result.failure, () => loadHero(identity, gen)));
      return;
    }

    // TRAP 1, handled here because this is where the rows land. Every returned row is validated
    // against the resolved entity set, and the count that did not belong is shown on the page.
    // The rows arriving here have already been through the response validator, which projects
    // the recipient column to a camel case name; filterRowsToEntitySet reads that spelling
    // directly, so nothing is re-aliased at this call site. A row whose recipient cannot be read
    // is excluded, which is the safe direction.
    const filtered = filterRowsToEntitySet(result.value.rows, identity.entityNamesUpper);
    const meta = metaOf(identity);
    const excludedRowCountClaim = tallyClaim(filtered.excludedCount, 'dropped award row',
      METHODS.SOLE_BIDDER_SHARE, meta,
      'Rows the award search endpoint returned whose recipient is not in the resolved entity set. '
      + 'That endpoint ignores a recipient filter entirely, so the rows are checked here against '
      + 'the parent and its registered children, and the ones that did not belong are dropped '
      + 'from every figure on this page and counted in the open rather than swallowed.');

    if (filtered.kept.length === 0) {
      mount(regions.hero, failurePanel(doc, failure(INCOMPLETE_ROLLUP,
        'the competition split for the largest contracts',
        { parts: { arrived: 0, expected: result.value.rows.length } })));
      return;
    }

    const tasks = filtered.kept.map((row) => () => api.client.request(
      awardDetailRequest(row.generatedInternalId),
      validateAwardDetail,
      { what: 'the competition record for one contract' },
    ));
    const settled = await api.client.mapWithCap(tasks, MAX_CONCURRENCY);
    if (stale(gen)) return;

    const awardDetails = settled.filter((d) => d && d.ok).map((d) => d.value);
    // COMPUTED, not REPORTED. The competition FIELDS are reported; how many of them arrived is
    // our own count over the fan out, and it has its own method so that the provenance line
    // states what was counted rather than borrowing the wording of the share below it.
    const detailCountClaim = tallyClaim(awardDetails.length, 'arrived competition record',
      METHODS.RESPONSE_COVERAGE_COUNT, meta,
      'Contracts in the set whose own competition record answered. A contract whose record did '
      + 'not arrive is counted in neither direction rather than assumed either way.');

    try {
      const soleBidder = soleBidderShare({ awardRows: filtered.kept, awardDetails, meta });
      const oneOffer = oneOfferShare({ awardRows: filtered.kept, awardDetails, meta });
      const awards = competitionRows({ awardRows: filtered.kept, awardDetails, meta });
      mount(regions.hero, heroPanel(doc, {
        soleBidder,
        oneOffer,
        awards: awards.map((row, i) => ({
          ...row,
          generatedInternalId: filtered.kept[i].generatedInternalId,
        })),
        excludedRowCountClaim,
        detailCountClaim,
        reveal: revealSentence(identity),
        chart: soleBidder.available === true
          ? soleBidderChart({ soleBidder, identity })
          : null,
      }));

    } catch (e) {
      mount(regions.hero, failurePanel(doc, failure(MALFORMED_RESPONSE,
        'the competition split', { detail: String(e && e.message) })));
    }

    // The concentration panel is built in its OWN try block. It is drawn from the same rows, but
    // a defect there must cost that panel and not the hero above it: every panel fails on its
    // own, and two panels sharing one catch is how one bug blanks two answers.
    try {
      const cumulative = cumulativeConcentration({ awardRows: filtered.kept, meta });
      mount(regions.concentration, concentrationPanel(doc, {
        cumulative,
        topAward: topAwardShare({ awardRows: filtered.kept, meta }),
        curveChart: cumulative.available === true
          ? concentrationCurveChart({ cumulative, identity })
          : null,
        awardsChart: largestAwardsChart({
          awardRows: competitionRows({ awardRows: filtered.kept, awardDetails, meta }),
          identity,
        }),
      }));
    } catch (e) {
      mount(regions.concentration, failurePanel(doc, failure(MALFORMED_RESPONSE,
        'the concentration view', { detail: String(e && e.message) })));
    }
  }

  /* ---- wave two: the fiscal year spine ---- */

  async function loadSpine(identity, gen) {
    mount(regions.spine, skeletonPanel(doc, 'obligations by fiscal year'));
    const result = await api.obligationsByFiscalYear({
      recipientId: identity.recipientId,
      fiscalYear: identity.fiscalYear,
      spanYears: SPINE_YEARS,
      awardTypeSetId: identity.awardTypeSetId,
      sourceAsOf: identity.sourceAsOf,
      onCold: () => coldNotice(regions.spine, 'obligations by fiscal year'),
    });
    if (stale(gen)) return;
    if (!result.ok) {
      mount(regions.spine, failurePanel(doc, result.failure, () => loadSpine(identity, gen)));
      return;
    }
    try {
      const spine = obligationsByYear({ points: result.points, meta: metaOf(identity) });
      mount(regions.spine, spinePanel(doc, {
        spine,
        chart: spine.available === true ? spineChart({ spine, identity }) : null,
      }));
    } catch (e) {
      mount(regions.spine, failurePanel(doc, failure(MALFORMED_RESPONSE,
        'obligations by fiscal year', { detail: String(e && e.message) })));
    }
  }

  /* ---- wave three: the category panels, the second definition, the third rollup arm ---- */

  /**
   * One ranked category panel. Each dimension is its OWN request and its OWN failure: the
   * industry breakdown failing costs the industry panel and nothing above it, and a dimension
   * that came back empty says so rather than drawing an empty chart.
   *
   * @param {any} identity
   * @param {number} gen
   * @param {typeof CATEGORY_PANELS[number]} spec
   */
  async function loadCategory(identity, gen, spec) {
    const regionNode = regions[spec.region];
    if (!regionNode) return;
    const what = 'the ' + spec.rowNoun + ' breakdown';
    mount(regionNode, skeletonPanel(doc, what));
    const result = await api.category({
      dimension: spec.dimension,
      recipientId: identity.recipientId,
      fiscalYear: identity.fiscalYear,
      awardTypeSetId: identity.awardTypeSetId,
      onCold: () => coldNotice(regionNode, what),
    });
    if (stale(gen)) return;
    if (!result.ok) {
      mount(regionNode, failurePanel(doc, result.failure, () => loadCategory(identity, gen, spec)));
      return;
    }
    const meta = metaOf(identity);
    const rows = result.rows;
    try {
      const top = topRowShare({ rows, method: spec.method, rowNoun: spec.rowNoun, meta });
      const rowClaims = categoryRowClaims(rows, meta);
      mount(regionNode, customerMixPanel(doc, {
        agency: top,
        herfindahl: spec.herfindahl ? herfindahlIndex(rows, spec.rowNoun, meta) : null,
        dimensionNoun: spec.noun,
        tailText: spec.tailText,
        topLabel: spec.topLabel,
        chart: rowClaims.length > 0
          ? agencyMixChart({ rowClaims, identity, dimensionNoun: spec.chartNoun })
          : null,
      }));
    } catch (e) {
      mount(regionNode, failurePanel(doc, failure(MALFORMED_RESPONSE, what,
        { detail: String(e && e.message) })));
    }
  }

  /**
   * @param {any} identity
   * @param {number} gen
   */
  function loadMix(identity, gen) {
    for (const spec of CATEGORY_PANELS) loadCategory(identity, gen, spec);
  }

  /**
   * DESIGN C5. The SECOND DEFINITION, published beside the first and never merged with it.
   *
   * This sums the entity breakdown under the NAME that was typed rather than under the parent
   * identifier that was chosen, which is a different question with a different answer. The two
   * were measured billions apart for one well known name, and the entities that sit in the gap
   * are listed rather than folded into a range, because a range would imply the truth lies
   * between them and there is no single truth to lie between them.
   *
   * @param {any} identity
   * @param {number} gen
   */
  async function loadSecondDefinition(identity, gen) {
    if (!regions.definition) return;
    const what = 'everything matching the name searched';
    mount(regions.definition, skeletonPanel(doc, what));

    // BOTH SIDES COME FROM ONE ENDPOINT UNDER ONE SET OF FILTERS, and the only difference
    // between them is the filter itself: the identifier on one, the typed text on the other.
    //
    // The parent PROFILE total is deliberately not used as definition one, even though it is
    // already on this page and would save a request. That endpoint takes no award type filter,
    // so its figure always covers every award type, and differencing it against a name match
    // restricted to contracts would publish a gap that is partly the award type control rather
    // than the definition. Measured on one large prime for FY2025 the two inputs differ by
    // roughly 671 million dollars, and it is the kind of difference that looks like a finding.
    const [named, byId] = await Promise.all([
      api.nameMatchTotal({
        text: state.queryText.length > 0 ? state.queryText : identity.name,
        fiscalYear: identity.fiscalYear,
        awardTypeSetId: identity.awardTypeSetId,
        sourceAsOf: identity.sourceAsOf,
        onCold: () => coldNotice(regions.definition, what),
      }),
      api.entityBreakdown({
        recipientId: identity.recipientId,
        fiscalYear: identity.fiscalYear,
        awardTypeSetId: identity.awardTypeSetId,
      }),
    ]);
    if (stale(gen)) return;
    const result = named;
    // Either both arms arrive or the panel says so. A gap computed against a denominator that
    // did not answer would be a figure about nothing, and half of a comparison is not a
    // comparison: there is no substitute figure that belongs in that slot.
    if (!named.ok || !byId.ok) {
      mount(regions.definition, failurePanel(doc, named.ok ? byId.failure : named.failure,
        () => loadSecondDefinition(identity, gen)));
      return;
    }
    try {
      mount(regions.definition, secondDefinitionPanel(doc, methodDelta({
        nameMatchRows: result.rows,
        parentRollupTotal: byId.total,
        parentEntityNamesUpper: identity.entityNamesUpper,
        fiscalYear: identity.fiscalYear,
        awardTypeSetId: identity.awardTypeSetId,
        sourceAsOf: identity.sourceAsOf,
      })));
    } catch (e) {
      mount(regions.definition, failurePanel(doc, failure(MALFORMED_RESPONSE, what,
        { detail: String(e && e.message) })));
    }
  }

  /**
   * DESIGN C4. Upgrade the two arm reconciliation to the three arm one.
   *
   * The two arm version is already on the page from wave one and it stands on its own, so this
   * runs late and replaces the panel only when the third arm actually arrived. A failed third
   * arm leaves the two arm panel exactly where it is: a reconciliation that loses an arm is
   * still a reconciliation, and blanking it would trade a real answer for a spinner.
   *
   * @param {any} identity
   * @param {number} gen
   */
  async function loadThirdArm(identity, gen) {
    if (!regions.rollup) return;
    const three = await api.reconcileThreeWays({
      identity,
      parentReportedTotal: state.parentReportedTotal,
      sourceAsOf: identity.sourceAsOf,
      onCold: () => coldNotice(regions.rollup, 'the entity breakdown'),
    });
    if (stale(gen)) return;
    if (!three.ok || three.armsMissing) return;
    mount(regions.rollup, rollupPanel(doc, {
      reconciliation: three.reconciliation,
      identity,
      onRetry: () => choose(state.choice),
    }));
  }

  /* ---- wave zero: the as-of date ---- */

  /**
   * THE HOOK. One live worked example, before the visitor has done anything.
   *
   * It costs exactly one request. Filtering a ranked category query by recorded NAME needs no
   * resolution step and no profile fetch, which is the whole reason the opening frame can carry
   * a real badged figure without a three call wait in front of it.
   *
   * IT IS PINNED TO THE YEAR THE PAGE OPENED WITH and it does not follow the period control.
   * The figure is an example of what this tool computes, not an answer to the visitor's own
   * query, and repointing it every time somebody changes a control would spend a request on a
   * figure nobody asked to move. Its badge carries its own fiscal year, so it stays true.
   *
   * ITS FAILURE COSTS NOTHING ELSE. Every other panel on this page fetches independently, so a
   * cold or refused opening example leaves the search and the whole product working.
   */
  async function loadHook() {
    if (!regions.hook || typeof api.category !== 'function') return;
    mount(regions.hook, hookPanel(doc, { name: HOOK_EXAMPLE.name, pending: true }));
    mount(regions.hookMethod, null);

    const meta = {
      fiscalYear: hookFiscalYear,
      awardTypeSetId: DEFAULT_AWARD_TYPE_SET,
      sourceAsOf: state.sourceAsOf,
    };
    const result = await api.category({
      dimension: HOOK_EXAMPLE.dimension,
      recipientSearchText: HOOK_EXAMPLE.name,
      fiscalYear: meta.fiscalYear,
      awardTypeSetId: meta.awardTypeSetId,
    });
    if (!result || !result.ok) {
      mount(regions.hook, hookPanel(doc, {
        name: HOOK_EXAMPLE.name,
        failure: result ? result.failure : null,
      }));
      return;
    }
    try {
      const agency = topRowShare({
        rows: result.rows,
        method: METHODS.ONE_CUSTOMER_SHARE,
        rowNoun: HOOK_EXAMPLE.rowNoun,
        meta,
      });
      const onSearch = () => {
        if (input) input.value = HOOK_EXAMPLE.name;
        search(HOOK_EXAMPLE.name);
      };
      mount(regions.hook, hookPanel(doc, { name: HOOK_EXAMPLE.name, agency }));
      mount(regions.hookMethod, hookMethodPanel(doc, { name: HOOK_EXAMPLE.name, agency, onSearch }));
    } catch (e) {
      mount(regions.hook, hookPanel(doc, {
        name: HOOK_EXAMPLE.name,
        failure: failure(MALFORMED_RESPONSE, 'the opening example',
          { detail: String(e && e.message) }),
      }));
    }
  }

  async function loadSourceAsOf() {
    const result = await api.sourceAsOf();
    state.sourceAsOf = result && result.sourceAsOf !== undefined ? result.sourceAsOf : null;
    mount(regions.source, sourceAsOfLine(doc, state.sourceAsOf));
  }

  /* ---- shared ---- */

  /** The provenance triple every claim on the page shares, taken from ONE resolved identity. */
  function metaOf(identity) {
    return {
      fiscalYear: identity.fiscalYear,
      awardTypeSetId: identity.awardTypeSetId,
      sourceAsOf: identity.sourceAsOf === undefined ? null : identity.sourceAsOf,
    };
  }

  function coldNotice(regionNode, what) {
    if (!regionNode || typeof regionNode.querySelector !== 'function') return;
    const existing = regionNode.querySelector('.skeleton');
    if (!existing) return;
    existing.appendChild(prose(doc, 'p', 'The source is cold for ' + what
      + ' and a cold query on this endpoint has been measured at tens of seconds. Nothing is '
      + 'wrong; the request is still open and it has not been retried into the ground.',
    { class: 'cold' }));
  }

  function resetPanels() {
    for (const key of ['subject', 'hero', 'mix', 'mixSubagency', 'mixPsc', 'mixNaics',
      'spine', 'concentration', 'rollup', 'definition']) {
      // Through mount rather than through clear, because mount is what re-hides the section a
      // region sits in. Clearing a region directly would empty the panel and leave its heading
      // standing over nothing, which is the state this page was rebuilt to stop having.
      if (regions[key]) mount(regions[key], null);
    }
  }

  function reload() {
    if (state.choice) choose(state.choice);
    else if (state.queryText) search(state.queryText, state.clickedUei);
  }

  /* ---- wiring ---- */

  const form = doc.getElementById('search-form');
  const input = doc.getElementById('q');
  if (input) {
    let pending = null;
    input.addEventListener('input', () => {
      if (pending !== null) clearTimeout(pending);
      // Debounced, because a request per keystroke is a request per keystroke against a public
      // government host that publishes no rate limit and therefore no ceiling to design against.
      pending = setTimeout(() => { suggest(input.value); }, SUGGEST_DEBOUNCE_MS);
    });
  }
  if (form) {
    form.addEventListener('submit', (ev) => {
      if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
      if (input) search(input.value);
    });
  }

  /**
   * Load the bundled name index, AFTER first paint. DESIGN 3.2 and 6.2.
   *
   * It is not on the critical path and it is not allowed to be: the page is usable with no index
   * at all, because the live suggestion endpoint answers for the whole recipient universe and
   * the bundle only covers the head of it. So a failure here costs speed, never coverage, and it
   * is swallowed deliberately rather than raised as a panel over the search field.
   *
   * The file is same origin, which is why it needs no entry in the host allowance. It carries
   * names and identifiers only: the amounts are stripped when it is built and assertStripped
   * refuses a row shaped like one that still had them.
   */
  async function loadIndex() {
    if (typeof loadIndexText !== 'function') return;
    try {
      const text = await loadIndexText();
      if (typeof text !== 'string' || text.length === 0) return;
      api.typeahead = createTypeahead({ index: parseIndex(text), client: api.client });
    } catch (e) {
      // Deliberately silent. See the paragraph above.
    }
  }

  paintControls();
  paintChips();
  loadSourceAsOf();
  loadIndex();
  loadHook();

  return { state, search, choose, suggest, reload, regions, years, loadIndex, loadHook };
}
