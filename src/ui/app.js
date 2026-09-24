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
import {
  metaOf, searchLargestAwards, fetchCompetitionRecords, assembleHero, assemblyFailure, HERO_WHAT,
} from '../api/hero.js';
import {
  fetchEntityBreakdown, fetchSecondDefinitionArms, secondDefinition, SECOND_DEFINITION_WHAT,
} from '../api/second-definition.js';
import { staleLinkageDisclosures } from '../identity/stale-tree.js';
import { topRowShare, herfindahlIndex, obligationsByYear } from '../analysis/index.js';
import { categoryRowClaims } from '../api/categories.js';
import { parseIndex } from '../api/typeahead-index.js';
import { createTypeahead } from '../api/typeahead.js';
import { METHODS } from '../core/claim.js';
import { DEFAULT_AWARD_TYPE_SET } from '../core/constants.js';
import { fiscalYearWindow } from '../query/fiscal-year.js';
import { failure, MALFORMED_RESPONSE } from '../query/failure.js';
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

// The fiscal year of a date, and the window the period control offers, live in the query layer
// beside the rule that refuses a year that has not started. They are re-exported here so the
// page's existing importers keep working, and the command line reads the same bounds.
export { fiscalYearOf, fiscalYearWindow } from '../query/fiscal-year.js';

