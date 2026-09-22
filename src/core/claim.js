// THE CLAIM SYSTEM. DESIGN 2, the claim boundary. This table is the product.
//
// Every number on the page resolves to one row of DESIGN 2, and a figure whose row is not
// declared cannot be rendered. Not "should not". Cannot.
//
// FOUR CLAIM TIERS, and the fourth one is the interesting one.
//
//   REPORTED       the API said it. Verbatim from a named endpoint and a named field.
//   COMPUTED       our arithmetic over REPORTED values only, and it is reproducible from the
//                  committed fixtures by a test that anybody who clones the repo can run.
//   ESTIMATED      the budget is ZERO. This kind exists ONLY so that scripts/gate-badges.mjs
//                  can DETECT an attempt to ship one. scripts/badge-exception-budget.json sets
//                  maxEstimated to 0, so an estimate cannot physically reach the published
//                  page. That is the honest form of the rule: not "we do not estimate", but
//                  "an estimate is structurally unable to reach a reader".
//   NEVER CLAIMED  the ten statements in DESIGN 2.4. These are not figures. They are sentences
//                  that appear ON THE PAGE, not in a footnote, and they are code rather than
//                  copy so that a rewrite cannot quietly drop one.
//
// THE ENFORCEMENT HAS FIVE LAYERS, and each exists because the layer above it can be forgotten
// by a tired person at two in the morning.
//
//   1. A Claim can only be built by reported(), computed(), estimated() or neverClaimed().
//      Each requires a method string drawn from the METHODS registry in this file, so there is
//      no way to construct a figure that does not already name how it was obtained, which
//      endpoint it came from and which filter method produced it.
//   2. Every numeric Claim requires a unitKind from src/core/units.js. There is no default and
//      there is no null. A dollar figure with no unit kind cannot exist as an object, so it
//      cannot exist on screen.
//   3. A Claim is frozen and branded into a module private WeakSet. An object that merely has
//      the right shape is not a Claim and every render path rejects it. Nothing outside this
//      file can forge one.
//   4. Every implicit stringification path on a Claim THROWS. toString, valueOf, toJSON and
//      Symbol.toPrimitive all throw, so `${claim}`, claim + '', String(claim),
//      el.textContent = claim and JSON.stringify(viewModel) are runtime errors rather than
//      silent bare numbers. The mistake fails loudly at the moment it is made.
//   5. The only text producing function, renderClaim(), ALWAYS emits the badge label AND the
//      unit noun. There is no parameter that asks for the number alone, because there is no
//      honest reason to want one.
//
// Layer 5 is the one that matters. Most provenance systems fail because they make the badge an
// option. Here the badge is the return value and the number is a substring of it.
//
// Colour is never the carrier. Every badge is text plus a distinct SHAPE, because a provenance
// scheme that collapses for a colour blind reader has not failed cosmetically, it has failed
// completely.
//
// Isomorphic: no node:* imports and no DOM. The UI layer turns a RenderedClaim into elements.

import {
  UNIT_KINDS,
  QUANTITY_KINDS,
  TALLY,
  SHARE,
  UNIT_SPEC,
  formatUnit,
  formatTally,
  assertTallyNoun,
  assertFiscalYear,
} from './units.js';

/* --------------------------------------------------------------------------------------------
 * The four badge kinds.
 * ------------------------------------------------------------------------------------------ */

/** The API said it. Verbatim from a named endpoint and field. DESIGN 2.1. */
export const REPORTED = 'REPORTED';
/** Our arithmetic over REPORTED values only, reproducible from a committed fixture. DESIGN 2.2. */
export const COMPUTED = 'COMPUTED';
/** Budget zero. Exists so the gate can detect an attempt. DESIGN 2.3. */
export const ESTIMATED = 'ESTIMATED';
/** A sentence, not a figure. The ten items in DESIGN 2.4, on the page, not in a footnote. */
export const NEVER_CLAIMED = 'NEVER_CLAIMED';

/** @typedef {'REPORTED'|'COMPUTED'|'ESTIMATED'|'NEVER_CLAIMED'} BadgeKind */

/** The four kinds, in the order the legend lists them. There is no fifth and no "unknown". */
export const BADGE_KINDS = Object.freeze([REPORTED, COMPUTED, ESTIMATED, NEVER_CLAIMED]);

