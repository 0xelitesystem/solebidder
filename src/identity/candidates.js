// FROM A TYPED NAME TO A LIST OF ENTITIES THE VISITOR CAN CHOOSE BETWEEN. CONTRACT 1, DESIGN C9.
//
// THE MEASUREMENT THIS FILE IS BUILT AROUND. The list endpoint was queried live for the text
// "LOCKHEED MARTIN" on 2026-09-22. It returned 50 rows on the first page of 272, and SIXTEEN of
// them are parent level records with different UEIs. "Google" returns two parent level records
// that are not linked to each other. So a tool that picks one for the visitor is picking at
// random and putting a badge on the result.
//
// WHAT THIS MODULE DOES. It turns a validated list response into candidates, and it does four
// things to that response that are each worth stating:
//
//   1. IT DROPS THE AMOUNT, because the validator never projected one. Trap 4: that endpoint has
//      no year parameter and its figure covers a window nobody named. For the parent record
//      chosen below, the list figure is 61,964,720,403.63 while the same parent for FY2025 is
//      65,405,410,468.25. Both look plausible. Only one of them answers the question the page
//      asks, and it is not the one on the chooser.
//   2. IT KEEPS PARENT LEVEL RECORDS ONLY. The endpoint reports the level as a single letter,
//      P for parent and C for child, and CONTRACT 1 wants the word. The translation happens here
//      and nowhere else. A child level record has no children of its own to roll up and its
//      total answers a different question.
//   3. IT DROPS A RECORD WITH NO UEI. This product keys on UEI only, trap 13, and a record
//      without one cannot be fetched, summed or shown.
//   4. IT NEVER MERGES TWO RECORDS. Two parent records that share a name are two entities until
//      the government says otherwise, and the government has not said otherwise.
//
// Isomorphic: no node:* imports and no DOM.

import { assertIdentityCandidate, mustRefuse, refuseIdentity } from '../contracts/identity.js';

/** The letter the list and profile endpoints use for a parent level record. */
const PARENT_LETTER = 'P';

/**
 * Turn a validated list projection into candidates.
 *
 * @param {{candidates:{recipientId:string, uei:string|null, name:string, level:string|null}[]}} projection
 * @returns {{candidates:import('../contracts/identity.js').IdentityCandidate[],
 *   droppedChildLevel:number, droppedNoUei:number}}
 */
export function toParentCandidates(projection) {
  if (!projection || !Array.isArray(projection.candidates)) {
    throw new TypeError('toParentCandidates: expected the validated recipient list projection.');
  }
  /** @type {import('../contracts/identity.js').IdentityCandidate[]} */
  const out = [];
  const seen = new Set();
  let droppedChildLevel = 0;
  let droppedNoUei = 0;

  for (const row of projection.candidates) {
    const level = typeof row.level === 'string' ? row.level.trim().toUpperCase() : '';
    if (level !== PARENT_LETTER && level !== 'PARENT') {
      droppedChildLevel += 1;
      continue;
    }
    if (typeof row.uei !== 'string' || !/^[A-Z0-9]{12}$/.test(row.uei)) {
      droppedNoUei += 1;
      continue;
    }
    if (seen.has(row.recipientId)) continue;
    seen.add(row.recipientId);
    out.push(Object.freeze({
      recipientId: row.recipientId,
      uei: row.uei,
      name: row.name,
      level: /** @type {'PARENT'} */ ('PARENT'),
      alternateNames: Object.freeze([]),
      location: null,
    }));
  }

  out.forEach((c, i) => assertIdentityCandidate(c, 'toParentCandidates[' + i + ']'));
  return { candidates: out, droppedChildLevel, droppedNoUei };
}

