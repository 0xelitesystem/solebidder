// THE UNIT RENDERER. DESIGN 2.5, DESIGN 7.2 item 6, trap 7.
//
// OBLIGATIONS ARE NOT REVENUE, AND THAT IS ENFORCED HERE RATHER THAN DISCLAIMED SOMEWHERE ELSE.
//
// The whole of the units problem in this product is one sentence: obligations, award lifetime
// value and shares are three different quantities, and a reader who takes one for another has
// been given a wrong number by us, not by the government. A disclaimer under a chart does not
// stop that. A function signature does.
//
// So there is exactly ONE function in this repository that can turn a number into a currency
// string, it is formatUnit() below, and its signature is (value, unitKind). There is no
// parameter that omits the unit, there is no overload that takes a value alone, and the dollar
// sign appears in exactly one place in the whole source tree, the CURRENCY_SYMBOL constant a
// few lines down. scripts/gate-units.mjs proves both of those by scanning the tree, and
// test/units.test.js asserts that no numeric literal reaches the DOM outside this module.
//
// THE THREE UNIT KINDS, and they are the only three. DESIGN 2.5.
//
//   obligations   Money the government COMMITTED against this recipient family in one named
//                 fiscal year. It is not revenue under ASC 606 and it is not cash paid.
//   awardValue    The LIFETIME value of an award, exercised options included. It is not money
//                 obligated in the fiscal year the reader selected. It never shares a chart, a
//                 column or a colour ramp with obligations.
//   share         A proportion of a stated denominator, carried as a decimal fraction in [0, 1]
//                 and rendered as a percentage. A share with no denominator on screen is a
//                 statistic with no meaning, so the denominator travels with it in the Claim.
//
// A TALLY IS NOT A UNIT KIND, and the distinction is deliberate rather than a fourth kind by a
// quieter name. A tally is a count of records: 217 children, 40 awards, 1 offer received, 3
// rows excluded. It is a whole number of things and it can never be currency, which is why
// formatTally() is a separate function with no access to CURRENCY_SYMBOL and no code path that
// reaches it. The chart contract still refuses to put a tally and a money kind on one axis,
// because "count of awards" and "dollars" on one axis is the same mistake in a different suit.
//
// NOTHING IN HERE ABBREVIATES BY DEFAULT. DESIGN 6.9: never abbreviate in a table, abbreviate
// only on a chart axis, and the badge tooltip always carries the full value to the cent. The
// caller has to ask for the abbreviated form by name, which means a table cell cannot get one
// by forgetting an argument.
//
// Isomorphic: no node:* imports and no DOM.

/* --------------------------------------------------------------------------------------------
 * The three kinds.
 * ------------------------------------------------------------------------------------------ */

/** Money committed in one named fiscal year. DESIGN 2.1, 2.5. */
export const OBLIGATIONS = 'obligations';
/** Lifetime value of an award, exercised options included. DESIGN 2.4 item 3, trap 7. */
export const AWARD_VALUE = 'awardValue';
/** A proportion of a stated denominator, carried as a decimal fraction. DESIGN 2.2. */
export const SHARE = 'share';

/** @typedef {'obligations'|'awardValue'|'share'} UnitKind */

/** The three unit kinds, in the order the legend lists them. There is no fourth. */
export const UNIT_KINDS = Object.freeze([OBLIGATIONS, AWARD_VALUE, SHARE]);

/**
 * A count of records. NOT a unit kind, see the header. Exported so that the chart contract and
 * the gates can name it, and so that nobody invents a second spelling for it.
 */
export const TALLY = 'tally';

/**
 * Every quantity kind a Claim may carry: the three unit kinds plus the tally. The chart
 * contract refuses more than one of these on a single axis, so "dollars" and "count of awards"
 * cannot end up sharing a scale.
 */
export const QUANTITY_KINDS = Object.freeze([...UNIT_KINDS, TALLY]);

