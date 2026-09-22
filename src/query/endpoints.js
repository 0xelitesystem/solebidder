// THE API CONTRACT. Every endpoint this product may reach, the exact request shape it takes,
// and the exact projection of the response this product is allowed to read.
//
// ONE HOST. DESIGN 3.4: connect-src is 'self' and api.usaspending.gov and nothing else. Every
// other candidate source was cut for a stated reason, most of them because their CORS headers
// are conditional on the user agent, which means they work under curl and fail in a real
// browser. The declared set equals the used set and the flagship gate checks both directions.
//
// THE PROJECTION RULE, and it is the reason validators exist here rather than at the call site.
// Each validator returns a WHITELISTED projection of the response. Two consequences:
//
//   1. THE TOTAL OUTLAYS FIELD NEVER LEAVES THIS MODULE. It comes back null from every
//      aggregate endpoint. A null that reaches arithmetic becomes a zero, a zero that reaches a
//      chart becomes a line at the bottom of the axis, and a line at the bottom of the axis is
//      a published claim that a company received nothing. It is dropped here, by name, and
//      test/endpoints.test.js asserts the key is absent from every projection.
//   2. A FIELD THAT MOVES UPSTREAM FAILS LOUDLY. This API answers HTTP 200 with null columns
//      for a field name it does not recognise, so nothing upstream will ever tell us a rename
//      happened. The validator is the only thing that will.
//
// THE RECIPIENT LIST ENDPOINT IS NAME RESOLUTION ONLY. Trap 4: it has no year parameter and it
// returned a plausible looking amount over a different window from the fiscal year total for
// the same parent. Its amount field is not in the projection at all, so there is no code path
// that could render it.
//
// Isomorphic: no node:* imports and no DOM.

import { API_ORIGIN, SUBAWARDS, AWARD_TYPE_SETS, MAX_PAGE_LIMIT } from '../core/constants.js';
import { timePeriod, requireFiscalYear } from './fiscal-year.js';

/** Dimensions of spending_by_category this product asks for. DESIGN C2. */
export const CATEGORY_DIMENSIONS = Object.freeze([
  'awarding_agency',
  'awarding_subagency',
  'psc',
  'naics',
  'recipient',
]);

/**
 * @typedef {Object} EndpointSpec
 * @property {string} id
 * @property {'GET'|'POST'} method
 * @property {'fast'|'heavy'} weight Which timeout and deadline pair from ../query/retry.js.
 * @property {boolean} requiresFiscalYear
 * @property {string} describe What it is for, in the words the badge uses.
 * @property {string} pathPattern For documentation and for the host gate.
 */

/**
 * Build a full URL. The origin is a constant, so no call site can introduce a second host.
 * @param {string} pathAndQuery Must start with a slash.
 * @returns {string}
 */
export function url(pathAndQuery) {
  if (typeof pathAndQuery !== 'string' || !pathAndQuery.startsWith('/')) {
    throw new TypeError('url: expected a path beginning with a slash, got '
      + JSON.stringify(pathAndQuery) + '. The origin is fixed, because the declared network '
      + 'allowlist has exactly one host in it and a second one would fail the build.');
  }
  return API_ORIGIN + pathAndQuery;
}

/* --------------------------------------------------------------------------------------------
 * Request builders. Every one of them that touches money takes an explicit fiscal year and
 * throws without it. Trap 2.
 * ------------------------------------------------------------------------------------------ */

/**
 * GET the parent profile. DESIGN 2.1.
 * @param {string} recipientId The USAspending internal recipient id, parent level.
 * @param {number} fiscalYear
 * @returns {{id:string, method:'GET', url:string, weight:'fast'}}
 */
export function recipientProfileRequest(recipientId, fiscalYear) {
  assertRecipientId(recipientId, 'recipientProfileRequest');
  requireFiscalYear(fiscalYear, 'recipientProfileRequest');
  return {
    id: 'recipientProfile',
    method: 'GET',
    url: url('/api/v2/recipient/' + encodeURIComponent(recipientId) + '/?year=' + fiscalYear),
    weight: 'fast',
  };
}

