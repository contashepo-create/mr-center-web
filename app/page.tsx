'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { HomeRedirect, SetupNotice } from '@/components/guards';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge, Card, LinkButton, LoadingScreen } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchPublicConfig } from '@/lib/supabase';
import type { PublicConfig } from '@/lib/types';

const features = [
  ['بيانات مشتركة', 'ما تضيفه من الويب يظهر في التطبيق فوراً والعكس صحيح.'],
  ['صلاحيات دقيقة', 'صاحب السنتر والفريق والطالب — كلٌّ يرى صلاحياته فقط.'],
  ['عربي كامل', 'واجهة عربية RTL مريحة مصممة لأصحاب السناتر.'],
  ['مظهر حديث', 'وضع فاتح وداكن بألوان زاهية تناسب ذوقك.'],
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
            <strong>Mr Center</strong>
            <div className="tiny muted">منصة إدارة السناتر</div>
          </div>
        </Link>
        <div className="row">
          <ThemeToggle variant="secondary" />
          <LinkButton href="/about" variant="secondary">حول المنصة</LinkButton>
          <LinkButton href="/auth/login">دخول</LinkButton>
        </div>
      </header>

      <main className="container hero">
        {publicConfig.global_message ? (
          <div className="notice warn" style={{ marginBottom: 18 }}>{publicConfig.global_message}</div>
        ) : null}
        <section className="hero-grid">
          <div className="stack-lg">
            <Badge tone="info">منصة واحدة · ويب وموبايل</Badge>
            <h1 className="h1">أدر سنترك من أي مكان، <span className="gradient-text">بمنصة واحدة</span>.</h1>
            <p className="muted" style={{ fontSize: '1.1rem', lineHeight: 1.9, maxWidth: 720 }}>
              نفس حسابك، نفس طلابك، نفس الحضور والمدفوعات والصلاحيات — على التطبيق وعلى الويب معاً. أضف من هنا وستجدها هناك فوراً.
            </p>
            <div className="row">
              <LinkButton href="/auth/login">تسجيل الدخول</LinkButton>
              <LinkButton href="/auth/register-center" variant="secondary">إنشاء سنتر جديد</LinkButton>
            </div>
            <div className="row">
              <LinkButton href="/auth/register-student" variant="secondary">تسجيل طالب جديد</LinkButton>
              <LinkButton href="/auth/register-staff" variant="secondary">انضمام فريق عمل</LinkButton>
            </div>
          </div>

          <Card className="hero-panel stack-lg">
            <div className="row-between">
              <div>
                <p className="muted" style={{ margin: 0 }}>متصل ومتزامن</p>
                <h2 className="h2" style={{ marginTop: 6 }}>قاعدة واحدة لكل شيء</h2>
              </div>
              <Badge tone="success">متصل</Badge>
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
              كل عملية تتم من الويب تظهر في التطبيق فوراً — لأن المنصتين تعملان على نفس البيانات.
            </div>
          </Card>
        </section>
      </main>
    </>
  );
}
