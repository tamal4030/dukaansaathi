import { Prisma } from '@prisma/client';

export type Money = Prisma.Decimal;

export function toDecimal(value: number | string | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/** Money is always serialised with two decimals as a string (no float drift). */
export function money(value: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export function multiply(price: Prisma.Decimal, quantity: number): Prisma.Decimal {
  return new Prisma.Decimal(price).mul(quantity);
}

export function sum(values: Array<Prisma.Decimal>): Prisma.Decimal {
  return values.reduce((acc, value) => acc.add(value), new Prisma.Decimal(0));
}
