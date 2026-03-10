interface GraphQLError {
  readonly errorType?: string;
  readonly message: string;
}

interface GraphQLErrorResponse {
  readonly errors: readonly GraphQLError[];
}

export function isGraphQLErrorResponse(e: unknown): e is GraphQLErrorResponse {
  return (
    typeof e === 'object' &&
    e !== null &&
    'errors' in e &&
    Array.isArray((e as any).errors) &&
    (e as any).errors.length > 0
  );
}

const ERROR_TYPE_MAP: Record<string, string> = {
  Unauthorized: 'errors.unauthorized',
  ValidationError: 'errors.validation',
  ConditionalCheckFailedException: 'errors.conflict',
  ThrottlingException: 'errors.throttled',
};

export function parseError(error: unknown, fallbackKey = 'errors.unexpected'): string {
  if (isGraphQLErrorResponse(error)) {
    const { errorType, message } = error.errors[0];
    if (errorType && ERROR_TYPE_MAP[errorType]) {
      return ERROR_TYPE_MAP[errorType];
    }
    return message || fallbackKey;
  }
  if (error instanceof Error) return error.message;
  return fallbackKey;
}
