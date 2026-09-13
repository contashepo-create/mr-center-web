// ============================================================
// قواعد عرض الحسابات في الواجهة.
// دفتر المركز هو سجل حركة نقدية؛ أما السلفة فهي أصل على الموظف وليست
// مصروف تشغيل. لهذا نفصل صافي النقد عن تكلفة التشغيل/الراتب في كل تقرير.
// ============================================================

export type LedgerKind = 'income' | 'expense';
export type LedgerEntryType =
  | 'general' | 'salary' | 'advance' | 'bonus' | 'commission'
  | 'rent' | 'utility' | 'purchase' | 'payment_collection';

export interface AccountingLedgerRow {
  id: string;
  kind: LedgerKind;
  entry_type: LedgerEntryType;
  amount: number;
  deduction?: number | null;
  gross_amount?: number | null;
  bonus_amount?: number | null;
  commission_amount?: number | null;
  advance_applied?: number | null;
  affects_profit?: boolean | null;
  employee_id?: string | null;
}

export const LEDGER_ENTRY_LABEL: Record<LedgerEntryType, string> = {
  general: 'حركة يدوية',
  salary: 'صرف راتب',
  advance: 'سلفة موظف',
  bonus: 'مكافأة موظف',
  commission: 'عمولة مصروفة',
  rent: 'إيجار',
  utility: 'مرافق',
  purchase: 'مشتريات',
  payment_collection: 'تحصيل طلاب',
};

export function valueOf(value: number | string | null | undefined): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

/** مبلغ النقد الداخل/الخارج فعلياً. السلفة تدخل هنا لأنها خرجت من الخزينة. */
export function cashEffect(row: AccountingLedgerRow): number {
  const amount = valueOf(row.amount);
  return row.kind === 'income' ? amount : -amount;
}

/**
 * تكلفة التشغيل التي تدخل قائمة الدخل.
 * السلفة لا تؤثر في الربح: هي مبلغ على الموظف ويُسوّى عند صرف راتبه.
 * أما تسوية الراتب فتسجل الاستحقاق قبل السلفة، مع طرح الخصم من التكلفة.
 * السلفة المسوّاة استرداد لذمة على الموظف وليست خصماً من تكلفة الراتب.
 */
export function operatingExpense(row: AccountingLedgerRow): number {
  if (row.kind !== 'expense' || row.entry_type === 'advance' || row.affects_profit === false) return 0;
  if (row.entry_type === 'salary') {
    return Math.max(0, valueOf(row.gross_amount ?? row.amount)
      + valueOf(row.bonus_amount)
      + valueOf(row.commission_amount)
      - valueOf(row.deduction));
  }
  return valueOf(row.amount);
}

export function operatingIncome(row: AccountingLedgerRow): number {
  return row.kind === 'income' && row.affects_profit !== false ? valueOf(row.amount) : 0;
}

export interface EmployeePayrollSummary {
  employeeId: string;
  baseSalary: number;
  bonuses: number;
  commissions: number;
  advancesIssued: number;
  advancesApplied: number;
  advancesOutstanding: number;
  deductions: number;
  cashPaid: number;
  netPayroll: number;
}

/** يلخّص الموظف دون عدّ السلفة مرة كنفقة ومرة كخصم من راتبه. */
export function summarizeEmployeePayroll(rows: AccountingLedgerRow[], employeeId: string): EmployeePayrollSummary {
  const mine = rows.filter((row) => row.employee_id === employeeId && row.kind === 'expense');
  let baseSalary = 0;
  let bonuses = 0;
  let commissions = 0;
  let advancesIssued = 0;
  let advancesApplied = 0;
  let deductions = 0;
  let cashPaid = 0;

  for (const row of mine) {
    if (row.entry_type === 'advance') {
      advancesIssued += valueOf(row.amount);
      continue;
    }
    if (row.entry_type === 'salary') {
      baseSalary += valueOf(row.gross_amount ?? row.amount);
      bonuses += valueOf(row.bonus_amount);
      commissions += valueOf(row.commission_amount);
      advancesApplied += valueOf(row.advance_applied);
      deductions += valueOf(row.deduction);
      cashPaid += valueOf(row.amount);
      continue;
    }
    // الحركات القديمة/المستقلة للمكافأة والعمولة هي صرف نقدي أيضاً.
    if (row.entry_type === 'bonus') { bonuses += valueOf(row.amount); cashPaid += valueOf(row.amount); }
    if (row.entry_type === 'commission') { commissions += valueOf(row.amount); cashPaid += valueOf(row.amount); }
  }

  return {
    employeeId,
    baseSalary,
    bonuses,
    commissions,
    advancesIssued,
    advancesApplied,
    advancesOutstanding: Math.max(0, advancesIssued - advancesApplied),
    deductions,
    cashPaid,
    netPayroll: baseSalary + bonuses + commissions - advancesApplied - deductions,
  };
}

export function periodTotals(rows: AccountingLedgerRow[]) {
  const income = rows.reduce((sum, row) => sum + operatingIncome(row), 0);
  const operatingCosts = rows.reduce((sum, row) => sum + operatingExpense(row), 0);
  const cashIncome = rows.filter((row) => row.kind === 'income').reduce((sum, row) => sum + valueOf(row.amount), 0);
  const cashOut = rows.filter((row) => row.kind === 'expense').reduce((sum, row) => sum + valueOf(row.amount), 0);
  const advances = rows.filter((row) => row.entry_type === 'advance' && row.kind === 'expense').reduce((sum, row) => sum + valueOf(row.amount), 0);
  return {
    income,
    operatingCosts,
    netProfit: income - operatingCosts,
    cashIncome,
    cashOut,
    cashNet: cashIncome - cashOut,
    advances,
  };
}
