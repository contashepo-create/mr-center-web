import assert from 'node:assert/strict';
import { PRODUCTS, limitsFor, planLabel, priceFor } from '../src/lib/billing';
import { can, isOwner, isStaff, roleLabel } from '../src/lib/rbac';
import type { Profile } from '../src/lib/types';
import {
  arabicDay,
  arabicError,
  compareVersions,
  dbConfigFromRemote,
  examMarksTotal,
  findGroupConflicts,
  formatDays,
  isAllowedEmailDomain,
  isManualExamType,
  isValidCenterCode,
  isValidEmail,
  isValidHttpUrl,
  isValidPhone,
  isValidSignupEmail,
  isValidSupabaseUrl,
  minutesToTime24,
  normalizeAnswerText,
  normalizeCenterCode,
  normalizePhone,
  seededShuffle,
  timeToMinutes,
  validateExamDraft,
} from '../src/lib/utils';
import { decodeCenterQr, decodeStudentQr, encodeCenterQr, encodeStudentQr, fnv1aHex, isQrFresh } from '../src/lib/qr';
import { toWaNumber, waLink } from '../src/lib/whatsapp';
import { shouldExposeStoredSession } from '../src/lib/auth/clientSession';
import { operatingExpense, periodTotals, summarizeEmployeePayroll } from '../src/lib/accounting';

function profile(role: Profile['role'], perms: Profile['perms'] = {}, active = true): Profile {
  return {
    id: `${role}-id`, role, center_id: 'c1', student_id: role === 'student' ? 's1' : null,
    full_name: 'Test', email: 'test@example.com', phone: '01000000000', is_active: active,
    perms, created_at: new Date().toISOString(),
  };
}

assert.equal(normalizePhone('٠١٠ 123-٤٥٦٧٨'), '01012345678');
assert.equal(normalizeCenterCode(' ab 12 '), 'AB12');
assert.equal(isValidCenterCode('ABC123'), true);
assert.equal(isValidCenterCode('AB'), false);
assert.equal(isValidEmail('a@b.com'), true);
assert.equal(isAllowedEmailDomain('x@gmail.com'), true);
assert.equal(isAllowedEmailDomain('x@temporary.invalid'), false);
assert.equal(isValidSignupEmail('x@gmail.com'), true);
assert.equal(isValidPhone('+201001112223'), true);
assert.equal(isValidHttpUrl('https://example.com/a'), true);
assert.equal(isValidHttpUrl('javascript:alert(1)'), false);
assert.equal(isValidSupabaseUrl('https://abc.supabase.co'), true);
assert.equal(arabicError(new Error('invalid_payment_amount')), 'أدخل مبلغ تحصيل صحيحاً أكبر من صفر');
assert.equal(arabicError(new Error('due_not_found')), 'المستحق المحدد غير موجود أو لا تملك صلاحية تحصيله');
assert.equal(arabicError(new Error('advance_exceeds_balance')), 'قيمة السلفة المسوّاة أكبر من رصيد سلف الموظف القائم');
assert.match(arabicError(new Error('group_uses_attendance_dues')), /الحضور/);
assert.match(arabicError(new Error('invalid_bulk_payment')), /الجماعي/);
assert.deepEqual(dbConfigFromRemote({ database: { url: 'https://abc.supabase.co', anon_key: 'anon' } }), { url: 'https://abc.supabase.co', anonKey: 'anon' });

assert.equal(arabicDay('sat'), 'السبت');
assert.equal(formatDays(['sat', 'mon']), 'السبت · الاثنين');
assert.equal(timeToMinutes('09:30'), 570);
assert.equal(minutesToTime24(570), '09:30');
assert.equal(compareVersions('1.0.10', '1.0.2') > 0, true);
assert.equal(normalizeAnswerText(' أإآةـ '), 'اااه');
assert.equal(isManualExamType('essay'), true);
assert.equal(examMarksTotal([{ marks: 2 }, { marks: 3 }]), 5);
assert.equal(validateExamDraft([{ q: 'سؤال', type: 'mcq', choices: ['أ', 'ب', 'ج', 'د'], marks: 1 }]), null);
assert.match(validateExamDraft([{ q: '', type: 'mcq', choices: ['أ', 'ب', 'ج', 'د'], marks: 1 }]) ?? '', /نص السؤال/);
assert.deepEqual(seededShuffle(5, 'abc').sort(), [0, 1, 2, 3, 4]);
assert.equal(findGroupConflicts([
  { id: '1', name: 'أ', days: ['sat'], start_time: '09:00', end_time: '10:00' },
  { id: '2', name: 'ب', days: ['sat'], start_time: '09:30', end_time: '11:00' },
]).length, 1);

