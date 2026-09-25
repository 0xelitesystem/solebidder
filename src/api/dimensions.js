// THE FOUR CATEGORY DIMENSIONS AND THE SPINE LENGTH, WITHOUT A DOCUMENT. DESIGN C2 and C3.
//
// These tables used to live in src/ui/app.js. They live here so the page and the command line
// ask the same four questions in the same order, badge each answer with the same method and say
// it in the same words, and so the command line can read them without importing the page's
// render layer. src/ui/app.js re-exports both names, so the page's existing importers keep working.
//
// EVERY DIMENSION HAS ITS OWN METHOD, and that is the point of the table rather than a loop over
// bare strings. The method is what the badge prints, so a single shared method would have every
// panel claiming its share was computed over awarding agencies while three of them were not.
// They run in this order because the agency panel is the one DESIGN C2 calls the headline and
// the slowest endpoints should not delay it.
//
// THE SENTENCE IS PER DIMENSION, because the verb is per dimension. Money COMES FROM a buyer and
// it is RECORDED AGAINST a classification, and running every panel through the buyer wording
// would have three of the four describing something they did not measure. Each entry carries its
// own tail and its own label for the top row, so neither surface has to supply a default.
//
// Isomorphic: no node:* imports and no DOM.

import { METHODS } from '../core/claim.js';

/** How many fiscal years the spine shows. DESIGN 6.9 chart one. */
export const SPINE_YEARS = 10;

/**
 * The four category dimensions. `region` is where the page mounts each one; the command line
 * ignores it.
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
    tailText: ' of the dollars obligated to this entity in the fiscal year selected came from one '
      + 'department.',
    topLabel: 'That one buyer is ',
  }),
  Object.freeze({
    dimension: 'awarding_subagency',
    region: 'mixSubagency',
    noun: 'sub agency',
    rowNoun: 'awarding sub agency',
    chartNoun: 'buying sub agency',
    method: METHODS.SUBAGENCY_SHARE,
    herfindahl: false,
    tailText: ' of the dollars obligated to this entity in the fiscal year selected came from one '
      + 'sub agency.',
    topLabel: 'That one buyer is ',
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
