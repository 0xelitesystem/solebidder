// The panels. Each one takes a view model and returns DOM. None of them fetches, none of them
// computes a figure, and none of them writes a number that did not arrive as a Claim.
//
// EVERY PANEL ASKS `available` FIRST. The analysis layer returns a guarded result: a figure that
// could not honestly be computed is an ABSENT key with a `reason` sentence beside it, never a
// null under its own name and never a zero. So each panel here prints the reason instead of the
// figure, and there is no path where a missing number renders as nothing and reads as zero.
//
// THE PANEL THAT MATTERS MOST IS THE ONE THAT REFUSES. DESIGN C9: when a name resolves to more
// than one unlinked parent record, the tool shows the split records with their identifiers and
// declines to add them together. That is not an error state with an apology in it. It is the
// most trustworthy thing on the page and it gets a real panel.
//
// THE SECOND MOST IMPORTANT IS THE FAILURE STATE. DESIGN 6.6: a named failure saying WHICH panel
// is missing and why, with a retry offered only when retrying is honest. Never a spinner that
// implies progress it cannot see, and never an empty chart, which reads as a real zero.
//
// Isomorphic: no node:* imports, no global document.

import { neverClaimedById } from '../core/never-claimed.js';
import { failureMessage } from '../query/failure.js';
import { AWARD_TYPE_SETS, FISCAL_YEAR_FLOOR, COLD_SOURCE_NOTICE } from '../core/constants.js';
import { formatUnit, OBLIGATIONS } from '../core/units.js';
import { el, prose, clear, onActivate } from './dom.js';
import { figureNode, figureCell, neverClaimedNode } from './figure.js';
import { renderChart } from './charts.js';
import { competitionSentence, awardHref, RECEIPT_ROWS } from './view-model.js';

/* --------------------------------------------------------------------------------------------
 * Loading, unavailable, and failure. DESIGN 6.3 and 6.6.
 * ------------------------------------------------------------------------------------------ */

/**
 * A tile that is waiting. It says what it is waiting FOR, because a bare spinner reads as broken.
 * @param {Document} doc
 * @param {string} what
 * @returns {HTMLElement}
 */
export function skeletonPanel(doc, what) {
  return el(doc, 'div', { class: 'skeleton', role: 'status', 'aria-live': 'polite' }, [
    prose(doc, 'p', 'Loading ' + what + ' from USAspending. Nothing here is precomputed and '
      + 'nothing is cached, so this is a live request from your own browser to the government '
      + 'host.'),
  ]);
}

/**
 * The honest cold source line, after three seconds of quiet. DESIGN 6.3.
 * @param {Document} doc
 * @param {string} what
 * @returns {HTMLElement}
 */
export function coldPanel(doc, what) {
  const p = el(doc, 'p');
  p.textContent = COLD_SOURCE_NOTICE;
  return el(doc, 'div', { class: 'skeleton', role: 'status', 'aria-live': 'polite' }, [
    prose(doc, 'p', 'Still waiting for ' + what + '.'),
    p,
  ]);
}

/**
 * A figure the analysis layer declined to compute, with the reason it gave. This is not an error:
 * it is the product saying what it could not honestly say.
 * @param {Document} doc
 * @param {string} what
 * @param {string} reason
 * @returns {HTMLElement}
 */
export function unavailablePanel(doc, what, reason) {
  const p = el(doc, 'p');
  p.textContent = reason;
  return el(doc, 'div', { class: 'panel unavailable' }, [
    prose(doc, 'h3', 'No figure for ' + what),
    p,
    prose(doc, 'p', 'Nothing is drawn here rather than something incomplete. An empty chart reads '
      + 'as a measured zero, and this is not one.', { class: 'soft' }),
  ]);
}

/**
 * A named failure. DESIGN 6.6.
 * @param {Document} doc
 * @param {any} f A Failure from src/query/failure.js.
 * @param {() => void} [onRetry]
 * @returns {HTMLElement}
 */
export function failurePanel(doc, f, onRetry) {
  const message = el(doc, 'p', { class: 'failure-message' });
  message.textContent = failureMessage(f);
  const kids = [prose(doc, 'h3', 'This panel is missing'), message];
  if (f.retryable && onRetry) {
    kids.push(onActivate(prose(doc, 'button', 'Retry this request', { type: 'button' }), onRetry));
  } else if (!f.retryable) {
    kids.push(prose(doc, 'p', 'Retrying will not change this, so no retry is offered.',
      { class: 'soft' }));
  }
  return el(doc, 'div', { class: 'panel failure', role: 'alert' }, kids);
}

/**
 * A narrative built of prose segments and Claim segments, from buildNarrative() in
 * src/api/reconcile.js. Prose stays prose and every figure keeps its badge.
 * @param {Document} doc
 * @param {{kind:string, text?:string, label?:string, claim?:any}[]} segments
 * @returns {HTMLElement}
 */
export function narrativeNode(doc, segments) {
  const kids = segments.map((seg) => {
    if (seg.kind === 'claim') {
      return figureNode(doc, seg.claim, { label: seg.label, provenance: true });
    }
    const span = el(doc, 'span', { class: 'narrative-text' });
    span.textContent = seg.text;
    return span;
  });
  return el(doc, 'div', { class: 'narrative' }, kids);
}

