import { LinkButton, Notice } from '@/components/ui';

export default function BlockedPage() {
  return <main className="auth-page"><section className="card auth-card stack"><div className="logo">MR</div><h1 className="h2">الخدمة موقوفة مؤقتاً</h1><Notice tone="error">السنتر موقوف أو الاشتراك منتهي. تواصل مع إدارة التطبيق للتفعيل أو التجديد.</Notice><div className="row"><LinkButton href="/about" variant="secondary">بيانات التواصل</LinkButton><LinkButton href="/auth/login" variant="secondary">تسجيل الدخول</LinkButton></div></section></main>;
}