/**
 * Presentation contract per badge. `shape` is load bearing: the UI draws it as inline SVG so
 * the four kinds are distinguishable with no colour and no web font. `glyph` is the plain text
 * fallback. `token` names a text token in ./tokens.js and is decoration layered on top of text
 * and shape, never the carrier of meaning.
 *
 * @typedef {Object} BadgeSpec
 * @property {BadgeKind} kind
 * @property {string} label
 * @property {string} shape
 * @property {string} glyph
 * @property {string} token
 * @property {string} meaning
 */

/** @type {Readonly<Record<BadgeKind, BadgeSpec>>} */
export const BADGE_SPEC = Object.freeze({
  [REPORTED]: Object.freeze({
    kind: REPORTED,
    label: 'REPORTED',
    shape: 'diamond',
    glyph: 'R',
    token: 'badgeReported',
    meaning: 'USAspending returned this figure from the endpoint and field named beside it. We '
      + 'did no arithmetic to it.',
  }),
  [COMPUTED]: Object.freeze({
    kind: COMPUTED,
    label: 'COMPUTED',
    shape: 'triangle',
    glyph: 'C',
    token: 'badgeComputed',
    meaning: 'Our arithmetic over REPORTED figures only. The formula is printed and the shipped '
      + 'test suite recomputes it from a committed fixture.',
  }),
  [ESTIMATED]: Object.freeze({
    kind: ESTIMATED,
    label: 'ESTIMATED',
    shape: 'square-outline',
    glyph: 'E',
    token: 'badgeEstimated',
    meaning: 'Nothing on this page is estimated. This kind exists so that the build gate can '
      + 'detect an attempt to publish one, and the budget for it is zero.',
  }),
  [NEVER_CLAIMED]: Object.freeze({
    kind: NEVER_CLAIMED,
    label: 'NEVER CLAIMED',
    shape: 'slash',
    glyph: 'X',
    token: 'badgeNeverClaimed',
    meaning: 'A statement about what this tool does not measure. It is on the page rather than '
      + 'in a footnote because a reader who misses it will misread every figure above it.',
  }),
});

/* --------------------------------------------------------------------------------------------
 * The method registry. DESIGN 2.1 and 2.2: the endpoint, the field and the filter method are
 * printed next to the number, not buried. A claim cannot be built without naming one of these.
 *
 * Each entry states the endpoint that produced it and the exact arithmetic where there is any.
 * ------------------------------------------------------------------------------------------ */

