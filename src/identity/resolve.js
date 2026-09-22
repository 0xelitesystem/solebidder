// IDENTITY RESOLUTION, END TO END. CONTRACT 1, DESIGN C9, traps 2, 4, 8 and 13.
//
// THE TWO NETWORK STEPS, AND WHY THEY ARE SEPARATE.
//
//   STEP ONE, resolveQuery. Text in, a LIST OF ENTITIES out. It never returns a figure, because
//   the endpoint it uses has no year parameter and its amount covers a window nobody named. Trap
//   4, measured: that endpoint reports 61,964,720,403.63 for the parent whose FY2025 total is
//   65,405,410,468.25. Both are real numbers about the same company and only one of them answers
//   the question this page asks. The validator does not project the amount at all, so the
//   chooser cannot show one and no later refactor can make it.
//
//   STEP TWO, hydrateIdentity. A CHOSEN entity in, a ResolvedIdentity out. This is where the
//   fiscal year enters, where the children are fetched for the SAME year as the parent, and
//   where the subject sentence that names what was summed is built.
//
// THE STEP BETWEEN THEM IS A HUMAN. That is the design, not an omission. Sixteen parent level
// records match "LOCKHEED MARTIN" with different UEIs, verified live on 2026-09-22. A tool that
// picks one is picking at random and putting a badge on the result.
//
// A FAILED CHILD FETCH IS A HARD FAILURE, NOT A DEGRADED IDENTITY. The alternative would be a
// ResolvedIdentity with an empty child list and an invented expectation, and everything
// downstream would then either suppress every figure anyway or, worse, publish a parent total
// beside a child list that is silently empty. The client has already retried this call four
// times with backoff before we get here.
//
// WHAT THIS MODULE NEVER DOES. It never edits the parent and child tree. Trap 8: at least one
// linkage in this dataset is known to be behind the world, and ../identity/stale-tree.js
// DISCLOSES that rather than correcting it.
//
// Isomorphic: no node:* imports and no DOM.

import { recipientListRequest, validateRecipientList, recipientProfileRequest, validateRecipientProfile } from '../query/endpoints.js';
import { resolveIdentity } from '../contracts/identity.js';
import { failure, MALFORMED_RESPONSE } from '../query/failure.js';
import { requireFiscalYear } from '../query/fiscal-year.js';
import { fetchChildren } from '../api/children.js';
import { toParentCandidates, decideIdentity, pickCandidate } from './candidates.js';
import { staleLinkageDisclosures } from './stale-tree.js';

/** How many list rows to ask for. One page. Deep pagination on this API is unusable, trap 6. */
const LIST_PAGE_SIZE = 50;

/**
 * STEP ONE. Text to a list of parent level entities, plus the decision about what happens next.
 *
 * @param {{request:Function}} client
 * @param {Object} args
 * @param {string} args.text What the visitor typed.
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold]
 * @returns {Promise<{ok:true, outcome:'no-records'|'only-candidate'|'choice-required',
 *   candidates:import('../contracts/identity.js').IdentityCandidate[],
 *   choice:import('../contracts/identity.js').IdentityChoice|null,
 *   refusal:import('../contracts/identity.js').IdentityRefusal|null,
 *   sentence:string, droppedChildLevel:number, droppedNoUei:number}
 *   |{ok:false, failure:import('../query/failure.js').Failure}>}
 */
export async function resolveQuery(client, args) {
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  if (text.length === 0) {
    throw new TypeError('resolveQuery: the search text is required and it is quoted back to the '
      + 'visitor in every outcome, including the refusal.');
  }
  const result = await client.request(
    recipientListRequest(text, LIST_PAGE_SIZE, 1),
    validateRecipientList,
    { what: 'the list of entities matching that name', signal: args.signal, onCold: args.onCold },
  );
  if (!result.ok) return { ok: false, failure: result.failure };

  const mapped = toParentCandidates(result.value);
  const decision = decideIdentity(text, mapped.candidates);
  return {
    ok: true,
    outcome: decision.outcome,
    candidates: decision.candidates,
    choice: decision.choice,
    refusal: decision.refusal,
    sentence: decision.sentence,
    droppedChildLevel: mapped.droppedChildLevel,
    droppedNoUei: mapped.droppedNoUei,
  };
}

/**
 * THE TYPEAHEAD TO PARENT UEI PATH. A suggestion the visitor clicked carries a UEI, so this
 * resolves the name and then picks the candidate whose UEI matches what they clicked.
 *
 * WHY A BUNDLED UEI IS NOT ENOUGH ON ITS OWN. Nothing in the bundle states a record's LEVEL, and
 * the profile endpoint is addressed by the internal recipient id rather than by UEI. Only the
 * list endpoint reports both, so the lookup happens either way. What the clicked UEI buys is the
 * thing that matters: the visitor has already said WHICH entity they meant, so a name that
 * matches sixteen parent records resolves to the one they pointed at instead of a guess, and the
 * choice is recorded as theirs.
 *
 * IF THE CLICKED UEI IS NOT AMONG THE PARENT RECORDS, THE LIST IS SHOWN. That happens when the
 * UEI belongs to a child level record, which is a real and ordinary case: the entity breakdown
 * that seeds the bundle is full of them. Silently substituting a different record would name a
 * subject the visitor never chose.
 *
 * @param {{request:Function}} client
 * @param {Object} args
 * @param {string} args.text The suggestion text, used as the search text.
 * @param {string} args.uei The UEI the visitor clicked.
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold]
 * @returns {Promise<object>} The same shape as resolveQuery, with the choice filled in when the
 *   clicked UEI is one of the parent records.
 */