/**
 * The presentation contract for each unit kind.
 *
 * `noun` is the word that is WELDED to every rendered figure. DESIGN 2.5: the header sentence
 * carries the unit, always, so the company name and the unit ship as one string. There is no
 * option to suppress it.
 *
 * @typedef {Object} UnitSpec
 * @property {UnitKind} kind
 * @property {boolean} isCurrency
 * @property {string} noun The word welded to the figure, for example "obligated".
 * @property {string} axisLabel What the chart axis says. Never a bare "dollars".
 * @property {string} meaning One sentence a reader can act on, shown in the tooltip.
 * @property {string} notRevenue The sentence that keeps this kind out of a revenue reading.
 * @property {string} rampId Key into UNIT_RAMPS in ./tokens.js.
 */

/** @type {Readonly<Record<UnitKind, UnitSpec>>} */
export const UNIT_SPEC = Object.freeze({
  [OBLIGATIONS]: Object.freeze({
    kind: OBLIGATIONS,
    isCurrency: true,
    noun: 'obligated',
    axisLabel: 'dollars obligated in the fiscal year',
    meaning: 'Money the government committed against this recipient family in the fiscal year '
      + 'shown. Federal prime awards only.',
    notRevenue: 'Obligations are not revenue. The government committing money is not the company '
      + 'recognising it under ASC 606, and it is not cash paid. Work is performed and booked over '
      + 'many years.',
    rampId: 'obligations',
  }),
  [AWARD_VALUE]: Object.freeze({
    kind: AWARD_VALUE,
    isCurrency: true,
    noun: 'in lifetime award value',
    axisLabel: 'lifetime award value, exercised options included',
    meaning: 'The total value of the award over its life, exercised options included. It is not '
      + 'money obligated in the fiscal year you selected.',
    notRevenue: 'Award lifetime value is not revenue and it is not a fiscal year figure. It never '
      + 'shares a chart, a column or a colour ramp with obligations.',
    rampId: 'awardValue',
  }),
  [SHARE]: Object.freeze({
    kind: SHARE,
    isCurrency: false,
    noun: 'percent',
    axisLabel: 'percent of the stated denominator',
    meaning: 'A proportion of a denominator that is printed beside it. A share with no visible '
      + 'denominator is not published here.',
    notRevenue: 'A share is a ratio of two figures of the same unit kind. It is never a ratio of '
      + 'obligations to award lifetime value, because that quotient means nothing.',
    rampId: 'share',
  }),
});

/* --------------------------------------------------------------------------------------------
 * The one and only currency symbol in this repository.
 *
 * scripts/gate-units.mjs greps the entire source tree for a dollar sign in a string literal and
 * fails on any occurrence outside this file. That is what makes the claim "no code path emits a
 * currency string without a unit kind" checkable rather than aspirational: there is exactly one
 * place a currency string can be built, and it demands a kind.
 * ------------------------------------------------------------------------------------------ */

const CURRENCY_SYMBOL = '$';
const CURRENCY_CODE = 'USD';

/** Fiscal year floor. Trap 14: nothing before 2007-10-01 exists in the search API. */
export const FISCAL_YEAR_FLOOR = 2008;

/* --------------------------------------------------------------------------------------------
 * Formatting.
 * ------------------------------------------------------------------------------------------ */

const FULL_MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: CURRENCY_CODE,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const GROUPED_INT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** Abbreviation steps for a chart axis only. DESIGN 6.9. */
const STEPS = Object.freeze([
  Object.freeze({ at: 1e12, suffix: 'T' }),
  Object.freeze({ at: 1e9, suffix: 'B' }),
  Object.freeze({ at: 1e6, suffix: 'M' }),
  Object.freeze({ at: 1e3, suffix: 'K' }),
]);

/**
 * @param {unknown} kind
 * @returns {UnitKind}
 */
