import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/20260913_developer_broadcast_channels.sql', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const page = readFileSync('app/developer/broadcast/page.tsx', 'utf8');
const inbox = readFileSync('app/admin/dev-notices/page.tsx', 'utf8');
const navigation = readFileSync('src/components/app-frame.tsx', 'utf8');

const problems = [];
function expect(text, pattern, description) {
  if (!pattern.test(text)) problems.push(description);
}

// لا يكفي عرض الاختيارات في الواجهة: نتحقق أن الخادم نفسه يقصر البث على القنوات
// الخمس ويولّد صفوفاً معزولة لكل سنتر/جمهور.
expect(sql, /CHECK \(audience IN \('all', 'grade', 'group', 'student', 'owners', 'staff'\)\)/, 'SQL: audience staff is missing');
expect(sql, /CREATE OR REPLACE FUNCTION public\.developer_broadcast_notification\(/, 'SQL: secure developer broadcast RPC is missing');
expect(sql, /v_channel NOT IN \('center', 'all_owners', 'all_owners_students', 'all_students', 'staff'\)/, 'SQL: server does not restrict broadcast to the five channels');
expect(sql, /role FROM public\.profiles WHERE id = auth\.uid\(\)\) IS DISTINCT FROM 'super_admin'/, 'SQL: broadcast sender must be super_admin');
expect(sql, /v_delivery NOT IN \('owners', 'owners_students'\)/, 'SQL: selected-center owner/student choice is missing');
expect(sql, /'owners'/, 'SQL: owner delivery rows are missing');
expect(sql, /'all'/, 'SQL: student delivery rows are missing');
expect(sql, /'staff'/, 'SQL: staff delivery rows are missing');
expect(sql, /CREATE OR REPLACE FUNCTION public\.get_my_developer_notifications\(\)/, 'SQL: filtered developer-notice inbox RPC is missing');
expect(sql, /CREATE OR REPLACE FUNCTION public\.mark_developer_notification_read\(/, 'SQL: secure developer-notice read RPC is missing');
expect(sql, /DROP POLICY IF EXISTS "app_notif_teacher_all"/, 'SQL: broad staff notification policy is not removed');
expect(sql, /app_notif_staff_manage_learning/, 'SQL: scoped staff notification policy is missing');

expect(api, /developer_broadcast_notification/, 'API: developer broadcast RPC is not connected');
expect(api, /fetchMyDeveloperNotifications/, 'API: developer inbox RPC is not connected');
expect(api, /markDeveloperNotificationRead/, 'API: developer inbox read RPC is not connected');
for (const channel of ['center', 'all_owners', 'all_owners_students', 'all_students', 'staff']) {
  expect(page, new RegExp(`value: '${channel}'`), `Broadcast UI: channel '${channel}' is missing`);
}
expect(page, /owners_students/, 'Broadcast UI: center owner-plus-students choice is missing');
expect(page, /all_centers/, 'Broadcast UI: all-centers staff choice is missing');
expect(page, /one_center/, 'Broadcast UI: selected-center staff choice is missing');
expect(inbox, /fetchMyDeveloperNotifications/, 'Inbox UI: recipient-filtered developer inbox is not used');
expect(inbox, /markDeveloperNotificationRead/, 'Inbox UI: secure developer read action is not used');
expect(navigation, /href: '\/admin\/dev-notices', label: 'تنبيهات المطور', icon: '🛡' \}/, 'Navigation: staff developer-notice inbox is not accessible');

if (problems.length) {
  console.error(`❌ broadcast audit failed:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log('✅ broadcast audit passed (five developer channels, isolated delivery, owner/staff inboxes)');