export async function resolveChosenUei(client, args) {
  const resolved = await resolveQuery(client, args);
  if (!resolved.ok) return resolved;
  const match = resolved.candidates.find((c) => c.uei === args.uei);
  if (match === undefined) {
    return {
      ...resolved,
      clickedUeiFound: false,
      sentence: resolved.outcome === 'no-records' ? resolved.sentence
        : 'The entity you clicked is not one of the parent level records for that name in this '
          + 'dataset, which usually means it is registered under a parent rather than being one. '
          + 'The parent records that do match are listed so you can choose deliberately.',
    };
  }
  return {
    ...resolved,
    clickedUeiFound: true,
    outcome: /** @type {'only-candidate'} */ ('only-candidate'),
    choice: pickCandidate(resolved.candidates, args.uei, 'picked-a-chip'),
    sentence: 'You chose ' + match.name + ', UEI ' + match.uei + '. Every figure below is '
      + 'recorded against that UEI family for the fiscal year selected.',
  };
}

/**
 * STEP TWO. A chosen entity to a ResolvedIdentity, with the profile projection alongside so the
 * parent detail panel does not have to fetch the same document twice.
 *
 * @param {{request:Function}} client
 * @param {Object} args
 * @param {import('../contracts/identity.js').IdentityChoice} args.choice
 * @param {number} args.fiscalYear Explicit. Trap 2: the SAME year reaches the children call.
 * @param {import('../core/constants.js').AwardTypeSetId} args.awardTypeSetId
 * @param {string|null} args.sourceAsOf
 * @param {AbortSignal} [args.signal]
 * @param {Function} [args.onCold]
 * @returns {Promise<{ok:true, identity:import('../contracts/identity.js').ResolvedIdentity,
 *   profile:object, disclosures:object[], linkageNotice:string}
 *   |{ok:false, failure:import('../query/failure.js').Failure}>}
 */
export async function hydrateIdentity(client, args) {
  const choice = args.choice;
  if (!choice || typeof choice !== 'object' || !choice.candidate) {
    throw new TypeError('hydrateIdentity: a choice is required. The visitor picks the entity and '
      + 'the page says so; the tool never picks one for them.');
  }
  requireFiscalYear(args.fiscalYear, 'hydrateIdentity');
  const candidate = choice.candidate;

  const profileResult = await client.request(
    recipientProfileRequest(candidate.recipientId, args.fiscalYear),
    validateRecipientProfile,
    { what: 'the profile for the entity you chose', signal: args.signal, onCold: args.onCold },
  );
  if (!profileResult.ok) return { ok: false, failure: profileResult.failure };
  const profile = profileResult.value;

  // The chosen record and the fetched record must be the same entity. If they are not, the page
  // would name one company and total another, which is the failure this whole product exists to
  // prevent. It is refused rather than reconciled.
  if (profile.uei !== candidate.uei) {
    return {
      ok: false,
      failure: failure(MALFORMED_RESPONSE, 'the profile for the entity you chose', {
        detail: 'the profile endpoint answered for UEI ' + profile.uei + ' when the entity you '
          + 'chose is UEI ' + candidate.uei + '. Nothing is displayed, because a figure under '
          + 'the wrong name is worse than no figure.',
        attempts: profileResult.attempts,
      }),
    };
  }

  const childrenResult = await fetchChildren(client, {
    uei: candidate.uei,
    fiscalYear: args.fiscalYear,
    signal: args.signal,
    onCold: args.onCold,
  });
  if (!childrenResult.ok) return { ok: false, failure: childrenResult.failure };

  const identity = resolveIdentity({
    choice: {
      candidate: {
        ...candidate,
        // The profile is where the declared alternate names live, and they are how a visitor
        // recognises which of several similar records is the one they meant. Twenty seven of
        // them came back for this parent on 2026-09-22.
        alternateNames: profile.alternateNames,
      },
      how: choice.how,
    },
    children: childrenResult.children.map((c) => ({
      uei: c.uei,
      name: c.name,
      obligations: c.obligations,
    })),
    childrenExpected: childrenResult.expected,
    fiscalYear: args.fiscalYear,
    awardTypeSetId: args.awardTypeSetId,
    sourceAsOf: args.sourceAsOf === undefined ? null : args.sourceAsOf,
  });

  const stale = staleLinkageDisclosures(identity);
  return {
    ok: true,
    identity,
    profile,
    disclosures: stale.disclosures,
    linkageNotice: stale.notice,
  };
}
