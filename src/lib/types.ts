// ============================================================
// الأنواع المطابقة لمخطط قاعدة البيانات (supabase/android_multitenant_schema.sql)
// ============================================================

export type Role = 'super_admin' | 'center_admin' | 'student' | 'teacher' | 'manager' | 'secretary';

export interface SubscriptionRequest {
  id: string;
  center_id: string;
  plan: string;
  months: number;
  amount: number;
  transfer_at: string;
  status: 'pending' | 'approved' | 'rejected';
  notes: string | null;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  center_id: string;
  actor_id: string;
  actor_name: string;
  action: string;
  details: string;
  created_at: string;
}

export type TeacherPermKey =
  | 'attendance' | 'exams' | 'grades' | 'reports' | 'announcements'
  | 'surveys' | 'honors' | 'inquiries' | 'collect' | 'notify';

export type TeacherPerms = Partial<Record<TeacherPermKey, boolean>>;

export interface Profile {
  id: string;
  role: Role;
  center_id: string | null;
  student_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  perms: TeacherPerms;
  push_token?: string | null;
  created_at: string;
}

export type CenterKind = 'center' | 'solo';

export interface Center {
  id: string;
  name: string;
  code: string;
  kind: CenterKind;
  owner_name: string;
  owner_email: string | null;
  owner_phone: string | null;
  status: 'active' | 'suspended';
  created_at: string;
}

export interface Grade {
  id: string;
  center_id: string;
  name: string;
  academic_year: string;
  created_at: string;
}

export type BillingType = 'monthly' | 'weekly' | 'per_session';

export interface Group {
  id: string;
  center_id: string;
  grade_id: string | null;
  name: string;
  teacher_name: string;
  teacher_phone: string | null;
  days: string[];
  start_time: string;
  end_time: string;
  monthly_fee: number;
  billing_type: BillingType;
  weekly_price: number;
  session_price: number;
  students_count: number;
}

