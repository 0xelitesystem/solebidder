// THE SOURCE AS OF DATE. DESIGN 7.3.
//
// The government publishes a date about its own data and this product fetches it live on every
// page load. It is never written into our HTML and it is never remembered between loads.
//
// WHY THAT IS STRONGER THAN A SNAPSHOT DATE. A snapshot carries OUR claim about OUR freshness.
// This carries the source's claim about itself, which is the thing a reader actually wants to
// know and the thing we have no ability to fake.
//
// AND IF THE CALL FAILS, NO DATE IS ASSERTED. The function returns null, every badge then reads
// that the as of date is unavailable, and the figures still render. A date we did not just
// receive is a date we do not put on the page, and a plausible looking stale one would be worse
// than none because a reader would trust it.
//
// Measured live on 2026-09-22: 29 bytes, HTTP 200, one round trip.
//
// Isomorphic: no node:* imports and no DOM.

import { lastUpdatedRequest, validateLastUpdated } from '../query/endpoints.js';

/**
 * What the notice says when the call did not come back. Worded for any surface, because the page
 * and the command line print the same sentence from this one constant.
 */
export const SOURCE_AS_OF_UNAVAILABLE = 'Source as of date unavailable. USAspending is asked for '
  + 'the date it publishes about its own data every time figures are fetched, and that request '
  + 'did not come back. The figures are still live from the same source; only the date the '
  + 'source states about itself is missing.';

/**
 * Fetch the date, or null.
 *
 * This NEVER returns a failure to the caller, on purpose. A missing as of date degrades one line
 * of every badge; it does not suppress a figure, and turning it into a hard failure would take
 * the whole page down over a sentence.
 *
 * @param {{request:Function}} client
 * @param {{signal?:AbortSignal}} [options]
 * @returns {Promise<{sourceAsOf:string|null, notice:string|null}>}
 */
export async function fetchSourceAsOf(client, options = {}) {
  const result = await client.request(lastUpdatedRequest(), validateLastUpdated, {
    what: 'the date USAspending publishes about its own data',
    signal: options.signal,
  });
  if (!result.ok) return { sourceAsOf: null, notice: SOURCE_AS_OF_UNAVAILABLE };
  const value = result.value.sourceAsOf;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { sourceAsOf: null, notice: SOURCE_AS_OF_UNAVAILABLE };
  }
  return { sourceAsOf: value, notice: null };
}