assert.equal(planLabel('center_full'), 'سنتر شامل');
assert.equal(priceFor('center_medium', 12), 4500);
assert.equal(PRODUCTS.length >= 3, true);
assert.deepEqual(limitsFor('solo', 'center_full'), { managers: 0, secretaries: 0, teachers: 0, maxStudents: 200 });

const owner = profile('center_admin');
const teacher = profile('teacher', { attendance: true });
const disabledTeacher = profile('teacher', { attendance: true }, false);
assert.equal(isOwner(owner), true);
assert.equal(isStaff(teacher), true);
assert.equal(can(owner, 'exams'), true);
assert.equal(can(teacher, 'attendance'), true);
assert.equal(can(teacher, 'exams'), false);
assert.equal(can(disabledTeacher, 'attendance'), false);
assert.equal(roleLabel('secretary'), 'سكرتير');

const day = '2026-09-12';
const studentQr = encodeStudentQr('center-1', 'student-1', day);
assert.equal(isQrFresh(decodeStudentQr(studentQr), day), true);
assert.deepEqual(decodeStudentQr(studentQr), { centerId: 'center-1', studentId: 'student-1', day });
assert.equal(decodeStudentQr(studentQr + 'x'), null);
const centerQr = encodeCenterQr('center-1', 'abc123', 'سنتر');
assert.deepEqual(decodeCenterQr(centerQr), { centerId: 'center-1', code: 'ABC123', name: 'سنتر' });
assert.equal(fnv1aHex('abc').length, 8);

assert.equal(toWaNumber('01012345678'), '201012345678');
assert.equal(waLink('01012345678', 'مرحبا')?.startsWith('https://wa.me/201012345678?text='), true);

const authNow = 1_700_000_000_000;
const accessOnlySession = (expiresAt: number) => JSON.stringify({
  access_token: 'access-token', refresh_token: '', expires_at: expiresAt,
});
assert.equal(shouldExposeStoredSession(accessOnlySession(Math.floor(authNow / 1000) + 5 * 60), authNow), true);
assert.equal(shouldExposeStoredSession(accessOnlySession(Math.floor(authNow / 1000) + 60), authNow), false);
assert.equal(shouldExposeStoredSession('{bad json', authNow), false);
assert.equal(shouldExposeStoredSession(JSON.stringify({ refresh_token: 'legacy-refresh-token' }), authNow), true);

// المحاسبة: السلفة حركة نقدية وذمة للموظف، وليست تكلفة إضافية بجانب الراتب.
const accountingRows = [
  { id: 'advance', kind: 'expense' as const, entry_type: 'advance' as const, amount: 200, employee_id: 'teacher-1', affects_profit: false },
  { id: 'salary', kind: 'expense' as const, entry_type: 'salary' as const, amount: 800, gross_amount: 1000, bonus_amount: 50, advance_applied: 200, deduction: 50, employee_id: 'teacher-1', affects_profit: true },
  { id: 'income', kind: 'income' as const, entry_type: 'general' as const, amount: 2000, affects_profit: true },
];
assert.equal(operatingExpense(accountingRows[0]), 0);
assert.equal(operatingExpense(accountingRows[1]), 1000);
assert.deepEqual(periodTotals(accountingRows), { income: 2000, operatingCosts: 1000, netProfit: 1000, cashIncome: 2000, cashOut: 1000, cashNet: 1000, advances: 200 });
assert.deepEqual(summarizeEmployeePayroll(accountingRows, 'teacher-1'), {
  employeeId: 'teacher-1', baseSalary: 1000, bonuses: 50, commissions: 0,
  advancesIssued: 200, advancesApplied: 200, advancesOutstanding: 0,
  deductions: 50, cashPaid: 800, netPayroll: 800,
});

console.log('✅ pure logic tests passed');