/**
 * Decide what happens next, and this is the decision the whole product turns on.
 *
 * FOUR OUTCOMES, and three of them are not a total.
 *
 *   'no-records'       nothing in this dataset matches the text at parent level. Said plainly,
 *                      never as an empty chart, and never as a zero.
 *   'only-candidate'   exactly one parent record matches. The choice is made, and the page still
 *                      names which entity it resolved to.
 *   'choice-required'  more than one unlinked parent record matches, which is the NORMAL case
 *                      for a large company. The tool refuses to produce a single total by
 *                      itself, shows the split records with their UEIs, and lets the visitor
 *                      pick one deliberately. DESIGN C9 treats this as a capability with its own
 *                      panel rather than an error, because adding those records together would
 *                      invent a company the record does not contain.
 *
 * The refusal object and the candidate list are BOTH returned for 'choice-required', because the
 * panel shows the refusal sentence and the list in the same place.
 *
 * @param {string} queryText
 * @param {import('../contracts/identity.js').IdentityCandidate[]} candidates
 * @returns {{outcome:'no-records'|'only-candidate'|'choice-required',
 *   candidates:import('../contracts/identity.js').IdentityCandidate[],
 *   choice:import('../contracts/identity.js').IdentityChoice|null,
 *   refusal:import('../contracts/identity.js').IdentityRefusal|null,
 *   sentence:string}}
 */
export function decideIdentity(queryText, candidates) {
  const text = typeof queryText === 'string' ? queryText.trim() : '';
  if (text.length === 0) {
    throw new TypeError('decideIdentity: the query text is quoted back to the visitor in every '
      + 'outcome, so it is required.');
  }
  if (!Array.isArray(candidates)) {
    throw new TypeError('decideIdentity: candidates must be an array, even when it is empty.');
  }

  if (candidates.length === 0) {
    return {
      outcome: 'no-records',
      candidates: [],
      choice: null,
      refusal: null,
      sentence: 'No parent level record matches "' + text + '" in this dataset. That means this '
        + 'search found no registered parent entity of that name, not that a company of that '
        + 'name received nothing. Entities that are not registered under a parent are invisible '
        + 'to this view.',
    };
  }

  if (mustRefuse(candidates)) {
    const refusal = refuseIdentity(text, candidates);
    return {
      outcome: 'choice-required',
      candidates,
      choice: null,
      refusal,
      sentence: refusal.sentence,
    };
  }

  const only = candidates[0];
  return {
    outcome: 'only-candidate',
    candidates,
    choice: Object.freeze({ candidate: only, how: /** @type {'only-candidate'} */ ('only-candidate') }),
    refusal: null,
    sentence: 'One parent level record matches "' + text + '": ' + only.name + ', UEI '
      + only.uei + '. Every figure below is recorded against that UEI family.',
  };
}

/**
 * The visitor picked one of the split records. The choice carries HOW it was made, so the page
 * can say "you chose this" rather than implying the tool knew. 'picked-by-flag' is the command
 * line's own act: the reader named the identifier with an option, which is a choice made before
 * any list was shown, and it is recorded as that rather than borrowed from the page's wording.
 *
 * @param {import('../contracts/identity.js').IdentityCandidate[]} candidates
 * @param {string} uei
 * @param {'picked-from-list'|'picked-a-chip'|'picked-by-flag'} [how]
 * @returns {import('../contracts/identity.js').IdentityChoice}
 */
export function pickCandidate(candidates, uei, how = 'picked-from-list') {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError('pickCandidate: there are no candidates to pick from.');
  }
  if (how !== 'picked-from-list' && how !== 'picked-a-chip' && how !== 'picked-by-flag') {
    throw new TypeError('pickCandidate: how must say whether the visitor picked from the list, '
      + 'clicked a chip or named the identifier with an option. The output states which, because '
      + 'the subject of every figure in it was chosen rather than deduced.');
  }
  const found = candidates.find((c) => c.uei === uei);
  if (found === undefined) {
    throw new RangeError('pickCandidate: no candidate carries UEI ' + JSON.stringify(uei)
      + '. A chosen entity that is not one of the records shown would make the page name a '
      + 'subject the visitor never saw.');
  }
  return Object.freeze({ candidate: assertIdentityCandidate(found, 'pickCandidate'), how });
}