export const METHODS = Object.freeze({
  /* ---- REPORTED. DESIGN 2.1 ---- */
  RECIPIENT_PROFILE_TOTAL:
    'GET /api/v2/recipient/{id}/?year=YYYY, field total_transaction_amount. Obligations recorded '
    + 'to this parent UEI family in the fiscal year named on the badge. Parent linkage is self '
    + 'declared in SAM.gov registration, not SEC consolidation.',
  RECIPIENT_PROFILE_TRANSACTIONS:
    'GET /api/v2/recipient/{id}/?year=YYYY, field total_transactions. A count of transaction '
    + 'records, not a count of awards.',
  RECIPIENT_CHILDREN:
    'GET /api/v2/recipient/children/{UEI}/?year=YYYY with an explicit year. The registered child '
    + 'entities of this parent UEI and the amount recorded against each.',
  SPENDING_OVER_TIME:
    'POST /api/v2/search/spending_over_time/ grouped by fiscal_year, Contract_Obligations bucket '
    + 'only, subawards false. The total outlays field comes back null at this grouping and is '
    + 'never read.',
  SPENDING_BY_CATEGORY:
    'POST /api/v2/search/spending_by_category/{dimension}/ with recipient_id set to the resolved '
    + 'parent id, which IS honoured on this endpoint, verified against a bogus id control that '
    + 'returns empty. Dimensions used: awarding_agency, awarding_subagency, psc, naics.',
  SPENDING_BY_AWARD_COUNT:
    'POST /api/v2/search/spending_by_award_count/, subawards false.',
  AWARD_LIFETIME_VALUE:
    'POST /api/v2/search/spending_by_award/, field Award Amount. This is the LIFETIME value of '
    + 'the award, exercised options included. It is not money obligated in the fiscal year '
    + 'selected and it never shares a chart with that figure.',
  AWARD_COMPETITION_FIELDS:
    'GET /api/v2/awards/{generated_internal_id}/, fields under '
    + 'latest_transaction_contract_data: extent_competed_description, number_of_offers_received, '
    + 'solicitation_procedures_description, type_set_aside_description. Straight from the '
    + 'government record, including where that record is internally inconsistent.',
  ALTERNATE_NAMES:
    'GET /api/v2/recipient/{id}/, field alternate_names. Names the registrant declared for '
    + 'itself.',
  SOURCE_AS_OF:
    'GET /api/v2/awards/last_updated/, fetched live on every page load and never baked into our '
    + 'HTML. If the call fails the date area says so and no date is asserted.',

  /* ---- COMPUTED. DESIGN 2.2 ---- */
  ONE_CUSTOMER_SHARE:
    'Top agency amount divided by the sum of every agency amount returned for the same fiscal '
    + 'year and award type set. Both figures are printed beside the share.',
  SUBAGENCY_SHARE:
    'Top sub agency amount divided by the sum of every sub agency amount returned for the same '
    + 'fiscal year and award type set.',
  PRODUCT_SERVICE_SHARE:
    'Top product or service category amount divided by the sum of every product or service '
    + 'category amount returned for the same fiscal year and award type set. The classification '
    + 'is the government product and service code carried on the award record.',
  INDUSTRY_SHARE:
    'Top industry amount divided by the sum of every industry amount returned for the same '
    + 'fiscal year and award type set. The classification is the North American Industry '
    + 'Classification System code carried on the award record.',
  HERFINDAHL_INDEX:
    'Sum of the squares of each agency share, shares taken as decimals, over every agency row '
    + 'returned. The formula is printed in the tooltip.',
  CHILD_ROLLUP_CHECK:
    'Sum of the amounts of every registered child entity for the same explicit fiscal year, '
    + 'compared against the parent total_transaction_amount for that year. The delta is shown '
    + 'rather than rounded away, because it is float arithmetic and saying so is more '
    + 'convincing than hiding it.',
  SOLE_BIDDER_SHARE:
    'Sum of Award Amount where extent_competed_description is NOT COMPETED, divided by the sum '
    + 'of Award Amount across the N largest awards active in the fiscal year selected. Both '
    + 'figures and N are printed beside the share. This is a share of lifetime award value '
    + 'across those N awards, never a share of the company federal money.',
  ONE_OFFER_SHARE:
    'Count of awards where number_of_offers_received is 1, divided by the count of awards where '
    + 'that field is present. Rows missing the field are excluded and the excluded count is '
    + 'shown.',
  TOP_AWARD_SHARE:
    'Largest Award Amount divided by the sum of Award Amount over the same N awards.',
  CUMULATIVE_CONCENTRATION:
    'Awards sorted by Award Amount descending, then the running share of the total, plotted '
    + 'against the diagonal a perfectly even distribution would trace.',
  YEAR_OVER_YEAR:
    'Obligations for the fiscal year minus obligations for the year before, divided by the year '
    + 'before, from spending_over_time. Obligations only.',
  NAME_MATCH_TOTAL:
    'Paged sum of spending_by_category/recipient under recipient_search_text. This is a '
    + 'DIFFERENT DEFINITION of the company from the parent UEI rollup and the two are never '
    + 'merged, added or presented as a range.',
  METHOD_DELTA:
    'Name match total minus parent UEI rollup total, itemised by UEI. The parent set is a strict '
    + 'subset of the name set, so the delta is a list of named entities rather than an error bar.',
  ENTITY_BREAKDOWN_ROLLUP_CHECK:
    'Sum over every row of POST /api/v2/search/spending_by_category/recipient/ paged under the '
    + 'resolved parent id for the same explicit fiscal year, compared against the parent '
    + 'total_transaction_amount for that year. This is the THIRD route to the same figure and it '
    + 'runs through a different endpoint from the child list, so it is named separately: the '
    + 'child rollup method describes summing the registered children and this arm sums the '
    + 'entity breakdown rows the source returns under that parent id.',
  RESPONSE_COVERAGE_COUNT:
    'A count WE took over the responses that arrived, not a figure the source reported. A fan '
    + 'out of per award calls can fail one member at a time, so the count of records that '
    + 'answered is published beside any share whose denominator it sets, and a set that came '
    + 'back short is never presented as a complete one.',

  /* ---- ESTIMATED. DESIGN 2.3. The budget is ZERO. ----
   *
   * There is exactly one method in this tier and it exists so that estimated() can build a real
   * Claim, so that scripts/gate-badges.mjs has a real thing to detect, and so that its positive
   * control is a control rather than a simulation of one. If this entry were removed, every call
   * to estimated() would throw at the method check and the gate would be proving nothing.
   *
   * Nothing in this product uses it. The gate fails the build on any call to estimated() under
   * src/ and on any ESTIMATED badge in the shipped page, with the budget committed at zero. */
  MODELLED_FIGURE:
    'A modelled figure rather than a reported one or arithmetic over reported ones. Nothing in '
    + 'this product is allowed to be one. This method exists so that an attempt to publish an '
    + 'estimate can be built, detected and refused by the build gate.',

  /* ---- NEVER CLAIMED. DESIGN 2.4. A sentence, not a figure. ---- */
  CLAIM_BOUNDARY_STATEMENT:
    'A statement of what this tool does not measure, published on the page beside the figures it '
    + 'qualifies.',
});

