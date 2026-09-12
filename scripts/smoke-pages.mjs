const base = process.env.SMOKE_BASE_URL;
const pages = [
  '/', '/about', '/blocked',
  '/auth/login', '/auth/login-admin', '/auth/login-student', '/auth/login-teacher', '/auth/register-center', '/auth/register-student', '/auth/register-staff', '/auth/register-teacher', '/auth/update-password',
  '/admin', '/admin/dashboard', '/admin/students', '/admin/groups', '/admin/grades-list', '/admin/teachers', '/admin/admin-settings', '/admin/more', '/admin/attendance', '/admin/payments', '/admin/grades', '/admin/exams', '/admin/surveys', '/admin/library', '/admin/schedule', '/admin/reports', '/admin/scan', '/admin/announcements', '/admin/notifications', '/admin/dev-notices', '/admin/inquiries', '/admin/whatsapp', '/admin/accounting', '/admin/custody', '/admin/settings', '/admin/activity', '/admin/staff', '/admin/subscription', '/admin/support', '/admin/guide',
  '/student', '/student/home', '/student/attendance', '/student/my-attendance', '/student/grades', '/student/my-grades', '/student/payments', '/student/my-payments', '/student/exams', '/student/my-exams', '/student/surveys', '/student/my-surveys', '/student/library', '/student/my-library', '/student/schedule', '/student/my-schedule', '/student/notifications', '/student/my-notifications', '/student/inquiries', '/student/my-inquiries', '/student/profile',
  '/developer', '/developer/centers', '/developer/subscriptions', '/developer/broadcast', '/developer/support', '/developer/app-info', '/developer/connection',
];
if (!base) {
  console.log('⏭️  smoke-pages skipped: set SMOKE_BASE_URL=http://127.0.0.1:3000');
  process.exit(0);
}
const failed = [];
for (const path of pages) {
  try {
    const res = await fetch(new URL(path, base), { redirect: 'manual' });
    if (![200, 307, 308].includes(res.status)) failed.push(`${path}: ${res.status}`);
    else console.log(`✅ ${path} -> ${res.status}`);
  } catch (err) {
    failed.push(`${path}: ${err?.cause?.code ?? err?.message ?? 'fetch_failed'}`);
  }
}
if (failed.length) {
  console.error('❌ smoke pages failed:\n' + failed.join('\n'));
  process.exit(1);
}
console.log(`✅ smoke pages passed (${pages.length} routes)`);
