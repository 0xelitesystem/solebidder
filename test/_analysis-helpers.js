// Shared loading and assembly for the analysis tests. Not a test file: the runner globs
// *.test.js, so this is imported rather than executed.
//
// TWO KINDS OF FIXTURE AND THE DIFFERENCE MATTERS.
//
//   hand(name)      loads test/fixtures/<name>.hand.json. Hand built, chosen so the arithmetic
//                   can be checked on paper. Every one carries an `arithmetic` block stating
//                   the expected answer and the working.
//   recorded(name)  loads test/fixtures/api/<name>.json, a real recorded response from the
//                   government API. These are what make a published figure reproducible by a
//                   stranger, and nothing in this directory is ever written by hand to look
//                   like one.
//
// See test/fixtures/README.md for why the distinction is enforced by naming rather than
// remembered.

import { readFileSync } from 'node:fs';
import { resolveIdentity } from '../src/contracts/identity.js';
import { renderClaim, isClaim } from '../src/core/claim.js';

/** @param {string} name @returns {any} */
export function hand(name) {
  return JSON.parse(readFileSync(new URL('./fixtures/' + name + '.hand.json', import.meta.url), 'utf8'));
}

/** @param {string} name @returns {any} */
export function recorded(name) {
  return JSON.parse(readFileSync(new URL('./fixtures/api/' + name + '.json', import.meta.url), 'utf8'));
}

/** The provenance every claim in these tests carries. */
export const META = Object.freeze({
  fiscalYear: 2025,
  awardTypeSetId: 'contracts',
  sourceAsOf: '09/21/2026',
});

/** A candidate with no money figure on it, which is the whole point of the shape. */
export const CANDIDATE = Object.freeze({
  recipientId: 'hand-candidate-P',
  uei: 'HAND00000001',
  name: 'SUBJECT ENTITY',
  level: 'PARENT',
  alternateNames: ['SUBJECT ENTITY INCORPORATED'],
  location: 'SPRINGFIELD, ZZ',
});

/**
 * Build a ResolvedIdentity for a test.
 * @param {{children?:object[], childrenExpected?:number, fiscalYear?:number}} [overrides]
 * @returns {import('../src/contracts/identity.js').ResolvedIdentity}
 */
export function identity(overrides = {}) {
  const children = overrides.children === undefined ? [] : overrides.children;
  return resolveIdentity({
    choice: { candidate: CANDIDATE, how: 'picked-from-list' },
    children,
    childrenExpected: overrides.childrenExpected === undefined ? children.length : overrides.childrenExpected,
    fiscalYear: overrides.fiscalYear === undefined ? META.fiscalYear : overrides.fiscalYear,
    awardTypeSetId: META.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
  });
}

/**
 * Map a validated children response onto the ChildEntity shape the resolved identity takes.
 * The validator projects the field as `amount`, the identity contract names it `obligations`,
 * and the mapping is done once here rather than inline in five tests where one of them would
 * eventually be written the other way round.
 * @param {{children:{uei:string, name:string, amount:number}[]}} validated
 * @returns {{uei:string, name:string, obligations:number}[]}
 */
export function childEntities(validated) {
  return validated.children.map((c) => ({ uei: c.uei, name: c.name, obligations: c.amount }));
}

/**
 * A complete AnalysisInput with everything empty, so a test can override exactly the one field
 * it is about and nothing else.
 * @param {object} [overrides]
 * @returns {object}
 */
export function analysisInput(overrides = {}) {
  const id = overrides.identity === undefined ? identity() : overrides.identity;
  return {
    identity: id,
    fiscalYear: id.fiscalYear,
    awardTypeSetId: id.awardTypeSetId,
    sourceAsOf: META.sourceAsOf,
    agencyRows: [],
    subagencyRows: [],
    pscRows: [],
    naicsRows: [],
    overTimePoints: [],
    awardRows: [],
    awardRowsExcluded: 0,
    awardDetails: [],
    childRows: [],
    parentReportedTotal: 0,
    ...overrides,
  };
}

/**
 * Walk any structure and collect every Claim in it, so a test can assert a property of ALL of
 * them at once. Used for the two properties that must hold everywhere: every claim renders,
 * and no rendered claim contains the text a failed division produces.
 * @param {any} node
 * @param {import('../src/core/claim.js').Claim[]} [out]
 * @returns {import('../src/core/claim.js').Claim[]}
 */
export function collectClaims(node, out = []) {
  if (node === null || node === undefined) return out;
  if (isClaim(node)) { out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach((v) => collectClaims(v, out)); return out; }
  if (node instanceof Set || node instanceof Map) return out;
  if (typeof node !== 'object') return out;
  for (const value of Object.values(node)) collectClaims(value, out);
  return out;
}

/**
 * Render every claim in a structure and return the text, so a test can assert that no figure
 * anywhere in an output reached a reader as the text a failed division produces.
 * @param {any} node
 * @returns {string[]}
 */
export function renderAll(node) {
  return collectClaims(node).map((c) => renderClaim(c).text);
}

/**
 * Assert two numbers agree to within a tolerance, and say by how much when they do not.
 * @param {import('node:assert/strict').default} assert
 * @param {number} actual
 * @param {number} expected
 * @param {number} tolerance
 * @param {string} message
 */
export function close(assert, actual, expected, tolerance, message) {
  const diff = Math.abs(actual - expected);
  assert.ok(diff <= tolerance, message + ' Computed ' + actual + ', expected ' + expected
    + ', which is a difference of ' + diff + ' against a tolerance of ' + tolerance + '.');
}
