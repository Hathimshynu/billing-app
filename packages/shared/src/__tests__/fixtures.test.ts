import { describe, expect, it } from 'vitest';
import fixtures from '../../fixtures/pricing-cases.json';
import { allocate, divRound, toScaled } from '../money';
import { calculatePricing, type PricingInput } from '../tax';
import { calculateJewelleryPrice, calculateOldGoldValue, type JewelleryPriceInput } from '../jewellery';
import { formatDocumentNumber, numberingPeriod } from '../numbering';

/**
 * These vectors are shared with the PHP test-suite (apps/api/tests/Unit/SharedFixturesTest.php)
 * so client and server always price a bill identically.
 */
describe('shared pricing fixtures', () => {
  for (const testCase of fixtures.cases) {
    it(testCase.name, () => {
      const result = calculatePricing(testCase.input as PricingInput);
      expect(result).toMatchObject(testCase.expected);
    });
  }
});

describe('shared jewellery fixtures', () => {
  for (const testCase of fixtures.jewellery) {
    it(testCase.name, () => {
      expect(calculateJewelleryPrice(testCase.input as JewelleryPriceInput)).toMatchObject(testCase.expected);
    });
  }
  for (const testCase of fixtures.old_gold) {
    it(testCase.name, () => {
      expect(calculateOldGoldValue(testCase.input)).toMatchObject(testCase.expected);
    });
  }
});

describe('shared numbering fixtures', () => {
  for (const testCase of fixtures.numbering) {
    it(`${testCase.format} → ${testCase.expected}`, () => {
      const ctx = {
        sequence: testCase.sequence,
        date: testCase.date,
        deviceCode: 'device' in testCase ? (testCase.device as string) : null,
        storeCode: 'store' in testCase ? (testCase.store as string) : null,
      };
      expect(formatDocumentNumber(testCase.format, ctx)).toBe(testCase.expected);
      expect(numberingPeriod(testCase.format, testCase.date)).toBe(testCase.period);
    });
  }
});

describe('shared arithmetic fixtures', () => {
  it.each(fixtures.allocation)('allocate($total, $weights)', ({ total, weights, expected }) => {
    expect(allocate(total, weights)).toEqual(expected);
  });
  it.each(fixtures.scaled)('toScaled($value, $scale)', ({ value, scale, expected }) => {
    expect(toScaled(value, scale)).toBe(expected);
  });
  it.each(fixtures.div_round)('divRound($a, $b)', ({ a, b, expected }) => {
    expect(divRound(a, b)).toBe(expected);
  });
});