/**
 * GET the registered children of a parent UEI, for one explicit year. DESIGN C4.
 * @param {string} uei
 * @param {number} fiscalYear
 * @returns {{id:string, method:'GET', url:string, weight:'fast'}}
 */
export function recipientChildrenRequest(uei, fiscalYear) {
  assertUei(uei, 'recipientChildrenRequest');
  requireFiscalYear(fiscalYear, 'recipientChildrenRequest');
  return {
    id: 'recipientChildren',
    method: 'GET',
    url: url('/api/v2/recipient/children/' + encodeURIComponent(uei) + '/?year=' + fiscalYear),
    weight: 'fast',
  };
}

/**
 * GET the date the source publishes about itself. DESIGN 7.3. Fetched on every page load and
 * never baked into our HTML.
 * @returns {{id:string, method:'GET', url:string, weight:'fast'}}
 */
export function lastUpdatedRequest() {
  return {
    id: 'lastUpdated',
    method: 'GET',
    url: url('/api/v2/awards/last_updated/'),
    weight: 'fast',
  };
}

/**
 * GET one award, for its competition fields. DESIGN C7.
 * @param {string} generatedInternalId
 * @returns {{id:string, method:'GET', url:string, weight:'fast'}}
 */
export function awardDetailRequest(generatedInternalId) {
  if (typeof generatedInternalId !== 'string' || generatedInternalId.trim().length === 0) {
    throw new TypeError('awardDetailRequest: generatedInternalId is required.');
  }
  return {
    id: 'awardDetail',
    method: 'GET',
    url: url('/api/v2/awards/' + encodeURIComponent(generatedInternalId) + '/'),
    weight: 'fast',
  };
}

/**
 * POST obligations grouped by fiscal year. DESIGN C3.
 * @param {Object} args
 * @param {string} args.recipientId
 * @param {number[]} args.fiscalYears Explicit years, oldest first.
 * @param {string} args.awardTypeSetId
 * @returns {{id:string, method:'POST', url:string, body:object, weight:'heavy'}}
 */
export function spendingOverTimeRequest(args) {
  assertRecipientId(args.recipientId, 'spendingOverTimeRequest');
  if (!Array.isArray(args.fiscalYears) || args.fiscalYears.length === 0) {
    throw new TypeError('spendingOverTimeRequest: fiscalYears must be a non empty array of '
      + 'explicit integer years.');
  }
  args.fiscalYears.forEach((y) => requireFiscalYear(y, 'spendingOverTimeRequest'));
  const set = assertAwardTypeSet(args.awardTypeSetId, 'spendingOverTimeRequest');

  /** @type {Record<string, unknown>} */
  const filters = {
    recipient_id: args.recipientId,
    time_period: args.fiscalYears.flatMap((y) => timePeriod(y)),
    subawards: SUBAWARDS,
  };
  if (set.codes !== null) filters.award_type_codes = [...set.codes];

  return {
    id: 'spendingOverTime',
    method: 'POST',
    url: url('/api/v2/search/spending_over_time/'),
    body: { group: 'fiscal_year', filters, subawards: SUBAWARDS },
    weight: 'heavy',
  };
}

/**
 * POST dollars by a category dimension. DESIGN C2.
 *
 * This endpoint DOES honour the recipient id filter, verified with a bogus id returning empty
 * and with no filter returning government wide results. That is the counter test that keeps the
 * award search rule precise rather than a blanket superstition about the field.
 *
 * @param {Object} args
 * @param {string} args.dimension One of CATEGORY_DIMENSIONS.
 * @param {string} [args.recipientId] Omitted only for the name match definition, DESIGN C5.
 * @param {string} [args.recipientSearchText] The name match definition, DESIGN C5.
 * @param {number} args.fiscalYear
 * @param {string} args.awardTypeSetId
 * @param {number} [args.limit]
 * @param {number} [args.page]
 * @returns {{id:string, method:'POST', url:string, body:object, weight:'heavy'}}
 */
