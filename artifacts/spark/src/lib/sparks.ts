import { supabase } from '@/lib/supabase';
import { clockOffsetFrom, normalizeMatch, scalar, type ChatMessage, type MatchRow } from '@/lib/spark-utils';

type DbError = { message: string; code?: string };

/** Logs the real error and throws an Error that keeps the server's message and code. */
const fail = (what: string, error: DbError): Error => {
  console.error(`${what} failed:`, error);
  return Object.assign(new Error(error.message), { code: error.code });
};

/** rpc('my_matches'): rows stay in the order the server returns them (soonest expiry first). */
export async function fetchMatches(): Promise<{ rows: MatchRow[]; offset: number | null }> {
  const sentAt = Date.now();
  const { data, error } = await supabase.rpc('my_matches');
  const receivedAt = Date.now();
  if (error) throw fail('my_matches', error);
  const rows = (Array.isArray(data) ? data : []).map(normalizeMatch).filter((row) => row.match_id);
  const serverNow = rows.find((row) => row.server_now)?.server_now;
  return { rows, offset: clockOffsetFrom(serverNow, sentAt, receivedAt) };
}

export async function ackSevered(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('ack_severed', { p_match: matchId });
  if (error) throw fail('ack_severed', error);
}

export async function markRead(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_read', { p_match: matchId });
  if (error) throw fail('mark_read', error);
}

/** Returns 'kept' or 'waiting'. It never says whether the other person tapped. */
export async function tapConnection(matchId: string): Promise<'waiting' | 'kept'> {
  const { data, error } = await supabase.rpc('tap_connection', { p_match: matchId });
  if (error) throw fail('tap_connection', error);
  const result = scalar(data);
  if (result !== 'kept' && result !== 'waiting') console.error('tap_connection returned an unexpected value:', data);
  return result === 'kept' ? 'kept' : 'waiting';
}

/** Returns 'revealed' or 'waiting'. */
export async function shareContact(matchId: string, contact: string): Promise<'waiting' | 'revealed'> {
  const { data, error } = await supabase.rpc('share_contact', { p_match: matchId, p_contact: contact });
  if (error) throw fail('share_contact', error);
  const result = scalar(data);
  if (result !== 'revealed' && result !== 'waiting') console.error('share_contact returned an unexpected value:', data);
  return result === 'revealed' ? 'revealed' : 'waiting';
}

export async function getMatchContact(matchId: string): Promise<unknown> {
  const { data, error } = await supabase.rpc('get_match_contact', { p_match: matchId });
  if (error) throw fail('get_match_contact', error);
  return data;
}

export async function unmatch(matchId: string): Promise<void> {
  const { error } = await supabase.rpc('unmatch', { p_match: matchId });
  if (error) throw fail('unmatch', error);
}

export async function blockUser(targetId: string): Promise<void> {
  const { error } = await supabase.rpc('block_user', { p_target: targetId });
  if (error) throw fail('block_user', error);
}

export type ReportReason = 'fake' | 'underage' | 'harassment' | 'nudity' | 'scam' | 'other';

export async function reportUser(input: { target: string; reason: ReportReason; details: string; match: string }): Promise<void> {
  const { error } = await supabase.rpc('report_user', {
    p_target: input.target,
    p_reason: input.reason,
    p_details: input.details,
    p_match: input.match,
  });
  if (error) throw fail('report_user', error);
}

export async function fetchMessages(matchId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase.from('messages').select('*').eq('match_id', matchId).order('created_at', { ascending: true });
  if (error) throw fail('Loading messages', error);
  return (data ?? []) as ChatMessage[];
}

/** The server refuses this once the window has closed; callers check the error code and message. */
export async function sendMessage(matchId: string, senderId: string, body: string): Promise<ChatMessage> {
  const { data, error } = await supabase
    .from('messages')
    .insert({ match_id: matchId, sender_id: senderId, body, kind: 'text' })
    .select()
    .single();
  if (error) throw fail('Sending message', error);
  return data as ChatMessage;
}