const METHOD_VALUES = new Set(Object.values(METHODS));

/**
 * Which badge kind each method is allowed to carry. A method belongs to exactly one tier, so
 * labelling a COMPUTED method as REPORTED is a construction time error rather than a
 * copywriting accident. A boundary that is only documented drifts.
 * @type {Map<string, BadgeKind>}
 */
const METHOD_KIND = new Map([
  [METHODS.RECIPIENT_PROFILE_TOTAL, REPORTED],
  [METHODS.RECIPIENT_PROFILE_TRANSACTIONS, REPORTED],
  [METHODS.RECIPIENT_CHILDREN, REPORTED],
  [METHODS.SPENDING_OVER_TIME, REPORTED],
  [METHODS.SPENDING_BY_CATEGORY, REPORTED],
  [METHODS.SPENDING_BY_AWARD_COUNT, REPORTED],
  [METHODS.AWARD_LIFETIME_VALUE, REPORTED],
  [METHODS.AWARD_COMPETITION_FIELDS, REPORTED],
  [METHODS.ALTERNATE_NAMES, REPORTED],
  [METHODS.SOURCE_AS_OF, REPORTED],
  [METHODS.ONE_CUSTOMER_SHARE, COMPUTED],
  [METHODS.SUBAGENCY_SHARE, COMPUTED],
  [METHODS.PRODUCT_SERVICE_SHARE, COMPUTED],
  [METHODS.INDUSTRY_SHARE, COMPUTED],
  [METHODS.HERFINDAHL_INDEX, COMPUTED],
  [METHODS.CHILD_ROLLUP_CHECK, COMPUTED],
  [METHODS.SOLE_BIDDER_SHARE, COMPUTED],
  [METHODS.ONE_OFFER_SHARE, COMPUTED],
  [METHODS.TOP_AWARD_SHARE, COMPUTED],
  [METHODS.CUMULATIVE_CONCENTRATION, COMPUTED],
  [METHODS.YEAR_OVER_YEAR, COMPUTED],
  [METHODS.NAME_MATCH_TOTAL, COMPUTED],
  [METHODS.METHOD_DELTA, COMPUTED],
  [METHODS.ENTITY_BREAKDOWN_ROLLUP_CHECK, COMPUTED],
  [METHODS.RESPONSE_COVERAGE_COUNT, COMPUTED],
  [METHODS.MODELLED_FIGURE, ESTIMATED],
  [METHODS.CLAIM_BOUNDARY_STATEMENT, NEVER_CLAIMED],
]);

/* --------------------------------------------------------------------------------------------
 * The Claim itself.
 * ------------------------------------------------------------------------------------------ */

/** Module private brand. Nothing outside this file can add to it, so nothing can forge a Claim. */
const CLAIMS = new WeakSet();

const REFUSE = 'solebidder: a Claim cannot be turned into text implicitly, because that is '
  + 'exactly how a number reaches a reader with no badge and no unit. Use renderClaim() or '
  + 'renderClaimText().';

