// THE BANNED VOCABULARY. The enforcement half of DESIGN 2.4, the NEVER CLAIMED list.
//
// THE PAGE NEVER LOADS THIS FILE AND THE PACKAGE NEVER CARRIES IT. It lives under scripts/ for
// the same reason the banned colour literal does: a file that has to NAME the forbidden strings
// in order to forbid them cannot also be a module the page or the command line runs. It is not
// secret, and GitHub Pages serves it at its path like every committed file. src/ therefore
// needs no exemption from its own gate, which is a stronger arrangement than exempting the
// registry and hoping the exemption stays narrow.
//
// HOW THE SCAN WORKS, and the masking step is the whole trick. The ten NEVER CLAIMED statements
// in src/core/never-claimed.js are the ONLY permitted phrasing for these terms. The scanner
// masks those exact sentences out of the text first, then applies the patterns. So
// "These are obligations, not revenue" is publishable and "Lockheed revenue" is not, and the
// distinction is mechanical rather than a matter of somebody reading carefully at the end of a
// long day.
//
// Nothing here is softened. A claim that cannot be supported is cut, not reworded into
// something vaguer that means the same thing.

import { NEVER_CLAIMED_ITEMS } from '../src/core/never-claimed.js';

/**
 * @typedef {Object} BannedRule
 * @property {string} id Stable identifier, quoted in the failure message.
 * @property {RegExp} pattern Global.
 * @property {'shipped'|'src'|'query'} scope Which files the rule applies to.
 * @property {string} designRef
 * @property {string} why One sentence somebody can act on.
 */

/**
 * Phrases that are legitimate and must never be treated as a violation. They are masked out
 * along with the ten statements before the patterns run.
 *
 * Each of these is a sentence the product is REQUIRED to be able to say. A gate that stops the
 * page explaining its own boundary has not made the page more honest, it has made it silent.
 */
export const ALLOWED_PHRASES = Object.freeze([
  'obligations, not revenue',
  'are not revenue',
  'is not revenue',
  'no revenue denominator',
  'not outlays',
  'are not available',
  'total outlays field',
  'Outlays are not trended',
  'not audited',
  'is self reported',
  'are excluded',
  'Subawards are excluded',
  'subawards to false',
  'does not exist in this data',
  'never the identity',
  'are missing',
  'cannot be measured',
  'not everything a company gets',
  'is not a measure of everything',
  'no backlog',
  'no cost overrun',
  'foreign military sales',
  'lifetime award value',
  'lifetime value of an award',
  'not SEC consolidation',
]);

/**
 * Code fragments that must be allowed to contain a banned token because they ARE the
 * enforcement. Separated from ALLOWED_PHRASES so that nobody reads this list as prose the page
 * is permitted to publish. Both lists are masked the same way.
 *
 * There is one entry. It is the array of upstream field names the response validators refuse to
 * carry forward, and a validator that cannot name the field it drops cannot drop it.
 */
export const ALLOWED_CODE_FRAGMENTS = Object.freeze([
  "['total_outlays', 'total_outlay']",
]);

/**
 * The banned vocabulary.
 *
 * scope 'shipped' runs over index.html, README.md, src/ and docs/.
 * scope 'src' runs over src/ only.
 * scope 'query' runs over src/query/ only.
 *
 * @type {readonly BannedRule[]}
 */
