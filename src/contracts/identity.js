// CONTRACT 1 OF 3: THE RESOLVED IDENTITY. Owned by the identity team, consumed by everyone.
//
// THE PROBLEM THIS SHAPE EXISTS TO SOLVE. Sixteen parent level records match the text
// "LOCKHEED MARTIN", with different UEIs and different totals. That was verified against the
// live API. So "type a company name and get a number" is not a resolvable instruction: the tool
// has to ask which entity, and then it has to SHOW the visitor which one it summed and how many
// registered children rolled into it. A headline figure whose subject the reader cannot name is
// not a figure, it is a rumour with a dollar sign on it.
//
// SO THE SHAPE IS BUILT AROUND A CHOICE, NOT A GUESS.
//
//   IdentityQuery      what the visitor typed.
//   IdentityCandidate  one parent level record. Carries no money figure at all, on purpose:
//                      the list endpoint that produces candidates has no year parameter and its
//                      amount covers a window nobody named, which differs from the fiscal year
//                      total for the same parent by billions. Choosing is a choice between
//                      ENTITIES, never between numbers.
//   IdentityChoice     the record the visitor picked, with how they picked it.
//   ResolvedIdentity   the frozen result. Everything downstream takes this and nothing else.
//   IdentityRefusal    the honest answer when no single parent exists. This is a capability,
//                      not an error state.
//
// THE REFUSAL IS A FEATURE. Some well known names have no umbrella parent in this dataset at
// all: separate unlinked parent records, no relationship between them, and totals that would
// mislead if added. The rule is stated rather than special cased: more than one unlinked parent
// level record for the name means refuse, show the split records with their UEIs, and say that
// no single parent record exists. Adding them up would be the most confident wrong number the
// product could publish.
//
// THE ROLLUP COMPLETENESS FLAG IS LOAD BEARING. If any page of the children list did not
// arrive, rollupComplete is false and the total is SUPPRESSED downstream. A rollup missing some
// of its parts is smaller than the truth, and a reader will quote it.
//
// Isomorphic: no node:* imports and no DOM.

import { assertUei } from '../query/endpoints.js';
import { requireFiscalYear } from '../query/fiscal-year.js';
import { AWARD_TYPE_SETS } from '../core/constants.js';

/**
 * What the visitor typed, plus the period and award type set in force. One period in
 * application state, always. Trap 2.
 *
 * @typedef {Object} IdentityQuery
 * @property {string} text The raw search text.
 * @property {number} fiscalYear Explicit integer year.
 * @property {import('../core/constants.js').AwardTypeSetId} awardTypeSetId
 */

/**
 * One parent level record the visitor may choose between.
 *
 * NOTE THE ABSENT FIELD. There is no amount here and there never will be. See the header.
 *
 * @typedef {Object} IdentityCandidate
 * @property {string} recipientId The internal id used on the profile endpoint.
 * @property {string} uei Twelve characters.
 * @property {string} name As the government records it.
 * @property {'PARENT'} level V1 resolves parent level records only.
 * @property {string[]} alternateNames Names the registrant declared for itself. These are how a
 *   visitor recognises which of sixteen similar records is the one they meant.
 * @property {string|null} location City and state, when the record carries one. A second
 *   distinguishing fact, because names alone do not separate sixteen records.
 */

/**
 * The record the visitor picked, and how. `how` is carried so the page can say "you chose this"
 * rather than implying the tool knew.
 *
 * @typedef {Object} IdentityChoice
 * @property {IdentityCandidate} candidate
 * @property {'picked-from-list'|'picked-a-chip'|'picked-by-flag'|'only-candidate'} how
 */

/**
 * One registered child entity that rolled into the parent total.
 *
 * @typedef {Object} ChildEntity
 * @property {string} uei
 * @property {string} name
 * @property {number} obligations Amount recorded against this child for the SAME explicit
 *   fiscal year as the parent. Trap 2: a child fetched over a different window than the parent
 *   produced a published figure more than thirteen times too large.
 */

