export interface UserProfile {
  userId: string;
  username: string;
  email: string;
  tenantId: string;
  name?: string;
  onboardingCompletedAt?: string | null;
}

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  plan: 'free' | 'premium';
}

export type AuthStatus = 'unknown' | 'authenticated' | 'unauthenticated';
export type ThemeMode = 'light' | 'dark';
export type Locale = 'en-GB' | 'it-IT';