function assertUnitKind(kind) {
  if (typeof kind !== 'string' || !UNIT_KINDS.includes(/** @type {UnitKind} */ (kind))) {
    throw new TypeError('formatUnit: unitKind must be one of ' + UNIT_KINDS.join(', ')
      + ', got ' + JSON.stringify(kind) + '. A figure with no unit kind is the exact mistake this '
      + 'module exists to prevent: obligations, award lifetime value and shares are three '
      + 'different quantities and a reader who takes one for another has been given a wrong '
      + 'number by us.');
  }
  return /** @type {UnitKind} */ (kind);
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {number}
 */
function assertFiniteNumber(value, where) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(where + ': value must be a finite number, got ' + String(value)
      + '. A figure this tool could not compute is refused, never rendered as a number. '
      + 'total_outlays comes back null from every aggregate endpoint and must never arrive here '
      + 'as a zero.');
  }
  return value;
}

/**
 * THE SINGLE CODE PATH FROM A NUMBER TO A DISPLAYED STRING.
 *
 * Every displayed figure in this product passes through here, and it cannot be called without
 * naming which of the three quantities the number is. The returned string ALWAYS carries the
 * unit noun, because DESIGN 2.5 welds the unit to the number and there is no argument that
 * unwelds it.
 *
 * @param {number} value For obligations and awardValue, dollars. For share, a decimal fraction
 *   in [0, 1]. A share arriving as 98.8 rather than 0.988 throws, because a percentage point
 *   value silently formatted as a fraction is a 100x error in a money product.
 * @param {UnitKind} unitKind One of UNIT_KINDS.
 * @param {{form?:'full'|'abbrev', decimals?:number}} [options]
 *   `form` defaults to 'full'. 'abbrev' is for a chart axis and a headline sentence only;
 *   DESIGN 6.9 forbids it in a table.
 * @returns {string} For example "$65,405,410,468.25 obligated", "65.41B obligated",
 *   "$421,660,000,000.00 in lifetime award value", "98.8 percent".
 */
export function formatUnit(value, unitKind, options = {}) {
  const kind = assertUnitKind(unitKind);
  const n = assertFiniteNumber(value, 'formatUnit');
  const spec = UNIT_SPEC[kind];
  const form = options.form === undefined ? 'full' : options.form;
  if (form !== 'full' && form !== 'abbrev') {
    throw new TypeError('formatUnit: form must be "full" or "abbrev", got ' + JSON.stringify(form));
  }

  if (kind === SHARE) {
    if (n < 0 || n > 1) {
      throw new RangeError('formatUnit: a share is a decimal fraction in [0, 1], got ' + n
        + '. Passing 98.8 where 0.988 was meant is a hundredfold error and it is refused here '
        + 'rather than printed.');
    }
    const decimals = options.decimals === undefined ? 1 : options.decimals;
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) {
      throw new RangeError('formatUnit: share decimals must be an integer in [0, 4], got ' + String(decimals));
    }
    return (n * 100).toFixed(decimals) + ' ' + spec.noun;
  }

  if (form === 'abbrev') return abbreviateMoney(n) + ' ' + spec.noun;
  return FULL_MONEY.format(n) + ' ' + spec.noun;
}

/**
 * The money figure WITHOUT the unit noun, for the rare layout where the noun is carried by an
 * adjacent element such as a column header. It still cannot be called without a unit kind, and
 * the caller is on the hook for the noun. DESIGN 2.5 requires the unit in the header string, so
 * a table that uses this must weld the noun into its own <th>, which weldHeader() below builds.
 *
 * @param {number} value
 * @param {UnitKind} unitKind
 * @param {{form?:'full'|'abbrev', decimals?:number}} [options]
 * @returns {string}
 */
export function formatUnitBare(value, unitKind, options = {}) {
  const kind = assertUnitKind(unitKind);
  const full = formatUnit(value, kind, options);
  const noun = UNIT_SPEC[kind].noun;
  return full.slice(0, full.length - noun.length - 1);
}

/**
 * Abbreviate a dollar amount for a chart axis. DESIGN 6.9: axes only.
 * @param {number} n
 * @returns {string}
 */
