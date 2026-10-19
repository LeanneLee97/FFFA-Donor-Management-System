import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Express 4 doesn't catch rejected promises; this forwards them to the error handler. Use on every async route. */
export function asyncRoute(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}
