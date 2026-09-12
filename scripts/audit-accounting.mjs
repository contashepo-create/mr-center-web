import { readFileSync } from 'node:fs';

const sql = readFileSync('supabase/android_multitenant_schema.sql', 'utf8');
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
has(api, /paidBefore \+ amount >= dueAmount \? 'paid' : 'partial'/, 'API: due status is not based on cumulative payments');
has(api, /collected_by: actorId, collected_by_name:/, 'API: recordPayment does not store collector identity');
has(api, /due_not_found/, 'API: recordPayment does not reject missing due records');

if (/value=['"]income['"]/.test(page) || /kind:\s*form\.kind/.test(page) || /setForm\([^)]*kind/.test(page)) {
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
