import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '@/config';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

export type SparkProfile = {
  id: string;
  name: string;
  birthdate?: string;
  age?: number;
  gender?: string;
  interested_in?: string[] | string;
  bio?: string;
  photos?: string[];
  interests?: string[];
  vibe?: string;
  distance_km?: number | null;
  vibe_score?: number | null;
  liked_you?: boolean;
  [key: string]: unknown;
};

export function photoUrl(path?: string | null): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return supabase.storage.from('photos').getPublicUrl(path).data.publicUrl;
}