/**
 * The frozen result. Everything downstream takes this and nothing else.
 *
 * @typedef {Object} ResolvedIdentity
 * @property {string} recipientId
 * @property {string} uei The PARENT UEI. The subject of every figure on the page.
 * @property {string} name
 * @property {'PARENT'} level
 * @property {string[]} alternateNames
 * @property {readonly ChildEntity[]} children The entities that were summed, listed, so the
 *   visitor can see what "the company" meant here.
 * @property {number} childCount How many children rolled in.
 * @property {number} childrenExpected How many the endpoint said exist.
 * @property {boolean} rollupComplete childCount === childrenExpected. False suppresses the total.
 * @property {number} fiscalYear
 * @property {import('../core/constants.js').AwardTypeSetId} awardTypeSetId
 * @property {string|null} sourceAsOf The date the source published about itself, or null. We
 *   never assert a date we did not just receive.
 * @property {'picked-from-list'|'picked-a-chip'|'picked-by-flag'|'only-candidate'} chosenHow
 * @property {Set<string>} entityNamesUpper Upper case names of the parent and every child, used
 *   to validate award rows against the resolved set. Trap 1.
 * @property {string} subjectSentence One sentence naming what was summed, for the page header.
 */

/**
 * The honest answer when no single parent record exists for a name. DESIGN C9.
 *
 * @typedef {Object} IdentityRefusal
 * @property {true} refused
 * @property {string} queryText
 * @property {IdentityCandidate[]} splitRecords The unlinked parent records, shown with their
 *   UEIs so the visitor can pick one deliberately if they want to.
 * @property {string} sentence What the page says, in full.
 */

/**
 * Validate a candidate. Throws rather than returning false, because a malformed candidate that
 * survives into a choice becomes a wrong subject for every figure on the page.
 * @param {any} c
 * @param {string} where
 * @returns {IdentityCandidate}
 */
export function assertIdentityCandidate(c, where) {
  if (!c || typeof c !== 'object') {
    throw new TypeError(where + ': a candidate must be an object.');
  }
  if (typeof c.recipientId !== 'string' || c.recipientId.trim().length === 0) {
    throw new TypeError(where + ': candidate.recipientId is required.');
  }
  assertUei(c.uei, where + ' candidate.uei');
  if (typeof c.name !== 'string' || c.name.trim().length === 0) {
    throw new TypeError(where + ': candidate.name is required.');
  }
  if (c.level !== 'PARENT') {
    throw new TypeError(where + ': V1 resolves parent level records only, got level '
      + JSON.stringify(c.level) + '. A child level record has no children of its own to roll up '
      + 'and its total answers a different question from the one this page asks.');
  }
  return /** @type {IdentityCandidate} */ (c);
}

/**
 * Build a ResolvedIdentity. This is the only way to make one, and it demands every field the
 * page needs in order to tell the visitor what it summed.
 *
 * @param {Object} args
 * @param {IdentityChoice} args.choice
 * @param {ChildEntity[]} args.children
 * @param {number} args.childrenExpected
 * @param {number} args.fiscalYear
 * @param {import('../core/constants.js').AwardTypeSetId} args.awardTypeSetId
 * @param {string|null} args.sourceAsOf
 * @returns {ResolvedIdentity}
 */