/**
 * A single displayed value with its provenance and its unit. DESIGN 2.
 *
 * @typedef {Object} Claim
 * @property {number|string} value Full internal precision. Rounding happens at render time only.
 *   A NEVER_CLAIMED claim carries the sentence itself here and may never carry a number.
 * @property {string|null} unitKind One of UNIT_KINDS, or TALLY for a count of records. null is
 *   permitted ONLY for a NEVER_CLAIMED statement, which is a sentence and therefore has no unit.
 * @property {BadgeKind} badge One of the four kinds.
 * @property {string} method One of METHODS, stating the endpoint and the arithmetic.
 * @property {number|null} fiscalYear The explicit fiscal year this figure belongs to.
 * @property {string|null} awardTypeSetId Which award_type_codes set produced it. DESIGN C6.
 * @property {string|null} sourceAsOf The date USAspending published about itself, or null when
 *   that call failed. We never assert a date we did not just receive.
 * @property {string|null} denominatorText For a share, the numerator and denominator in words.
 * @property {string|null} tallyNoun For a tally, what is being counted.
 * @property {string|null} note An extra sentence shown with the figure.
 */

/**
 * @param {number|string} value
 * @param {string|null} unitKind
 * @param {BadgeKind} badge
 * @param {string} method
 * @param {object} [extra]
 * @returns {Claim}
 */
function makeClaim(value, unitKind, badge, method, extra = {}) {
  if (!BADGE_KINDS.includes(badge)) {
    throw new TypeError('Claim: badge must be one of ' + BADGE_KINDS.join(', ') + ', got ' + String(badge));
  }
  if (!METHOD_VALUES.has(method)) {
    throw new TypeError('Claim: method must be a string from the METHODS registry. An '
      + 'unregistered method means the page would print a figure whose provenance was written ad '
      + 'hoc at the call site, which is the failure this module exists to prevent.');
  }
  const expected = METHOD_KIND.get(method);
  if (expected !== badge) {
    throw new TypeError('Claim: this method belongs to the ' + expected + ' tier but was given '
      + 'the ' + badge + ' badge. DESIGN 2 is a boundary, not a preference.');
  }

  if (badge === NEVER_CLAIMED) {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new TypeError('neverClaimed(): the value is the sentence itself and it must be a non '
        + 'empty string.');
    }
    if (unitKind !== null) {
      throw new TypeError('neverClaimed(): a NEVER CLAIMED item is a sentence about what this '
        + 'tool does not measure. Giving it a unit kind implies a number is coming, and no '
        + 'number is coming.');
    }
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new TypeError('Claim: a figure must be a finite number, got ' + String(value)
        + '. A value this tool could not obtain is refused, never rendered. In particular the '
        + 'total outlays field comes back null from every aggregate endpoint and must never be '
        + 'coerced to zero on its way here.');
    }
    if (typeof unitKind !== 'string' || !QUANTITY_KINDS.includes(unitKind)) {
      throw new TypeError('Claim: unitKind is REQUIRED and must be one of '
        + QUANTITY_KINDS.join(', ') + ', got ' + JSON.stringify(unitKind) + '. There is no '
        + 'default, because a default is how a lifetime award value ends up rendered as if it '
        + 'were a fiscal year obligation.');
    }
    if (unitKind !== TALLY) {
      assertFiscalYear(extra.fiscalYear, 'Claim(' + unitKind + ')');
    }
    if (unitKind === SHARE && (typeof extra.denominatorText !== 'string' || extra.denominatorText.trim().length === 0)) {
      throw new TypeError('Claim: a share must carry denominatorText naming the numerator and the '
        + 'denominator in words. A percentage with no visible denominator is a statistic with no '
        + 'meaning, and it is the single easiest figure on this page to quote out of context.');
    }
    if (unitKind === TALLY) {
      // IN THE CONSTRUCTOR, not in a helper. The same guard used to live only in the analysis
      // layer's tallyClaim(), so any figure built through reported() or computed() directly
      // walked past it, and one did: an award detail tally reached a real browser reading
      // "2 offer receiveds". There is no path to a tally that does not come through here.
      assertTallyNoun(extra.tallyNoun, 'Claim(tally)');
    }
  }

  const claim = {
    value,
    unitKind,
    badge,
    method,
    fiscalYear: extra.fiscalYear === undefined ? null : extra.fiscalYear,
    awardTypeSetId: extra.awardTypeSetId === undefined ? null : extra.awardTypeSetId,
    sourceAsOf: extra.sourceAsOf === undefined ? null : extra.sourceAsOf,
    denominatorText: extra.denominatorText === undefined ? null : extra.denominatorText,
    tallyNoun: extra.tallyNoun === undefined ? null : extra.tallyNoun,
    note: extra.note === undefined ? null : extra.note,
  };

  // Layer 4. Every implicit path to text throws instead of quietly producing a bare number.
  const refuse = () => { throw new TypeError(REFUSE); };
  Object.defineProperty(claim, 'toString', { value: refuse, enumerable: false });
  Object.defineProperty(claim, 'valueOf', { value: refuse, enumerable: false });
  Object.defineProperty(claim, 'toJSON', { value: refuse, enumerable: false });
  Object.defineProperty(claim, Symbol.toPrimitive, { value: refuse, enumerable: false });

  Object.freeze(claim);
  CLAIMS.add(claim);
  return /** @type {Claim} */ (claim);
}

