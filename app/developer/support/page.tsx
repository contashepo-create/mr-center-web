'use client';

import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, Select, Textarea } from '@/components/ui';
import { devFetchCenters, devFetchSupportMessages, devSendSupportMessage, type CenterWithSub } from '@/lib/api';
import type { SupportMessage } from '@/lib/types';
import { formatDate } from '@/lib/utils';

export default function DeveloperSupportPage() {
  const [centers, setCenters] = useState<CenterWithSub[]>([]);
  const [rows, setRows] = useState<SupportMessage[]>([]);
  const [centerId, setCenterId] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<unknown>(null);
  const centerName = useMemo(() => new Map(centers.map((c) => [c.id, c.name])), [centers]);
  const visible = centerId ? rows.filter((r) => r.center_id === centerId) : rows;
  const load = async () => { try { const [c, m] = await Promise.all([devFetchCenters(), devFetchSupportMessages()]); setCenters(c); setRows(m); if (!centerId && c[0]) setCenterId(c[0].id); } catch (err) { setError(err); } };
  useEffect(() => { void load(); }, []);
  const send = async (e: React.FormEvent) => { e.preventDefault(); if (!centerId || !body.trim()) return; try { await devSendSupportMessage(centerId, body); setBody(''); await load(); } catch (err) { setError(err); } };
  return <><PageHeader title="دعم العملاء" subtitle="متابعة رسائل السناتر والرد عليها." /><ErrorNotice error={error} /><div className="grid grid-2"><Card className="stack"><Select label="السنتر" value={centerId} onChange={(e) => setCenterId(e.target.value)}>{centers.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.code}</option>)}</Select><form className="stack" onSubmit={send}><Textarea label="رد المطور" value={body} onChange={(e) => setBody(e.target.value)} /><Button type="submit">إرسال الرد</Button></form></Card><Card className="stack"><div className="row-between"><h2 className="h3">المحادثة</h2><Badge tone="info">{visible.length}</Badge></div>{visible.length === 0 ? <EmptyState title="لا توجد رسائل" /> : visible.map((m) => <div key={m.id} className="card compact soft"><div className="row-between"><strong>{m.sender_name || centerName.get(m.center_id) || '—'}</strong><Badge tone={m.sender_role === 'developer' ? 'info' : 'success'}>{m.sender_role === 'developer' ? 'المطور' : 'السنتر'}</Badge></div><p className="muted small">{m.body}</p><span className="tiny muted">{formatDate(m.created_at)}</span></div>)}</Card></div></>;
}
