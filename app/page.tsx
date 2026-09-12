'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HomeRedirect, SetupNotice } from '@/components/guards';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge, Card, LinkButton, LoadingScreen } from '@/components/ui';
import { ComplaintsSection } from '@/components/complaints';
import { useSession } from '@/context/session';
import { fetchPublicConfig } from '@/lib/supabase';
import type { PublicConfig } from '@/lib/types';

const features = [
  ['حضور ومتابعة', 'سجّل حضور طلابك بالباركود أو يدوياً وتابع الغياب يومياً.'],
  ['مدفوعات ومستحقات', 'حصّل وارصد المستحقات الشهرية لكل مجموعة بوضوح.'],
  ['اختبارات واستبيانات', 'أنشئ اختبارات إلكترونية مصححة تلقائياً واستبيانات رأي.'],
  ['ويب وموبايل معاً', 'نفس حسابك وبياناتك على الويب وتطبيق الأندرويد فوراً.'],
];

export default function LandingPage() {
  const { ready, configured, session } = useSession();
  const [publicConfig, setPublicConfig] = useState<PublicConfig>({});

  useEffect(() => {
    if (!configured) return;
    fetchPublicConfig().then(setPublicConfig).catch(() => setPublicConfig({}));
  }, [configured]);

  if (!ready) return <LoadingScreen />;
  if (!configured) return <SetupNotice />;

  const contactWhatsapp = (publicConfig.contact_whatsapp ?? '').trim();
  const contactEmail = (publicConfig.contact_email ?? '').trim();

  return (
    <>
      {session ? <HomeRedirect /> : null}
      <header className="container row-between" style={{ padding: '20px 0' }}>
        <Link href="/" className="brand" style={{ margin: 0 }}>
          <div className="logo">MR</div>
          <div>
            <strong>Mr Center</strong>
            <div className="tiny muted">منصة إدارة السناتر</div>
          </div>
        </Link>
        <div className="row">
          <ThemeToggle variant="secondary" />
          <LinkButton href="#complaints" variant="secondary">الشكاوي والاقتراحات</LinkButton>
          <LinkButton href="/auth/login">دخول</LinkButton>
        </div>
      </header>

      <main className="container">
        {publicConfig.global_message ? (
          <div className="notice info" style={{ marginBottom: 18 }}>{publicConfig.global_message}</div>
        ) : null}

        <section className="hero">
          <div className="hero-grid">
            <div className="stack-lg">
              <Badge tone="info">منصة واحدة · ويب وموبايل</Badge>
              <h1 className="h1">أهلًا بك في <span className="gradient-text">Mr Center</span></h1>
              <p className="muted" style={{ fontSize: '1.08rem', lineHeight: 1.95, maxWidth: 700 }}>
                منصة متكاملة لإدارة السناتر التعليمية: الطلاب والحضور والمجموعات والمدفوعات
                والاختبارات والتقارير — كلها في مكان واحد، يعمل على الويب وعلى تطبيق الأندرويد
                بنفس الحساب والبيانات.
              </p>
              <div className="row">
                <LinkButton href="/auth/login">تسجيل الدخول</LinkButton>
                <LinkButton href="/auth/register-center" variant="secondary">إنشاء سنتر جديد</LinkButton>
              </div>
              <div className="row">
                <LinkButton href="/auth/register-student" variant="secondary">تسجيل طالب</LinkButton>
                <LinkButton href="/auth/register-staff" variant="secondary">انضمام فريق عمل</LinkButton>
              </div>
            </div>

            <Card className="hero-panel stack-lg">
              <div>
                <p className="muted" style={{ margin: 0 }}>كل ما يحتاجه سنترك</p>
                <h2 className="h2" style={{ marginTop: 6 }}>مزايا المنصة</h2>
              </div>
              <div className="grid grid-2">
                {features.map(([title, body]) => (
                  <div key={title} className="card compact soft">
                    <strong>{title}</strong>
                    <p className="muted small" style={{ marginBottom: 0, lineHeight: 1.7 }}>{body}</p>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </section>

        <div className="stack-lg" style={{ paddingBottom: 56 }}>
          <Card className="stack">
            <div>
              <h2 className="h2">عن النظام</h2>
              <p className="muted" style={{ lineHeight: 1.9 }}>
                {publicConfig.about_body?.trim()
                  ? publicConfig.about_body.trim()
                  : 'Mr Center نظام عربي متكامل لإدارة السناتر التعليمية المصرية: إدارة الطلاب والمجموعات، تسجيل الحضور بالباركود، المستحقات والتحصيل، الدرجات، الاختبارات الإلكترونية، الإعلانات، التقارير، والمحاسبة — بواجهة عربية سهلة تدعم الوضعين الفاتح والداكن.'}
              </p>
            </div>
          </Card>

          <Card className="stack">
            <div>
              <h2 className="h2">التواصل مع المطور</h2>
              <p className="muted" style={{ lineHeight: 1.9 }}>
                لأي استفسار أو اقتراح أو دعم فني، يمكنك التواصل مباشرة مع فريق التطوير:
              </p>
            </div>
            <div className="row">
              {contactWhatsapp ? (
                <LinkButton href={`https://wa.me/${contactWhatsapp.replace(/\D/g, '')}`} variant="secondary">واتساب المطور</LinkButton>
              ) : null}
              {contactEmail ? (
                <LinkButton href={`mailto:${contactEmail}`} variant="secondary">بريد المطور</LinkButton>
              ) : null}
              {!contactWhatsapp && !contactEmail ? (
                <span className="muted">بيانات التواصل ستظهر هنا — أو تواصل عبر قسم الشكاوي بالأسفل.</span>
              ) : null}
            </div>
          </Card>

          <ComplaintsSection ready={configured} />
        </div>
      </main>
    </>
  );
}