export const BANNED = Object.freeze([
  Object.freeze({
    id: 'revenue-claim',
    pattern: /\brevenues?\b|\bturnover\b|\btop line\b|\bsales figures?\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 1',
    why: 'These figures are obligations. The government committing money is not the company '
      + 'recognising revenue and it is not cash paid. Any sentence that survives the masking step '
      + 'is using the word as a claim about this data rather than as a denial of one.',
  }),
  Object.freeze({
    id: 'outlays-claim',
    pattern: /\boutlays?\b|\bdisbursed\b|\bcash paid out\b|\bmoney actually spent\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 2, trap 7',
    why: 'The total outlays field came back null on every aggregate endpoint tested. It is never '
      + 'trended, never charted and never displayed as a zero, so the only permitted use of the '
      + 'word is the NEVER CLAIMED statement that says so.',
  }),
  Object.freeze({
    id: 'award-value-as-fiscal-year-money',
    pattern: /\baward (?:amount|value)[^.]{0,40}\b(?:obligated|in FY\d{4}|this fiscal year)\b|\b(?:obligated|fiscal year) (?:award )?(?:amount|value) including options\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 3, trap 7',
    why: 'Award Amount is the lifetime value of an award, exercised options included. Describing '
      + 'it as money obligated in a fiscal year merges two quantities that differ by a factor of '
      + 'several across a large prime.',
  }),
  Object.freeze({
    id: 'everything-the-company-gets',
    pattern: /\beverything (?:the )?(?:company|they|it) (?:gets|receives|makes|earns)\b|\ball (?:the )?(?:federal )?(?:money|dollars|funding) (?:it|they|the company) (?:gets|receives)\b|\btotal federal (?:funding|money) received\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 4',
    why: 'The claim is money recorded under one parent UEI and its registered child UEIs. '
      + 'Entities not registered under that parent are invisible to it.',
  }),
  Object.freeze({
    id: 'audited-or-consolidated',
    pattern: /\baudited\b|\bSEC consolidat\w*\b|\bconsolidated (?:financials|subsidiaries|group)\b|\bverified corporate (?:tree|structure)\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 5, trap 8',
    why: 'The parent and child tree is what a registrant declared about itself in a registration '
      + 'system. Nobody audited it, it is not consolidation under an accounting standard, and it '
      + 'goes stale in ways that are visible in the data today.',
  }),
  Object.freeze({
    id: 'subawards-included',
    pattern: /\bincluding subawards\b|\bsubawards? included\b|\bprime and sub\b|\bcomplete (?:picture|total) of (?:all )?(?:federal )?(?:spending|money|contracts)\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 6',
    why: 'Subaward reporting is self reported by primes and is materially incomplete. Including '
      + 'it would present a floor as a total.',
  }),
  Object.freeze({
    id: 'losing-bidders',
    pattern: /\blosing bidders?\b|\bwho (?:else )?(?:lost|bid against)\b|\bcompetitors? who bid\b|\bother bidders? (?:were|was|are|included)\b|\bbeat (?:out )?(?:its |their )?(?:rivals?|competitors?)\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 7',
    why: 'The procurement record publishes the number of offers received and never the identity '
      + 'of the parties who did not win. A tool implying otherwise is fabricating it.',
  }),
  Object.freeze({
    id: 'completeness-claim',
    pattern: /\bevery (?:federal )?(?:contract|dollar|award) (?:it|they|the company) (?:has|have)\b|\ball federal contracts\b|\bcomplete (?:record|dataset)\b|\bnothing is missing\b|\bfull picture\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 8, trap 15',
    why: 'Classified and withheld actions are absent and the size of that gap cannot be measured '
      + 'from inside the data. Defence primes are where the gap is largest and are the first '
      + 'names anyone searches.',
  }),
  Object.freeze({
    id: 'all-time-framing',
    pattern: /\ball[- ]time\b|\bsince (?:the )?(?:beginning|inception)\b|\bever (?:awarded|received)\b|\bhistorical total\b|\bfull history\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 9, trap 14',
    why: 'The search API holds nothing awarded before 1 October 2007, so no figure here covers '
      + 'the whole history of anything.',
  }),
  Object.freeze({
    id: 'absent-financial-denominators',
    pattern: /\bpercent of (?:its|their|company) revenue\b|\bbacklog\b|\bcost overruns?\b|\bprofit margins?\b|\bearnings\b/gi,
    scope: 'shipped',
    designRef: 'DESIGN 2.4 item 10',
    why: 'There is no revenue denominator, no backlog and no margin anywhere in this tool. Those '
      + 'live in a company annual report and this page does not read one.',
  }),
  Object.freeze({
    id: 'legacy-vendor-identifier',
    pattern: /\bduns\b|\bdun\s*&\s*bradstreet\b|\bdata universal numbering\b/gi,
    scope: 'shipped',
    designRef: 'trap 13',
    why: 'The legacy vendor number is a commercial data vendor identifier and its open data '
      + 'carries a written attribution obligation. Rendering it or keying on it would import that '
      + 'obligation into an otherwise public domain product. This tool keys on UEI only.',
  }),
  Object.freeze({
    id: 'rolling-window-literal',
    pattern: /year\s*=\s*latest|["'`]latest["'`]|:\s*latest\b/gi,
    scope: 'query',
    designRef: 'trap 3',
    why: 'The rolling window drifted by dollars and by transactions inside a single evening and '
      + 'it is not a fiscal year: the rolling figure and the named fiscal year figure for the '
      + 'same company differ by tens of billions. Only explicit integer fiscal years reach the '
      + 'query layer. The field name that contains this word as a prefix is untouched by this '
      + 'rule, which matches only the standalone literal.',
  }),
  Object.freeze({
    id: 'assistant-attribution',
    pattern: /co-authored-by|generated with (?:claude|an ai)|written by (?:claude|an ai)|ai[- ]assist(?:ed|ance)/gi,
    scope: 'shipped',
    designRef: 'house rule',
    why: 'No authorship attribution to an assistant appears anywhere in a shipped repository.',
  }),
  Object.freeze({
    id: 'em-and-en-dashes',
    pattern: /[—–]/g,
    scope: 'shipped',
    designRef: 'house rule',
    why: 'Neither dash appears anywhere in this repository, prose included.',
  }),
]);

/**
 * Mask the permitted phrasing out of a text before the patterns run.
 *
 * The ten NEVER CLAIMED sentences and their headings are the only permitted use of these terms,
 * so they are replaced with a neutral filler of the same length. Length preserving replacement
 * keeps the reported line numbers honest.
 *
 * @param {string} text
 * @returns {string}
 */
export function maskPermitted(text) {
  let out = text;
  const masks = [];
  for (const item of NEVER_CLAIMED_ITEMS) {
    masks.push(item.sentence);
    masks.push(item.heading);
    // The identifier is a kebab case form of the heading, and it is what an anchor on the page
    // and a cross reference from a panel both use. Masking it keeps the ids readable instead of
    // forcing them into numbers nobody can follow.
    masks.push(item.id);
  }
  for (const phrase of ALLOWED_PHRASES) masks.push(phrase);
  for (const frag of ALLOWED_CODE_FRAGMENTS) masks.push(frag);
  // Longest first, so a short allowed phrase cannot eat part of a long permitted sentence and
  // leave the rest of it exposed to a pattern.
  masks.sort((a, b) => b.length - a.length);
  for (const m of masks) {
    if (m.length === 0) continue;
    let at = out.indexOf(m);
    while (at !== -1) {
      out = out.slice(0, at) + '#'.repeat(m.length) + out.slice(at + m.length);
      at = out.indexOf(m, at + m.length);
    }
  }
  return out;
}

/**
 * Scan one text against the rules in one scope.
 *
 * @param {string} text
 * @param {string} rel Relative path, for the message.
 * @param {'shipped'|'src'|'query'} scope
 * @returns {{ruleId:string, line:number, match:string, why:string, designRef:string}[]}
 */
export function scanText(text, rel, scope) {
  const masked = maskPermitted(text);
  const hits = [];
  for (const rule of BANNED) {
    if (rule.scope !== scope) continue;
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m;
    while ((m = re.exec(masked)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      const line = masked.slice(0, m.index).split('\n').length;
      hits.push({
        ruleId: rule.id,
        line,
        match: m[0],
        why: rule.why,
        designRef: rule.designRef,
      });
    }
  }
  return hits;
}
