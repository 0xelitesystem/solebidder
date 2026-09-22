// The banned house colour values, and the scan for them.
//
// This file exists separately from src/core/tokens.js for one reason: tokens.js SHIPS, and a
// file that has to name a forbidden literal in order to forbid it must not be a file that is
// served. Keeping the literals here means the shipped palette contains only colours that pass.
//
// Each entry is a number rather than a preference. #6b7280 against #0a0a0a computes to 4.10,
// which is under the AA threshold of 4.5 for normal text, and it reached many repositories
// before anybody did the arithmetic. That is the whole case for this file.

/**
 * @typedef {Object} BannedColour
 * @property {string} value
 * @property {string} why
 * @property {string} instead
 */

/** @type {readonly BannedColour[]} */
export const BANNED_COLOURS = Object.freeze([
  Object.freeze({
    value: '#6b7280',
    why: 'Computes to 4.10:1 on the dark ground, which is under the 4.5 AA threshold for normal '
      + 'text. It is the house value that shipped broken across many repositories.',
    instead: 'Use the inkSoft token, which is 7.75:1 on the dark ground and 6.32:1 on the light '
      + 'ground.',
  }),
  Object.freeze({
    value: '#a05a00',
    why: 'A banned house colour that shipped broken once already.',
    instead: 'Use the accent token for the theme in question.',
  }),
  Object.freeze({
    value: '#b8341a',
    why: 'A banned house colour that shipped broken once already.',
    instead: 'Use the accent token for the theme in question.',
  }),
]);

/**
 * Find a banned colour used as a TEXT colour, which is the use that fails. A banned value used
 * as a non text stroke is still refused here, because keeping the rule simple is worth more
 * than the one legitimate case it might cost.
 *
 * @param {string} text
 * @param {string} rel
 * @returns {{value:string, line:number, why:string, instead:string}[]}
 */
export function scanForBannedColours(text, rel) {
  const hits = [];
  for (const c of BANNED_COLOURS) {
    const re = new RegExp(c.value.replace('#', '#'), 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      hits.push({
        value: c.value,
        line: text.slice(0, m.index).split('\n').length,
        why: c.why,
        instead: c.instead,
      });
    }
  }
  return hits;
}
