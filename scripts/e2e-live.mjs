import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.E2E_SUPABASE_URL;
const ANON = process.env.E2E_ANON_KEY;
const SERVICE = process.env.E2E_SERVICE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.log('⏭️  live E2E skipped: set E2E_SUPABASE_URL, E2E_ANON_KEY, E2E_SERVICE_KEY to run against a real Supabase project.');
  process.exit(0);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const client = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const ts = Date.now();
const ownerEmail = `web-owner-${ts}@gmail.com`;
const studentEmail = `web-student-${ts}@gmail.com`;
const loginCredential = `e2e-${randomUUID()}-${ts}`;
let ownerId = '';
let studentUserId = '';
let centerId = '';
let studentId = '';
let gradeId = `web-grade-${ts}`;
let groupId = `web-group-${ts}`;
let sessionId = `web-session-${ts}`;
let examId = `web-exam-${ts}`;
let surveyId = `web-survey-${ts}`;

async function step(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); }
  catch (err) { console.error(`❌ ${name}:`, err?.message ?? err); throw err; }
}
async function assertOk(res) { if (res.error) throw res.error; return res.data; }

try {
  await step('schema smoke: public config exists/queryable', async () => {
    await assertOk(await admin.from('app_config').select('key').limit(1));
  });

  await step('create confirmed auth users', async () => {
    const o = await admin.auth.admin.createUser({ email: ownerEmail, password: loginCredential, email_confirm: true });
    if (o.error) throw o.error; ownerId = o.data.user.id;
    const s = await admin.auth.admin.createUser({ email: studentEmail, password: loginCredential, email_confirm: true });
    if (s.error) throw s.error; studentUserId = s.data.user.id;
  });

  await step('owner registers center via RPC', async () => {
    const c = client();
    await assertOk(await c.auth.signInWithPassword({ email: ownerEmail, password: loginCredential }));
    const data = await assertOk(await c.rpc('complete_center_registration', {
      p_center_name: 'سنتر اختبار الويب', p_code: `W${String(ts).slice(-7)}`,
      p_owner_name: 'مالك اختبار الويب', p_phone: `010${String(ts).slice(-8)}`, p_kind: 'center',
    }));
    centerId = data;
    await assertOk(await c.from('grades').insert({ id: gradeId, center_id: centerId, name: 'الصف التجريبي' }));
    await assertOk(await c.from('groups').insert({ id: groupId, center_id: centerId, grade_id: gradeId, name: 'مجموعة تجريبية', teacher_name: 'مدرس', days: ['sat'], start_time: '09:00', end_time: '10:00', monthly_fee: 100, billing_type: 'monthly' }));
  });

  await step('student joins center via RPC', async () => {
    const s = client();
    await assertOk(await s.auth.signInWithPassword({ email: studentEmail, password: loginCredential }));
    const data = await assertOk(await s.rpc('complete_student_registration', {
      p_center_id: centerId, p_full_name: 'طالب اختبار الويب', p_phone: `011${String(ts).slice(-8)}`,
      p_guardian_phone: `012${String(ts).slice(-8)}`, p_grade_id: gradeId, p_group_id: groupId,
    }));
    studentId = data;
  });

  await step('owner records attendance/payment/grade/announcement/notification', async () => {
    const o = client();
    await assertOk(await o.auth.signInWithPassword({ email: ownerEmail, password: loginCredential }));
    await assertOk(await o.from('sessions').insert({ id: sessionId, center_id: centerId, group_id: groupId, session_date: new Date().toISOString().slice(0, 10), start_time: '09:00', end_time: '10:00' }));
    await assertOk(await o.from('attendance').insert({ id: `web-att-${ts}`, center_id: centerId, session_id: sessionId, student_id: studentId, status: 'present' }));
    await assertOk(await o.from('dues').insert({ id: `web-due-${ts}`, center_id: centerId, student_id: studentId, group_id: groupId, month: 9, year: 2026, amount: 100, status: 'pending' }));
    await assertOk(await o.from('payments').insert({ id: `web-pay-${ts}`, center_id: centerId, student_id: studentId, due_id: `web-due-${ts}`, amount: 100, payment_date: new Date().toISOString().slice(0, 10), month: 9, year: 2026 }));
    await assertOk(await o.from('manual_grades').insert({ id: `web-grade-row-${ts}`, center_id: centerId, student_id: studentId, title: 'تقييم ويب', score: 9, max_score: 10, month: 9, year: 2026 }));
    await assertOk(await o.from('announcements').insert({ id: `web-ann-${ts}`, center_id: centerId, title: 'إعلان ويب', body: 'اختبار' }));
    await assertOk(await o.from('app_notifications').insert({ id: `web-not-${ts}`, center_id: centerId, audience: 'all', title: 'تنبيه ويب', body: 'اختبار' }));
  });

  await step('student can read own data and submitted exam/survey flows work', async () => {
    const o = client(); await assertOk(await o.auth.signInWithPassword({ email: ownerEmail, password: loginCredential }));
    await assertOk(await o.from('app_exams').insert({ id: examId, center_id: centerId, title: 'امتحان ويب', subject: 'تجربة', grade_id: gradeId, duration_minutes: 10, questions: [{ q: '1+1؟', type: 'mcq', choices: ['1','2','3','4'], marks: 2 }], answers: [1], total_score: 2, is_published: true }));
    await assertOk(await o.from('app_surveys').insert({ id: surveyId, center_id: centerId, title: 'استبيان ويب', questions: ['رأيك؟'], is_active: true }));

    const s = client(); await assertOk(await s.auth.signInWithPassword({ email: studentEmail, password: loginCredential }));
    const myRows = await assertOk(await s.from('students').select('id').eq('id', studentId));
    if (myRows.length !== 1) throw new Error('student cannot read own row');
    const exams = await assertOk(await s.rpc('get_published_exams'));
    if (!exams.some((e) => e.id === examId)) throw new Error('published exam missing');
    const result = await assertOk(await s.rpc('submit_exam_attempt', { p_exam_id: examId, p_answers: [1] }));
    if (Number(result.score) !== 2) throw new Error('exam scoring failed');
    await assertOk(await s.from('app_survey_responses').insert({ id: `web-survey-response-${ts}`, center_id: centerId, survey_id: surveyId, student_id: studentId, answers: ['جيد'] }));
    const notes = await assertOk(await s.rpc('get_my_notifications'));
    if (!notes.some((n) => n.id === `web-not-${ts}`)) throw new Error('notification not visible to student');
  });

  await step('cross-tenant isolation basic check', async () => {
    const s = client();
    await assertOk(await s.auth.signInWithPassword({ email: studentEmail, password: loginCredential }));
    const others = await assertOk(await s.from('students').select('id').neq('id', studentId).limit(5));
    if (others.length) throw new Error('student can see other students');
  });

  console.log('✅ live E2E passed');
} finally {
  if (centerId) await admin.from('centers').delete().eq('id', centerId);
  if (ownerId) await admin.auth.admin.deleteUser(ownerId).catch(() => {});
  if (studentUserId) await admin.auth.admin.deleteUser(studentUserId).catch(() => {});
}