export function resolveIdentity(args) {
  const { choice } = args;
  if (!choice || typeof choice !== 'object') {
    throw new TypeError('resolveIdentity: a choice is required. The visitor picks the entity; '
      + 'the tool never picks one for them, because sixteen parent level records can match a '
      + 'single well known name and they carry different totals.');
  }
  const candidate = assertIdentityCandidate(choice.candidate, 'resolveIdentity');
  const how = choice.how;
  if (how !== 'picked-from-list' && how !== 'picked-a-chip' && how !== 'picked-by-flag'
    && how !== 'only-candidate') {
    throw new TypeError('resolveIdentity: choice.how must say how the entity was chosen, so the '
      + 'page can say so too.');
  }
  requireFiscalYear(args.fiscalYear, 'resolveIdentity');
  if (!AWARD_TYPE_SETS[args.awardTypeSetId]) {
    throw new RangeError('resolveIdentity: awardTypeSetId must be one of '
      + Object.keys(AWARD_TYPE_SETS).join(', '));
  }
  if (!Array.isArray(args.children)) {
    throw new TypeError('resolveIdentity: children must be an array, even when it is empty.');
  }
  if (!Number.isInteger(args.childrenExpected) || args.childrenExpected < 0) {
    throw new TypeError('resolveIdentity: childrenExpected must be a non negative integer. It is '
      + 'what makes an incomplete rollup detectable, and an incomplete rollup suppresses the '
      + 'total rather than showing it short.');
  }
  for (const child of args.children) {
    assertUei(child.uei, 'resolveIdentity child.uei');
    if (typeof child.obligations !== 'number' || !Number.isFinite(child.obligations)) {
      throw new TypeError('resolveIdentity: every child must carry a finite obligations figure '
        + 'for the SAME fiscal year as the parent.');
    }
  }

  const children = Object.freeze(args.children.map((c) => Object.freeze({ ...c })));
  const childCount = children.length;
  const rollupComplete = childCount === args.childrenExpected;
  const names = new Set([candidate.name.toUpperCase(), ...children.map((c) => c.name.toUpperCase())]);

  const subjectSentence = candidate.name + ', parent UEI ' + candidate.uei + ', summed with '
    + (childCount === 1 ? 'one registered child entity' : childCount + ' registered child entities')
    + (rollupComplete ? '' : ' of ' + args.childrenExpected + ' expected')
    + '. Parent linkage is self declared in SAM.gov registration, not SEC consolidation.';

  return Object.freeze({
    recipientId: candidate.recipientId,
    uei: candidate.uei,
    name: candidate.name,
    level: 'PARENT',
    alternateNames: Object.freeze([...(candidate.alternateNames || [])]),
    children,
    childCount,
    childrenExpected: args.childrenExpected,
    rollupComplete,
    fiscalYear: args.fiscalYear,
    awardTypeSetId: args.awardTypeSetId,
    sourceAsOf: args.sourceAsOf === undefined ? null : args.sourceAsOf,
    chosenHow: how,
    entityNamesUpper: names,
    subjectSentence,
  });
}

/**
 * Build the refusal. DESIGN C9: this is treated as a capability with its own panel, not as an
 * error, and it is the most trustworthy thing on the page.
 *
 * @param {string} queryText
 * @param {IdentityCandidate[]} splitRecords
 * @returns {IdentityRefusal}
 */
export function refuseIdentity(queryText, splitRecords) {
  if (!Array.isArray(splitRecords) || splitRecords.length < 2) {
    throw new TypeError('refuseIdentity: a refusal names the unlinked parent records it found, '
      + 'and there must be more than one of them, or there is nothing to refuse.');
  }
  splitRecords.forEach((c, i) => assertIdentityCandidate(c, 'refuseIdentity splitRecords[' + i + ']'));
  return Object.freeze({
    refused: true,
    queryText,
    splitRecords: Object.freeze(splitRecords.map((c) => Object.freeze({ ...c }))),
    sentence: 'No single parent record exists for "' + queryText + '" in this dataset. '
      + splitRecords.length + ' separate parent level records match, they are not linked to each '
      + 'other, and adding them together would invent a company that the government record does '
      + 'not contain. The records are listed with their UEIs so you can choose one deliberately.',
  });
}

/**
 * True when a name resolves to more than one unlinked parent record and the tool must refuse.
 * @param {IdentityCandidate[]} candidates
 * @returns {boolean}
 */
export function mustRefuse(candidates) {
  if (!Array.isArray(candidates)) return false;
  const parents = candidates.filter((c) => c && c.level === 'PARENT');
  return parents.length > 1;
}

/** @param {unknown} x @returns {boolean} */
export function isResolvedIdentity(x) {
  return Boolean(x) && typeof x === 'object'
    && typeof (/** @type {any} */ (x).uei) === 'string'
    && (/** @type {any} */ (x).level) === 'PARENT'
    && typeof (/** @type {any} */ (x).rollupComplete) === 'boolean'
    && (/** @type {any} */ (x).entityNamesUpper) instanceof Set;
}
