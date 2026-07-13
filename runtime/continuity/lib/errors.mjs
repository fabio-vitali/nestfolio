export class ContinuityError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ContinuityError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details = {}) {
  throw new ContinuityError(code, message, details);
}

export function asErrorPayload(error) {
  if (error instanceof ContinuityError) {
    return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
  }
  return {
    ok: false,
    error: {
      code: 'UNEXPECTED_ERROR',
      message: error?.message ?? String(error),
      details: {},
    },
  };
}
