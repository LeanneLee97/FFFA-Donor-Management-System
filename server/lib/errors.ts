/** An error with an HTTP status and a stable code, turned into `{ error, code }` by the app's error handler. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