/* --------------------------------------------------------------------------------------------
 * The controls. One period in application state, and an award type set that is never a hidden
 * default. DESIGN C6 and trap 2.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Document} doc
 * @param {Object} args
 * @param {number} args.fiscalYear
 * @param {number} args.latestFiscalYear
 * @param {string} args.awardTypeSetId
 * @param {(fy:number) => void} args.onFiscalYear
 * @param {(setId:string) => void} args.onAwardTypeSet
 * @returns {HTMLElement}
 */
export function controlsPanel(doc, args) {
  const yearSelect = el(doc, 'select', { id: 'fiscal-year', name: 'fiscal-year' });
  for (let y = args.latestFiscalYear; y >= FISCAL_YEAR_FLOOR; y -= 1) {
    const option = el(doc, 'option', { value: String(y), selected: y === args.fiscalYear });
    option.textContent = 'FY' + y;
    yearSelect.appendChild(option);
  }
  yearSelect.addEventListener('change', (ev) => {
    const raw = ev && ev.target ? ev.target.value : String(args.fiscalYear);
    args.onFiscalYear(Number.parseInt(raw, 10));
  });

  const setFieldset = el(doc, 'fieldset', { class: 'award-set' }, [
    prose(doc, 'legend', 'Award type set'),
  ]);
  for (const set of Object.values(AWARD_TYPE_SETS)) {
    const input = el(doc, 'input', {
      type: 'radio',
      name: 'award-type-set',
      id: 'set-' + set.id,
      value: set.id,
      checked: set.id === args.awardTypeSetId,
    });
    input.addEventListener('change', () => args.onAwardTypeSet(set.id));
    setFieldset.appendChild(el(doc, 'span', { class: 'radio' }, [
      input,
      prose(doc, 'label', set.label, { for: 'set-' + set.id }),
    ]));
  }
  setFieldset.appendChild(prose(doc, 'p',
    'All three sets are defensible and they give different totals, which is exactly why this '
    + 'control is visible and the set you chose is named on every badge on the page. It is never '
    + 'a hidden default.', { class: 'soft' }));

  return el(doc, 'div', { class: 'panel controls' }, [
    el(doc, 'div', { class: 'control' }, [
      prose(doc, 'label', 'Fiscal year', { for: 'fiscal-year' }),
      yearSelect,
      prose(doc, 'p', 'One fiscal year, applied to every request on the page at once. A parent '
        + 'measured over one window against its children measured over another produced a figure '
        + 'more than thirteen times too large, so there is one period and it is explicit.',
      { class: 'soft' }),
    ]),
    setFieldset,
  ]);
}

/* --------------------------------------------------------------------------------------------
 * The entity chooser. A candidate carries NO money figure, ever: the endpoint that produces
 * candidates has no year parameter and its amount covers a window nobody named.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Document} doc
 * @param {Object} args
 * @param {{recipientId:string, uei:string, name:string}[]} args.candidates
 * @param {(candidate:any) => void} args.onChoose
 * @param {string} [args.sentence]
 * @returns {HTMLElement}
 */
export function chooserPanel(doc, args) {
  const list = el(doc, 'ul', { class: 'candidates' });
  for (const c of args.candidates) {
    const name = el(doc, 'span', { class: 'cand-name' });
    name.textContent = c.name;
    const uei = el(doc, 'span', { class: 'cand-uei mono' });
    uei.textContent = c.uei;
    const button = el(doc, 'button', { type: 'button', class: 'cand-pick' }, [
      name,
      uei,
      prose(doc, 'span', 'parent record', { class: 'cand-level soft' }),
    ]);
    onActivate(button, () => args.onChoose(c));
    list.appendChild(el(doc, 'li', {}, [button]));
  }

  const kids = [
    prose(doc, 'h3', 'Choose the entity to sum'),
    prose(doc, 'p', 'More than one parent level record can match a well known name, each with a '
      + 'different identifier and a different total. This tool will not choose for you. Pick the '
      + 'entity you mean and the page will then tell you which one it summed and how many '
      + 'registered children rolled into it.'),
    prose(doc, 'p', 'No dollar figure appears in this list on purpose. The endpoint that produces '
      + 'these records has no fiscal year parameter and its amount covers a window nobody named, '
      + 'so choosing here is a choice between entities rather than between numbers.',
    { class: 'soft' }),
    list,
  ];
  if (args.sentence) {
    const s = el(doc, 'p', { class: 'soft' });
    s.textContent = args.sentence;
    kids.splice(1, 0, s);
  }
  return el(doc, 'div', { class: 'panel chooser' }, kids);
}

/**
 * Name suggestions under the search field.
 *
 * A SUGGESTION IS A NAME, NOT AN ANSWER. Clicking one runs the same resolution the typed name
 * would run, because a suggestion from the live endpoint does not say which level of record it
 * names and a child level record is not a subject this page can sum. No suggestion carries a
 * dollar figure: the bundled index has its amounts stripped at build time precisely so that no
 * number in it could ever reach a reader and have to be defended as current.
 *
 * @param {Document} doc
 * @param {Object} args
 * @param {{name:string, uei:string|null, source:string}[]} args.suggestions
 * @param {(name:string) => void} args.onPick
 * @param {string} [args.source]
 * @returns {HTMLElement|null}
 */
