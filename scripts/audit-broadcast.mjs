import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/20260913_developer_broadcast_channels.sql', 'utf8');
const communicationSql = readFileSync('supabase/20260913_communication_hub_and_presence.sql', 'utf8');
const api = readFileSync('src/lib/api.ts', 'utf8');
const page = readFileSync('app/developer/broadcast/page.tsx', 'utf8');
const inbox = readFileSync('app/admin/dev-notices/page.tsx', 'utf8');
const navigation = readFileSync('src/components/app-frame.tsx', 'utf8');
const hub = readFileSync('src/components/communication-hub.tsx', 'utf8');

const problems = [];
function expect(text, pattern, description) {
  if (!pattern.test(text)) problems.push(description);
}

// لا يكفي عرض الاختيارات في الواجهة: نتحقق أن الخادم نفسه يقصر البث على القنوات
// المعلنة ويولد صفاً واحداً للدور المستهدف، ولا يتيح للمالك رصد قراءات بث المطور.
expect(sql, /CREATE OR REPLACE FUNCTION public\.developer_broadcast_notification\(/, 'SQL: secure developer broadcast RPC is missing');
expect(communicationSql, /source IN \('center', 'developer'\)/, 'SQL: center and developer notifications are not separated');
expect(communicationSql, /presentation IN \('notification', 'message', 'urgent'\)/, 'SQL: three delivery presentations are missing');
expect(communicationSql, /v_channel NOT IN \('center', 'all_owners', 'all_owners_staff', 'all_owners_students', 'all_students', 'staff', 'all_project'\)/, 'SQL: server channel allow-list is incomplete');
expect(communicationSql, /v_delivery NOT IN \('owners', 'owners_staff', 'owners_students', 'owners_students_staff', 'students', 'staff', 'everyone'\)/, 'SQL: selected-center delivery matrix is incomplete');
expect(communicationSql, /v_staff := v_channel IN \('all_owners_staff', 'all_owners_students', 'staff', 'all_project'\)/, 'SQL: owner-plus-students broadcast does not also include staff');
expect(communicationSql, /AND source = 'center'/, 'SQL: owner can still directly access developer notification rows or reads');
expect(communicationSql, /CREATE OR REPLACE FUNCTION public\.get_my_communication_summary\(\)/, 'SQL: secure top-bar unread summary RPC is missing');
expect(communicationSql, /CREATE OR REPLACE FUNCTION public\.mark_my_communication_notification_read\(/, 'SQL: secure unified notification read RPC is missing');
expect(communicationSql, /CREATE TABLE IF NOT EXISTS public\.support_message_reads/, 'SQL: support-message read receipts are missing');
expect(communicationSql, /CREATE OR REPLACE FUNCTION public\.dev_list_center_owner_presence\(\)/, 'SQL: developer owner-presence RPC is missing');
expect(communicationSql, /NOT.*IP|لا نخزن IP/s, 'SQL: migration must document that IP is not used as a device identity');

for (const name of ['developerBroadcastNotification', 'fetchMyCommunicationSummary', 'markMyCommunicationNotificationRead', 'markMySupportMessagesRead']) {
  expect(api, new RegExp(`export async function ${name}`), `API: ${name} is missing`);
}
for (const channel of ['center', 'all_owners', 'all_owners_staff', 'all_owners_students', 'all_students', 'staff', 'all_project']) {
  expect(page, new RegExp(`value: '${channel}'`), `Broadcast UI: channel '${channel}' is missing`);
}
for (const delivery of ['owners', 'owners_staff', 'owners_students', 'students', 'staff', 'everyone']) {
  expect(page, new RegExp(`value: '${delivery}'`), `Broadcast UI: selected-center delivery '${delivery}' is missing`);
}
for (const mode of ['notification', 'message', 'urgent']) {
  expect(page, new RegExp(`value: '${mode}'`), `Broadcast UI: presentation '${mode}' is missing`);
}
expect(inbox, /requestedView/, 'Inbox UI: developer message route does not filter the relevant view');
expect(inbox, /markDeveloperNotificationRead/, 'Inbox UI: secure read action is not used');
expect(navigation, /CommunicationHub area=\{area\}/, 'Navigation: communication controls are not rendered above the page');
if (/href: '\/admin\/dev-notices'/.test(navigation)) problems.push('Navigation: developer notices must not remain a sidebar item');
expect(hub, /mrcenter:communication-changed/, 'Top communication hub does not refresh badges immediately after reading');
expect(hub, /urgent-overlay/, 'Urgent broadcasts do not open a global modal');
expect(hub, /router\.push\(target\)/, 'Top communication hub does not direct an item to its owning section');

if (problems.length) {
  console.error(`❌ broadcast audit failed:\n${problems.map((problem) => `- ${problem}`).join('\n')}`);
  process.exit(1);
}
console.log('✅ broadcast audit passed (isolated delivery, no developer-read leakage, top inbox, emergency presentation, owner presence)');
