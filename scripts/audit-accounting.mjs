import { readFileSync, readdirSync } from 'node:fs';

// نجمع كل ملفات SQL (المخطط الأساسي + الترحيلات) لأن دالة record_payment
// وبوابة المحاسبة تُعرَّف في ترحيلات idempotent منفصلة.
const sql = readdirSync('supabase')
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(`supabase/${f}`, 'utf8'))
  .join('\n');
const api = readFileSync('src/lib/api.ts', 'utf8');
const page = readFileSync('app/admin/accounting/page.tsx', 'utf8');
const custody = readFileSync('app/admin/custody/page.tsx', 'utf8');

const issues = [];
const has = (text, re, label) => { if (!re.test(text)) issues.push(label); };

has(sql, /CREATE TABLE IF NOT EXISTS public\.center_ledger/i, 'SQL: center_ledger table is missing');
has(sql, /kind TEXT NOT NULL CHECK \(kind IN \('income','expense'\)\)/i, 'SQL: ledger kind income/expense CHECK is missing');
has(sql, /amount NUMERIC\(12,2\) NOT NULL CHECK \(amount > 0\)/i, 'SQL: ledger amount > 0 CHECK is missing');
has(sql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_ledger_payment/i, 'SQL: unique source payment ledger index is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.record_payment_income/i, 'SQL: payment income trigger function is missing');
has(sql, /CREATE TRIGGER trg_payment_income AFTER INSERT ON public\.payments/i, 'SQL: payment income trigger is missing');
has(sql, /ALTER TABLE public\.payments ADD COLUMN IF NOT EXISTS collected_by/i, 'SQL: payments.collected_by migration is missing');
has(sql, /CREATE TABLE IF NOT EXISTS public\.staff_custody/i, 'SQL: staff_custody table is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.submit_staff_custody/i, 'SQL: submit_staff_custody RPC is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.review_staff_custody/i, 'SQL: review_staff_custody RPC is missing');
has(sql, /CREATE TABLE IF NOT EXISTS public\.staff_commission_rules/i, 'SQL: staff_commission_rules table is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.calculate_staff_commission/i, 'SQL: calculate_staff_commission RPC is missing');

has(api, /export async function recordPayment/, 'API: recordPayment is missing');
has(api, /invalid_payment_amount/, 'API: recordPayment does not reject non-positive amounts');
has(api, /\.rpc\('record_payment'/, 'API: recordPayment must use the atomic record_payment RPC');
has(sql, /FOR UPDATE/, 'SQL: record_payment must lock the due row (FOR UPDATE) to prevent race conditions');
has(sql, /p_amount > \(v_due - v_paid\)/, 'SQL: record_payment must reject payments exceeding the remaining amount');
has(sql, /collected_by, collected_by_name/, 'SQL: record_payment must store collector identity');
has(sql, /due_not_found/, 'SQL: record_payment does not reject missing due records');

if (/kind:\s*['"]income['"]/.test(page) || /kind:\s*form\.kind/.test(page) || /setForm\([^)]*kind/.test(page)) {
  issues.push('Accounting UI: manual income entry is enabled; income must come from payment_collection trigger only');
}
has(page, /kind:\s*'expense'/, 'Accounting UI: manual ledger entries are not forced to expense');
has(page, /payment_collection/, 'Accounting UI: automatic payment_collection income is not surfaced');
has(page, /staff_commission_rules/, 'Accounting UI: commission rules are not connected');
has(page, /buildPayrollReportHtml/, 'Accounting UI: payroll report export is missing');
has(page, /مصدر الإيراد الوحيد/, 'Accounting UI: anti-duplicate-income notice is missing');

has(custody, /submit_staff_custody/, 'Custody UI: submit_staff_custody RPC is missing');
has(custody, /review_staff_custody/, 'Custody UI: review_staff_custody RPC is missing');

if (issues.length) {
  console.error('❌ accounting audit failed:\n' + issues.map((x) => `- ${x}`).join('\n'));
  process.exit(1);
}
console.log('✅ accounting audit passed (ledger, payment trigger, custody, payroll, commissions)');
