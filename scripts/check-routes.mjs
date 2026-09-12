import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const expected = [
  'app/page.tsx', 'app/about/page.tsx', 'app/blocked/page.tsx', 'app/not-found.tsx',
  'app/auth/login/page.tsx', 'app/auth/login-admin/page.tsx', 'app/auth/login-student/page.tsx', 'app/auth/login-teacher/page.tsx', 'app/auth/update-password/page.tsx',
  'app/auth/register-center/page.tsx', 'app/auth/register-student/page.tsx', 'app/auth/register-staff/page.tsx', 'app/auth/register-teacher/page.tsx',
  'app/admin/page.tsx', 'app/admin/dashboard/page.tsx', 'app/admin/students/page.tsx', 'app/admin/students/[id]/page.tsx', 'app/admin/student/[id]/page.tsx', 'app/admin/groups/page.tsx', 'app/admin/grades-list/page.tsx', 'app/admin/teachers/page.tsx', 'app/admin/admin-settings/page.tsx', 'app/admin/more/page.tsx',
  'app/admin/attendance/page.tsx', 'app/admin/scan/page.tsx', 'app/admin/payments/page.tsx', 'app/admin/grades/page.tsx', 'app/admin/exams/page.tsx',
  'app/admin/surveys/page.tsx', 'app/admin/library/page.tsx', 'app/admin/schedule/page.tsx', 'app/admin/reports/page.tsx', 'app/admin/announcements/page.tsx',
  'app/admin/notifications/page.tsx', 'app/admin/dev-notices/page.tsx', 'app/admin/inquiries/page.tsx', 'app/admin/whatsapp/page.tsx', 'app/admin/accounting/page.tsx',
  'app/admin/custody/page.tsx', 'app/admin/settings/page.tsx', 'app/admin/activity/page.tsx', 'app/admin/staff/page.tsx', 'app/admin/subscription/page.tsx', 'app/admin/support/page.tsx', 'app/admin/guide/page.tsx',
  'app/student/page.tsx', 'app/student/home/page.tsx', 'app/student/attendance/page.tsx', 'app/student/my-attendance/page.tsx',  'app/student/grades/page.tsx', 'app/student/my-grades/page.tsx', 'app/student/payments/page.tsx', 'app/student/my-payments/page.tsx', 'app/student/exams/page.tsx', 'app/student/my-exams/page.tsx', 'app/student/surveys/page.tsx', 'app/student/my-surveys/page.tsx',
  'app/student/library/page.tsx', 'app/student/my-library/page.tsx', 'app/student/schedule/page.tsx', 'app/student/my-schedule/page.tsx', 'app/student/notifications/page.tsx', 'app/student/my-notifications/page.tsx', 'app/student/inquiries/page.tsx', 'app/student/my-inquiries/page.tsx', 'app/student/profile/page.tsx',
  'app/developer/page.tsx', 'app/developer/centers/page.tsx', 'app/developer/centers/[id]/page.tsx', 'app/developer/subscriptions/page.tsx', 'app/developer/broadcast/page.tsx',
  'app/developer/support/page.tsx', 'app/developer/app-info/page.tsx', 'app/developer/connection/page.tsx',
];

const missing = expected.filter((p) => !existsSync(join(process.cwd(), p)));
if (missing.length) {
  console.error('❌ missing expected routes/files:\n' + missing.join('\n'));
  process.exit(1);
}

const forbidden = /TODO|FIXME|غير منفذ|سيتم لاحقا|سيتم لاحقاً|قريباً|coming soon/i;
const scanFiles = expected.filter((p) => existsSync(join(process.cwd(), p)) && p.endsWith('.tsx'));
const hits = [];
for (const f of scanFiles) {
  const text = readFileSync(join(process.cwd(), f), 'utf8');
  if (forbidden.test(text)) hits.push(f);
}
if (hits.length) {
  console.error('❌ unfinished markers found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`✅ route surface check passed (${expected.length} files)`);