export function suggestionsPanel(doc, args) {
  if (!args.suggestions || args.suggestions.length === 0) return null;
  const list = el(doc, 'ul', { class: 'suggestions' });
  for (const s of args.suggestions) {
    const name = el(doc, 'span', { class: 'sugg-name' });
    name.textContent = s.name;
    const button = el(doc, 'button', { type: 'button', class: 'ghost' }, [name]);
    // The WHOLE suggestion, not just its text. A bundled hit carries a verified identifier and
    // a live one does not, and the caller resolves the two differently: the first goes
    // straight to that parent record, the second has to ask which entity the name means.
    onActivate(button, () => args.onPick(s.name, s));
    list.appendChild(el(doc, 'li', {}, [button]));
  }
  return el(doc, 'div', {
    class: 'panel suggestions-panel',
    role: 'group',
    'aria-label': 'Name suggestions',
  }, [
    prose(doc, 'p', args.source === 'live'
      ? 'Suggestions from the government name index, fetched live. Choosing one runs the same '
        + 'resolution that typing the name runs, because a suggestion is a name rather than a '
        + 'decision about which entity you meant.'
      : 'Suggestions from the bundled name index. It holds names and identifiers only: the '
        + 'amounts are stripped when it is built, so there is no figure in it to go stale.',
    { class: 'soft' }),
    list,
  ]);
}

/**
 * The refusal. DESIGN C9. Its own panel, because it is a capability rather than an error.
 * @param {Document} doc
 * @param {any} refusal From refuseIdentity().
 * @param {(candidate:any) => void} [onChooseAnyway]
 * @returns {HTMLElement}
 */
export function refusalPanel(doc, refusal, onChooseAnyway) {
  const sentence = el(doc, 'p', { class: 'refusal-sentence' });
  sentence.textContent = refusal.sentence;

  const rows = refusal.splitRecords.map((r) => {
    const name = el(doc, 'td');
    name.textContent = r.name;
    const uei = el(doc, 'td', { class: 'mono' });
    uei.textContent = r.uei;
    const pick = el(doc, 'td');
    if (onChooseAnyway) {
      pick.appendChild(onActivate(
        prose(doc, 'button', 'Sum this one only', { type: 'button', class: 'ghost' }),
        () => onChooseAnyway(r),
      ));
    }
    return el(doc, 'tr', {}, [name, uei, pick]);
  });

  return el(doc, 'div', { class: 'panel refusal' }, [
    prose(doc, 'h3', 'No single parent record exists for this name'),
    sentence,
    el(doc, 'div', { class: 'tablewrap' }, [
      el(doc, 'table', {}, [
        el(doc, 'thead', {}, [el(doc, 'tr', {}, [
          prose(doc, 'th', 'Parent record', { scope: 'col' }),
          prose(doc, 'th', 'Unique entity identifier', { scope: 'col' }),
          prose(doc, 'th', 'Choose', { scope: 'col' }),
        ])]),
        el(doc, 'tbody', {}, rows),
      ]),
    ]),
    neverClaimedNode(doc, neverClaimedById('not-everything-a-company-gets')),
  ]);
}

/**
 * What was summed. DESIGN 5: the name, the identifier, the child count, and the statement that
 * parent linkage is self declared in registration rather than consolidation.
 *
 * @param {Document} doc
 * @param {Object} args
 * @param {any} args.identity
 * @param {any} args.detail From parentDetailClaims().
 * @param {{disclosures:any[], notice:string}} [args.linkage] From staleLinkageDisclosures().
 * @returns {HTMLElement}
 */
export function subjectPanel(doc, args) {
  const { identity, detail } = args;
  const sentence = el(doc, 'p', { class: 'subject-sentence' });
  sentence.textContent = identity.subjectSentence;

  const kids = [prose(doc, 'h3', 'What this page is about to sum'), sentence];

  if (detail && detail.noFederalAwards && detail.sentence) {
    const s = el(doc, 'p', { class: 'warn' });
    s.textContent = detail.sentence;
    kids.push(s);
  }

  // Each figure is rendered only if it is actually there. A panel that throws on an absent claim
  // takes the whole page down over one missing field, and the rule everywhere here is that a
  // figure which could not be built is absent with a reason rather than present as a zero.
  const figure = (claim, label, provenance) => (claim
    ? figureNode(doc, claim, { label, provenance })
    : null);
  kids.push(el(doc, 'p', { class: 'subject-figures' }, detail === null || detail === undefined ? [] : [
    figure(detail.totalClaim, 'Recorded against this parent identifier family', true),
    figure(detail.awardCountClaim, 'Awards in the selected set', false),
    figure(detail.transactionsClaim, 'Transaction records', false),
    figure(detail.alternateNamesClaim, 'Names the registrant declared', false),
  ]));

  if (args.linkage && args.linkage.disclosures.length > 0) {
    for (const d of args.linkage.disclosures) {
      const p = el(doc, 'p', { class: 'warn' });
      p.textContent = d.sentence === undefined ? d.note : d.sentence;
      kids.push(p);
    }
  }

  kids.push(neverClaimedNode(doc, neverClaimedById('obligations-are-not-revenue')));
  kids.push(neverClaimedNode(doc, neverClaimedById('parent-tree-self-reported')));

  if (!identity.rollupComplete) {
    kids.push(prose(doc, 'p', 'Part of the child list did not arrive, so the summed total is '
      + 'suppressed on this page rather than shown short. A rollup missing some of its parts is '
      + 'smaller than the truth and a reader would quote it.', { class: 'warn' }));
  }
  return el(doc, 'div', { class: 'panel subject' }, kids);
}

