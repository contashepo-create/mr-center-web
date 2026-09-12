import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const webRoot = process.cwd();
const androidRoot = process.env.ANDROID_REPO_PATH || '/tmp/mr-center-android';

function read(root, file) {
  return readFileSync(join(root, file), 'utf8');
}
function sha(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}
function assert(ok, msg, failures) {
  if (!ok) failures.push(msg);
}
function exportNames(source) {
  const re = /^export\s+(?:(?:async\s+)?function|const|interface|type)\s+([A-Za-z0-9_]+)/mg;
  return [...source.matchAll(re)].map((m) => m[1]).sort();
}
function dbRefs(source, kind) {
  const re = kind === 'table' ? /\.from\(['"`]([^'"`]+)['"`]\)/g : /\.rpc\(['"`]([^'"`]+)['"`]/g;
  return [...new Set([...source.matchAll(re)].map((m) => m[1]))].sort();
}
function diff(a, b) {
  return a.filter((x) => !b.includes(x));
}
function walkFiles(dir, out = []) {
  for (const ent of readdirSync(dir)) {
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const failures = [];
assert(existsSync(join(androidRoot, 'app')), `ANDROID_REPO_PATH غير صحيح أو لا يحتوي app/: ${androidRoot}`, failures);

const routeMappings = [
  ['app/index.tsx', ['app/page.tsx']],
  ['app/about.tsx', ['app/about/page.tsx']],
  ['app/blocked.tsx', ['app/blocked/page.tsx']],
  ['app/auth/login-admin.tsx', ['app/auth/login-admin/page.tsx', 'app/auth/login/page.tsx']],
  ['app/auth/login-student.tsx', ['app/auth/login-student/page.tsx', 'app/auth/login/page.tsx']],
  ['app/auth/login-teacher.tsx', ['app/auth/login-teacher/page.tsx', 'app/auth/login/page.tsx']],
  ['app/auth/register-center.tsx', ['app/auth/register-center/page.tsx']],
  ['app/auth/register-student.tsx', ['app/auth/register-student/page.tsx']],
  ['app/auth/register-teacher.tsx', ['app/auth/register-teacher/page.tsx', 'app/auth/register-staff/page.tsx']],
  ['app/developer/index.tsx', ['app/developer/page.tsx']],
  ['app/developer/connection.tsx', ['app/developer/connection/page.tsx']],
  ['app/developer/centers.tsx', ['app/developer/centers/page.tsx']],
  ['app/developer/center-detail.tsx', ['app/developer/centers/[id]/page.tsx']],
  ['app/developer/subscriptions.tsx', ['app/developer/subscriptions/page.tsx']],
  ['app/developer/broadcast.tsx', ['app/developer/broadcast/page.tsx']],
  ['app/developer/support.tsx', ['app/developer/support/page.tsx']],
  ['app/developer/app-info.tsx', ['app/developer/app-info/page.tsx']],
  ['app/(admin)/(tabs)/dashboard.tsx', ['app/admin/page.tsx', 'app/admin/dashboard/page.tsx']],
  ['app/(admin)/(tabs)/students.tsx', ['app/admin/students/page.tsx']],
  ['app/(admin)/(tabs)/groups.tsx', ['app/admin/groups/page.tsx']],
  ['app/(admin)/(tabs)/attendance.tsx', ['app/admin/attendance/page.tsx']],
  ['app/(admin)/(tabs)/more.tsx', ['app/admin/more/page.tsx', 'app/admin/guide/page.tsx']],
  ['app/(admin)/student/[id].tsx', ['app/admin/student/[id]/page.tsx', 'app/admin/students/[id]/page.tsx']],
  ['app/(admin)/teachers.tsx', ['app/admin/teachers/page.tsx', 'app/admin/staff/page.tsx']],
  ['app/(admin)/admin-settings.tsx', ['app/admin/admin-settings/page.tsx', 'app/admin/settings/page.tsx']],
  ['app/(admin)/grades-list.tsx', ['app/admin/grades-list/page.tsx', 'app/admin/groups/page.tsx']],
  ['app/(admin)/payments.tsx', ['app/admin/payments/page.tsx']],
  ['app/(admin)/exams.tsx', ['app/admin/exams/page.tsx']],
  ['app/(admin)/surveys.tsx', ['app/admin/surveys/page.tsx']],
  ['app/(admin)/library.tsx', ['app/admin/library/page.tsx']],
  ['app/(admin)/schedule.tsx', ['app/admin/schedule/page.tsx']],
  ['app/(admin)/reports.tsx', ['app/admin/reports/page.tsx']],
  ['app/(admin)/scan.tsx', ['app/admin/scan/page.tsx']],
  ['app/(admin)/announcements.tsx', ['app/admin/announcements/page.tsx']],
  ['app/(admin)/notifications.tsx', ['app/admin/notifications/page.tsx']],
  ['app/(admin)/dev-notices.tsx', ['app/admin/dev-notices/page.tsx']],
  ['app/(admin)/inquiries.tsx', ['app/admin/inquiries/page.tsx']],
  ['app/(admin)/whatsapp.tsx', ['app/admin/whatsapp/page.tsx']],
  ['app/(admin)/accounting.tsx', ['app/admin/accounting/page.tsx']],
  ['app/(admin)/activity.tsx', ['app/admin/activity/page.tsx']],
  ['app/(admin)/custody.tsx', ['app/admin/custody/page.tsx']],
  ['app/(admin)/subscription.tsx', ['app/admin/subscription/page.tsx']],
  ['app/(admin)/support.tsx', ['app/admin/support/page.tsx']],
  ['app/(admin)/guide.tsx', ['app/admin/guide/page.tsx']],
  ['app/(student)/(tabs)/home.tsx', ['app/student/page.tsx', 'app/student/home/page.tsx']],
  ['app/(student)/(tabs)/my-attendance.tsx', ['app/student/attendance/page.tsx', 'app/student/my-attendance/page.tsx']],
  ['app/(student)/(tabs)/my-grades.tsx', ['app/student/grades/page.tsx', 'app/student/my-grades/page.tsx']],
  ['app/(student)/(tabs)/my-payments.tsx', ['app/student/payments/page.tsx', 'app/student/my-payments/page.tsx']],
  ['app/(student)/(tabs)/profile.tsx', ['app/student/profile/page.tsx']],
  ['app/(student)/my-exams.tsx', ['app/student/exams/page.tsx', 'app/student/my-exams/page.tsx']],
  ['app/(student)/my-inquiries.tsx', ['app/student/inquiries/page.tsx', 'app/student/my-inquiries/page.tsx']],
  ['app/(student)/my-library.tsx', ['app/student/library/page.tsx', 'app/student/my-library/page.tsx']],
  ['app/(student)/my-notifications.tsx', ['app/student/notifications/page.tsx', 'app/student/my-notifications/page.tsx']],
  ['app/(student)/my-schedule.tsx', ['app/student/schedule/page.tsx', 'app/student/my-schedule/page.tsx']],
  ['app/(student)/my-surveys.tsx', ['app/student/surveys/page.tsx', 'app/student/my-surveys/page.tsx']],
];

if (existsSync(join(androidRoot, 'app'))) {
  const androidScreens = walkFiles(join(androidRoot, 'app'))
    .map((p) => p.replace(`${androidRoot}/`, ''))
    .filter((p) => !p.endsWith('/_layout.tsx'))
    .sort();
  const mappedScreens = routeMappings.map(([androidFile]) => androidFile).sort();
  const unmapped = diff(androidScreens, mappedScreens);
  const staleMapped = diff(mappedScreens, androidScreens);
  assert(unmapped.length === 0 && staleMapped.length === 0,
    `خريطة الشاشات غير كاملة\nAndroid غير mapped: ${unmapped.join(', ') || '—'}\nMapped غير موجودة: ${staleMapped.join(', ') || '—'}`,
    failures,
  );
}

for (const [androidFile, webFiles] of routeMappings) {
  assert(existsSync(join(androidRoot, androidFile)), `ملف Android مفقود من المقارنة: ${androidFile}`, failures);
  assert(webFiles.some((file) => existsSync(join(webRoot, file))), `لا يوجد مقابل Web للمسار Android: ${androidFile} -> ${webFiles.join(' أو ')}`, failures);
}

for (const sql of ['supabase/android_multitenant_schema.sql', 'supabase/20260911_safe_production_migration.sql']) {
  if (existsSync(join(androidRoot, sql)) && existsSync(join(webRoot, sql))) {
    const a = read(androidRoot, sql);
    const w = read(webRoot, sql);
    assert(a === w, `ملف SQL غير مطابق: ${sql} android=${sha(a)} web=${sha(w)}`, failures);
  } else {
    assert(false, `ملف SQL مفقود في أحد المشروعين: ${sql}`, failures);
  }
}

const androidApi = read(androidRoot, 'src/lib/api.ts');
const webApi = read(webRoot, 'src/lib/api.ts');
for (const [label, a, w] of [
  ['API exports', exportNames(androidApi), exportNames(webApi)],
  ['Supabase table refs', dbRefs(androidApi, 'table'), dbRefs(webApi, 'table')],
  ['Supabase RPC refs', dbRefs(androidApi, 'rpc'), dbRefs(webApi, 'rpc')],
]) {
  assert(diff(a, w).length === 0 && diff(w, a).length === 0, `${label} غير متطابقة\nAndroid-only: ${diff(a, w).join(', ') || '—'}\nWeb-only: ${diff(w, a).join(', ') || '—'}`, failures);
}

for (const file of ['billing.ts', 'pendingRegistration.ts', 'qr.ts', 'rbac.ts', 'types.ts', 'utils.ts']) {
  const a = exportNames(read(androidRoot, `src/lib/${file}`));
  const w = exportNames(read(webRoot, `src/lib/${file}`));
  assert(diff(a, w).length === 0 && diff(w, a).length === 0, `Exports غير متطابقة في ${file}`, failures);
}

const webForbidden = /from ['"]react-native|from ['"]expo-|@react-native|service_role|SERVICE_ROLE/i;
for (const file of ['src/lib/api.ts', 'src/lib/supabase.ts', 'src/context/session.tsx']) {
  const txt = read(webRoot, file);
  assert(!webForbidden.test(txt), `اعتماد أو سر غير مناسب للويب في ${file}`, failures);
}

if (failures.length) {
  console.error('❌ Android/Web parity comparison failed:\n' + failures.map((f) => `- ${f}`).join('\n'));
  process.exit(1);
}

console.log(`✅ Android/Web parity comparison passed`);
console.log(`   routes mapped: ${routeMappings.length}`);
console.log(`   SQL schema hashes: ${sha(read(webRoot, 'supabase/android_multitenant_schema.sql'))}, ${sha(read(webRoot, 'supabase/20260911_safe_production_migration.sql'))}`);
console.log(`   API exports/tables/RPC references match Android exactly`);
console.log(`   Android repo: ${androidRoot}`);
