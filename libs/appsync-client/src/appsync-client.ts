import { generateClient } from 'aws-amplify/api';

export interface GraphQLResult<T> {
  data: T;
  errors?: Array<{ message: string }>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: any = null;

function getClient() {
  if (!client) {
    client = generateClient();
  }
  return client;
}

export async function query<T = unknown>(
  statement: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const c = getClient();
  const result = await c.graphql({
    query: statement,
    variables: variables ?? {},
  }) as GraphQLResult<T>;

  if (result.errors && result.errors.length > 0) {
    const err = new Error(`GraphQL query error: ${result.errors[0].message}`);
    (err as Error & { graphqlErrors: Array<{ message: string }> }).graphqlErrors = result.errors;
    throw err;
  }

  return result.data;
}

export async function mutate<T = unknown>(
  statement: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const c = getClient();
  const result = await c.graphql({
    query: statement,
    variables: variables ?? {},
  }) as GraphQLResult<T>;

  if (result.errors && result.errors.length > 0) {
    const err = new Error(`GraphQL mutation error: ${result.errors[0].message}`);
    (err as Error & { graphqlErrors: Array<{ message: string }> }).graphqlErrors = result.errors;
    throw err;
  }

  return result.data;
}

export function subscribe<T = unknown>(
  statement: string,
  variables?: Record<string, unknown>,
) {
  const c = getClient();
  return (c.graphql({
    query: statement,
    variables: variables ?? {},
  }) as unknown as { subscribe: (handlers: { next: (value: { data: T }) => void; error: (error: unknown) => void }) => { unsubscribe: () => void } });
}

export function resetClient(): void {
  client = null;
}