/* --------------------------------------------------------------------------------------------
 * C1. The hero and the ten second reveal. DESIGN 5.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Document} doc
 * @param {Object} args
 * @param {any} args.soleBidder The soleBidderShare result.
 * @param {any} args.oneOffer The oneOfferShare result.
 * @param {any[]} args.awards The competitionRows result.
 * @param {any} args.excludedRowCountClaim
 * @param {any} args.detailCountClaim
 * @param {any} [args.chart] The ChartInput, absent when the share is unavailable.
 * @param {{lead:string, tail:string}} args.reveal
 * @returns {HTMLElement}
 */
export function heroPanel(doc, args) {
  const { soleBidder } = args;
  const kids = [];

  if (soleBidder.available === true) {
    kids.push(el(doc, 'p', { class: 'reveal' }, [
      prose(doc, 'span', args.reveal.lead + ' ', { class: 'reveal-lead' }),
      figureNode(doc, soleBidder.soleBidderShareClaim, { large: true }),
      prose(doc, 'span', ' ' + args.reveal.tail, { class: 'reveal-tail' }),
    ]));
    kids.push(el(doc, 'p', { class: 'soft' }, [
      figureNode(doc, soleBidder.soleBidderShareClaim, {
        provenance: true,
        label: 'The same figure with its numerator and its denominator',
      }),
    ]));
    if (soleBidder.isFloor) {
      kids.push(prose(doc, 'p', 'Some contracts in this set carry no competition field at all. '
        + 'Their value stays in the denominator and can never enter the numerator, so the share '
        + 'above is a floor for this set rather than the whole of it.', { class: 'warn' }));
    }
    kids.push(el(doc, 'p', { class: 'split-figures' }, [
      figureNode(doc, soleBidder.notCompetedValueClaim, {
        label: 'Lifetime award value the record marks as not competed',
      }),
      figureNode(doc, soleBidder.totalValueClaim, {
        label: 'Lifetime award value across the whole set',
      }),
    ]));
    if (args.chart) kids.push(renderChart(doc, args.chart, { idBase: 'hero' }));
  } else {
    kids.push(unavailablePanel(doc, 'the competition split', soleBidder.reason));
  }

  kids.push(el(doc, 'p', { class: 'tallies' }, [
    figureNode(doc, soleBidder.awardCountClaim, { label: 'Contracts in the denominator' }),
    figureNode(doc, soleBidder.notCompetedCountClaim, { label: 'Marked not competed' }),
    figureNode(doc, soleBidder.noCompetitionFieldCountClaim, { label: 'No competition field' }),
    figureNode(doc, soleBidder.negativeRowCountClaim, { label: 'Negative lifetime value' }),
    args.detailCountClaim
      ? figureNode(doc, args.detailCountClaim, { label: 'Competition records that arrived' })
      : null,
    args.excludedRowCountClaim
      ? figureNode(doc, args.excludedRowCountClaim, { label: 'Rows dropped as outside the entity set' })
      : null,
  ]));

  if (args.oneOffer && args.oneOffer.available === true) {
    kids.push(el(doc, 'p', { class: 'cross-check' }, [
      prose(doc, 'span', 'An independent cross check, counting records rather than dollars: ',
        { class: 'soft' }),
      figureNode(doc, args.oneOffer.oneOfferShareClaim, { provenance: true }),
    ]));
  } else if (args.oneOffer) {
    const r = el(doc, 'p', { class: 'soft' });
    r.textContent = args.oneOffer.reason;
    kids.push(r);
  }

  kids.push(receiptsTable(doc, args.awards));
  kids.push(neverClaimedNode(doc, neverClaimedById('award-value-is-lifetime')));
  kids.push(neverClaimedNode(doc, neverClaimedById('no-losing-bidders')));
  return el(doc, 'div', { class: 'panel hero' }, kids);
}

/**
 * The receipt rows. Each one links straight into the government's own record for that contract.
 * @param {Document} doc
 * @param {any[]} awards From competitionRows().
 * @param {number} [limit]
 * @returns {HTMLElement}
 */
export function receiptsTable(doc, awards, limit = RECEIPT_ROWS) {
  const ranked = [...awards]
    .sort((a, b) => b.awardValueClaim.value - a.awardValueClaim.value)
    .slice(0, Math.max(limit, RECEIPT_ROWS));

  const rows = ranked.map((r) => {
    const link = el(doc, 'a', {
      href: awardHref(r.generatedInternalId === undefined ? r.awardId : r.generatedInternalId),
      rel: 'noopener noreferrer',
      class: 'mono',
    });
    link.textContent = r.awardId;
    const competition = el(doc, 'td');
    competition.textContent = competitionSentence(r);
    const offers = el(doc, 'td');
    if (r.offersReceivedClaim) offers.appendChild(figureNode(doc, r.offersReceivedClaim));
    else offers.textContent = 'not recorded';
    return el(doc, 'tr', {}, [
      el(doc, 'td', {}, [link]),
      figureCell(doc, r.awardValueClaim),
      offers,
      competition,
    ]);
  });

  return el(doc, 'div', { class: 'tablewrap' }, [
    el(doc, 'table', { class: 'receipts' }, [
      prose(doc, 'caption', 'The largest contracts in the denominator by lifetime award value, '
        + 'each one linking to the government record it came from.'),
      el(doc, 'thead', {}, [el(doc, 'tr', {}, [
        prose(doc, 'th', 'Award identifier', { scope: 'col' }),
        prose(doc, 'th', 'Lifetime award value, options included', { scope: 'col', class: 'num' }),
        prose(doc, 'th', 'Offers received, as reported', { scope: 'col' }),
        prose(doc, 'th', 'What the competition field says', { scope: 'col' }),
      ])]),
      el(doc, 'tbody', {}, rows),
    ]),
  ]);
}