export function spendingByCategoryRequest(args) {
  if (!CATEGORY_DIMENSIONS.includes(args.dimension)) {
    throw new RangeError('spendingByCategoryRequest: dimension must be one of '
      + CATEGORY_DIMENSIONS.join(', ') + ', got ' + JSON.stringify(args.dimension));
  }
  requireFiscalYear(args.fiscalYear, 'spendingByCategoryRequest');
  const set = assertAwardTypeSet(args.awardTypeSetId, 'spendingByCategoryRequest');
  const hasId = typeof args.recipientId === 'string' && args.recipientId.length > 0;
  const hasText = typeof args.recipientSearchText === 'string' && args.recipientSearchText.length > 0;
  if (hasId === hasText) {
    throw new TypeError('spendingByCategoryRequest: supply EITHER a resolved recipient id, which '
      + 'is the parent UEI rollup definition, OR a recipient search text, which is the name match '
      + 'definition. Never both. They are two different definitions of what "the company" means '
      + 'and the product shows them side by side as two named figures, never merged and never '
      + 'presented as a range.');
  }
  const limit = args.limit === undefined ? MAX_PAGE_LIMIT : args.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_LIMIT) {
    throw new RangeError('spendingByCategoryRequest: limit must be an integer in [1, '
      + MAX_PAGE_LIMIT + ']. The API answers HTTP 422 above that.');
  }

  /** @type {Record<string, unknown>} */
  const filters = { time_period: timePeriod(args.fiscalYear), subawards: SUBAWARDS };
  if (hasId) filters.recipient_id = args.recipientId;
  else filters.recipient_search_text = [args.recipientSearchText];
  if (set.codes !== null) filters.award_type_codes = [...set.codes];

  return {
    id: 'spendingByCategory',
    method: 'POST',
    url: url('/api/v2/search/spending_by_category/' + args.dimension + '/'),
    body: {
      category: args.dimension,
      filters,
      limit,
      page: args.page === undefined ? 1 : args.page,
      subawards: SUBAWARDS,
    },
    weight: 'heavy',
  };
}

/**
 * POST the award count. DESIGN 2.1.
 * @param {Object} args
 * @param {string} args.recipientId
 * @param {number} args.fiscalYear
 * @param {string} args.awardTypeSetId
 * @returns {{id:string, method:'POST', url:string, body:object, weight:'heavy'}}
 */
export function spendingByAwardCountRequest(args) {
  assertRecipientId(args.recipientId, 'spendingByAwardCountRequest');
  requireFiscalYear(args.fiscalYear, 'spendingByAwardCountRequest');
  const set = assertAwardTypeSet(args.awardTypeSetId, 'spendingByAwardCountRequest');
  /** @type {Record<string, unknown>} */
  const filters = {
    recipient_id: args.recipientId,
    time_period: timePeriod(args.fiscalYear),
    subawards: SUBAWARDS,
  };
  if (set.codes !== null) filters.award_type_codes = [...set.codes];
  return {
    id: 'spendingByAwardCount',
    method: 'POST',
    url: url('/api/v2/search/spending_by_award_count/'),
    body: { filters, subawards: SUBAWARDS },
    weight: 'heavy',
  };
}

/**
 * POST the typeahead fallback for anything outside the bundled index. DESIGN 3.2.
 * @param {string} searchText
 * @param {number} [limit]
 * @returns {{id:string, method:'POST', url:string, body:object, weight:'fast'}}
 */
export function recipientAutocompleteRequest(searchText, limit = 10) {
  if (typeof searchText !== 'string' || searchText.trim().length === 0) {
    throw new TypeError('recipientAutocompleteRequest: searchText is required.');
  }
  return {
    id: 'recipientAutocomplete',
    method: 'POST',
    url: url('/api/v2/autocomplete/recipient/'),
    body: { search_text: searchText, limit },
    weight: 'fast',
  };
}

