// Synthetic fixtures for the render layer.
//
// EVERY NUMBER IN THIS FILE IS INVENTED AND IT IS INVENTED ON PURPOSE. These fixtures exercise
// the shapes the page renders; they are never quoted as a figure about any real entity anywhere
// in this repository, and the identifiers below are obviously synthetic so that nobody can mine
// a plausible looking dollar amount out of a test file. The figures that ARE published are
// recomputed from recorded responses by the analysis layer's own fixtures.

import { resolveIdentity } from '../../src/contracts/identity.js';

export const TEST_FISCAL_YEAR = 2025;
export const TEST_SET = 'contracts';
export const TEST_AS_OF = '09/21/2026';

export const META = Object.freeze({
  fiscalYear: TEST_FISCAL_YEAR,
  awardTypeSetId: TEST_SET,
  sourceAsOf: TEST_AS_OF,
});

/** A resolved identity with three registered children. */
export function testIdentity(overrides = {}) {
  return resolveIdentity({
    choice: {
      candidate: {
        recipientId: 'test-recipient-id',
        uei: 'TESTPARENT01',
        name: 'TEST PARENT ENTITY',
        level: 'PARENT',
        alternateNames: ['TEST PARENT ALIAS'],
      },
      how: 'picked-from-list',
    },
    children: [
      { uei: 'TESTCHILD001', name: 'TEST CHILD ONE', obligations: 400 },
      { uei: 'TESTCHILD002', name: 'TEST CHILD TWO', obligations: 300 },
      { uei: 'TESTCHILD003', name: 'TEST CHILD THREE', obligations: 300 },
    ],
    childrenExpected: 3,
    fiscalYear: TEST_FISCAL_YEAR,
    awardTypeSetId: TEST_SET,
    sourceAsOf: TEST_AS_OF,
    ...overrides,
  });
}

/** Award rows as the award search validator projects them, already inside the entity set. */
export function testAwardRows() {
  return [
    { awardId: 'TESTAWARD0001', recipientName: 'TEST PARENT ENTITY', awardValue: 600, generatedInternalId: 'gid-1' },
    { awardId: 'TESTAWARD0002', recipientName: 'TEST CHILD ONE', awardValue: 300, generatedInternalId: 'gid-2' },
    { awardId: 'TESTAWARD0003', recipientName: 'TEST CHILD TWO', awardValue: 100, generatedInternalId: 'gid-3' },
  ];
}

/** Award details as the award detail validator projects them. */
export function testAwardDetails() {
  return [
    {
      generatedInternalId: 'gid-1',
      awardId: 'TESTAWARD0001',
      extentCompeted: 'NOT COMPETED',
      offersReceived: 1,
      offersReceivedRaw: '1',
      solicitationProcedures: 'ONLY ONE SOURCE',
      setAside: null,
      solicitationIdentifier: null,
      inconsistent: false,
    },
    {
      generatedInternalId: 'gid-2',
      awardId: 'TESTAWARD0002',
      extentCompeted: 'FULL AND OPEN COMPETITION',
      offersReceived: 4,
      offersReceivedRaw: '4',
      solicitationProcedures: 'NEGOTIATED PROPOSAL',
      setAside: null,
      solicitationIdentifier: null,
      inconsistent: false,
    },
    {
      generatedInternalId: 'gid-3',
      awardId: 'TESTAWARD0003',
      extentCompeted: 'FULL AND OPEN COMPETITION',
      offersReceived: 0,
      offersReceivedRaw: '0',
      solicitationProcedures: 'NEGOTIATED PROPOSAL',
      setAside: null,
      solicitationIdentifier: null,
      inconsistent: true,
    },
  ];
}

/** Category rows as the category validator projects them. */
export function testAgencyRows() {
  return [
    { name: 'TEST DEPARTMENT ALPHA', code: 'A', id: '1', amount: 900 },
    { name: 'TEST DEPARTMENT BETA', code: 'B', id: '2', amount: 80 },
    { name: 'TEST DEPARTMENT GAMMA', code: 'G', id: '3', amount: 20 },
  ];
}

/** Obligations by fiscal year, as the over time validator projects them. */
export function testOverTimePoints() {
  return [
    { fiscalYear: 2023, obligations: 700 },
    { fiscalYear: 2024, obligations: 900 },
    { fiscalYear: 2025, obligations: 1000 },
  ];
}

/** The region ids the shell provides and boot() looks for. */
export const REGION_IDS = Object.freeze([
  'panel-controls', 'panel-chips', 'panel-suggestions', 'panel-chooser', 'panel-subject', 'panel-hero',
  'panel-mix', 'panel-mix-subagency', 'panel-mix-psc', 'panel-mix-naics',
  'panel-spine', 'panel-concentration', 'panel-rollup', 'panel-definition', 'panel-source-as-of',
]);
