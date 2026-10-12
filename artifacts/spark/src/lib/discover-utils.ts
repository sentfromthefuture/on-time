// Pure helpers for the Discovery page. No Supabase import so they are easy to test.
import type { SparkProfile } from '@/lib/supabase';
import { ageFromDate } from '@/lib/profile';

export type DiscoverFilters = {
  maxKm: number;
  minAge: number;
  maxAge: number;
  genders: string[];
  sharedOnly: boolean;
  verifiedOnly: boolean;
};

export const KM_MIN = 5;
export const KM_MAX = 200;
export const DEFAULT_KM = 50;
export const AGE_MIN = 18;
export const AGE_MAX = 99;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const numberOr = (value: unknown, fallback: number) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
};

export const interestedInOf = (profile: SparkProfile): string[] =>
  Array.isArray(profile.interested_in)
    ? profile.interested_in.map((item) => String(item).toLowerCase())
    : profile.interested_in ? [String(profile.interested_in).toLowerCase()] : [];

/** What the filters look like when nothing has been narrowed: the person's saved preferences. */
export function defaultFilters(profile: SparkProfile): DiscoverFilters {
  return clampFilters({
    maxKm: DEFAULT_KM,
    minAge: numberOr(profile.min_age, 22),
    maxAge: numberOr(profile.max_age, 36),
    genders: interestedInOf(profile),
    sharedOnly: false,
    verifiedOnly: false,
  });
}

export function clampFilters(filters: DiscoverFilters): DiscoverFilters {
  const minAge = clamp(Math.round(filters.minAge), AGE_MIN, AGE_MAX);
  const maxAge = clamp(Math.round(filters.maxAge), minAge, AGE_MAX);
  return {
    maxKm: clamp(Math.round(filters.maxKm / 5) * 5, KM_MIN, KM_MAX),
    minAge,
    maxAge,
    genders: Array.from(new Set(filters.genders.map((g) => g.toLowerCase()))),
    sharedOnly: filters.sharedOnly === true,
    verifiedOnly: filters.verifiedOnly === true,
  };
}

/** Returns a human message when the filters cannot be applied, otherwise null. */
export function validateFilters(filters: DiscoverFilters): string | null {
  if (!Number.isFinite(filters.maxKm) || filters.maxKm < KM_MIN || filters.maxKm > KM_MAX) return `Choose a distance between ${KM_MIN} and ${KM_MAX} km.`;
  if (!Number.isFinite(filters.minAge) || !Number.isFinite(filters.maxAge) || filters.minAge < AGE_MIN) return `Ages start at ${AGE_MIN}.`;
  if (filters.maxAge > AGE_MAX) return `The highest age is ${AGE_MAX}.`;
  if (filters.maxAge < filters.minAge) return 'The oldest age must be at least the youngest age.';
  if (filters.genders.length === 0) return 'Choose at least one group of people to see.';
  return null;
}

export const sameFilters = (a: DiscoverFilters, b: DiscoverFilters) =>
  a.maxKm === b.maxKm && a.minAge === b.minAge && a.maxAge === b.maxAge && a.sharedOnly === b.sharedOnly && a.verifiedOnly === b.verifiedOnly &&
  [...a.genders].sort().join('|') === [...b.genders].sort().join('|');

/** How many filters differ from the person's defaults (shown on the Filters button). */
export function activeFilterCount(filters: DiscoverFilters, defaults: DiscoverFilters): number {
  let count = 0;
  if (filters.maxKm !== DEFAULT_KM) count++;
  if (filters.minAge !== defaults.minAge || filters.maxAge !== defaults.maxAge) count++;
  if ([...filters.genders].sort().join('|') !== [...defaults.genders].sort().join('|')) count++;
  if (filters.sharedOnly) count++;
  if (filters.verifiedOnly) count++;
  return count;
}

export const personAge = (person: SparkProfile): number | undefined => {
  if (typeof person.age === 'number' && person.age > 0) return person.age;
  return ageFromDate(typeof person.birthdate === 'string' ? person.birthdate : undefined);
};

const interestList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []);

