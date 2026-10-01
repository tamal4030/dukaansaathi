import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTPayload } from 'jose';
import type { UserProfile } from '@prisma/client';
import { env, features, missingEnvFor } from '../config/env';
import type { Db } from '../db/prisma';
import { AppError, forbidden, notConfigured, unauthorized } from '../lib/errors';
import { logger } from '../lib/logger';

export interface AuthClaims {
  sub: string;
  email?: string;
  name?: string;
  provider?: string;
  isAnonymous?: boolean;
}

export interface AuthVerifier {
  verify(token: string): Promise<AuthClaims>;
}

function claimsFromPayload(payload: JWTPayload): AuthClaims {
  const metadata = (payload as Record<string, unknown>).user_metadata as Record<string, unknown> | undefined;
  const appMetadata = (payload as Record<string, unknown>).app_metadata as Record<string, unknown> | undefined;
  const email = typeof payload.email === 'string' ? payload.email : undefined;
  const name =
    (typeof metadata?.full_name === 'string' && metadata.full_name) ||
    (typeof metadata?.name === 'string' && metadata.name) ||
    undefined;
  return {
    sub: String(payload.sub ?? ''),
    email,
    name: name || undefined,
    provider: typeof appMetadata?.provider === 'string' ? appMetadata.provider : undefined,
    isAnonymous: appMetadata?.provider === 'anonymous' || payload.role === 'anon',
  };
}

async function verifyWithSupabaseAuthServer(token: string): Promise<AuthClaims> {
  const response = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) throw unauthorized('Session expired or invalid. Please sign in again.');
  const body = (await response.json()) as Record<string, unknown>;
  return {
    sub: String(body.id ?? ''),
    email: typeof body.email === 'string' ? body.email : undefined,
    name:
      typeof (body.user_metadata as Record<string, unknown> | undefined)?.full_name === 'string'
        ? String((body.user_metadata as Record<string, unknown>).full_name)
        : undefined,
    provider:
      typeof (body.app_metadata as Record<string, unknown> | undefined)?.provider === 'string'
        ? String((body.app_metadata as Record<string, unknown>).provider)
        : undefined,
  };
}

export function createSupabaseVerifier(): AuthVerifier {
  return {
    async verify(token: string): Promise<AuthClaims> {
      if (!features.supabaseAuth()) {
        throw notConfigured(
          'Sign-in is not configured on the server yet.',
          { missing: missingEnvFor('supabaseAuth'), setup: 'Set SUPABASE_URL and SUPABASE_ANON_KEY (see docs/DEPLOYMENT.md).' },
        );
      }

      const header = (() => {
        try {
          return decodeProtectedHeader(token);
        } catch {
          return undefined;
        }
      })();

      if (!header) throw unauthorized('Malformed session token.');

      if (header.alg === 'HS256' && env.supabaseJwtSecret) {
        try {
          const { payload } = await jwtVerify(token, new TextEncoder().encode(env.supabaseJwtSecret), {
            issuer: `${env.supabaseUrl}/auth/v1`,
          });
          return claimsFromPayload(payload);
        } catch (error) {
          logger.warn('hs256 token verification failed', { reason: (error as Error).message });
          throw unauthorized('Session expired or invalid. Please sign in again.');
        }
      }

      try {
        const jwks = createRemoteJWKSet(new URL(`${env.supabaseUrl}/auth/v1/.well-known/jwks.json`));
        const { payload } = await jwtVerify(token, jwks, {
          issuer: `${env.supabaseUrl}/auth/v1`,
        });
        return claimsFromPayload(payload);
      } catch (error) {
        logger.warn('jwks verification failed, falling back to auth server check', {
          reason: (error as Error).message,
        });
        return verifyWithSupabaseAuthServer(token);
      }
    },
  };
}

function bearerToken(req: Request): string | null {
  const header = req.header('authorization') || req.header('Authorization');
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
  return token.trim();
}

export interface AuthDeps {
  prisma: Db;
  verifier: AuthVerifier;
}

async function resolveProfile(prisma: Db, claims: AuthClaims): Promise<UserProfile> {
  const data = {
    email: claims.email ?? null,
    fullName: claims.name ?? null,
    signInProvider: claims.provider ?? null,
  };
  return prisma.userProfile.upsert({
    where: { authUserId: claims.sub },
    update: { email: data.email, fullName: data.fullName ?? undefined, signInProvider: data.signInProvider ?? undefined },
    create: { authUserId: claims.sub, ...data },
  });
}

export function createAuthMiddleware({ prisma, verifier }: AuthDeps) {
  const optionalAuth: RequestHandler = async (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) return next();
    try {
      const claims = await verifier.verify(token);
      if (!claims.sub) return next();
      const profile = await resolveProfile(prisma, claims);
      req.auth = { claims, profile };
      return next();
    } catch (error) {
      // Anonymous browsing must keep working even with a stale token.
      logger.debug('optional auth skipped', { reason: (error as Error).message });
      return next();
    }
  };

  const requireAuth: RequestHandler = async (req, _res, next) => {
    const token = bearerToken(req);
    if (!token) return next(unauthorized());
    try {
      const claims = await verifier.verify(token);
      if (!claims.sub) return next(unauthorized());
      if (claims.isAnonymous) {
        return next(forbidden('Anonymous sessions cannot access account data. Please sign in.'));
      }
      const profile = await resolveProfile(prisma, claims);
      req.auth = { claims, profile };
      return next();
    } catch (error) {
      return next(error);
    }
  };

  /**
   * Customer ordering requires Google sign-in (configurable through
   * REQUIRE_GOOGLE_FOR_ORDERS). Guest browsing and chat stay anonymous.
   */
  const requireCustomerForOrder: RequestHandler[] = [
    requireAuth,
    (req: Request, _res: Response, next: NextFunction) => {
      if (!env.requireGoogleForOrders) return next();
      const provider = req.auth?.claims.provider;
      if (provider !== 'google') {
        return next(
          new AppError(
            403,
            'GOOGLE_SIGN_IN_REQUIRED',
            'Please sign in with Google to place an order. Your cart is kept while you sign in.',
          ),
        );
      }
      return next();
    },
  ];

  return { optionalAuth, requireAuth, requireCustomerForOrder };
}