function abbreviateMoney(n) {
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  for (const step of STEPS) {
    if (abs >= step.at) {
      return sign + CURRENCY_SYMBOL + (abs / step.at).toFixed(2) + step.suffix;
    }
  }
  return sign + CURRENCY_SYMBOL + abs.toFixed(2);
}

/**
 * A count of records. Never currency, by construction: this function has no access to
 * CURRENCY_SYMBOL and no branch that reaches formatUnit().
 *
 * @param {number} value A non negative integer.
 * @param {string} noun What is being counted, singular. For example "registered child entity".
 * @returns {string} For example "217 registered child entities".
 */
export function formatTally(value, noun) {
  const n = assertFiniteNumber(value, 'formatTally');
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError('formatTally: a tally is a non negative whole number of records, got ' + n);
  }
  assertTallyNoun(noun, 'formatTally');
  const word = n === 1 ? noun : pluralise(noun);
  return GROUPED_INT.format(n) + ' ' + word;
}

/**
 * Words that turn a noun phrase into a clause. After the first word, any of these means the head
 * of the phrase is no longer its last word.
 *
 * "not" is on the list even though "not competed award" is a legitimate noun, because the check
 * only inspects words AFTER the first: a leading modifier is fine and a buried one is not.
 */
const CLAUSE_WORDS = new Set([
  'of', 'with', 'whose', 'which', 'that', 'where', 'when', 'carrying', 'by', 'from', 'in', 'on',
  'for', 'and', 'or', 'to', 'as', 'at', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'not',
]);

/**
 * Past participles that are legitimate ADJECTIVES in front of a noun and never a head at the end
 * of one. Listed rather than inferred, because a rule against every word ending in "ed" would
 * refuse a real noun the day somebody counts a bid or a feed.
 */
const TRAILING_PARTICIPLES = new Set([
  'received', 'reported', 'returned', 'arrived', 'excluded', 'dropped', 'competed', 'awarded',
  'obligated', 'missing', 'declared', 'registered', 'suppressed', 'counted',
]);

/**
 * REFUSE A TALLY NOUN WHOSE HEAD IS NOT ITS LAST WORD. This lives here, next to the pluraliser,
 * because it is a rule about the pluraliser.
 *
 * The consequence is not cosmetic. formatTally inflects the END of the string, so
 * "award row dropped by the entity set filter" is announced as "3 award row dropped by the
 * entity set filterS", a count of FILTERS where a count of ROWS was meant, and a reader who
 * hears that has been told the wrong thing about a number.
 *
 * The participle half of the rule was added after a real page shipped the line "2 offer
 * receivedS" to a browser. That noun contains no clause word at all, so the first version of
 * this guard passed it, and it reached a screen.
 *
 * @param {string} noun
 * @param {string} [where]
 * @returns {string}
 */
export function assertTallyNoun(noun, where = 'formatTally') {
  if (typeof noun !== 'string' || noun.trim().length === 0) {
    throw new TypeError(where + ': a tally must name what it counts. A bare count is a number '
      + 'with no subject and a reader will attach it to whichever figure sits nearest.');
  }
  const words = noun.trim().split(/\s+/);
  if (words.length > 5) {
    throw new TypeError(where + ': the noun "' + noun + '" is ' + words.length + ' words long. A '
      + 'tally noun is a short noun phrase whose head is its last word, because the pluraliser '
      + 'inflects the end of the string. Move the explanation into the note, where it is read '
      + 'out beside the figure instead of being conjugated into it.');
  }
  const clause = words.slice(1).find((w) => CLAUSE_WORDS.has(w.toLowerCase()));
  if (clause !== undefined) {
    throw new TypeError(where + ': the noun "' + noun + '" contains "' + clause + '", which makes '
      + 'it a clause rather than a noun phrase. The pluraliser inflects its last word, so this '
      + 'would announce a count of whatever that clause happens to end with. Put the head noun '
      + 'last and move the explanation into the note.');
  }
  const last = words[words.length - 1].toLowerCase();
  if (TRAILING_PARTICIPLES.has(last)) {
    throw new TypeError(where + ': the noun "' + noun + '" ends in "' + last + '", which is a '
      + 'participle rather than a head noun, so the pluraliser would announce "' + noun + 's". '
      + 'Put the participle in front of the noun it modifies: "offer received" becomes '
      + '"received offer".');
  }
  return noun;
}