/* --------------------------------------------------------------------------------------------
 * C2. The customer mix and the concentration profile.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Document} doc
 * @param {Object} args
 * @param {any} args.agency The topRowShare result.
 * @param {any} args.herfindahl The herfindahlIndex result.
 * @param {any} [args.chart]
 * @param {string} [args.dimensionNoun]
 * @returns {HTMLElement}
 */
export function customerMixPanel(doc, args) {
  const { agency, herfindahl } = args;
  const noun = args.dimensionNoun === undefined ? 'department' : args.dimensionNoun;
  // The sentence is per dimension, because the verb is per dimension. Money COMES FROM a buyer
  // and it is RECORDED AGAINST a classification, and running every panel through the buyer
  // wording would have three of the four describing something they did not measure.
  const tail = args.tailText === undefined
    ? ' of the dollars obligated to this entity in the fiscal year selected came from one '
      + noun + '.'
    : args.tailText;
  const topLabel = args.topLabel === undefined ? 'That one buyer is ' : args.topLabel;
  const kids = [];

  if (agency.available === true) {
    kids.push(el(doc, 'p', { class: 'reveal reveal-second' }, [
      figureNode(doc, agency.topShareClaim, { large: true }),
      prose(doc, 'span', tail, { class: 'reveal-tail' }),
    ]));
    const who = el(doc, 'p', { class: 'soft' });
    who.textContent = topLabel + agency.topName + '.';
    kids.push(who);
    kids.push(el(doc, 'p', {}, [figureNode(doc, agency.topShareClaim, { provenance: true })]));
    kids.push(el(doc, 'p', { class: 'tallies' }, [
      figureNode(doc, agency.topAmountClaim, { label: 'Recorded to that one buyer' }),
      figureNode(doc, agency.totalClaim, { label: 'Across every row returned' }),
      figureNode(doc, agency.rowCountClaim, { label: 'Rows returned' }),
      figureNode(doc, agency.negativeRowCountClaim, { label: 'Rows carrying a negative amount' }),
    ]));
  } else {
    kids.push(unavailablePanel(doc, 'the single customer share', agency.reason));
  }

  if (args.chart) kids.push(renderChart(doc, args.chart, { idBase: 'mix' }));

  if (herfindahl && herfindahl.available === true) {
    kids.push(el(doc, 'p', { class: 'hhi' }, [
      figureNode(doc, herfindahl.indexClaim, {
        provenance: true,
        label: 'Herfindahl index across every buyer row returned, the sum of the squares of the shares',
      }),
    ]));
  } else if (herfindahl) {
    const r = el(doc, 'p', { class: 'soft' });
    r.textContent = herfindahl.reason;
    kids.push(r);
  }

  kids.push(neverClaimedNode(doc, neverClaimedById('classified-gap-unmeasurable')));
  return el(doc, 'div', { class: 'panel mix' }, kids);
}

/**
 * THE OPENING FRAME, DESIGN 5 second zero.
 *
 * WHY THERE IS A PANEL HERE AT ALL. The page used to teach nothing until a visitor had typed
 * something. Its sibling flagship states a physics floor before any click, and this product had
 * no equivalent: the strongest true sentence it owns was three interactions away.
 *
 * THE FIGURE IS NOT WRITTEN HERE AND IT IS NOT BUNDLED. There is no number in this file and
 * none in index.html. The example is fetched live from the same host, through the same client,
 * with the same validator and the same arithmetic as every other share on the page, and it
 * arrives as a Claim carrying its endpoint, its method, its fiscal year and the date the source
 * publishes about itself. A reader can recompute it from the provenance line under it.
 *
 * IT IS THE NAME MATCH DEFINITION AND IT SAYS SO. Filtering by recorded name needs no resolved
 * parent identifier, which is what lets the opening frame cost exactly one request instead of a
 * resolution step and a profile fetch. It is a DIFFERENT definition of the company from the
 * parent rollup the rest of the page uses, so the panel states that in words rather than
 * letting a reader assume the two are the same question.
 *
 * @param {Document} doc
 * @param {Object} args
 * @param {string} args.name The example company, a NAME and nothing else.
 * @param {boolean} [args.pending] Render the waiting state.
 * @param {any} [args.agency] A topRowShare() result once it has arrived.
 * @param {any} [args.failure] A named Failure when the one request did not answer.
 * @param {() => void} [args.onSearch] Run the full record for the example company.
 * @returns {HTMLElement}
 */
