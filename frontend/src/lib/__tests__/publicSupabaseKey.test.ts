import { afterEach, expect, it } from 'vitest';
import { getStoredAnonKey, isPublicSupabaseKey } from '../supabase';

const jwt = (role: string) => `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.signature`;
afterEach(() => { localStorage.clear(); sessionStorage.clear(); });

it.each(['sb_publishable_test', jwt('anon')])('accepts browser-safe key %s', (key) => {
  expect(isPublicSupabaseKey(key)).toBe(true);
});
it.each(['sb_secret_test', jwt('service_role'), '', 'malformed', undefined])('rejects non-public key %s', (key) => {
  expect(isPublicSupabaseKey(key)).toBe(false);
});
it('purges an old service-role JWT from browser storage', () => {
  localStorage.setItem('erp_supabase_anon_key', jwt('service_role'));
  sessionStorage.setItem('erp_supabase_anon_key', jwt('service_role'));
  expect(getStoredAnonKey()).toBe('');
  expect(localStorage.getItem('erp_supabase_anon_key')).toBeNull();
  expect(sessionStorage.getItem('erp_supabase_anon_key')).toBeNull();
});