/** @param {string} noun @returns {string} */
function pluralise(noun) {
  if (/(s|x|z|ch|sh)$/i.test(noun)) return noun + 'es';
  if (/[^aeiou]y$/i.test(noun)) return noun.slice(0, -1) + 'ies';
  return noun + 's';
}

/**
 * THE HEADER STRING. DESIGN 2.5: "Not 'Lockheed Martin, 65.41B', but 'Lockheed Martin, 65.41B
 * obligated in FY2025'. The company name and the unit ship as one string."
 *
 * This function is why that rule cannot be forgotten: there is no way to build a header for a
 * figure in this product that does not carry the unit and the fiscal year, because the only
 * function that builds one demands all four arguments.
 *
 * @param {string} entityName As the government records it.
 * @param {number} value
 * @param {UnitKind} unitKind
 * @param {number} fiscalYear Explicit. Trap 2 and trap 3: there is no rolling window here.
 * @param {{form?:'full'|'abbrev'}} [options]
 * @returns {string}
 */
export function weldHeader(entityName, value, unitKind, fiscalYear, options = {}) {
  if (typeof entityName !== 'string' || entityName.trim().length === 0) {
    throw new TypeError('weldHeader: entityName is required. A figure with no named entity is a '
      + 'figure about nobody.');
  }
  const kind = assertUnitKind(unitKind);
  assertFiscalYear(fiscalYear, 'weldHeader');
  const figure = formatUnit(value, kind, { form: options.form === undefined ? 'abbrev' : options.form });
  return entityName + ', ' + figure + ' in FY' + fiscalYear;
}

/**
 * An explicit fiscal year, or a throw. Trap 2 (mismatched year parameters published a 13.36x
 * error) and trap 3 (the literal rolling window is not a fiscal year and is not reproducible).
 *
 * @param {unknown} fiscalYear
 * @param {string} where
 * @returns {number}
 */
export function assertFiscalYear(fiscalYear, where) {
  if (typeof fiscalYear !== 'number' || !Number.isInteger(fiscalYear)) {
    throw new TypeError(where + ': fiscalYear must be an explicit integer year. A rolling window '
      + 'drifted by measurable dollars inside a single evening and is not a fiscal year at all.');
  }
  if (fiscalYear < FISCAL_YEAR_FLOOR) {
    throw new RangeError(where + ': fiscalYear must be ' + FISCAL_YEAR_FLOOR + ' or later. The '
      + 'search API holds nothing before 2007-10-01, so there is no honest framing that reaches '
      + 'further back.');
  }
  return fiscalYear;
}

/**
 * The accessible label for one figure. DESIGN 6.8 requires a live region to announce the value,
 * the unit and the badge kind, never "bar chart". The badge kind is supplied by the caller
 * because src/core/claim.js owns it; this module owns the value and the unit.
 *
 * @param {number} value
 * @param {UnitKind} unitKind
 * @param {string} badgeLabel
 * @param {{context?:string}} [options]
 * @returns {string}
 */
export function unitA11yLabel(value, unitKind, badgeLabel, options = {}) {
  const kind = assertUnitKind(unitKind);
  const text = formatUnit(value, kind, { form: 'full' });
  const ctx = options.context ? options.context + ', ' : '';
  return ctx + text + ', ' + String(badgeLabel);
}

/**
 * True when the two kinds may never share one chart axis. DESIGN 2.5: "A build gate fails if a
 * single chart component receives series of two different unit kinds."
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function kindsConflict(a, b) {
  return a !== b;
}
