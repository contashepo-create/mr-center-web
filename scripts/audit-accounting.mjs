import { readFileSync, readdirSync } from 'node:fs';

// يجمع المخطط والترحيلات لأن كل ترقية محاسبية تضاف بصورة idempotent منفصلة.
const sql = readdirSync('supabase').filter((f) => f.endsWith('.sql')).map((f) => readFileSync(`supabase/${f}`, 'utf8')).join('\n');
const api = readFileSync('src/lib/api.ts', 'utf8');
const page = readFileSync('app/admin/accounting/page.tsx', 'utf8');
const custody = readFileSync('src/components/accounting/custody-workspace.tsx', 'utf8');
const accounting = readFileSync('src/lib/accounting.ts', 'utf8');
const fiscalRepair = readFileSync('supabase/20260913_fiscal_runtime_repair.sql', 'utf8');
const fiscalAccounting = readFileSync('supabase/20260912_fiscal_accounting.sql', 'utf8');
const practicalAccounting = readFileSync('supabase/20260913_practical_accounting.sql', 'utf8');
const liveE2e = readFileSync('scripts/e2e-live.mjs', 'utf8');

const issues = [];
const has = (text, re, label) => { if (!re.test(text)) issues.push(label); };

// يضمن إصلاح توافق المخطط القديم (fiscal_year) مع API الويب الجديد، حتى لا يعيد
// get_my_fiscal_years خطأ PostgreSQL/HTTP 400 عند وجود أعمدة السنة الحديثة.
has(fiscalRepair, /ALTER TABLE public\.center_fiscal_years ADD COLUMN IF NOT EXISTS year_label TEXT/i, 'Fiscal repair: year_label compatibility column is missing');
has(fiscalRepair, /ALTER TABLE public\.center_fiscal_years ADD COLUMN IF NOT EXISTS starts_on DATE/i, 'Fiscal repair: starts_on compatibility column is missing');
has(fiscalRepair, /ALTER TABLE public\.center_fiscal_years ADD COLUMN IF NOT EXISTS ends_on DATE/i, 'Fiscal repair: ends_on compatibility column is missing');
has(fiscalRepair, /ALTER TABLE public\.center_fiscal_years ADD COLUMN IF NOT EXISTS fiscal_year INT/i, 'Fiscal repair: Android fiscal_year compatibility column is missing');
has(fiscalRepair, /CREATE OR REPLACE FUNCTION public\.get_my_fiscal_years\(\)/i, 'Fiscal repair: get_my_fiscal_years must be recreated');
has(fiscalRepair, /CREATE OR REPLACE FUNCTION public\.close_fiscal_year\(p_center UUID\)/i, 'Fiscal repair: live close_fiscal_year RPC must be recreated');
has(fiscalRepair, /make_date\(due_year, month, 1\)/i, 'Fiscal repair: live fiscal close must use dues.due_year');
has(fiscalRepair, /NOT public\.center_accounting_enabled\(v_center\) THEN RETURN '\[\]'::JSONB/i, 'Fiscal repair: expired accounting calls must return an empty safe result');
has(fiscalAccounting, /make_date\(due_year, month, 1\)/i, 'Fiscal close: must use dues.due_year, not removed legacy year');
has(practicalAccounting, /make_date\(due_year, month, 1\)/i, 'Practical fiscal close: must use dues.due_year, not removed legacy year');
has(api, /fetchAdminStats[\s\S]{0,1000}payment_year/i, 'Dashboard stats: must use payments.payment_year, not removed legacy year');
has(liveE2e, /due_year: 2026[\s\S]{0,500}payment_year: 2026[\s\S]{0,500}grade_year: 2026/s, 'Live E2E: must use current due/payment/grade year column names');

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

