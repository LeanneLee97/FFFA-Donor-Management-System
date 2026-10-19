import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Staff } from '../../shared/types.ts';
import type { Db } from '../db.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      staff?: Staff;
    }
  }
}

/** Works out which staff member is making the request, or null if nobody valid is signed in. */
export type StaffResolver = (req: Request) => Promise<Staff | null>;

/** Every /api route except health goes through this (design section 8). */
export function requireStaff(resolve: StaffResolver): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const staff = await resolve(req);
      if (!staff) return res.status(401).json({ error: 'Sign in required', code: 'UNAUTHENTICATED' });
      if (!staff.active) return res.status(403).json({ error: 'Account disabled', code: 'FORBIDDEN' });
      req.staff = staff;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireAdmin: RequestHandler = (req, res, next) => {
  if (req.staff?.role !== 'admin') return res.status(403).json({ error: 'Admins only', code: 'FORBIDDEN' });
  next();
};

/**
 * Local development only (AUTH_MODE=dev): everyone is signed in as one dev admin,
 * created on first use. Never enable this in a deployed environment.
 */
export function devStaffResolver(db: Db, email = 'dev.admin@fffa.test'): StaffResolver {
  let cached: Staff | null = null;
  return async () => {
    if (cached) return cached;
    const [staff] = await db.query<Staff>(
      `insert into staff (name, email, role) values ('Dev Admin', $1, 'admin')
       on conflict (email) do update set email = excluded.email
       returning id, name, email, role, active`,
      [email],
    );
    cached = staff;
    return staff;
  };
}

/**
 * Production (AUTH_MODE=supabase). Owner: Chris (design section 10).
 * Verify the Supabase access token from the Authorization header, then look the user up
 * in `staff` by id and return them (or null if missing/invalid).
 */
export function supabaseStaffResolver(_db: Db): StaffResolver {
  return async () => {
    throw new Error('Supabase auth not implemented yet (Chris). Use AUTH_MODE=dev locally.');
  };
}
