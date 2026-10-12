import { supabase, type SparkProfile } from '@/lib/supabase';

export const genderOptions = ['man', 'woman', 'nonbinary', 'other'];

// Always hand Supabase a real array, never a JSON string such as "[]".
export const asArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* not JSON, fall through */ }
  }
  return [];
};

export const ageFromDate = (value?: string) => {
  if (!value) return undefined;
  const born = new Date(`${value}T00:00:00`);
  const now = new Date();
  return now.getFullYear() - born.getFullYear() - (now < new Date(now.getFullYear(), born.getMonth(), born.getDate()) ? 1 : 0);
};

export type ProfileDraft = {
  name: string;
  birthdate: string;
  gender: string;
  interestedIn: string[];
  bio: string;
  photos: string[];
  interests: string[];
  vibe: string;
  minAge: number;
  maxAge: number;
  prompts: unknown[];
};

export const blankDraft: ProfileDraft = {
  name: '', birthdate: '', gender: '', interestedIn: [], bio: '', photos: [], interests: [],
  vibe: '', minAge: 22, maxAge: 36, prompts: [],
};

export function draftFromProfile(profile?: SparkProfile | null): ProfileDraft {
  if (!profile) return blankDraft;
  return {
    ...blankDraft,
    name: String(profile.name || ''),
    birthdate: String(profile.birthdate || ''),
    gender: String(profile.gender || ''),
    interestedIn: Array.isArray(profile.interested_in)
      ? profile.interested_in.map(String)
      : profile.interested_in ? [String(profile.interested_in)] : [],
    bio: String(profile.bio || ''),
    photos: Array.isArray(profile.photos) ? profile.photos.map(String) : [],
    interests: Array.isArray(profile.interests) ? profile.interests.map(String) : [],
    vibe: String(profile.vibe || ''),
    minAge: Number(profile.min_age || 22),
    maxAge: Number(profile.max_age || 36),
    prompts: asArray(profile.prompts),
  };
}

/** Saves a full profile through upsert_my_profile. Throws the real Supabase error. */
export async function upsertProfile(draft: ProfileDraft): Promise<void> {
  const { error } = await supabase.rpc('upsert_my_profile', {
    p_name: draft.name.trim(),
    p_birthdate: draft.birthdate,
    p_gender: draft.gender,
    p_interested_in: draft.interestedIn,
    p_bio: draft.bio.slice(0, 500),
    p_photos: draft.photos,
    p_interests: draft.interests,
    p_vibe: draft.vibe || null,
    p_min_age: draft.minAge,
    p_max_age: draft.maxAge,
    p_prompts: asArray(draft.prompts),
  });
  if (error) throw error;
}
