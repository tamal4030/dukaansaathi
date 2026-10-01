import type { Availability, OpenState } from './types';

export function availabilityTone(value: Availability): string {
  switch (value) {
    case 'AVAILABLE':
      return 'bg-emerald-50 text-emerald-700';
    case 'OUT_OF_STOCK':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-amber-50 text-amber-800';
  }
}

export function openStateTone(value: OpenState): string {
  switch (value) {
    case 'open':
      return 'bg-emerald-50 text-emerald-700';
    case 'closed':
      return 'bg-slate-100 text-slate-600';
    default:
      return 'bg-amber-50 text-amber-800';
  }
}

export function statusTone(status: string): string {
  switch (status) {
    case 'NEW':
      return 'bg-brand-50 text-brand-700';
    case 'ACCEPTED':
    case 'PREPARING':
      return 'bg-sky-50 text-sky-700';
    case 'READY_FOR_PICKUP':
    case 'OUT_FOR_DELIVERY':
      return 'bg-amber-50 text-amber-800';
    case 'COMPLETED':
      return 'bg-emerald-50 text-emerald-700';
    case 'CANCELLED':
      return 'bg-red-50 text-red-700';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

export function formatTime(value: string | null): string {
  if (!value) return '';
  const [hours, minutes] = value.split(':');
  const hour = Number(hours);
  if (Number.isNaN(hour)) return value;
  const suffix = hour < 12 ? 'am' : 'pm';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minutes ?? '00'} ${suffix}`;
}

export function addressLine(address: {
  line: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
}): string {
  return [address.line, address.city, address.state, address.pincode].filter(Boolean).join(', ');
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