export function hookPanel(doc, args) {
  const kids = [];
  const label = args.pending
    ? 'Worked example, being fetched live right now'
    : 'Worked example, fetched live as this page loaded';
  kids.push(prose(doc, 'p', label, { class: 'hook-label' }));

  if (args.pending) {
    kids.push(prose(doc, 'p', 'Asking USAspending how the federal contract dollars recorded '
      + 'against one well known prime contractor were split between the departments that bought '
      + 'from it. One live request from your own browser to the government host, and a cold one '
      + 'on this endpoint has been measured in tens of seconds.'));
    return el(doc, 'div', {}, kids);
  }

  if (args.failure) {
    kids.push(failurePanel(doc, args.failure));
    kids.push(prose(doc, 'p', 'The opening example needs the government host and did not get an '
      + 'answer. Nothing else on this page depends on it: search a name below and every figure '
      + 'is fetched the same way.', { class: 'fine soft' }));
    return el(doc, 'div', {}, kids);
  }

  const agency = args.agency;
  if (!agency || agency.available !== true) {
    kids.push(unavailablePanel(doc, 'the opening example',
      agency && agency.reason ? agency.reason : 'The example could not be computed honestly.'));
    return el(doc, 'div', {}, kids);
  }

  // A company NAME is not prose and it is not a figure, so it is written as text content the
  // way every other entity name in this product is written.
  const subject = el(doc, 'span', { class: 'hook-subject' });
  subject.textContent = args.name;
  const buyer = el(doc, 'span', { class: 'hook-subject' });
  buyer.textContent = agency.topName;

  kids.push(el(doc, 'p', { class: 'hook-line' }, [
    prose(doc, 'span', 'Of the federal contract dollars recorded against the name '),
    subject,
    prose(doc, 'span', ' in FY' + agency.topShareClaim.fiscalYear + ', '),
    figureNode(doc, agency.topShareClaim, { large: true }),
    prose(doc, 'span', ' came from a single department.'),
  ]));

  const who = el(doc, 'p', { class: 'soft' }, [
    prose(doc, 'span', 'That one buyer is '),
    buyer,
    prose(doc, 'span', '.'),
  ]);
  kids.push(who);

  return el(doc, 'div', {}, kids);
}

/**
 * THE SECOND HALF OF THE HOOK: how that figure was obtained, and what it is not.
 *
 * SPLIT FROM THE HEADLINE ON PURPOSE, and the reason is measured rather than aesthetic. With the
 * provenance line, the definition caveat, the button and the NEVER CLAIMED sentence all sitting
 * under the headline, the search field landed at 1025 px on a 900 px tall window: the one
 * control the page exists for was below the fold on a laptop. The headline goes above the search
 * and everything that supports it goes below, so nothing is hidden, nothing is behind a
 * disclosure, and the reader who wants to check the arithmetic scrolls a few centimetres to a
 * block that is still on the page.
 *
 * @param {Document} doc
 * @param {Object} args
 * @param {string} args.name
 * @param {any} [args.agency] A topRowShare() result. Renders nothing without one.
 * @param {() => void} [args.onSearch]
 * @returns {HTMLElement|null}
 */
export function hookMethodPanel(doc, args) {
  const agency = args.agency;
  if (!agency || agency.available !== true) return null;

  const kids = [];
  kids.push(el(doc, 'p', {}, [
    figureNode(doc, agency.topShareClaim, {
      provenance: true,
      label: 'The opening figure, with its numerator and its denominator',
    }),
  ]));

  kids.push(prose(doc, 'p', 'That example filters by the recorded NAME rather than by a resolved '
    + 'parent identifier, so it is the name match definition of the company. Searching a name '
    + 'above resolves it to a parent entity instead, and the page then shows you both definitions '
    + 'side by side rather than merging them into one answer.', { class: 'fine soft' }));

  if (args.onSearch) {
    const go = el(doc, 'button', { type: 'button', class: 'ghost' });
    go.textContent = 'Open the whole record for ' + args.name;
    onActivate(go, args.onSearch);
    kids.push(go);
  }

  kids.push(neverClaimedNode(doc, neverClaimedById('not-everything-a-company-gets')));
  return el(doc, 'div', {}, kids);
}

/* --------------------------------------------------------------------------------------------
 * C3 and the concentration curve.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Document} doc
 * @param {Object} args
 * @param {any} args.spine
 * @param {any} [args.chart]
 * @returns {HTMLElement}
 */
export function spinePanel(doc, args) {
  const kids = [];
  if (args.spine.available === true && args.chart) {
    kids.push(renderChart(doc, args.chart, { idBase: 'spine' }));
  } else {
    kids.push(unavailablePanel(doc, 'obligations by fiscal year', args.spine.reason));
  }
  kids.push(neverClaimedNode(doc, neverClaimedById('not-outlays')));
  kids.push(neverClaimedNode(doc, neverClaimedById('floor-2008')));
  return el(doc, 'div', { class: 'panel spine' }, kids);
}

/**
 * @param {Document} doc
 * @param {Object} args
 * @param {any} args.cumulative
 * @param {any} [args.curveChart]
 * @param {any} [args.awardsChart]
 * @param {any} [args.topAward]
 * @returns {HTMLElement}
 */
