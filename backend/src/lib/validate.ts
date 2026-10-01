import { z } from 'zod';

export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown): z.infer<S> {
  return schema.parse(body ?? {});
}

export function parseQuery<S extends z.ZodTypeAny>(schema: S, query: unknown): z.infer<S> {
  return schema.parse(query ?? {});
}

export const trimmedString = (max: number) => z.string().trim().max(max);

export const optionalTrimmed = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .optional()
    .transform((value) => (value === undefined || value === null || value === '' ? null : value));