/**
 * POST the recipient list. NAME TO ID RESOLUTION ONLY. Trap 4.
 *
 * This endpoint has no year parameter. Its amount field covers a window nobody named and it
 * differs from the fiscal year total for the same parent by billions. The validator below does
 * not project the amount, so there is no path from this response to a rendered figure.
 *
 * @param {string} searchText
 * @param {number} [limit]
 * @param {number} [page]
 * @returns {{id:string, method:'POST', url:string, body:object, weight:'fast'}}
 */
export function recipientListRequest(searchText, limit = 50, page = 1) {
  if (typeof searchText !== 'string' || searchText.trim().length === 0) {
    throw new TypeError('recipientListRequest: searchText is required.');
  }
  return {
    id: 'recipientList',
    method: 'POST',
    url: url('/api/v2/recipient/'),
    body: { keyword: searchText, limit, page, order: 'desc', sort: 'amount' },
    weight: 'fast',
  };
}

/* --------------------------------------------------------------------------------------------
 * Validators. Each returns a whitelisted projection or throws a MalformedResponse.
 * ------------------------------------------------------------------------------------------ */

/** Thrown when a response does not match the shape this endpoint is contracted to return. */
export class MalformedResponse extends Error {
  /** @param {string} endpointId @param {string} detail */
  constructor(endpointId, detail) {
    super('Malformed response from ' + endpointId + ': ' + detail
      + '. Nothing is displayed for this panel, because guessing at a field that moved is how a '
      + 'wrong number gets published.');
    this.name = 'MalformedResponse';
    this.endpointId = endpointId;
    this.detail = detail;
  }
}

/** The field this product refuses to carry. It is null upstream on every aggregate endpoint. */
const FORBIDDEN_FIELDS = Object.freeze(['total_outlays', 'total_outlay']);

/**
 * Assert a projection carries none of the forbidden fields. Called by every validator, so the
 * rule cannot be forgotten in a new one.
 * @param {object} projection
 * @param {string} endpointId
 * @returns {object}
 */
export function assertNoForbiddenFields(projection, endpointId) {
  for (const key of Object.keys(projection)) {
    if (FORBIDDEN_FIELDS.includes(key)) {
      throw new MalformedResponse(endpointId, 'the projection carries the field "' + key
        + '", which this product never reads. That field is null on every aggregate endpoint '
        + 'tested and a null becomes a zero the moment it reaches arithmetic');
    }
  }
  return projection;
}

/**
 * Twelve alphanumeric characters. Declared once and used by both the projection that keeps a UEI
 * and the assertion that refuses anything else, so the two can never drift apart. Trap 13.
 */
export const UEI_PATTERN = /^[A-Z0-9]{12}$/;

/** @param {unknown} v @param {string} endpointId @param {string} field @returns {number} */
function num(v, endpointId, field) {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new MalformedResponse(endpointId, 'field "' + field + '" was ' + JSON.stringify(v)
      + ' where a finite number was contracted');
  }
  return v;
}

/** @param {unknown} v @param {string} endpointId @param {string} field @returns {string} */
function str(v, endpointId, field) {
  if (typeof v !== 'string') {
    throw new MalformedResponse(endpointId, 'field "' + field + '" was ' + JSON.stringify(v)
      + ' where a string was contracted');
  }
  return v;
}

/**
 * @param {any} json
 * @returns {{recipientId:string, uei:string, name:string, level:string, totalObligations:number,
 *   totalTransactions:number, alternateNames:string[], parentUei:string|null}}
 */
export function validateRecipientProfile(json) {
  const id = 'recipientProfile';
  if (!json || typeof json !== 'object') throw new MalformedResponse(id, 'body was not an object');
  return assertNoForbiddenFields({
    recipientId: str(json.recipient_id, id, 'recipient_id'),
    uei: str(json.uei, id, 'uei'),
    name: str(json.name, id, 'name'),
    level: str(json.recipient_level, id, 'recipient_level'),
    totalObligations: num(json.total_transaction_amount, id, 'total_transaction_amount'),
    totalTransactions: num(json.total_transactions, id, 'total_transactions'),
    alternateNames: Array.isArray(json.alternate_names) ? json.alternate_names.map(String) : [],
    parentUei: typeof json.parent_uei === 'string' ? json.parent_uei : null,
  }, id);
}