export function concentrationPanel(doc, args) {
  const kids = [];
  if (args.cumulative.available === true && args.curveChart) {
    kids.push(renderChart(doc, args.curveChart, { idBase: 'curve' }));
  } else {
    kids.push(unavailablePanel(doc, 'the concentration curve', args.cumulative.reason));
  }
  if (args.topAward && args.topAward.available === true) {
    kids.push(el(doc, 'p', {}, [figureNode(doc, args.topAward.topShareClaim, {
      provenance: true,
      label: 'The single largest contract as a share of the same set',
    })]));
  }
  if (args.awardsChart) {
    kids.push(prose(doc, 'p', 'The chart below is the same set of contracts measured in dollars '
      + 'rather than in shares. It is drawn on the hatched neutral ramp because lifetime award '
      + 'value is a different quantity from the fiscal year obligations above, and the hatch is '
      + 'what keeps the two apart in greyscale and in high contrast mode.', { class: 'soft' }));
    kids.push(renderChart(doc, args.awardsChart, { idBase: 'largest-awards' }));
  }
  kids.push(neverClaimedNode(doc, neverClaimedById('subawards-excluded')));
  return el(doc, 'div', { class: 'panel concentration' }, kids);
}

/* --------------------------------------------------------------------------------------------
 * C4. The rollup, performed in front of the reader.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Document} doc
 * @param {Object} args
 * @param {any} args.reconciliation From reconcileRollup().
 * @param {any} args.identity
 * @param {() => void} [args.onRetry]
 * @returns {HTMLElement}
 */
export function rollupPanel(doc, args) {
  const { reconciliation, identity } = args;
  if (!reconciliation.ok) {
    return failurePanel(doc, reconciliation.failure, args.onRetry);
  }

  const kids = [
    prose(doc, 'h3', 'What was summed, and the arithmetic'),
    narrativeNode(doc, reconciliation.narrative),
  ];

  const armRows = reconciliation.arms.map((arm) => {
    const label = el(doc, 'td');
    label.textContent = arm.label;
    const note = el(doc, 'td', { class: 'soft' });
    note.textContent = arm.note === null ? 'Comparable with the arm above it.' : arm.note;
    return el(doc, 'tr', {}, [label, figureCell(doc, arm.claim), note]);
  });
  kids.push(el(doc, 'div', { class: 'tablewrap' }, [
    el(doc, 'table', {}, [
      prose(doc, 'caption', 'The same quantity measured more than one way, and the difference '
        + 'between them published rather than rounded away.'),
      el(doc, 'thead', {}, [el(doc, 'tr', {}, [
        prose(doc, 'th', 'How it was measured', { scope: 'col' }),
        prose(doc, 'th', 'Dollars obligated in that fiscal year', { scope: 'col', class: 'num' }),
        prose(doc, 'th', 'What it is comparable with', { scope: 'col' }),
      ])]),
      el(doc, 'tbody', {}, armRows),
    ]),
  ]));

  const childRows = identity.children.map((c) => {
    const name = el(doc, 'td');
    name.textContent = c.name;
    const uei = el(doc, 'td', { class: 'mono' });
    uei.textContent = c.uei;
    const amount = el(doc, 'td', { class: 'num' });
    amount.textContent = formatChildAmount(c);
    return el(doc, 'tr', {}, [name, uei, amount]);
  });
  // A SCROLL PANE, NOT A TRUNCATION. One well known parent carries two hundred and seventeen
  // registered children, and rendering every one of them at full height put nearly fourteen
  // thousand pixels of one table on a page whose whole result state was twenty seven thousand.
  // Every row is still in the document, still in the accessibility tree, still selectable and
  // still copyable: what changed is that the pane has a height and scrolls. The container is
  // focusable and named, because a scrollable region with no focusable content inside it is
  // unreachable by keyboard otherwise, which would trade a layout problem for an access one.
  kids.push(el(doc, 'div', {
    class: 'tablewrap tablewrap-tall',
    tabindex: '0',
    role: 'region',
    'aria-label': 'Every registered child entity that rolled into the sum, scrollable',
  }, [
    el(doc, 'table', {}, [
      prose(doc, 'caption', 'Every registered child entity that rolled into the sum above, for '
        + 'the same explicit fiscal year as the parent. This pane scrolls: every row is present '
        + 'and none is dropped.'),
      el(doc, 'thead', {}, [el(doc, 'tr', {}, [
        prose(doc, 'th', 'Registered child entity', { scope: 'col' }),
        prose(doc, 'th', 'Unique entity identifier', { scope: 'col' }),
        prose(doc, 'th', 'Dollars obligated in that fiscal year', { scope: 'col', class: 'num' }),
      ])]),
      el(doc, 'tbody', {}, childRows),
    ]),
  ]));
  kids.push(neverClaimedNode(doc, neverClaimedById('parent-tree-self-reported')));
  return el(doc, 'div', { class: 'panel rollup' }, kids);
}

/**
 * A child amount, through the one currency path. The child rows are the components of a sum
 * whose total is badged above them, and each component carries the same unit as that total.
 * @param {{obligations:number}} child
 * @returns {string}
 */
function formatChildAmount(child) {
  return formatUnit(child.obligations, OBLIGATIONS);
}

/* --------------------------------------------------------------------------------------------
 * C5. Two definitions of the company, side by side, never merged and never a range.
 * ------------------------------------------------------------------------------------------ */

/**
 * @param {Document} doc
 * @param {any} view From methodDelta().
 * @returns {HTMLElement}
 */
