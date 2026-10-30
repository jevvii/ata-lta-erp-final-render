/**
 * Client runtime bootstrap module.
 * Fetches public configuration from backend /v1/config/public (Supabase URL, anon key, and tenant entities),
 * registers tenant mappings, and dynamically configures the Supabase Realtime client.
 */

import { configureSupabase, isPublicSupabaseKey } from '@/lib/supabase';
import { API_BASE_URL } from '@/lib/api';
import { registerEntityMapping } from '@/lib/realtime/tenantResolver';

export async function bootstrapRuntimeConfig(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    const apiBase = API_BASE_URL;

    const cleanBase = apiBase.replace(/\/+$/, '');
    const endpoint = cleanBase.endsWith('/v1') ? `${cleanBase}/config/public` : `${cleanBase}/v1/config/public`;

    // Timeout of 2500ms prevents blocking React mount if network is degraded
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const res = await fetch(endpoint, {
      signal: controller.signal,
      cache: 'no-cache',
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const body = await res.json();
      const config = body?.data;

      if (config?.supabaseUrl && isPublicSupabaseKey(config?.supabaseAnonKey)) {
        sessionStorage.setItem('erp_supabase_anon_key', config.supabaseAnonKey);
        localStorage.setItem('erp_supabase_anon_key', config.supabaseAnonKey);

        const targetUrl = config.supabaseUrl;
        configureSupabase(targetUrl, config.supabaseAnonKey);
      }

      if (config?.supabaseUrl) {
        sessionStorage.setItem('erp_supabase_url', config.supabaseUrl);
        localStorage.setItem('erp_supabase_url', config.supabaseUrl);
      }

      if (Array.isArray(config?.entities)) {
        for (const ent of config.entities) {
          if (ent?.code && ent?.id) {
            registerEntityMapping(ent.code, ent.id);
          }
        }
      }
    }
  } catch (err) {
    // Non-fatal: offline dev or test mode will fall back safely
    console.warn('[Bootstrap] Runtime config bootstrap warning:', err);
  }
}
