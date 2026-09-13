// حماية سطح التحصيل: رصيد الطالب لا يكرر الإيراد، والحضور ينشئ استحقاقاً ذرياً.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const sql = readFileSync(join(root, 'supabase/20260913_student_collections.sql'), 'utf8');
const api = readFileSync(join(root, 'src/lib/api.ts'), 'utf8');
const page = readFileSync(join(root, 'app/admin/payments/page.tsx'), 'utf8');
const issues = [];
const has = (text, pattern, label) => { if (!pattern.test(text)) issues.push(label); };
const functionBody = (name) => {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  if (start < 0) return '';
  const next = sql.indexOf('CREATE OR REPLACE FUNCTION public.', start + 1);
  return sql.slice(start, next < 0 ? sql.length : next);
};

has(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_dues_attendance_session_student/i, 'SQL: attendance dues must be unique per session/student');
has(sql, /CREATE OR REPLACE FUNCTION public\.sync_attendance_dues_for_session/i, 'SQL: attendance due sync RPC is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.get_student_account/i, 'SQL: student account statement RPC is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.record_bulk_due_payments/i, 'SQL: atomic bulk collection RPC is missing');
has(sql, /CREATE TABLE IF NOT EXISTS public\.student_credit_applications/i, 'SQL: credit allocation ledger is missing');
has(sql, /payment_kind IN \('due_payment', 'credit'\)/i, 'SQL: payment kind guard is missing');
has(functionBody('record_payment'), /apply_student_credit_to_open_dues/i, 'SQL: advance payment does not apply available credit');
has(functionBody('settle_student_account'), /student_credit_applications/i, 'SQL: credit settlement is not documented in the allocation ledger');
if (/INSERT INTO\s+public\.payments/i.test(functionBody('settle_student_account'))) issues.push('SQL: settlement must not insert a second payment/income');
has(api, /rpc\('sync_attendance_dues_for_session'/, 'API: attendance save does not call secure due sync');
has(api, /rpc\('record_bulk_due_payments'/, 'API: batch collection does not use RPC');
has(api, /rpc\('get_student_account'/, 'API: student statement does not use RPC');
has(page, /تحديد الكل/, 'UI: batch selection control is missing');
has(page, /حفظ تحصيل/, 'UI: batch save confirmation is missing');
has(page, /رصيد مقدم/, 'UI: advance-credit option is missing');

if (issues.length) {
  console.error('❌ collections audit failed:\n' + issues.map((issue) => `- ${issue}`).join('\n'));
  process.exit(1);
}
console.log('✅ collections audit passed (advance credit, attendance dues, statement, settlement, bulk collection)');
