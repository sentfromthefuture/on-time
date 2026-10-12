import type { SparkProfile } from '@/lib/supabase';

export type MatchPopup = { person?: SparkProfile; expires?: string; matchId?: string };

export const errorText = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' && (error as { message: string }).message) {
    return (error as { message: string }).message;
  }
  return 'Something went wrong. Please try again.';
};

export const matchIdOf = (record: Record<string, unknown>) =>
  (typeof record.match_id === 'string' ? record.match_id : typeof record.id === 'string' ? record.id : undefined);

export const vibrate = (pattern: number | number[] = 14) => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch { /* haptics are optional */ }
};