/**
 * @param {any} json
 * @returns {{children:{uei:string, name:string, recipientId:string|null, amount:number,
 *   transactionCount:number|null}[], count:number}}
 */
export function validateRecipientChildren(json) {
  const id = 'recipientChildren';
  if (!Array.isArray(json)) throw new MalformedResponse(id, 'body was not an array');
  const children = json.map((row, i) => assertNoForbiddenFields({
    uei: str(row.uei, id, 'children[' + i + '].uei'),
    name: str(row.name, id, 'children[' + i + '].name'),
    recipientId: typeof row.recipient_id === 'string' ? row.recipient_id : null,
    amount: num(row.amount, id, 'children[' + i + '].amount'),
    transactionCount: typeof row.state_province === 'string' ? null
      : (typeof row.total_transactions === 'number' ? row.total_transactions : null),
  }, id));
  return { children, count: children.length };
}

/**
 * The contract obligations bucket only. The total outlays field at this grouping is null
 * upstream and is dropped here rather than carried and guarded downstream.
 * @param {any} json
 * @returns {{points:{fiscalYear:number, obligations:number}[]}}
 */
export function validateSpendingOverTime(json) {
  const id = 'spendingOverTime';
  const results = json && json.results;
  if (!Array.isArray(results)) throw new MalformedResponse(id, 'results was not an array');
  const points = results.map((row, i) => {
    const tv = row && row.time_period && row.time_period.fiscal_year;
    const fy = typeof tv === 'string' ? Number(tv) : tv;
    if (!Number.isInteger(fy)) {
      throw new MalformedResponse(id, 'results[' + i + '].time_period.fiscal_year was '
        + JSON.stringify(tv) + ' where an integer year was contracted');
    }
    const bucket = row.aggregated_amount !== undefined
      ? row.aggregated_amount
      : row.Contract_Obligations;
    return assertNoForbiddenFields({
      fiscalYear: fy,
      obligations: num(bucket, id, 'results[' + i + '] obligations bucket'),
    }, id);
  });
  return { points };
}

/**
 * TRAP 13 LIVES IN THE SHAPE OF THIS RESPONSE AND IT IS NOT OBVIOUS FROM THE FIELD NAME.
 *
 * Across the agency, sub agency, PSC and NAICS dimensions the `code` field is a public
 * government classification: DOD, 1710, 336411. Across the RECIPIENT dimension the SAME field
 * name carries the nine digit legacy vendor number instead, which is a commercial data vendor
 * identifier whose open data carries a written attribution obligation. That is visible in the
 * recorded response committed at test/fixtures/api/category-recipient-all-fy2025.json, where the
 * top row reads "code": "008016958" beside "uei": "G4KDGE4JFFK7".
 *
 * So the projection is dimension aware. On the recipient dimension the vendor number is NOT
 * carried forward at all and the UEI is projected in its place, which is the identifier this
 * product keys on everywhere else. A validator that quietly hands a banned identifier to the
 * layer above it is a loaded gun, even while nothing upstairs happens to read it: the whole
 * point of a projection is that a field which never reaches it can never reach a reader.
 *
 * @param {any} json
 * @returns {{dimension:string, rows:{name:string, code:string|null, uei:string|null,
 *   id:string|null, amount:number}[], hasNextPage:boolean}}
 */
export function validateSpendingByCategory(json) {
  const id = 'spendingByCategory';
  const results = json && json.results;
  if (!Array.isArray(results)) throw new MalformedResponse(id, 'results was not an array');
  const dimension = typeof json.category === 'string' ? json.category : 'unknown';
  const isRecipient = dimension === 'recipient';
  const rows = results.map((row, i) => assertNoForbiddenFields({
    name: str(row.name === null ? '' : row.name, id, 'results[' + i + '].name'),
    // Null on the recipient dimension, on purpose. See the block above this function.
    code: isRecipient || row.code === null || row.code === undefined ? null : String(row.code),
    uei: typeof row.uei === 'string' && UEI_PATTERN.test(row.uei) ? row.uei : null,
    id: row.id === null || row.id === undefined ? null : String(row.id),
    amount: num(row.amount, id, 'results[' + i + '].amount'),
  }, id));
  return {
    dimension,
    rows,
    hasNextPage: Boolean(json.page_metadata && json.page_metadata.hasNext),
  };
}

