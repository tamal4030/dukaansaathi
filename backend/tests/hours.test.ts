import { describe, expect, it } from 'vitest';
import { computeOpenState, validateHourInput } from '../src/lib/hours';
import type { BusinessHour } from '@prisma/client';

function hour(partial: Partial<BusinessHour>): BusinessHour {
  return {
    id: 'h1',
    businessId: 'b1',
    dayOfWeek: 1,
    isClosed: false,
    openTime: '09:00',
    closeTime: '21:00',
    note: null,
    ...partial,
  } as BusinessHour;
}

/** Monday 2026-01-05, 12:00 IST == 06:30 UTC */
const mondayNoonIst = new Date('2026-01-05T06:30:00.000Z');

describe('store hours', () => {
  it('reports unknown when the business published no hours', () => {
    expect(computeOpenState([], mondayNoonIst)).toBe('unknown');
    expect(computeOpenState([], mondayNoonIst)).not.toBe('open');
  });

  it('reports open inside the published window', () => {
    expect(computeOpenState([hour({})], mondayNoonIst)).toBe('open');
  });

  it('reports closed outside the published window', () => {
    expect(computeOpenState([hour({ openTime: '18:00', closeTime: '22:00' })], mondayNoonIst)).toBe('closed');
  });

  it('reports closed on a day marked closed', () => {
    expect(computeOpenState([hour({ isClosed: true, openTime: null, closeTime: null })], mondayNoonIst)).toBe('closed');
  });

  it('reports unknown when times are missing for an open day', () => {
    expect(computeOpenState([hour({ openTime: null, closeTime: null })], mondayNoonIst)).toBe('unknown');
  });

  it('handles overnight windows', () => {
    const lateNight = new Date('2026-01-05T20:00:00.000Z'); // 01:30 IST Tuesday
    const hours = [
      hour({ dayOfWeek: 1, openTime: '20:00', closeTime: '02:00' }),
      hour({ id: 'h2', dayOfWeek: 2, openTime: '20:00', closeTime: '02:00' }),
    ];
    expect(computeOpenState(hours, lateNight)).toBe('open');
  });

  it('validates hour input', () => {
    expect(validateHourInput({ isClosed: false, openTime: '09:00', closeTime: '21:00' })).toBeNull();
    expect(validateHourInput({ isClosed: true })).toBeNull();
    expect(validateHourInput({ isClosed: false, openTime: '9am', closeTime: '21:00' })).toBeTruthy();
    expect(validateHourInput({ isClosed: false, openTime: null, closeTime: null })).toBeTruthy();
  });
});
