import type { BusinessHour } from '@prisma/client';

export type OpenState = 'open' | 'closed' | 'unknown';

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export interface PublicHour {
  dayOfWeek: number;
  day: string;
  isClosed: boolean;
  openTime: string | null;
  closeTime: string | null;
  note: string | null;
}

export function toPublicHours(hours: BusinessHour[]): PublicHour[] {
  return [...hours]
    .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
    .map((hour) => ({
      dayOfWeek: hour.dayOfWeek,
      day: DAY_NAMES[hour.dayOfWeek] ?? '',
      isClosed: hour.isClosed,
      openTime: hour.openTime,
      closeTime: hour.closeTime,
      note: hour.note,
    }));
}

/** IST is the only timezone DukaanSaathi targets in the MVP. */
export function istParts(now: Date): { dayOfWeek: number; minutes: number } {
  const ist = new Date(now.getTime() + (330 + now.getTimezoneOffset()) * 60 * 1000);
  return { dayOfWeek: ist.getDay(), minutes: ist.getHours() * 60 + ist.getMinutes() };
}

function toMinutes(value: string | null): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Returns 'unknown' when the business has no hours configured: the UI and the
 * assistant must never guess that a store is open.
 */
export function computeOpenState(hours: BusinessHour[], now: Date = new Date()): OpenState {
  if (!hours || hours.length === 0) return 'unknown';
  const { dayOfWeek, minutes } = istParts(now);
  const today = hours.find((hour) => hour.dayOfWeek === dayOfWeek);
  if (!today) return 'unknown';
  if (today.isClosed) return 'closed';
  const open = toMinutes(today.openTime);
  const close = toMinutes(today.closeTime);
  if (open === null || close === null) return 'unknown';
  if (close <= open) {
    // Overnight window, e.g. 20:00 - 02:00
    return minutes >= open || minutes < close ? 'open' : 'closed';
  }
  return minutes >= open && minutes < close ? 'open' : 'closed';
}

export function validateHourInput(input: {
  isClosed?: boolean;
  openTime?: string | null;
  closeTime?: string | null;
}): string | null {
  if (input.isClosed) return null;
  const open = toMinutes(input.openTime ?? null);
  const close = toMinutes(input.closeTime ?? null);
  if (open === null || close === null) {
    return 'Opening and closing time are required in HH:MM 24-hour format.';
  }
  return null;
}