/**
 * @param {any} json
 * @returns {{rows:{awardId:string, recipientName:string, awardingAgency:string,
 *   awardingSubAgency:string, awardValue:number, generatedInternalId:string,
 *   startDate:string|null, endDate:string|null, awardType:string|null}[], hasNextPage:boolean}}
 */
export function validateSpendingByAward(json) {
  const id = 'spendingByAward';
  const results = json && json.results;
  if (!Array.isArray(results)) throw new MalformedResponse(id, 'results was not an array');
  const rows = results.map((row, i) => assertNoForbiddenFields({
    awardId: str(row['Award ID'], id, 'results[' + i + '].Award ID'),
    recipientName: str(row['Recipient Name'], id, 'results[' + i + '].Recipient Name'),
    awardingAgency: typeof row['Awarding Agency'] === 'string' ? row['Awarding Agency'] : '',
    awardingSubAgency: typeof row['Awarding Sub Agency'] === 'string' ? row['Awarding Sub Agency'] : '',
    awardValue: num(row['Award Amount'], id, 'results[' + i + '].Award Amount'),
    generatedInternalId: str(row.generated_internal_id, id, 'results[' + i + '].generated_internal_id'),
    startDate: typeof row['Start Date'] === 'string' ? row['Start Date'] : null,
    endDate: typeof row['End Date'] === 'string' ? row['End Date'] : null,
    awardType: typeof row['Award Type'] === 'string' ? row['Award Type'] : null,
  }, id));
  return { rows, hasNextPage: Boolean(json.page_metadata && json.page_metadata.hasNext) };
}

/**
 * The competition fields, straight from the government record INCLUDING where that record
 * contradicts itself. DESIGN C1: an award reporting full and open competition with zero offers
 * received is rendered as reported and excluded from the count share with a visible tally, not
 * quietly corrected.
 * @param {any} json
 * @returns {{generatedInternalId:string, awardId:string, extentCompeted:string|null,
 *   offersReceived:number|null, offersReceivedRaw:string|null, solicitationProcedures:string|null,
 *   setAside:string|null, solicitationIdentifier:string|null, inconsistent:boolean}}
 */
export function validateAwardDetail(json) {
  const id = 'awardDetail';
  if (!json || typeof json !== 'object') throw new MalformedResponse(id, 'body was not an object');
  const c = json.latest_transaction_contract_data;
  if (!c || typeof c !== 'object') {
    throw new MalformedResponse(id, 'latest_transaction_contract_data was absent, so this award '
      + 'carries no competition fields and it cannot be counted either way');
  }
  const raw = c.number_of_offers_received;
  const offers = raw === null || raw === undefined || raw === '' ? null : Number(raw);
  const extent = typeof c.extent_competed_description === 'string'
    ? c.extent_competed_description : null;
  const inconsistent = extent !== null && extent.toUpperCase().includes('FULL AND OPEN')
    && offers !== null && offers < 2;
  return assertNoForbiddenFields({
    generatedInternalId: str(json.generated_unique_award_id, id, 'generated_unique_award_id'),
    awardId: typeof json.piid === 'string' ? json.piid : '',
    extentCompeted: extent,
    offersReceived: offers !== null && Number.isFinite(offers) ? offers : null,
    offersReceivedRaw: raw === null || raw === undefined ? null : String(raw),
    solicitationProcedures: typeof c.solicitation_procedures_description === 'string'
      ? c.solicitation_procedures_description : null,
    setAside: typeof c.type_set_aside_description === 'string' ? c.type_set_aside_description : null,
    solicitationIdentifier: typeof c.solicitation_identifier === 'string'
      ? c.solicitation_identifier : null,
    inconsistent,
  }, id);
}

