// ============================================================
// قسم الشكاوي العام: متاح للزوار بلا تسجيل، محمي خادمياً بحد
// محاولات، آمن من الحقن (كل الإدخال عبر معاملات RPC)، ويُتتبع
// برقم الهاتف ورقم الشكوى.
// ============================================================

import { getSupabase } from './supabase';
import { getDeviceId } from './visitors';

export interface ComplaintLookup {
  found: boolean;
  ticket_no?: string;
  subject?: string;
  status?: string;
  created_at?: string;
}

export async function submitComplaint(input: {
  phone: string; name: string; subject: string; body: string;
}): Promise<string> {
  const device = typeof window !== 'undefined' ? getDeviceId() : '';
  const { data, error } = await getSupabase().rpc('submit_complaint', {
    p_phone: input.phone.trim(),
    p_name: input.name.trim(),
    p_subject: input.subject.trim(),
    p_body: input.body.trim(),
    p_device: device || '',
  });
  if (error) throw error;
  return (data as { ticket_no?: string } | null)?.ticket_no ?? '';
}

export async function lookupComplaint(phone: string, ticket: string): Promise<ComplaintLookup> {
  const { data, error } = await getSupabase().rpc('lookup_complaint', {
    p_phone: phone.trim(),
    p_ticket: ticket.trim(),
  });
  if (error) throw error;
  return ((data ?? { found: false }) as ComplaintLookup);
}
