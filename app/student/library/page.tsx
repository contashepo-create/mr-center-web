'use client';

import { useEffect, useState } from 'react';
import { Badge, Card, EmptyState, ErrorNotice, PageHeader } from '@/components/ui';
import { HonorBoard } from '@/components/honor-board';
import { useSession } from '@/context/session';
import { fetchHonorees, fetchImportantLinks, fetchSharedFiles, type Honoree, type ImportantLink, type SharedFile } from '@/lib/api';
import { formatDate } from '@/lib/utils';

export default function StudentLibraryPage() {
  const { profile } = useSession();
  const [honors, setHonors] = useState<Honoree[]>([]);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [links, setLinks] = useState<ImportantLink[]>([]);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => { if (profile?.center_id) Promise.all([fetchHonorees(profile.center_id), fetchSharedFiles(profile.center_id), fetchImportantLinks(profile.center_id)]).then(([h, f, l]) => { setHonors(h); setFiles(f); setLinks(l); }).catch(setError); }, [profile?.center_id]);
  return <><PageHeader title="المكتبة ولوحة الشرف" subtitle="ملفات وروابط وتكريمات السنتر." /><ErrorNotice error={error} /><div className="grid grid-3"><Card className="stack"><div className="row-between"><h2 className="h3">لوحة الشرف</h2><Badge tone="warn">{honors.length}</Badge></div><HonorBoard honors={honors} highlightName={profile?.full_name ?? null} highlightStudentId={profile?.student_id ?? null} /></Card><Card className="stack"><div className="row-between"><h2 className="h3">الملفات</h2><Badge tone="info">{files.length}</Badge></div>{files.length === 0 ? <EmptyState title="لا توجد ملفات" /> : files.map((f) => <a key={f.id} className="card compact soft" href={f.file_url ?? '#'} target="_blank"><strong>{f.name}</strong><div className="tiny muted">{formatDate(f.created_at)}</div></a>)}</Card><Card className="stack"><div className="row-between"><h2 className="h3">الروابط</h2><Badge tone="info">{links.length}</Badge></div>{links.length === 0 ? <EmptyState title="لا توجد روابط" /> : links.map((l) => <a key={l.id} className="card compact soft" href={l.url ?? '#'} target="_blank"><strong>{l.name}</strong><div className="tiny muted">{formatDate(l.created_at)}</div></a>)}</Card></div></>;
}