/**
 * @param {any} json
 * @returns {{sourceAsOf:string}}
 */
export function validateLastUpdated(json) {
  const id = 'lastUpdated';
  if (!json || typeof json !== 'object') throw new MalformedResponse(id, 'body was not an object');
  return assertNoForbiddenFields({ sourceAsOf: str(json.last_updated, id, 'last_updated') }, id);
}

/**
 * Name to id resolution ONLY. The amount field is deliberately not projected. Trap 4.
 * @param {any} json
 * @returns {{candidates:{recipientId:string, uei:string|null, name:string, level:string|null}[]}}
 */
export function validateRecipientList(json) {
  const id = 'recipientList';
  const results = json && json.results;
  if (!Array.isArray(results)) throw new MalformedResponse(id, 'results was not an array');
  const candidates = results.map((row, i) => assertNoForbiddenFields({
    recipientId: str(row.id, id, 'results[' + i + '].id'),
    uei: typeof row.uei === 'string' ? row.uei : null,
    name: str(row.name === null ? '' : row.name, id, 'results[' + i + '].name'),
    level: typeof row.recipient_level === 'string' ? row.recipient_level : null,
  }, id));
  return { candidates };
}

/**
 * @param {any} json
 * @returns {{suggestions:{recipientId:string|null, uei:string|null, name:string}[]}}
 */
export function validateRecipientAutocomplete(json) {
  const id = 'recipientAutocomplete';
  const results = json && json.results;
  if (!Array.isArray(results)) throw new MalformedResponse(id, 'results was not an array');
  return {
    suggestions: results.map((row) => ({
      recipientId: typeof row.recipient_id === 'string' ? row.recipient_id : null,
      uei: typeof row.uei === 'string' ? row.uei : null,
      name: typeof row.recipient_name === 'string' ? row.recipient_name : String(row.name || ''),
    })),
  };
}

/**
 * @param {any} json
 * @returns {{awardCount:number}}
 */
export function validateSpendingByAwardCount(json) {
  const id = 'spendingByAwardCount';
  const results = json && json.results;
  if (!results || typeof results !== 'object') {
    throw new MalformedResponse(id, 'results was not an object');
  }
  const total = Object.values(results).reduce((acc, v) => acc + (typeof v === 'number' ? v : 0), 0);
  return assertNoForbiddenFields({ awardCount: total }, id);
}

/* --------------------------------------------------------------------------------------------
 * Shared assertions.
 * ------------------------------------------------------------------------------------------ */

/**
 * A UEI is twelve alphanumeric characters. Never a legacy vendor number: that identifier is a
 * commercial data vendor's intellectual property and using it as a key would import a written
 * attribution obligation into an otherwise public domain product. Trap 13.
 * @param {unknown} uei
 * @param {string} where
 * @returns {string}
 */
export function assertUei(uei, where) {
  if (typeof uei !== 'string' || !UEI_PATTERN.test(uei)) {
    throw new TypeError(where + ': expected a twelve character UEI, got ' + JSON.stringify(uei)
      + '. This product keys on UEI only.');
  }
  return uei;
}

/** @param {unknown} id @param {string} where @returns {string} */
export function assertRecipientId(id, where) {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new TypeError(where + ': a resolved recipient id is required. Resolution happens once, '
      + 'explicitly, and the user is shown which entity was chosen.');
  }
  return id;
}

/** @param {unknown} setId @param {string} where @returns {{id:string, codes:readonly string[]|null}} */
export function assertAwardTypeSet(setId, where) {
  const set = AWARD_TYPE_SETS[/** @type {string} */ (setId)];
  if (!set) {
    throw new RangeError(where + ': awardTypeSetId must be one of '
      + Object.keys(AWARD_TYPE_SETS).join(', ') + ', got ' + JSON.stringify(setId));
  }
  return set;
}
