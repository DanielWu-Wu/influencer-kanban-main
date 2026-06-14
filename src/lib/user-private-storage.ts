import type { SupabaseClient } from '@supabase/supabase-js';

export async function setUserSecret(
  supabase: SupabaseClient,
  key: string,
  value: unknown,
) {
  const { error } = await supabase.rpc('set_user_secret', {
    p_key: key,
    p_value: JSON.stringify(value),
  });
  if (error) throw error;
}

export async function getUserSecret<T>(
  supabase: SupabaseClient,
  key: string,
): Promise<T | null> {
  const { data, error } = await supabase.rpc('get_user_secret', { p_key: key });
  if (error) throw error;
  if (!data || typeof data !== 'string') return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return data as T;
  }
}

export async function deleteUserSecret(supabase: SupabaseClient, key: string) {
  const { error } = await supabase.rpc('delete_user_secret', { p_key: key });
  if (error) throw error;
}