export function secondDefinitionPanel(doc, view) {
  if (view.available !== true) {
    return unavailablePanel(doc, 'the second definition of the company', view.reason);
  }
  const rows = view.gapEntities.map((e) => {
    const name = el(doc, 'td');
    name.textContent = e.name;
    const uei = el(doc, 'td', { class: 'mono' });
    uei.textContent = e.uei === null ? '' : e.uei;
    return el(doc, 'tr', {}, [name, uei, figureCell(doc, e.amountClaim)]);
  });

  return el(doc, 'div', { class: 'panel second-definition' }, [
    prose(doc, 'h3', 'Two definitions of the company, named separately'),
    prose(doc, 'p', 'These are not two estimates of one truth. They are two different definitions '
      + 'of what the company means in this dataset, so they are shown side by side and the '
      + 'entities in the gap are listed. Presenting them as a range would imply the truth lies '
      + 'between them, and it does not.'),
    el(doc, 'p', {}, [figureNode(doc, view.parentRollupTotalClaim, {
      provenance: true, label: 'Definition one, the parent identifier rollup',
    })]),
    el(doc, 'p', {}, [figureNode(doc, view.nameMatchTotalClaim, {
      provenance: true, label: 'Definition two, everything matching the name searched',
    })]),
    el(doc, 'p', {}, [figureNode(doc, view.deltaClaim, {
      provenance: true, label: 'The gap between the two definitions',
    })]),
    el(doc, 'p', {}, [figureNode(doc, view.gapEntityCountClaim, { label: 'Entities in that gap' })]),
    rows.length === 0 ? null : el(doc, 'div', { class: 'tablewrap' }, [
      el(doc, 'table', {}, [
        prose(doc, 'caption', 'The entities that match the name searched but are not registered '
          + 'under the parent identifier chosen.'),
        el(doc, 'thead', {}, [el(doc, 'tr', {}, [
          prose(doc, 'th', 'Entity', { scope: 'col' }),
          prose(doc, 'th', 'Unique entity identifier', { scope: 'col' }),
          prose(doc, 'th', 'Dollars obligated in that fiscal year', { scope: 'col', class: 'num' }),
        ])]),
        el(doc, 'tbody', {}, rows),
      ]),
    ]),
    neverClaimedNode(doc, neverClaimedById('not-everything-a-company-gets')),
  ]);
}

/* --------------------------------------------------------------------------------------------
 * The source as-of line.
 * ------------------------------------------------------------------------------------------ */

/**
 * The as-of date is NOT a Claim and deliberately cannot be one: a Claim carries a finite number
 * and a unit kind, and a date is neither. It is the date the source publishes about itself, it
 * is fetched on every page load, it is never baked into our HTML, and it already travels inside
 * the provenance line of every figure on the page. This is the standalone statement of it, and
 * when the call fails it says so rather than asserting a date we did not receive.
 *
 * @param {Document} doc
 * @param {string|null} sourceAsOf
 * @returns {HTMLElement}
 */
export function sourceAsOfLine(doc, sourceAsOf) {
  if (sourceAsOf === null || sourceAsOf === undefined) {
    return prose(doc, 'p', 'Source as of date unavailable. That call did not answer, so no date '
      + 'is asserted here. Every other figure on this page is unaffected.', { class: 'soft' });
  }
  const p = el(doc, 'p', { class: 'soft', 'data-source-as-of': sourceAsOf });
  p.textContent = 'USAspending publishes this data as current to ' + sourceAsOf
    + '. That date comes from the source itself, fetched on this page load.';
  return p;
}

/**
 * Replace the contents of a region. The only mutation helper the app uses, so there is one place
 * where a panel swap happens and no path where markup is assigned as a string.
 * @param {Element} region
 * @param {Element|null} node
 * @returns {Element}
 */
export function mount(region, node) {
  if (!region) return region;
  clear(region);
  if (node) region.appendChild(node);
  discloseFor(region);
  return region;
}

/**
 * PROGRESSIVE DISCLOSURE, and it is mechanical rather than a list somebody maintains.
 *
 * The page used to paint every section heading at load, so a visitor who had searched for
 * nothing was met with a stack of labels over empty regions below the fold: five promises the
 * page had not kept yet. A heading with nothing under it is worse than no heading, because it
 * reads as a thing that failed to load.
 *
 * The rule: a container marked data-disclose is hidden exactly when every element marked
 * data-region inside it is empty. mount() is the only funnel through which panel content
 * reaches this document, and clearing a region goes through it as well, so every appearance
 * and every removal is handled here and no call site has to remember anything.
 *
 * It walks parentNode by hand rather than calling closest(), because the whole render layer is
 * driven under a small document stand in in the test suite and closest() is not part of the
 * surface that stand in implements. A region with no data-disclose ancestor, which is what a
 * test region and the masthead date both are, is left alone.
 *
 * @param {Element} region
 * @returns {Element|null} The container that was toggled, or null when there is none.
 */
export function discloseFor(region) {
  let node = region;
  while (node && typeof node.hasAttribute === 'function' && !node.hasAttribute('data-disclose')) {
    node = node.parentNode;
  }
  if (!node || typeof node.hasAttribute !== 'function' || !node.hasAttribute('data-disclose')) {
    return null;
  }
  const inner = typeof node.querySelectorAll === 'function' ? node.querySelectorAll('[data-region]') : [];
  let filled = false;
  for (const r of inner) {
    if (r.childNodes && r.childNodes.length > 0) { filled = true; break; }
  }
  if (filled) node.removeAttribute('hidden');
  else node.setAttribute('hidden', '');
  return node;
}
