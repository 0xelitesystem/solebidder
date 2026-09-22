// THE PARENT TREE IS SELF DECLARED AND IT GOES STALE. Trap 8, DESIGN 2.4 item 5.
//
// WHAT THIS MODULE DOES AND, MORE IMPORTANTLY, WHAT IT REFUSES TO DO.
//
// It DISCLOSES. It does not correct. Nothing here removes a child from a rollup, adjusts an
// amount, or reorders a list. The registration record says what it says; our job is to show the
// reader the part of it that is known to be behind the world, not to publish our own private
// corporate tree and call it the government's.
//
// The reason is not politeness. The moment this tool starts editing the tree, every figure on
// the page becomes our arithmetic over our opinion of who owns whom, which is unbadgeable: there
// is no endpoint we could name for it and no fixture that could reproduce it. A disclosed stale
// linkage is a fact about the source. A silently removed one is a claim about the world.
//
// THE WORKED EXAMPLE IS ON THE PAGE, NOT IN A FOOTNOTE. DESIGN 2.4 item 5 names it: the
// children list for the most searched parent in this dataset still carries the Sandia
// management entity, and that management contract moved to a different operator in 2017. It is
// shown as the illustration of the caveat rather than hidden, because a caveat with a worked
// example beside it is one a reader believes.
//
// VERIFIED LIVE ON 2026-09-22. GET /api/v2/recipient/children/ZFN2JJXBLZT3/?year=2025 returned
// 217 rows, one of which is NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC, UEI
// LUJEPCRRT377, with an amount of 0 recorded for that fiscal year. The linkage is still there;
// the fiscal year figure attached to it is zero. Both halves of that are shown.
//
// HOW THE REGISTRY IS ALLOWED TO GROW. One entry per case, each with the UEI it keys on, the
// parent UEI it appears under, and a sentence stating what is known. No entry may assert a
// figure, and assertDisclosure refuses one that tries: a disclosure is prose about a linkage,
// and a number inside it would be a claim with no endpoint behind it.
//
// Isomorphic: no node:* imports and no DOM.

import { assertUei } from '../query/endpoints.js';

/**
 * @typedef {Object} StaleLinkage
 * @property {string} childUei The child record as it appears in the registration tree.
 * @property {string} parentUei The parent it still appears under.
 * @property {string} childNameAsRecorded The name exactly as the endpoint returns it.
 * @property {string} sentence What the page says about this linkage.
 */

/**
 * The known cases. This list is short on purpose and it is not a substitute for the general
 * caveat, which applies to every linkage in the tree whether or not it is listed here.
 *
 * @type {readonly StaleLinkage[]}
 */
export const KNOWN_STALE_LINKAGES = Object.freeze([
  Object.freeze({
    childUei: 'LUJEPCRRT377',
    parentUei: 'ZFN2JJXBLZT3',
    childNameAsRecorded: 'NATIONAL TECHNOLOGY & ENGINEERING SOLUTIONS OF SANDIA, LLC',
    sentence: 'This entity still appears as a registered child of this parent in the source '
      + 'registration record, and the management contract it operates under moved to a '
      + 'different operator in 2017. The linkage is shown here exactly as the government record '
      + 'carries it. This tool does not edit the tree, because an edited tree would be our '
      + 'opinion of who owns whom rather than the record, and there would be no endpoint to name '
      + 'beside it.',
  }),
]);

/**
 * The sentence that qualifies EVERY rollup, listed or not. The registry above holds the worked
 * examples; this is the rule they illustrate.
 */
export const SELF_DECLARED_LINKAGE_NOTICE = 'The parent and child relationships summed here are '
  + 'what the registrant declared about itself in its own registration, not SEC consolidation. '
  + 'They are maintained by the registrant, they go stale, and at least one linkage in this '
  + 'dataset is known to be behind the world.';

/**
 * Refuse a registry entry that carries a figure. A disclosure is prose about a linkage.
 * @param {StaleLinkage} entry
 * @param {string} where
 * @returns {StaleLinkage}
 */
export function assertDisclosure(entry, where) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError(where + ': a disclosure must be an object.');
  }
  assertUei(entry.childUei, where + ' childUei');
  assertUei(entry.parentUei, where + ' parentUei');
  if (typeof entry.childNameAsRecorded !== 'string' || entry.childNameAsRecorded.trim().length === 0) {
    throw new TypeError(where + ': a disclosure names the entity exactly as the endpoint records '
      + 'it, so a reader can find the row it is about.');
  }
  if (typeof entry.sentence !== 'string' || entry.sentence.trim().length === 0) {
    throw new TypeError(where + ': a disclosure is a sentence.');
  }
  if (/\d[\d,.]*\s*(?:billion|million|thousand|percent)\b|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/i.test(entry.sentence)) {
    throw new TypeError(where + ': a disclosure sentence carries no figure. A quantity written '
      + 'into prose here would be a claim with no endpoint behind it and no badge on it, which '
      + 'is the one thing this product does not publish. A calendar year is allowed; a quantity '
      + 'is not.');
  }
  return entry;
}

KNOWN_STALE_LINKAGES.forEach((e, i) => assertDisclosure(e, 'KNOWN_STALE_LINKAGES[' + i + ']'));

/**
 * Which disclosures apply to a resolved identity.
 *
 * It reads the children. It does not touch them. The returned array is the page's disclosure
 * panel, and the children array handed in is the same array on the way out, which
 * test/identity.test.js asserts by identity rather than by value.
 *
 * @param {{uei:string, children:readonly {uei:string, name:string}[]}} identity
 * @returns {{disclosures:StaleLinkage[], notice:string}}
 */
export function staleLinkageDisclosures(identity) {
  if (!identity || typeof identity !== 'object' || !Array.isArray(identity.children)) {
    throw new TypeError('staleLinkageDisclosures: expected a resolved identity with a children '
      + 'array.');
  }
  const byUei = new Set(identity.children.map((c) => c.uei));
  const disclosures = KNOWN_STALE_LINKAGES
    .filter((e) => e.parentUei === identity.uei && byUei.has(e.childUei))
    .map((e) => Object.freeze({ ...e }));
  return { disclosures, notice: SELF_DECLARED_LINKAGE_NOTICE };
}
