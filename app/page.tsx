'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HomeRedirect, SetupNotice } from '@/components/guards';
import { Badge, Card, LinkButton, LoadingScreen } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchPublicConfig } from '@/lib/supabase';
import type { PublicConfig } from '@/lib/types';

const features = [
  ['نفس Supabase', 'الويب والأندرويد يقرآن ويكتبان في نفس الجداول والدوال.'],
  ['صلاحيات موحدة', 'مسئول سنتر، فريق عمل، طالب، ومطور بنفس قواعد RLS.'],
  ['RTL عربي كامل', 'واجهة ويب مخصصة للعملاء بالعربية وليست WebView.'],
  ['جاهز لـ Vercel', 'Next.js منفصل قابل للنشر مع Environment Variables.'],
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

  return (
    <>
      {session ? <HomeRedirect /> : null}
      <header className="container row-between" style={{ padding: '22px 0' }}>
        <Link href="/" className="brand" style={{ margin: 0 }}>
          <div className="logo">MR</div>
          <div>
            <strong>Mr Center Web</strong>
            <div className="tiny muted">منصة الويب المتصلة بالتطبيق</div>
          </div>
        </Link>
        <div className="row">
          <LinkButton href="/about" variant="secondary">حول التطبيق</LinkButton>
          <LinkButton href="/auth/login">دخول</LinkButton>
        </div>
      </header>

      <main className="container hero">
        {publicConfig.global_message ? (
          <div className="notice warn" style={{ marginBottom: 18 }}>{publicConfig.global_message}</div>
        ) : null}
        <section className="hero-grid">
          <div className="stack-lg">
            <Badge tone="info">نسخة ويب حقيقية — Next.js + Supabase</Badge>
            <h1 className="h1">نفس سيستم <span className="gradient-text">Mr Center</span> على الويب والموبايل.</h1>
            <p className="muted" style={{ fontSize: '1.1rem', lineHeight: 1.9, maxWidth: 720 }}>
              هذه الواجهة تعمل كمنصة ويب مستقلة متصلة بنفس قاعدة بيانات تطبيق Android: نفس العملاء، نفس السناتر، نفس الطلاب، نفس الحضور والمدفوعات والصلاحيات.
            </p>
            <div className="row">
              <LinkButton href="/auth/login?role=admin">دخول مسئول السنتر</LinkButton>
              <LinkButton href="/auth/login?role=student" variant="secondary">دخول طالب</LinkButton>
              <LinkButton href="/auth/login?role=teacher" variant="secondary">دخول فريق العمل</LinkButton>
            </div>
            <div className="row">
              <LinkButton href="/auth/register-center" variant="secondary">إنشاء سنتر جديد</LinkButton>
              <LinkButton href="/auth/register-student" variant="secondary">تسجيل طالب جديد</LinkButton>
              <LinkButton href="/auth/register-staff" variant="secondary">انضمام فريق عمل</LinkButton>
            </div>
          </div>

          <Card className="hero-panel stack-lg">
            <div className="row-between">
              <div>
                <p className="muted" style={{ margin: 0 }}>حالة الربط</p>
                <h2 className="h2" style={{ marginTop: 6 }}>قاعدة واحدة لمنصتين</h2>
              </div>
              <Badge tone="success">Live DB</Badge>
            </div>
            <div className="grid grid-2">
              {features.map(([title, body]) => (
                <div key={title} className="card compact soft">
                  <strong>{title}</strong>
                  <p className="muted small" style={{ marginBottom: 0, lineHeight: 1.7 }}>{body}</p>
                </div>
              ))}
            </div>
            <div className="notice">
              أي عملية تتم من الويب ستظهر في تطبيق Android فورًا لأنها تتم على نفس Supabase مع نفس سياسات RLS.
            </div>
          </Card>
        </section>
      </main>
    </>
  );
}
