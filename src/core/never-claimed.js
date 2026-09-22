// THE NEVER CLAIMED REGISTRY. DESIGN 2.4.
//
// Ten sentences. Each one appears ON THE PAGE, not in a footnote, because a reader who misses
// one of them will misread every figure above it.
//
// They are code rather than copy for one reason: copy gets rewritten, and the rewrite is where
// a boundary quietly softens. scripts/gate-vocabulary.mjs asserts that every sentence below is
// present in index.html verbatim, so dropping one fails the build rather than shipping a
// friendlier page.
//
// The phrasing here is also the ONLY place these words are allowed to appear in this product.
// The gate masks these exact sentences out of the shipped copy and then bans the underlying
// terms everywhere else, so "obligations are not revenue" is publishable and
// "Lockheed revenue" is not.
//
// Nothing here is softened. A claim that cannot be supported is cut, not reworded into
// something vaguer that means the same thing.
//
// Isomorphic: no node:* imports and no DOM.

import { neverClaimed } from './claim.js';

/**
 * @typedef {Object} NeverClaimedItem
 * @property {string} id Stable identifier, quoted in the gate failure message.
 * @property {string} heading The short form used as the item heading on the page.
 * @property {string} sentence The full sentence, published verbatim.
 * @property {string} designRef Where in the design it is fixed.
 */

/** @type {readonly NeverClaimedItem[]} */
export const NEVER_CLAIMED_ITEMS = Object.freeze([
  Object.freeze({
    id: 'obligations-are-not-revenue',
    heading: 'These are obligations, not revenue.',
    sentence: 'These are obligations, not revenue. The government committing money is not the '
      + 'company recognising revenue under ASC 606, and it is not cash paid. A large obligation '
      + 'in one year is not a revenue year of the same size, because the work is performed and '
      + 'booked over many years.',
    designRef: 'DESIGN 2.4 item 1',
  }),
  Object.freeze({
    id: 'not-outlays',
    heading: 'These are not outlays.',
    sentence: 'These are not outlays. The total outlays field came back null on every aggregate '
      + 'endpoint tested, on spending over time and on every category response. Outlays are not '
      + 'trended anywhere in this tool, because they are not available, and a null is never '
      + 'displayed as a zero.',
    designRef: 'DESIGN 2.4 item 2',
  }),
  Object.freeze({
    id: 'award-value-is-lifetime',
    heading: 'Award Amount is lifetime award value.',
    sentence: 'Award Amount is the lifetime value of an award, exercised options included, not '
      + 'money obligated in the fiscal year you selected. It never shares a chart, a column or a '
      + 'colour ramp with the fiscal year figure.',
    designRef: 'DESIGN 2.4 item 3',
  }),
  Object.freeze({
    id: 'not-everything-a-company-gets',
    heading: 'This is not everything a company gets.',
    sentence: 'This is money recorded under one parent UEI and its registered child UEIs. '
      + 'Entities that are not registered under that parent are invisible to it, and the figure '
      + 'is not a measure of everything the company receives from the federal government.',
    designRef: 'DESIGN 2.4 item 4',
  }),
  Object.freeze({
    id: 'parent-tree-self-reported',
    heading: 'The parent and child tree is self reported, not audited.',
    sentence: 'The parent and child tree is what the registrant declared about itself in SAM.gov '
      + 'registration. It is not SEC consolidation, nobody audited it, and it goes stale. One '
      + 'large laboratory entity still sits in a defence prime children list years after its '
      + 'management contract moved to a different company, and that example is shown on this '
      + 'page rather than hidden.',
    designRef: 'DESIGN 2.4 item 5, trap 8',
  }),
  Object.freeze({
    id: 'subawards-excluded',
    heading: 'Subawards are excluded.',
    sentence: 'Every query here sets subawards to false. Subaward reporting is self reported by '
      + 'prime recipients and is materially incomplete, so including it would produce a floor '
      + 'that reads like a total.',
    designRef: 'DESIGN 2.4 item 6',
  }),
  Object.freeze({
    id: 'no-losing-bidders',
    heading: 'Who lost a bid does not exist in this data.',
    sentence: 'The federal procurement record publishes the number of offers received and never '
      + 'the identity of the parties who did not win. Any tool implying otherwise is fabricating '
      + 'it, and this one says so in the competition panel rather than in a footnote.',
    designRef: 'DESIGN 2.4 item 7',
  }),
  Object.freeze({
    id: 'classified-gap-unmeasurable',
    heading: 'Classified and withheld actions are missing.',
    sentence: 'Classified and withheld actions are absent from this data and the size of that gap '
      + 'cannot be measured from inside it. Defence primes are exactly where the gap is largest '
      + 'and exactly the names searched first, so no figure here is a complete picture of what a '
      + 'defence prime does for the government.',
    designRef: 'DESIGN 2.4 item 8, trap 15',
  }),
  Object.freeze({
    id: 'floor-2008',
    heading: 'Nothing before fiscal year 2008.',
    sentence: 'The search API holds nothing awarded before 1 October 2007, so the earliest fiscal '
      + 'year offered here is 2008 and no figure on this page is framed as covering the whole '
      + 'history of a company.',
    designRef: 'DESIGN 2.4 item 9, trap 14',
  }),
  Object.freeze({
    id: 'no-financial-denominators',
    heading: 'There is no revenue denominator here.',
    sentence: 'There is no revenue denominator, no backlog, no cost overrun figure and no split '
      + 'of foreign military sales anywhere in this tool. Those live in a company annual report '
      + 'and this page does not read one.',
    designRef: 'DESIGN 2.4 item 10',
  }),
]);

/** Exactly ten. The gate asserts this so an item cannot be dropped in a refactor. */
export const NEVER_CLAIMED_COUNT = 10;

/**
 * The ten statements as Claims, so the page renders them through the same badge path as every
 * figure and a screen reader announces them with the NEVER CLAIMED kind.
 * @returns {import('./claim.js').Claim[]}
 */
export function neverClaimedClaims() {
  return NEVER_CLAIMED_ITEMS.map((item) => neverClaimed(item.sentence, { note: item.heading }));
}

/**
 * Look one up by id, so a panel can place the statement that qualifies the figure it is showing
 * directly beside that figure.
 * @param {string} id
 * @returns {NeverClaimedItem}
 */
export function neverClaimedById(id) {
  const found = NEVER_CLAIMED_ITEMS.find((i) => i.id === id);
  if (!found) {
    throw new RangeError('neverClaimedById: no such statement "' + id + '". The ten ids are: '
      + NEVER_CLAIMED_ITEMS.map((i) => i.id).join(', '));
  }
  return found;
}
