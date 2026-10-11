// Pure helpers for the Spark Window (part 2). No Supabase import here so they are easy to test.

export type MatchStatus = 'active' | 'kept' | 'severed';

export type MatchRow = {
  match_id: string;
  user_id: string;
  display_name: string;
  age: number | null;
  photos: string[];
  distance_km: number | null;
  matched_at: string;
  status: MatchStatus;
  expires_at: string;
  extended: boolean;
  kept_via: string | null;
  i_tapped: boolean;
  i_shared_contact: boolean;
  last_message: string | null;
  last_message_at: string | null;
  unread: number;
  server_now: string | null;
};

export type ChatMessage = {
  id: string | number;
  match_id: string;
  sender_id: string;
  body: string;
  kind?: string | null;
  created_at: string;
};

export const HOUR = 3_600_000;
export const DEFAULT_WINDOW_MS = 24 * HOUR;

export const messageOf = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string' && (error as { message: string }).message) {
    return (error as { message: string }).message;
  }
  return 'Something went wrong. Please try again.';
};

export const normalizeStatus = (value: unknown): MatchStatus | undefined => {
  if (typeof value !== 'string') return undefined;
  const status = value.trim().toLowerCase();
  return status === 'active' || status === 'kept' || status === 'severed' ? status : undefined;
};

const asString = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);
const asNumber = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
};

/** Turns one row of rpc('my_matches') into a predictable shape. Order is never changed by callers. */
export function normalizeMatch(raw: unknown): MatchRow {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    match_id: String(row.match_id ?? row.id ?? ''),
    user_id: String(row.user_id ?? ''),
    display_name: asString(row.display_name) ?? 'Someone',
    age: asNumber(row.age),
    photos: Array.isArray(row.photos) ? row.photos.filter((photo): photo is string => typeof photo === 'string') : [],
    distance_km: asNumber(row.distance_km),
    matched_at: asString(row.matched_at) ?? '',
    status: normalizeStatus(row.status) ?? 'active',
    expires_at: asString(row.expires_at) ?? '',
    extended: row.extended === true,
    kept_via: asString(row.kept_via),
    i_tapped: row.i_tapped === true,
    i_shared_contact: row.i_shared_contact === true,
    last_message: asString(row.last_message),
    last_message_at: asString(row.last_message_at),
    unread: asNumber(row.unread) ?? 0,
    server_now: asString(row.server_now),
  };
}

/**
 * clockOffset = serverNow - deviceNow. We compare against the midpoint of the request so network
 * latency does not skew the countdown. Returns null when the server gave no usable time.
 */
export function clockOffsetFrom(serverNowIso: string | null | undefined, sentAt: number, receivedAt: number): number | null {
  if (!serverNowIso) return null;
  const server = Date.parse(serverNowIso);
  if (!Number.isFinite(server)) return null;
  return server - (sentAt + receivedAt) / 2;
}

/** Milliseconds left, measured on the server clock (serverNow = Date.now() + clockOffset). */
export function msLeft(expiresAt: string, serverNow: number): number {
  const end = Date.parse(expiresAt);
  return Number.isFinite(end) ? end - serverNow : 0;
}

export type Tier = 'fresh' | 'steady' | 'amber' | 'orange' | 'red';

/** green >12h, (yellow-green 6-12h), amber <6h, orange <3h, red <1h. */
export function tierFor(ms: number): Tier {
  if (ms > 12 * HOUR) return 'fresh';
  if (ms > 6 * HOUR) return 'steady';
  if (ms > 3 * HOUR) return 'amber';
  if (ms > 1 * HOUR) return 'orange';
  return 'red';
}

export const TIER_COLOR: Record<Tier, string> = {
  fresh: '#4ade80',
  steady: '#bef264',
  amber: '#fbbf24',
  orange: '#fb923c',
  red: '#fb4668',
};

export const pulseFor = (tier: Tier): 'none' | 'soft' | 'fast' => (tier === 'orange' ? 'soft' : tier === 'red' ? 'fast' : 'none');

