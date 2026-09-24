// Constants that more than one layer needs, each with the measurement or the design section
// that fixes it. Nothing here is a taste call.
//
// Isomorphic: no node:* imports and no DOM.

/** The one host this product may reach. DESIGN 3.4. The CSP declares exactly this and nothing else. */
export const API_ORIGIN = 'https://api.usaspending.gov';

/** Earliest fiscal year the search API can answer for. Trap 14. */
export const FISCAL_YEAR_FLOOR = 2008;

/**
 * The three award type sets, shown as a visible control. DESIGN C6.
 *
 * All three are defensible and they give different totals, which is exactly why the control is
 * visible and the chosen set is named on every badge. It is never a hidden default.
 */
export const AWARD_TYPE_SETS = Object.freeze({
  contracts: Object.freeze({
    id: 'contracts',
    label: 'Contracts only',
    codes: Object.freeze(['A', 'B', 'C', 'D']),
    describe: 'Definitive contracts and purchase orders, award type codes A, B, C and D.',
  }),
  contractsAndIdvs: Object.freeze({
    id: 'contractsAndIdvs',
    label: 'Contracts and IDVs',
    codes: Object.freeze(['A', 'B', 'C', 'D', 'IDV_A', 'IDV_B', 'IDV_B_A', 'IDV_B_B', 'IDV_B_C',
      'IDV_C', 'IDV_D', 'IDV_E']),
    describe: 'Contracts plus indefinite delivery vehicles.',
  }),
  all: Object.freeze({
    id: 'all',
    label: 'All award types',
    codes: null,
    describe: 'Every award type. This is the set the government recipient profile page uses, so '
      + 'it is the set whose total matches that page.',
  }),
});

/** @typedef {'contracts'|'contractsAndIdvs'|'all'} AwardTypeSetId */

/** The default set, named out loud rather than left implicit. */
export const DEFAULT_AWARD_TYPE_SET = 'contracts';

/**
 * Subawards are excluded from every query. DESIGN 2.4 item 6. This is a constant rather than a
 * literal at each call site so that a request builder cannot be written without it.
 */
export const SUBAWARDS = false;

/**
 * Concurrency cap for the award detail fan out. Trap 6 and trap 11: there is no documented rate
 * limit, which means there is also no published ceiling to design against, so an undocumented
 * limit can appear without notice. Six is the measured working point.
 */
export const MAX_CONCURRENCY = 6;

/** Award list page size. The API returns HTTP 422 above 100. Trap 6. */
export const MAX_PAGE_LIMIT = 100;

/** How many of the largest awards the hero fans out over. DESIGN C1. */
export const HERO_AWARD_COUNT = 40;

/**
 * How long a tile may show a skeleton before it must say why. DESIGN 6.3: after this the
 * skeleton gains an honest line, because a bare spinner reads as broken and a spinner that
 * implies progress it cannot see is a lie.
 */
export const COLD_SOURCE_NOTICE_MS = 3000;

/** The sentence that replaces a bare spinner. DESIGN 6.3. */
export const COLD_SOURCE_NOTICE = 'Still loading from USAspending. The source is cold for this '
  + 'query and cold queries have been measured at tens of seconds.';

/**
 * The advice disclaimer, in ONE copy. The build writes it into the page footer from here, the
 * command line prints it from here, and a test holds the README and USAGE to these exact words.
 * Readers include credit and equity analysts, and a figure lifted out of this tool into a note is
 * still a government record and some arithmetic over it, never a recommendation.
 */
export const ADVICE_DISCLAIMER = 'This tool reports government records and arithmetic over them. '
  + 'It is not investment, legal or procurement advice.';

/** Compare is capped at three series. DESIGN C8 and 6.8: colour separation will not carry a fourth. */
export const MAX_COMPARE_SERIES = 3;
