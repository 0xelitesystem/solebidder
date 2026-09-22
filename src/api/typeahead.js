// THE TYPEAHEAD, BUNDLED FIRST AND LIVE SECOND. DESIGN 3.2 and 6.4.
//
// THE BUNDLE ANSWERS INSTANTLY AND CARRIES A UEI. That is the whole reason it exists. A bundled
// hit is a name AND the identifier that makes it resolvable, so clicking one goes straight to a
// parent record without a round trip.
//
// THE LIVE FALLBACK ANSWERS FOR EVERYTHING ELSE AND CARRIES ONLY A NAME. Measured live on
// 2026-09-22: POST /api/v2/autocomplete/recipient/ returned ten suggestions in 516 ms, and every
// one of them had a null identifier and a null level. So a live suggestion is TEXT. Choosing one
// still has to go through the list endpoint to find out which entity the text means, and that
// step is where a name that matches sixteen different parent records gets shown to the visitor
// instead of guessed at. This module marks the difference explicitly with needsResolution rather
// than letting a caller assume every suggestion is equally resolved.
//
// COVERAGE IS NEVER LIMITED BY THE BUNDLE. The recipient universe is more than eighteen million
// rows. Any bundled subset of it would silently misrepresent everyone outside the subset, so the
// bundle is a speed optimisation over the head of the distribution and the live call is the
// answer for the tail.
//
// THERE IS NO MONEY IN THIS FILE AND THERE IS NO PATH TO ANY. Neither source returns a figure
// this module reads. The bundle has no slot for one and the autocomplete projection has no
// amount field. A typeahead that showed dollars would be showing them for a window nobody named.
//
// Isomorphic: no node:* imports and no DOM.

import { recipientAutocompleteRequest, validateRecipientAutocomplete } from '../query/endpoints.js';
import { searchIndex, buildPrefixMap, assertStripped, MAX_SUGGESTIONS } from './typeahead-index.js';

/** Below this many characters nothing is suggested, bundled or live. */
export const MIN_QUERY_LENGTH = 2;

/**
 * @typedef {Object} Suggestion
 * @property {string} name
 * @property {string|null} uei Present for a bundled hit, null for a live one.
 * @property {boolean} needsResolution True when the suggestion is a name that still has to be
 *   resolved to a parent record before anything can be summed.
 * @property {'bundled'|'live'} source
 */

/**
 * Build a typeahead over an optional bundled index and a client for the live fallback.
 *
 * @param {Object} deps
 * @param {import('./typeahead-index.js').TypeaheadIndex} [deps.index] The bundled index. When it
 *   is absent every query goes live, which is the honest degraded behaviour: slower, never wrong.
 * @param {{request:Function}} [deps.client]
 * @returns {{suggest:Function, hasIndex:boolean, indexSize:number}}
 */
export function createTypeahead(deps = {}) {
  const index = deps.index === undefined ? null : assertStripped(deps.index, 'createTypeahead');
  const prefixMap = index === null ? null : buildPrefixMap(index);
  const client = deps.client;

  /**
   * @param {string} text
   * @param {{limit?:number, signal?:AbortSignal, forceLive?:boolean}} [options]
   * @returns {Promise<{ok:true, suggestions:Suggestion[], source:'bundled'|'live'|'none'}
   *   |{ok:false, failure:import('../query/failure.js').Failure}>}
   */
  async function suggest(text, options = {}) {
    const q = typeof text === 'string' ? text.trim() : '';
    const limit = options.limit === undefined ? MAX_SUGGESTIONS : options.limit;
    if (q.length < MIN_QUERY_LENGTH) {
      return { ok: true, suggestions: [], source: 'none' };
    }

    if (index !== null && !options.forceLive) {
      const hits = searchIndex(index, q, { limit, prefixMap });
      if (hits.length > 0) {
        return {
          ok: true,
          source: 'bundled',
          suggestions: hits.map((h) => Object.freeze({
            name: h.name,
            uei: h.uei,
            needsResolution: false,
            source: /** @type {'bundled'} */ ('bundled'),
          })),
        };
      }
    }

    if (!client) return { ok: true, suggestions: [], source: 'none' };

    const result = await client.request(
      recipientAutocompleteRequest(q, limit),
      validateRecipientAutocomplete,
      { what: 'name suggestions', signal: options.signal },
    );
    if (!result.ok) return { ok: false, failure: result.failure };

    const seen = new Set();
    /** @type {Suggestion[]} */
    const suggestions = [];
    for (const row of result.value.suggestions) {
      const name = typeof row.name === 'string' ? row.name.trim() : '';
      if (name.length === 0 || seen.has(name)) continue;
      seen.add(name);
      const uei = typeof row.uei === 'string' && /^[A-Z0-9]{12}$/.test(row.uei) ? row.uei : null;
      suggestions.push(Object.freeze({
        name,
        uei,
        // A live suggestion is text until the list endpoint says which entity it names. That is
        // true even when this endpoint does return an identifier, because the level it belongs
        // to is not stated and a child level record is not a subject this page can sum.
        needsResolution: true,
        source: /** @type {'live'} */ ('live'),
      }));
      if (suggestions.length >= limit) break;
    }
    return { ok: true, suggestions, source: 'live' };
  }

  return {
    suggest,
    hasIndex: index !== null,
    indexSize: index === null ? 0 : index.rows.length,
  };
}
