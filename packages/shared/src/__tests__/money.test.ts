import { describe, expect, it } from 'vitest';
import {
  addQty,
  allocate,
  amountInWords,
  formatMoney,
  integerToWords,
  lineAmount,
  mulDivRound,
  percentOf,
  roundTo,
  sumDecimals,
  toScaled,
} from '../money';

describe('money helpers', () => {
  it('avoids floating point drift when summing', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumDecimals([0.1, 0.2])).toBe(0.3);
    expect(addQty(0.1, 0.2, 0.3)).toBe(0.6);
  });

  it('rounds half away from zero on decimal representation', () => {
    expect(roundTo(1.005)).toBe(1.01);
    expect(roundTo(2.675)).toBe(2.68);
    expect(roundTo(-1.005)).toBe(-1.01);
    expect(roundTo(1.004999)).toBe(1);
  });

  it('computes line amounts and percentages exactly', () => {
    expect(lineAmount(2.5, 65)).toBe(162.5);
    // Rates are held at currency precision: 33.333 → 33.33
    expect(lineAmount(3, 33.333)).toBe(99.99);
    expect(percentOf(1999, 18)).toBe(359.82);
  });

  it('uses BigInt when products exceed the safe integer range', () => {
    expect(mulDivRound(9_000_000_000_000, 10_000, 10_000)).toBe(9_000_000_000_000);
  });

  it('allocation always sums to the total', () => {
    const parts = allocate(1001, [3, 7, 11, 13]);
    expect(parts.reduce((s, p) => s + p, 0)).toBe(1001);
  });

  it('rejects invalid numbers', () => {
    expect(() => toScaled(Number.NaN, 2)).toThrow(RangeError);
    expect(() => toScaled('abc', 2)).toThrow(RangeError);
    expect(toScaled('', 2)).toBe(0);
    expect(toScaled(null, 2)).toBe(0);
  });

  it('formats INR with Indian digit grouping', () => {
    expect(formatMoney(124850)).toBe('₹1,24,850.00');
    expect(formatMoney(1500.5, { showSymbol: false })).toBe('1,500.50');
  });

  it('spells amounts using lakh and crore', () => {
    expect(integerToWords(0)).toBe('Zero');
    expect(integerToWords(124850)).toBe('One Lakh Twenty Four Thousand Eight Hundred Fifty');
    expect(integerToWords(12_34_56_789)).toBe('Twelve Crore Thirty Four Lakh Fifty Six Thousand Seven Hundred Eighty Nine');
    expect(integerToWords(1_500_000, 'international')).toBe('One Million Five Hundred Thousand');
    expect(amountInWords(1550.5)).toBe('Rupees One Thousand Five Hundred Fifty and Fifty Paise Only');
  });
});
