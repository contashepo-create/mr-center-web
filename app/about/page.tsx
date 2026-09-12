'use client';

import { useEffect, useState } from 'react';
import { LinkButton, LoadingScreen, Notice } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchPublicConfig } from '@/lib/supabase';
import type { PublicConfig } from '@/lib/types';

export default function AboutPage() {
  const { ready, configured } = useSession();
  const [cfg, setCfg] = useState<PublicConfig>({});

  useEffect(() => {
    if (configured) fetchPublicConfig().then(setCfg).catch(() => setCfg({}));
  }, [configured]);

  if (!ready) return <LoadingScreen />;

  return (
    <main className="container" style={{ padding: '32px 0 56px' }}>
      <div className="row-between" style={{ marginBottom: 22 }}>
        <div className="brand" style={{ margin: 0 }}>
          <div className="logo">MR</div>
          <div>
            <strong>Mr Center Web</strong>
            <div className="tiny muted">حول المنصة</div>
          </div>
        </div>
        <LinkButton href="/" variant="secondary">الرئيسية</LinkButton>
      </div>

      <section className="card stack-lg">
        <div>
          <span className="badge info">منصة موحدة</span>
          <h1 className="h2" style={{ marginTop: 12 }}>{cfg.about_title || 'إدارة السناتر التعليمية من الويب والموبايل'}</h1>
          <p className="muted" style={{ lineHeight: 1.9, fontSize: '1.05rem' }}>
            {cfg.about_body || 'Mr Center هو منصة موحدة لإدارة السناتر التعليمية: المستخدمون، الطلاب، المجموعات، الحضور، المدفوعات، الإشعارات والاشتراكات — كلها في مكان واحد يعمل على الويب والموبايل معاً.'}
          </p>
        </div>

        {!configured ? <Notice tone="warn">لم يتم تحميل محتوى المنصة بعد.</Notice> : null}

        <div className="grid grid-3">
          {[
            ['عزل السناتر', 'كل سنتر يرى بياناته فقط ولا يطّلع على بيانات غيره.'],
            ['صلاحيات الفريق', 'مدرس/مدير/سكرتير بصلاحيات تفصيلية مثل التطبيق.'],
            ['حساب الطالب', 'الطالب يرى حضوره ودرجاته ومدفوعاته وإشعاراته فقط.'],
            ['إدارة الاشتراكات', 'باقات مرنة تتناسب مع حجم سنترك.'],
            ['تحديث فوري', 'تغييراتك تظهر مباشرة على كل المنصات.'],
            ['حساب موحد', 'نفس تسجيل الدخول وتأكيد البريد وإعادة كلمة المرور.'],
          ].map(([title, body]) => (
            <div className="card compact soft" key={title}>
              <h3 className="h3">{title}</h3>
              <p className="muted small" style={{ lineHeight: 1.7 }}>{body}</p>
            </div>
          ))}
        </div>

        <div className="row">
          {cfg.contact_whatsapp ? <a className="btn" href={`https://wa.me/${cfg.contact_whatsapp.replace(/\D/g, '')}`} target="_blank">واتساب الدعم</a> : null}
          {cfg.contact_email ? <a className="btn secondary" href={`mailto:${cfg.contact_email}`}>البريد الإلكتروني</a> : null}
        </div>
      </section>
    </main>
  );
}
