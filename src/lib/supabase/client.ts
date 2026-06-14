'use client';

import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null | undefined;

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return {
    url,
    publishableKey,
    configured: Boolean(url && publishableKey),
  };
}

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;

  const { url, publishableKey, configured } = getSupabaseConfig();
  if (!configured || !url || !publishableKey) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createSupabaseClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  return browserClient;
}
