import type { UserProfile } from '@prisma/client';
import type { AuthClaims } from '../middleware/auth';

declare global {
  namespace Express {
    interface Request {
      auth?: { claims: AuthClaims; profile: UserProfile };
    }
  }
}

export {};