// The award search request, and the whole hero assembly behind it, live in src/api/hero.js so
// that the page and the command line build the hero through the same code. Re-exported here for
// the page's existing importers.
export { awardSearchRequest } from '../api/hero.js';

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

  // THE AS OF DATE IS AWAITED BEFORE A CLAIM IS BUILT. It is asked for once, at boot, and every
  // claim carries it in its provenance. Reading it off state without waiting raced the request:
  // the opening example was built before the date could possibly have answered and always said
  // the date was unavailable, and a fast pick could do the same to the subject. It is one small
  // request that was started first, so waiting on it costs nothing once it has answered, and a
  // failure is swallowed here because a missing date degrades a provenance line, never a figure.
  let sourceAsOfReady = Promise.resolve();

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

    // Every claim below carries the as of date, so it is in hand before the first one is built.
    await sourceAsOfReady;
    if (stale(gen)) return;

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

    // The parent reported total is the anchor of the third reconciliation arm. It is held on
    // state rather than refetched, so that arm differences against the SAME figure the subject
    // panel printed. The second definition does not use it: see src/api/second-definition.js.
    state.parentReportedTotal = subject.profile.totalObligations;

    // THE ENTITY BREAKDOWN IS PAGED ONCE. It is definition one of the second definition and the
    // third arm of the reconciliation, and it used to be paged twice, once for each. Both
    // consumers now await this one request.
    const breakdown = regions.definition || regions.rollup
      ? fetchEntityBreakdown(api, identity, {
        onCold: () => coldNotice(regions.rollup, 'the entity breakdown'),
      })
      : null;

    loadHero(identity, gen);
    loadSpine(identity, gen);
    loadMix(identity, gen);
    loadSecondDefinition(identity, gen, breakdown);
    loadThirdArm(identity, gen, breakdown);
  }

  /* ---- wave two: the hero ---- */

  /**
   * @param {any} identity
   * @param {number} gen
   */
  async function loadHero(identity, gen) {
    mount(regions.hero, skeletonPanel(doc, 'the largest contracts and their competition fields'));

    // The figures are assembled in src/api/hero.js, the same code the command line runs. What
    // stays here is where each result lands, how it is drawn, and the two points at which a
    // reader who has moved to another period stops the work: after the search, so a stale
    // search never spends the detail requests, and after the fan out.
    const search = await searchLargestAwards(api.client, identity, {
      onCold: () => coldNotice(regions.hero, 'the largest contracts'),
    });
    if (stale(gen)) return;
    if (!search.ok) {
      // An emptied set is not a request that failed: asking again returns the same rows and
      // drops them again, so it offers no retry.
      mount(regions.hero, failurePanel(doc, search.failure,
        search.emptied ? undefined : () => loadHero(identity, gen)));
      return;
    }

    const awardDetails = await fetchCompetitionRecords(api.client, search.kept);
    if (stale(gen)) return;

    const assembled = assembleHero({ kept: search.kept, awardDetails, meta: search.meta });
    const { hero, concentration } = assembled;

    if (!hero.ok) {
      mount(regions.hero, failurePanel(doc, hero.failure));
    } else {
      try {
        mount(regions.hero, heroPanel(doc, {
          soleBidder: hero.soleBidder,
          oneOffer: hero.oneOffer,
          awards: hero.awards,
          excludedRowCountClaim: search.excludedRowCountClaim,
          detailCountClaim: assembled.detailCountClaim,
          reveal: revealSentence(identity),
          chart: hero.soleBidder.available === true
            ? soleBidderChart({ soleBidder: hero.soleBidder, identity })
            : null,
        }));
      } catch (e) {
        mount(regions.hero, failurePanel(doc, assemblyFailure(HERO_WHAT.hero, e)));
      }
    }

    // The concentration panel fails on its OWN. It is drawn from the same rows, but a defect
    // there must cost that panel and not the hero above it: two panels sharing one catch is how
    // one bug blanks two answers.
    if (!concentration.ok) {
      mount(regions.concentration, failurePanel(doc, concentration.failure));
      return;
    }
    try {
      mount(regions.concentration, concentrationPanel(doc, {
        cumulative: concentration.cumulative,
        topAward: concentration.topAward,
        curveChart: concentration.cumulative.available === true
          ? concentrationCurveChart({ cumulative: concentration.cumulative, identity })
          : null,
        awardsChart: largestAwardsChart({ awardRows: concentration.awardRows, identity }),
      }));
    } catch (e) {
      mount(regions.concentration, failurePanel(doc,
        assemblyFailure(HERO_WHAT.concentration, e)));
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
   * Both arms, the refusal when either is missing, and the arithmetic live in
   * src/api/second-definition.js, the same code the command line runs.
   *
   * @param {any} identity
   * @param {number} gen
   * @param {Promise<any>|null} [breakdown] The entity breakdown already in flight. A retry passes
   *   none, so an arm that failed is asked for again rather than awaited a second time.
   */
  async function loadSecondDefinition(identity, gen, breakdown = null) {
    if (!regions.definition) return;
    const what = SECOND_DEFINITION_WHAT;
    mount(regions.definition, skeletonPanel(doc, what));

    const arms = await fetchSecondDefinitionArms(api, {
      identity,
      queryText: state.queryText,
      breakdown,
      onCold: () => coldNotice(regions.definition, what),
    });
    if (stale(gen)) return;
    const result = secondDefinition({ ...arms, identity });
    if (!result.ok) {
      mount(regions.definition, failurePanel(doc, result.failure,
        result.armFailed ? () => loadSecondDefinition(identity, gen) : undefined));
      return;
    }
    try {
      mount(regions.definition, secondDefinitionPanel(doc, result.delta));
    } catch (e) {
      mount(regions.definition, failurePanel(doc, assemblyFailure(what, e)));
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
   * @param {Promise<any>|null} [breakdown] The entity breakdown already in flight, shared with
   *   the second definition so it is paged once.
   */
  async function loadThirdArm(identity, gen, breakdown = null) {
    if (!regions.rollup) return;
    const three = await api.reconcileThreeWays({
      identity,
      parentReportedTotal: state.parentReportedTotal,
      sourceAsOf: identity.sourceAsOf,
      breakdown,
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

    const request = api.category({
      dimension: HOOK_EXAMPLE.dimension,
      recipientSearchText: HOOK_EXAMPLE.name,
      fiscalYear: hookFiscalYear,
      awardTypeSetId: DEFAULT_AWARD_TYPE_SET,
    });
    // The as of date rides on this badge like every other, and both requests were started at
    // boot side by side. The claim is built once both have answered, so it can never be built
    // before the date could have arrived.
    const [result] = await Promise.all([request, sourceAsOfReady]);
    const meta = {
      fiscalYear: hookFiscalYear,
      awardTypeSetId: DEFAULT_AWARD_TYPE_SET,
      sourceAsOf: state.sourceAsOf,
    };
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

  // metaOf, the provenance triple every claim shares, is imported from src/api/hero.js so the
  // page and the command line take it from ONE resolved identity the same way.

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
  sourceAsOfReady = loadSourceAsOf().catch(() => {});
  loadIndex();
  loadHook();

  return { state, search, choose, suggest, reload, regions, years, loadIndex, loadHook };
}
