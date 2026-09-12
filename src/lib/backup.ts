import { getSupabase } from './supabase';

const TABLES = [
  'grades', 'groups', 'students', 'dues', 'payments', 'sessions',
  'attendance', 'announcements', 'manual_grades', 'app_exams',
  'app_exam_attempts', 'app_inquiries', 'app_surveys',
  'app_survey_responses', 'honorees', 'shared_files',
  'important_links', 'center_settings', 'center_subscriptions',
  'subscription_requests', 'activity_log', 'student_groups', 'teacher_groups',
] as const;

/** يجمع كل صفوف السنتر من نفس 23 جدولاً التي يصدرها تطبيق Android. */
export async function gatherCenterBackup(centerId: string): Promise<Record<string, unknown[]>> {
  const sb = getSupabase();
  const out: Record<string, unknown[]> = {};
  const results = await Promise.all([
    sb.from('centers').select('*').eq('id', centerId).maybeSingle(),
    ...TABLES.map((table) => sb.from(table).select('*').eq('center_id', centerId).limit(5000)),
  ]);
  const [center, ...rest] = results;
  if (center.error) throw center.error;
  out.centers = center.data ? [center.data] : [];
  rest.forEach((result, i) => {
    if (result.error) throw result.error;
    out[TABLES[i]] = (result.data ?? []) as unknown[];
  });
  return out;
}

function safeFilePart(name: string): string {
  return name.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'center';
}

/**
 * نسخة الويب من exportCenterBackup: تنشئ ملف JSON وتدفع المتصفح لتحميله.
 * لا تستخدم أي أسرار ولا تكتب في قاعدة البيانات؛ القراءة كلها محكومة بـ RLS.
 */
export async function downloadCenterBackup(centerId: string, centerName: string, tag = 'web'): Promise<string> {
  const payload = {
    app: 'mr-center',
    tag,
    center_id: centerId,
    exported_at: new Date().toISOString(),
    data: await gatherCenterBackup(centerId),
  };
  const fileName = `mrcenter-${tag}-${safeFilePart(centerName)}-${new Date().toISOString().slice(0, 10)}.json`;
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return fileName;
}