// السلف والرواتب: لا يكفي تغيير واجهة العرض؛ نتحقق من الحقول وRPC الذرية وقاعدة التقرير.
has(sql, /ADD COLUMN IF NOT EXISTS affects_profit boolean/i, 'SQL: ledger must distinguish profit effect from cash movement');
has(sql, /CREATE POLICY ledger_owner_read[\s\S]{0,220}FOR SELECT/i, 'SQL: direct owner ledger writes must be replaced with guarded RPCs');
has(sql, /ADD COLUMN IF NOT EXISTS gross_amount/i, 'SQL: payroll gross amount migration is missing');
has(sql, /ADD COLUMN IF NOT EXISTS advance_applied/i, 'SQL: payroll advance settlement migration is missing');
has(sql, /SET affects_profit = false[\s\S]{0,100}entry_type = 'advance'/i, 'SQL: advances must be excluded from profit impact');
has(sql, /CREATE OR REPLACE FUNCTION public\.record_staff_advance/i, 'SQL: atomic staff advance RPC is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.(record_payroll_settlement|record_salary_payment)/i, 'SQL: atomic payroll payment RPC is missing');
has(sql, /CREATE TABLE IF NOT EXISTS public\.staff_deductions/i, 'SQL: staff deduction balance table is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.record_staff_deduction/i, 'SQL: atomic staff deduction RPC is missing');
has(sql, /advance_exceeds_balance/i, 'SQL: payroll must reject settling more than the advance balance');
has(sql, /entry_type IN \('advance','salary'\)[\s\S]{0,120}FOR UPDATE/i, 'SQL: payroll must lock advance rows before settlement');
has(sql, /CREATE OR REPLACE FUNCTION public\.record_staff_commission_payment/i, 'SQL: commission payment RPC is missing');
has(sql, /CREATE OR REPLACE FUNCTION public\.record_manual_ledger_entry/i, 'SQL: secure manual ledger RPC is missing');
has(accounting, /entry_type === 'advance'[\s\S]{0,120}return 0/, 'Client accounting rules must exclude advances from operating cost');
has(accounting, /gross_amount \?\? row\.amount/, 'Client accounting rules must use gross payroll cost');
has(accounting, /- valueOf\(row\.deduction\)/, 'Client accounting rules must subtract salary deductions from operating cost');
has(sql, /commission_amount, 0\) - coalesce\(deduction, 0\)/, 'SQL: fiscal close must subtract payroll deductions from operating cost');
has(page, /record_manual_ledger_entry/, 'Accounting UI: manual income/expense RPC is not connected');
has(page, /record_salary_payment/, 'Accounting UI: payroll payment RPC is not connected');
has(page, /staff_deductions/, 'Accounting UI: staff deductions are not connected');
has(page, /preparePayroll/, 'Accounting UI: outstanding advances and deductions are not proposed before payment');
has(page, /record_staff_advance/, 'Accounting UI: staff advance RPC is not connected');
has(page, /record_staff_commission_payment/, 'Accounting UI: commission payment RPC is not connected');
has(page, /payment_collection/, 'Accounting UI: automatic payment_collection income is not surfaced');
has(page, /staff_commission_rules/, 'Accounting UI: commission rules are not connected');
has(page, /ledgerOrder.*'newest'/s, 'Accounting UI: ledger must default to newest-first order');
has(page, /ledger-sort-toggle/, 'Accounting UI: ledger date-order toggle is missing');
has(page, /payrollPeriod/, 'Accounting UI: monthly payroll period selector is missing');
has(sql, /CREATE TABLE IF NOT EXISTS public\.staff_advance_settlements/i, 'SQL: advance settlement trace table is missing');
has(sql, /CREATE TABLE IF NOT EXISTS public\.staff_deduction_settlements/i, 'SQL: deduction settlement trace table is missing');
has(sql, /advance_ledger_id[\s\S]{0,180}salary_ledger_id/i, 'SQL: advance settlements must link both source advance and salary payment');
has(sql, /deduction_id[\s\S]{0,180}salary_ledger_id/i, 'SQL: deduction settlements must link both source deduction and salary payment');
has(sql, /v_legacy_advance_used[\s\S]{0,450}staff_advance_settlements/i, 'SQL: old aggregate advance applications must not be allocated twice after the traceability upgrade');
has(page, /payrollAdvanceItems/, 'Accounting UI: payroll must show only outstanding advance sources');
has(page, /monthlyAdvanceSettlements/, 'Accounting UI: monthly advance settlements must be traceable');
has(page, /monthlyDeductionSettlements/, 'Accounting UI: monthly deduction settlements must be traceable');
has(page, /رصيد السلف المتبقي القابل للتسوية/, 'Accounting UI: payroll modal must label carried balances as outstanding only');
has(page, /printEmployeeStatement/, 'Accounting UI: comprehensive employee statement export is missing');
has(page, /دفعات الطلاب لا تُدخل يدوياً/, 'Accounting UI: student-payment duplicate-income warning is missing');
has(page, /CustodyWorkspace embedded/, 'Accounting UI: custody must be integrated as a tab');
has(custody, /submit_staff_custody/, 'Custody workspace: submit_staff_custody RPC is missing');
has(custody, /settle_staff_custody/, 'Custody workspace: practical custody settlement RPC is missing');
has(custody, /get_custody_overview/, 'Custody workspace: employee collection overview RPC is missing');

if (issues.length) {
  console.error('❌ accounting audit failed:\n' + issues.map((x) => `- ${x}`).join('\n'));
  process.exit(1);
}
console.log('✅ accounting audit passed (ledger, settlement-safe payroll, advances, custody, commissions, reports)');