/** @param {unknown} x @returns {boolean} True only for an object this module built. */
export function isClaim(x) {
  return typeof x === 'object' && x !== null && CLAIMS.has(/** @type {object} */ (x));
}

/**
 * Throw unless x is a genuine Claim. Use at every boundary where a figure is about to be
 * rendered, so a bare number that survived a refactor fails here rather than on screen.
 * @param {unknown} x
 * @param {string} [label]
 * @returns {Claim}
 */
export function assertClaim(x, label = 'value') {
  if (!isClaim(x)) {
    throw new TypeError(label + ': expected a Claim built by reported(), computed(), estimated() '
      + 'or neverClaimed(). A bare number or a look alike object cannot be rendered, because it '
      + 'carries no badge, no unit kind and no method. Got: ' + (x === null ? 'null' : typeof x));
  }
  return /** @type {Claim} */ (x);
}

/* -------- The only four constructors. DESIGN 2.1 to 2.4. -------- */

/**
 * The API said it. DESIGN 2.1.
 * @param {number} value
 * @param {string} unitKind One of UNIT_KINDS or TALLY.
 * @param {string} method One of METHODS.
 * @param {object} extra Must carry fiscalYear for a money or share figure.
 * @returns {Claim}
 */
export function reported(value, unitKind, method, extra) {
  return makeClaim(value, unitKind, REPORTED, method, extra);
}

/**
 * Our arithmetic over REPORTED values. DESIGN 2.2.
 * @param {number} value
 * @param {string} unitKind
 * @param {string} method
 * @param {object} extra
 * @returns {Claim}
 */
export function computed(value, unitKind, method, extra) {
  return makeClaim(value, unitKind, COMPUTED, method, extra);
}

/**
 * THE BUDGET IS ZERO. DESIGN 2.3.
 *
 * This constructor works, on purpose. If it threw, scripts/gate-badges.mjs would have nothing
 * real to detect and its positive control would be a simulation of a gate rather than a gate.
 * What stops an estimate reaching a reader is the gate, which fails the build on any call to
 * this function inside src/ and on any ESTIMATED badge in the shipped page, with
 * scripts/badge-exception-budget.json holding maxEstimated at 0.
 *
 * @param {number} value
 * @param {string} unitKind
 * @param {string} method
 * @param {object} extra
 * @returns {Claim}
 */
export function estimated(value, unitKind, method, extra) {
  return makeClaim(value, unitKind, ESTIMATED, method, extra);
}

/**
 * One of the ten statements in DESIGN 2.4. A sentence, never a figure.
 * @param {string} sentence
 * @param {{note?:string|null}} [extra]
 * @returns {Claim}
 */
export function neverClaimed(sentence, extra = {}) {
  return makeClaim(sentence, null, NEVER_CLAIMED, METHODS.CLAIM_BOUNDARY_STATEMENT, extra);
}

/* --------------------------------------------------------------------------------------------
 * Rendering. Layer 5: no code path here returns the number on its own.
 * ------------------------------------------------------------------------------------------ */