/** Interests both people listed, using their own wording, ignoring case. */
export function sharedInterests(mine: unknown, theirs: unknown): string[] {
  const mineSet = new Set(interestList(mine).map((item) => item.trim().toLowerCase()));
  if (mineSet.size === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of interestList(theirs)) {
    const key = item.trim().toLowerCase();
    if (mineSet.has(key) && !seen.has(key)) { seen.add(key); out.push(item.trim()); }
  }
  return out;
}

export function joinNatural(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "You both enjoy Cooking and Live music." Only built from real shared interests. */
export function contextLine(shared: string[]): string | null {
  if (shared.length === 0) return null;
  const shown = shared.slice(0, 3);
  const extra = shared.length - shown.length;
  return `You both enjoy ${joinNatural(shown)}${extra > 0 ? ` and ${extra} more` : ''}.`;
}

/** Client-side narrowing for things the discover RPC does not filter itself. Unknown data never hides someone. */
export function passesFilters(person: SparkProfile, filters: DiscoverFilters, myInterests: unknown): boolean {
  const age = personAge(person);
  if (age !== undefined && (age < filters.minAge || age > filters.maxAge)) return false;
  if (filters.genders.length > 0 && typeof person.gender === 'string' && person.gender) {
    if (!filters.genders.includes(person.gender.toLowerCase())) return false;
  }
  if (filters.sharedOnly && interestList(myInterests).length > 0 && sharedInterests(myInterests, person.interests).length === 0) return false;
  if (filters.verifiedOnly && person.verified !== true) return false;
  return true;
}

export const isVerified = (person: SparkProfile) => person.verified === true;

export function photosOf(person: SparkProfile): string[] {
  return Array.isArray(person.photos) ? person.photos.filter((photo): photo is string => typeof photo === 'string' && photo !== '') : [];
}

/** Prompt answers, if the profile came with any in a recognisable shape. */
export function promptsOf(person: SparkProfile): { question: string; answer: string }[] {
  if (!Array.isArray(person.prompts)) return [];
  const out: { question: string; answer: string }[] = [];
  for (const item of person.prompts) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const question = [record.question, record.prompt, record.title].find((v): v is string => typeof v === 'string' && v !== '');
    const answer = [record.answer, record.response, record.text].find((v): v is string => typeof v === 'string' && v !== '');
    if (question && answer) out.push({ question, answer });
  }
  return out;
}

export function distanceText(km: unknown): string | null {
  if (typeof km !== 'number' || !Number.isFinite(km) || km < 0) return null;
  return km < 0.1 ? 'Nearby' : `${km.toFixed(1)} km away`;
}

// Extra preferences that are not stored on the profile live on this device.
const storageKey = (userId: string) => `spark.discover.filters.${userId}`;

export function loadStoredFilters(userId: string): Partial<DiscoverFilters> {
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Partial<DiscoverFilters> = {};
    if (typeof parsed.maxKm === 'number') out.maxKm = parsed.maxKm;
    if (typeof parsed.sharedOnly === 'boolean') out.sharedOnly = parsed.sharedOnly;
    if (typeof parsed.verifiedOnly === 'boolean') out.verifiedOnly = parsed.verifiedOnly;
    return out;
  } catch (error) {
    console.error('Could not read saved discovery filters:', error);
    return {};
  }
}

export function saveStoredFilters(userId: string, filters: DiscoverFilters): void {
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify({ maxKm: filters.maxKm, sharedOnly: filters.sharedOnly, verifiedOnly: filters.verifiedOnly }));
  } catch (error) {
    console.error('Could not save discovery filters:', error);
  }
}

/** Starting filters: the profile's saved preferences plus whatever this device remembers. */
export function initialFilters(profile: SparkProfile, userId: string): DiscoverFilters {
  const base = defaultFilters(profile);
  const stored = loadStoredFilters(userId);
  const profileKm = numberOr(profile.max_km, DEFAULT_KM);
  return clampFilters({ ...base, maxKm: stored.maxKm ?? profileKm, sharedOnly: stored.sharedOnly ?? false, verifiedOnly: stored.verifiedOnly ?? false });
}
