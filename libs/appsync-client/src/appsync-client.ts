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
  });
  return (result as GraphQLResult<T>).data;
}

export async function mutate<T = unknown>(
  statement: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const c = getClient();
  const result = await c.graphql({
    query: statement,
    variables: variables ?? {},
  });
  return (result as GraphQLResult<T>).data;
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
