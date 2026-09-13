// ============================================================
// الأنواع المطابقة لمخطط قاعدة البيانات (supabase/android_multitenant_schema.sql)
// ============================================================

export type Role = 'super_admin' | 'center_admin' | 'student' | 'teacher' | 'manager' | 'secretary';

/** دعوة فريق عمل (سكرتير/مدرس) — كود يولّده صاحب السنتر */
export interface StaffInviteRow {
  id: string;
  center_id: string;
  code: string;
  name: string;
  phone: string | null;
  role: 'teacher' | 'secretary';
  status: 'pending' | 'accepted' | 'revoked';
  created_at: string;
}

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
  sort_order: number;
  created_at: string;
}

export type BillingType = 'monthly' | 'weekly' | 'per_session';
export type DueMode = 'manual' | 'attendance';

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
  /** يدوي = توليد شهري، حضور = استحقاق منفصل لكل حاضر/متأخر. */
  due_mode: DueMode;
  attendance_due_amount: number;
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
  due_year: number;
  amount: number;
  status: 'pending' | 'paid' | 'partial';
  due_source?: 'manual' | 'attendance';
  session_id?: string | null;
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
  payment_year: number;
  notes: string | null;
  payment_kind?: 'due_payment' | 'credit';
  created_at: string;
}

export interface StudentAccountDue {
  id: string;
  group_id: string | null;
  month: number;
  due_year: number;
  amount: number;
  cash_paid: number;
  credit_applied: number;
  settled_amount: number;
  remaining: number;
  status: 'pending' | 'paid' | 'partial';
  due_source: 'manual' | 'attendance';
  session_id: string | null;
  created_at: string;
}

export interface StudentAccountCredit {
  id: string;
  amount: number;
  remaining: number;
  applied_to_dues: number;
  settled_amount: number;
  payment_date: string;
  notes: string | null;
  created_at: string;
}

export interface StudentAccount {
  student: Pick<Student, 'id' | 'name' | 'phone' | 'guardian_phone'>;
  summary: { credit_balance: number; amount_due: number; net_balance: number };
  dues: StudentAccountDue[];
  credits: StudentAccountCredit[];
  settlements: { amount: number; notes: string | null; created_at: string; kind: 'debt_settlement' }[];
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
  grade_year: number;
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
  /** صورة السؤال (رابط خارجي أو رابط تخزين عام) */
  image?: string | null;
  /** مكان الصورة: بجانب السؤال (ورقي) أو فوق/تحت (إلكتروني) */
  imagePosition?: 'beside' | 'above' | 'below';
  /** عرض الصورة بالبكسل (80..600) */
  imageSize?: number;
}

/** قيمة إجابة سؤال: فهرس / مصفوفة فهارس / نص / null لليدوي بلا نموذج */
export type ExamAnswer = number | number[] | string | null;

/** طريقة إظهار النتيجة للطالب */
export type ExamResultMode = 'after_each' | 'end' | 'never';
export type ExamDeliveryMode = 'paper' | 'online';
export type OnlineExamMode = 'objective' | 'essay' | 'mixed';
export type ExamAvailabilityMode = 'always' | 'scheduled';
/** قوالب ورقة الاختبار. التسعة الأولى تطابق Center Publish؛ formal يبقي القالب السابق متوافقاً. */
export type PaperTemplate = 'classic' | 'lab' | 'life' | 'cosmos' | 'explorer' | 'royal' | 'parchment' | 'wedding' | 'modern' | 'formal';

/** كثافة الزخارف حول الورقة */
export type OrnamentDensity = 'low' | 'medium' | 'high';

/** ختم زخرفة موضوع يدوياً على الورقة (كنسبة مئوية من أبعادها) */
export interface OrnamentStamp {
  id: string;
  kind: string;
  x: number; // 0..100
  y: number; // 0..100
  size: number; // px
}

/** إعدادات زخارف ورقة الاختبار */
export interface ExamOrnaments {
  placement: 'auto' | 'manual';
  density: OrnamentDensity;
  opacity: number; // 0..1
  kinds: string[]; // الأنواع المختارة (تُعبأ تلقائياً حسب المادة)
  stamps: OrnamentStamp[]; // أختام يدوية (وضع manual)
}

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
  attempts_allowed: number;
  show_result: ExamResultMode;
  /** مسار الاختبار وتحكم عرضه — تتوافق الاختبارات القديمة مع online/mixed تلقائياً. */
  delivery_mode?: ExamDeliveryMode;
  online_mode?: OnlineExamMode;
  target_group_ids?: string[];
  availability_mode?: ExamAvailabilityMode;
  available_from?: string | null;
  available_until?: string | null;
  paper_template?: PaperTemplate;
  /** زخارف الورقة (اختياري — قد تكون غائبة في الاختبارات القديمة) */
  ornaments?: ExamOrnaments | null;
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
  attempts_allowed: number;
  attempts_used: number;
  show_result: ExamResultMode;
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
  /** تفاصيل طلب الانتقال؛ موجودة فقط عندما kind = transfer. */
  from_group_id?: string | null;
  to_group_id?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
}

export type SurveyQuestionType = 'single' | 'multi' | 'rating' | 'yesno' | 'text';
export type SurveyAudience = 'all' | 'grade' | 'group';

export interface SurveyQuestion {
  id: string;
  type: SurveyQuestionType;
  title: string;
  required?: boolean;
  options?: string[];
  maxRating?: number;
  placeholder?: string;
}

export interface SurveyAnswer {
  choice?: string[];
  text?: string;
  rating?: number;
}

export interface AppSurvey {
  id: string;
  center_id: string;
  title: string;
  description?: string;
  audience: SurveyAudience;
  grade_id: string | null;
  group_ids: string[];
  questions: SurveyQuestion[];
  is_active: boolean;
  anonymous: boolean;
  lock_after_submit: boolean;
  deadline: string | null;
  version: number;
  created_at: string;
}

export interface AppSurveyResponse {
  id: string;
  center_id: string;
  survey_id: string;
  student_id: string;
  answers: Record<string, SurveyAnswer>;
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