export interface Student {
  id: string;
  center_id: string;
  name: string;
  phone: string | null;
  guardian_phone: string | null;
  email: string | null;
  grade_id: string | null;
  group_id: string | null;
  status: 'active' | 'suspended' | 'archived';
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Due {
  id: string;
  center_id: string;
  student_id: string;
  group_id: string | null;
  month: number;
  year: number;
  amount: number;
  status: 'pending' | 'paid' | 'partial';
  created_at: string;
}

export interface Payment {
  id: string;
  center_id: string;
  student_id: string;
  due_id: string | null;
  amount: number;
  payment_date: string;
  month: number;
  year: number;
  notes: string | null;
  created_at: string;
}

export interface SessionRecord {
  id: string;
  center_id: string;
  group_id: string;
  session_date: string;
  start_time: string;
  end_time: string;
  notes: string | null;
  created_at: string;
}

export type AttendanceStatus = 'present' | 'absent' | 'late';

export interface Attendance {
  id: string;
  center_id: string;
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  late_minutes: number | null;
  notes: string | null;
  created_at: string;
}

export interface ManualGrade {
  id: string;
  center_id: string;
  student_id: string;
  grade_id: string | null;
  group_id: string | null;
  title: string;
  score: number;
  max_score: number;
  month: number;
  year: number;
  notes: string | null;
  created_at: string;
}

export interface Announcement {
  id: string;
  center_id: string | null;
  title: string;
  body: string;
  pinned: boolean;
  created_at: string;
}

export type PlanType = 'monthly' | 'yearly' | 'custom' | 'trial' | 'center_full' | 'center_medium' | 'solo_teacher';
export type SubscriptionStatus = 'active' | 'expired' | 'suspended';

export interface Subscription {
  id: string;
  center_id: string;
  plan_type: PlanType;
  starts_on: string;
  ends_on: string;
  status: SubscriptionStatus;
  notes: string | null;
  created_at: string;
}

export interface CenterLookup {
  id: string;
  name: string;
  owner_name: string;
  status: 'active' | 'suspended';
}

export interface MySubscription {
  status: SubscriptionStatus | 'none';
  plan_type: PlanType | null;
  ends_on: string | null;
  days_left: number | null;
  center_status: string;
}

export type ExamQuestionType =
  | 'mcq'       // اختيار من متعدد — تصحيح تلقائي
  | 'multi'     // متعدد الإجابات — تلقائي (مصفوفة فهارس)
  | 'tf'        // صح / خطأ — تلقائي
  | 'complete'  // أكمل الفراغ — تلقائي (مطابقة نص بعد التطبيع)
  | 'match'     // وصل — تلقائي (فهرس اليمنى لكل بند يسار)
  | 'correct'   // صحّح الخطأ — يدوي + نموذج إرشادي (المطابقة التامة تعتمد آلياً)
  | 'essay'     // مقالي — يدوي
  | 'short';    // إجابة قصيرة — يدوي

export interface ExamPair { l: string; r: string }

export interface ExamQuestion {
  q: string;
  type: ExamQuestionType;
  choices: string[];
  marks: number;
  /** الإجابة النموذجية (أكمل/صحّح) — تُخزَّن مطبَّعة في answers[i] */
  answer?: string;
  /** أزواج التوصيل (وصل) */
  pairs?: ExamPair[];
}

/** قيمة إجابة سؤال: فهرس / مصفوفة فهارس / نص / null لليدوي بلا نموذج */
export type ExamAnswer = number | number[] | string | null;

export interface AppExam {
  id: string;
  center_id: string;
  title: string;
  subject: string;
  grade_id: string | null;
  duration_minutes: number;
  questions: ExamQuestion[];
  answers: ExamAnswer[];
  total_score: number;
  is_published: boolean;
  created_at: string;
}

export interface PublishedExam {
  id: string;
  title: string;
  subject: string;
  grade_id: string | null;
  duration_minutes: number;
  total_score: number;
  questions: ExamQuestion[];
  attempted: boolean;
  created_at: string;
}

/** رسالة قناة الدعم (مالك السنتر ↔ المطور) */
export interface SupportMessage {
  id: string;
  center_id: string;
  sender_role: 'owner' | 'developer';
  sender_name: string;
  body: string;
  created_at: string;
}

export interface ExamAttempt {
  id: string;
  center_id: string;
  exam_id: string;
  student_id: string;
  answers: ExamAnswer[];
  score: number;
  max_score: number;
  status: 'graded' | 'pending_review';
  created_at: string;
}

export type InquiryKind = 'question' | 'transfer' | 'registration' | 'other';
export type InquiryStatus = 'pending' | 'answered' | 'approved' | 'rejected' | 'closed';

export interface AppInquiry {
  id: string;
  center_id: string;
  student_id: string | null;
  kind: InquiryKind;
  subject: string;
  body: string;
  status: InquiryStatus;
  reply: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppSurvey {
  id: string;
  center_id: string;
  title: string;
  questions: string[];
  is_active: boolean;
  created_at: string;
}

export interface AppSurveyResponse {
  id: string;
  center_id: string;
  survey_id: string;
  student_id: string;
  answers: string[];
  created_at: string;
}

export type NotificationAudience = 'all' | 'grade' | 'group' | 'student' | 'owners';

export interface AppNotification {
  id: string;
  center_id: string;
  audience: NotificationAudience;
  audience_id: string | null;
  title: string;
  body: string;
  created_at: string;
}

export interface MyNotification {
  id: string;
  title: string;
  body: string;
  created_at: string;
  is_read: boolean;
}

export interface CenterSettings {
  whatsapp: string;
  contact_email: string;
  registration_open: boolean;
  archive_year: string;
}

export interface PublicConfig {
  about_title?: string;
  about_body?: string;
  contact_whatsapp?: string;
  contact_email?: string;
  global_message?: string;
  min_app_version?: string;
}
