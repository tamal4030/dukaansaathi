import { describe, expect, it } from 'vitest';
import { availabilityLabel, isOrderable, parseAvailability } from '../src/lib/availability';

describe('availability parsing', () => {
  it('accepts the three canonical states case-insensitively', () => {
    expect(parseAvailability('Available')).toEqual({ ok: true, value: 'AVAILABLE' });
    expect(parseAvailability('available')).toEqual({ ok: true, value: 'AVAILABLE' });
    expect(parseAvailability('OUT_OF_STOCK')).toEqual({ ok: true, value: 'OUT_OF_STOCK' });
    expect(parseAvailability('Unknown')).toEqual({ ok: true, value: 'UNKNOWN' });
  });

  it('maps friendly spreadsheet synonyms', () => {
    expect(parseAvailability('in stock')).toEqual({ ok: true, value: 'AVAILABLE' });
    expect(parseAvailability('Yes')).toEqual({ ok: true, value: 'AVAILABLE' });
    expect(parseAvailability('sold out')).toEqual({ ok: true, value: 'OUT_OF_STOCK' });
    expect(parseAvailability('not sure')).toEqual({ ok: true, value: 'UNKNOWN' });
  });

  it('treats blank cells as unknown, never as available', () => {
    for (const blank of ['', '   ', null, undefined]) {
      const result = parseAvailability(blank);
      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toBe('UNKNOWN');
      expect(result.ok && result.value).not.toBe('AVAILABLE');
    }
  });

  it('rejects unrecognised values instead of guessing', () => {
    const result = parseAvailability('maybe later');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain('Available');
  });

  it('never reports unknown as available and does not allow ordering it', () => {
    expect(availabilityLabel('UNKNOWN')).toBe('Availability unknown');
    expect(isOrderable('UNKNOWN')).toBe(false);
    expect(isOrderable('OUT_OF_STOCK')).toBe(false);
    expect(isOrderable('AVAILABLE')).toBe(true);
  });

  it('parses its own display labels so exported files can be re-imported', () => {
    for (const value of ['AVAILABLE', 'OUT_OF_STOCK', 'UNKNOWN'] as const) {
      const result = parseAvailability(availabilityLabel(value));
      expect(result.ok).toBe(true);
      expect(result.ok && result.value).toBe(value);
    }
  });
});