/** Share of the window still left (0 to 1). The window length comes from the server's own timestamps. */
export function ringFraction(left: number, matchedAt: string, expiresAt: string): number {
  const total = Date.parse(expiresAt) - Date.parse(matchedAt);
  const window = Number.isFinite(total) && total > 0 ? total : DEFAULT_WINDOW_MS;
  return Math.min(1, Math.max(0, left / window));
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Compact text for the ring: hours + minutes, then minutes, then live seconds in the last minute. */
export function ringText(ms: number): { big: string; small: string } {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours >= 1) return { big: `${hours}h`, small: `${minutes}m` };
  if (total >= 60) return { big: `${minutes}m`, small: 'left' };
  return { big: `${total}s`, small: 'left' };
}

/** HH:MM:SS for the big chat countdown. */
export function clockText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${pad(Math.floor(total / 3600))}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

export function speakLeft(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'} ${minutes} minute${minutes === 1 ? '' : 's'} left`;
  if (total >= 60) return `${minutes} minute${minutes === 1 ? '' : 's'} left`;
  return `${total} second${total === 1 ? '' : 's'} left`;
}

export function relativeTime(iso: string | null, serverNow: number): string {
  if (!iso) return '';
  const diff = serverNow - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Reads a scalar from an RPC result that may be 'waiting', ['waiting'], or { result: 'waiting' }. */
export function scalar(data: unknown): string {
  if (typeof data === 'string') return data.trim().replace(/^"|"$/g, '').toLowerCase();
  if (Array.isArray(data)) return data.length ? scalar(data[0]) : '';
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    for (const key of ['result', 'status', 'state', 'outcome']) {
      if (typeof record[key] === 'string') return scalar(record[key]);
    }
    const first = Object.values(record).find((value) => typeof value === 'string');
    return typeof first === 'string' ? scalar(first) : '';
  }
  return '';
}

export type Contacts = { mine?: string; theirs?: string };

const MINE_KEYS = ['my_contact', 'my_number', 'my_phone', 'mine', 'your_contact', 'your_number', 'your_phone'];
const THEIRS_KEYS = ['their_contact', 'their_number', 'their_phone', 'theirs', 'other_contact', 'other_number', 'other_phone', 'partner_contact', 'contact', 'phone', 'number'];

/** get_match_contact may return one object, one row per person, or a bare string. Be forgiving. */
export function normalizeContacts(data: unknown, myId?: string): Contacts {
  const out: Contacts = {};
  let input = data;
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { /* a plain number string */ }
  }
  const rows = Array.isArray(input) ? input : [input];
  for (const row of rows) {
    if (typeof row === 'string') { if (row && !out.theirs) out.theirs = row; continue; }
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const owner = record.user_id ?? record.owner_id ?? record.profile_id ?? record.shared_by;
    const value = record.contact ?? record.phone ?? record.number ?? record.contact_value;
    if (typeof owner === 'string' && typeof value === 'string' && value) {
      if (owner === myId) out.mine ??= value; else out.theirs ??= value;
      continue;
    }
    for (const key of MINE_KEYS) if (typeof record[key] === 'string' && record[key]) out.mine ??= record[key] as string;
    for (const key of THEIRS_KEYS) if (typeof record[key] === 'string' && record[key]) out.theirs ??= record[key] as string;
  }
  return out;
}

/** Digits only for wa.me. A Zambian local number (0977...) gets the 260 country code. */
export function whatsappDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return digits;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0') && digits.length === 10) return `260${digits.slice(1)}`;
  return digits;
}
export const whatsappLink = (raw: string) => `https://wa.me/${whatsappDigits(raw)}`;

/** Did the server reject a write because the window is closed? */
export function looksLikeClosedWindow(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === '42501') return true;
  return /clos|expir|sever|window|not active|inactive|ended|no longer|policy/i.test(error.message ?? '');
}

export const isNumbersKeep = (match: Pick<MatchRow, 'status' | 'kept_via'>) =>
  match.status === 'kept' && /number|contact|phone|swap/i.test(match.kept_via ?? '');

export const ICEBREAKERS = [
  'Two truths and a lie. You go first 😄',
  "What's the song you can't stop replaying?",
  'Best meal you had this month?',
  'Weekend plan: adventure or full chill?',
  'What made you swipe? Be honest 👀',
];

export const buzz = (pattern: number | number[] = 14) => {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch { /* haptics are optional */ }
};
