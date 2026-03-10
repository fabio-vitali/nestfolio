import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { generateClient } from 'aws-amplify/api';

@Injectable({ providedIn: 'root' })
export class GraphqlService {
  private client: any = null;

  private getClient(): any {
    if (!this.client) {
      this.client = generateClient();
    }
    return this.client;
  }

  async query<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
    const result = await this.getClient().graphql({
      query: statement,
      variables: variables ?? {},
    });
    if (result.errors?.length) {
      const error = new Error(result.errors[0].message);
      (error as any).graphqlErrors = result.errors;
      throw error;
    }
    return result.data as T;
  }

  async mutate<T>(statement: string, variables?: Record<string, unknown>): Promise<T> {
    return this.query<T>(statement, variables);
  }

  subscribe<T>(statement: string, variables?: Record<string, unknown>): Observable<T> {
    return new Observable<T>((subscriber) => {
      const sub = this.getClient()
        .graphql({ query: statement, variables: variables ?? {} })
        .subscribe({
          next: ({ data }: { data: T }) => subscriber.next(data),
          error: (err: unknown) => subscriber.error(err),
        });
      return () => sub.unsubscribe();
    });
  }

  resetClient(): void {
    this.client = null;
  }
}