/**
 * @typedef {Object} RenderedClaim
 * @property {string} valueText The figure WITH its unit noun, for example
 *   "$65,405,410,468.25 obligated". Never rendered alone.
 * @property {string} text valueText plus the badge label. This is what goes on screen.
 * @property {BadgeKind} badge
 * @property {string} badgeLabel
 * @property {string} badgeShape
 * @property {string} badgeGlyph
 * @property {string} badgeToken Palette token name. Decoration, never the carrier.
 * @property {string} method
 * @property {string|null} unitKind
 * @property {string|null} rampId Which ramp a chart must use for this figure.
 * @property {string} provenance One line: endpoint, method, fiscal year, award type set, as of.
 * @property {string} a11yLabel One sentence for a screen reader.
 * @property {string|null} note
 * @property {Readonly<Record<string,string>>} dataAttrs Attributes the UI MUST put on the node.
 *   data-claim-badge is what scripts/gate-badges.mjs looks for and data-unit-kind is what
 *   scripts/gate-units.mjs looks for, so a figure rendered without coming through this function
 *   fails the build twice.
 */

/**
 * Turn a Claim into everything the UI needs. The ONLY text producing function in the product.
 * @param {unknown} claim
 * @returns {RenderedClaim}
 */
export function renderClaim(claim) {
  const c = assertClaim(claim, 'renderClaim');
  const spec = BADGE_SPEC[c.badge];

  let valueText;
  let rampId = null;
  if (c.badge === NEVER_CLAIMED) {
    valueText = /** @type {string} */ (c.value);
  } else if (c.unitKind === TALLY) {
    valueText = formatTally(/** @type {number} */ (c.value), /** @type {string} */ (c.tallyNoun));
  } else {
    const kind = /** @type {'obligations'|'awardValue'|'share'} */ (c.unitKind);
    valueText = formatUnit(/** @type {number} */ (c.value), kind, { form: 'full' });
    rampId = UNIT_SPEC[kind].rampId;
  }

  const text = valueText + ' [' + spec.label + ']';

  const bits = [c.method];
  if (c.fiscalYear !== null) bits.push('Fiscal year FY' + c.fiscalYear + '.');
  if (c.awardTypeSetId !== null) bits.push('Award type set: ' + c.awardTypeSetId + '.');
  if (c.denominatorText !== null) bits.push(c.denominatorText);
  bits.push(c.sourceAsOf === null
    ? 'Source as of date unavailable.'
    : 'Source as of ' + c.sourceAsOf + '.');
  const provenance = bits.join(' ');

  return Object.freeze({
    valueText,
    text,
    badge: c.badge,
    badgeLabel: spec.label,
    badgeShape: spec.shape,
    badgeGlyph: spec.glyph,
    badgeToken: spec.token,
    method: c.method,
    unitKind: c.unitKind,
    rampId,
    provenance,
    a11yLabel: valueText + ', ' + spec.label + '. ' + (c.note ? c.note + ' ' : '') + provenance,
    note: c.note,
    dataAttrs: Object.freeze({
      'data-claim-badge': c.badge,
      'data-claim-method': c.method,
      'data-unit-kind': c.unitKind === null ? 'none' : c.unitKind,
    }),
  });
}

/**
 * The plain text form, for a table export or a console self test line. Always carries the badge
 * and the unit. There is deliberately no option to omit either.
 * @param {unknown} claim
 * @returns {string}
 */
export function renderClaimText(claim) {
  return renderClaim(claim).text;
}

/**
 * Serialise a Claim for a fixture or a log. Explicit, because toJSON throws on purpose: an
 * accidental JSON.stringify of a view model must fail loudly rather than emit bare numbers into
 * a file somebody later pastes into a README.
 * @param {unknown} claim
 * @returns {object}
 */
export function claimToJSON(claim) {
  const c = assertClaim(claim, 'claimToJSON');
  return {
    value: c.value,
    unitKind: c.unitKind,
    badge: c.badge,
    method: c.method,
    fiscalYear: c.fiscalYear,
    awardTypeSetId: c.awardTypeSetId,
    sourceAsOf: c.sourceAsOf,
    denominatorText: c.denominatorText,
    tallyNoun: c.tallyNoun,
    note: c.note,
  };
}

/** Re exported so a consumer needs one import to build and to check a figure. */
export { UNIT_KINDS, QUANTITY_KINDS, TALLY };
