import { LinkButton } from '@/components/ui';

export default function NotFound() {
  return (
    <main className="auth-page">
      <section className="card auth-card stack" style={{ textAlign: 'center' }}>
        <div className="logo" style={{ marginInline: 'auto' }}>MR</div>
        <h1 className="h2">الصفحة غير موجودة</h1>
        <p className="muted">الرابط الذي تحاول فتحه غير متاح في نسخة الويب.</p>
        <LinkButton href="/" variant="secondary">العودة للرئيسية</LinkButton>
      </section>
    </main>
  );
}
