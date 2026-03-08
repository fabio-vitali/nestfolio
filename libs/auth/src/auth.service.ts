import { signIn, signUp, confirmSignUp, signOut, fetchAuthSession, getCurrentUser } from 'aws-amplify/auth';

export interface AuthTokens {
  idToken: string;
  accessToken: string;
}

export interface AuthUser {
  userId: string;
  username: string;
  email?: string;
  tenantId?: string;
}

export interface SignUpInput {
  username: string;
  password: string;
  email: string;
  name: string;
  age: string;
}

export async function authSignIn(username: string, password: string): Promise<{ isSignedIn: boolean; nextStep?: string }> {
  const result = await signIn({ username, password });
  return {
    isSignedIn: result.isSignedIn,
    nextStep: result.nextStep?.signInStep,
  };
}

export async function authSignUp(input: SignUpInput): Promise<{ isSignUpComplete: boolean; nextStep?: string }> {
  const result = await signUp({
    username: input.username,
    password: input.password,
    options: {
      userAttributes: {
        email: input.email,
        name: input.name,
        'custom:age': input.age,
      },
    },
  });
  return {
    isSignUpComplete: result.isSignUpComplete,
    nextStep: result.nextStep?.signUpStep,
  };
}

export async function authConfirmSignUp(username: string, confirmationCode: string): Promise<{ isSignUpComplete: boolean }> {
  const result = await confirmSignUp({ username, confirmationCode });
  return { isSignUpComplete: result.isSignUpComplete };
}

export async function authSignOut(): Promise<void> {
  await signOut();
}

export async function getAuthSession(): Promise<AuthTokens | null> {
  try {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken?.toString();
    const accessToken = session.tokens?.accessToken?.toString();
    if (!idToken || !accessToken) return null;
    return { idToken, accessToken };
  } catch {
    return null;
  }
}

export async function forceRefreshSession(): Promise<AuthTokens | null> {
  try {
    const session = await fetchAuthSession({ forceRefresh: true });
    const idToken = session.tokens?.idToken?.toString();
    const accessToken = session.tokens?.accessToken?.toString();
    if (!idToken || !accessToken) return null;
    return { idToken, accessToken };
  } catch {
    return null;
  }
}

export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const user = await getCurrentUser();
    const session = await fetchAuthSession();
    const claims = session.tokens?.idToken?.payload;
    return {
      userId: user.userId,
      username: user.username,
      email: claims?.['email'] as string | undefined,
      tenantId: claims?.['custom:tenant_id'] as string | undefined,
    };
  } catch {
    return null;
  }
}

export async function isAuthenticated(): Promise<boolean> {
  try {
    await getCurrentUser();
    return true;
  } catch {
    return false;
  }
}
