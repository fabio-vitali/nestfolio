import {
  authSignIn,
  authSignUp,
  authConfirmSignUp,
  authSignOut,
  getAuthSession,
  getAuthUser,
  isAuthenticated,
} from '../src/auth.service';

const mockSignIn = jest.fn();
const mockSignUp = jest.fn();
const mockConfirmSignUp = jest.fn();
const mockSignOut = jest.fn();
const mockFetchAuthSession = jest.fn();
const mockGetCurrentUser = jest.fn();

jest.mock('aws-amplify/auth', () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  signUp: (...args: unknown[]) => mockSignUp(...args),
  confirmSignUp: (...args: unknown[]) => mockConfirmSignUp(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  fetchAuthSession: (...args: unknown[]) => mockFetchAuthSession(...args),
  getCurrentUser: (...args: unknown[]) => mockGetCurrentUser(...args),
}));

beforeEach(() => jest.resetAllMocks());

describe('authSignIn', () => {
  it('returns isSignedIn and nextStep on success', async () => {
    mockSignIn.mockResolvedValue({
      isSignedIn: true,
      nextStep: { signInStep: 'DONE' },
    });

    const result = await authSignIn('user', 'pass');

    expect(result).toEqual({ isSignedIn: true, nextStep: 'DONE' });
    expect(mockSignIn).toHaveBeenCalledWith({ username: 'user', password: 'pass' });
  });

  it('propagates error on failure', async () => {
    mockSignIn.mockRejectedValue(new Error('Invalid credentials'));

    await expect(authSignIn('user', 'wrong')).rejects.toThrow('Invalid credentials');
  });
});

describe('authSignUp', () => {
  it('returns isSignUpComplete and nextStep', async () => {
    mockSignUp.mockResolvedValue({
      isSignUpComplete: false,
      nextStep: { signUpStep: 'CONFIRM_SIGN_UP' },
    });

    const result = await authSignUp({
      username: 'newuser',
      password: 'P@ss1234',
      email: 'new@example.com',
      name: 'New User',
      age: '30',
    });

    expect(result).toEqual({ isSignUpComplete: false, nextStep: 'CONFIRM_SIGN_UP' });
    expect(mockSignUp).toHaveBeenCalledWith({
      username: 'newuser',
      password: 'P@ss1234',
      options: {
        userAttributes: {
          email: 'new@example.com',
          name: 'New User',
          'custom:age': '30',
        },
      },
    });
  });
});

describe('authConfirmSignUp', () => {
  it('returns isSignUpComplete', async () => {
    mockConfirmSignUp.mockResolvedValue({ isSignUpComplete: true });

    const result = await authConfirmSignUp('newuser', '123456');

    expect(result).toEqual({ isSignUpComplete: true });
    expect(mockConfirmSignUp).toHaveBeenCalledWith({ username: 'newuser', confirmationCode: '123456' });
  });
});

describe('authSignOut', () => {
  it('calls signOut', async () => {
    mockSignOut.mockResolvedValue(undefined);

    await authSignOut();

    expect(mockSignOut).toHaveBeenCalled();
  });
});

describe('getAuthSession', () => {
  it('returns tokens when session is valid', async () => {
    mockFetchAuthSession.mockResolvedValue({
      tokens: {
        idToken: { toString: () => 'id-token-123' },
        accessToken: { toString: () => 'access-token-456' },
      },
    });

    const result = await getAuthSession();

    expect(result).toEqual({ idToken: 'id-token-123', accessToken: 'access-token-456' });
  });

  it('returns null when no tokens', async () => {
    mockFetchAuthSession.mockResolvedValue({ tokens: undefined });

    const result = await getAuthSession();

    expect(result).toBeNull();
  });

  it('returns null on error', async () => {
    mockFetchAuthSession.mockRejectedValue(new Error('Not authenticated'));

    const result = await getAuthSession();

    expect(result).toBeNull();
  });
});

describe('getAuthUser', () => {
  it('returns user with tenant from claims', async () => {
    mockGetCurrentUser.mockResolvedValue({ userId: 'uid-1', username: 'testuser' });
    mockFetchAuthSession.mockResolvedValue({
      tokens: {
        idToken: {
          payload: {
            email: 'test@example.com',
            'custom:tenant_id': 'tenant-abc',
          },
        },
      },
    });

    const result = await getAuthUser();

    expect(result).toEqual({
      userId: 'uid-1',
      username: 'testuser',
      email: 'test@example.com',
      tenantId: 'tenant-abc',
    });
  });

  it('returns null on error', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('Not authenticated'));

    const result = await getAuthUser();

    expect(result).toBeNull();
  });
});

describe('isAuthenticated', () => {
  it('returns true when user exists', async () => {
    mockGetCurrentUser.mockResolvedValue({ userId: 'uid-1' });

    expect(await isAuthenticated()).toBe(true);
  });

  it('returns false when not authenticated', async () => {
    mockGetCurrentUser.mockRejectedValue(new Error('Not authenticated'));

    expect(await isAuthenticated()).toBe(false);
  });
});
