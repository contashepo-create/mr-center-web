'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui';

const CONSENT_KEY = 'mrcenter.cookie.consent';

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(CONSENT_KEY)) setVisible(true);
    } catch { /* ignore */ }
  }, []);

  const decide = (value: 'accepted' | 'declined') => {
    try { window.localStorage.setItem(CONSENT_KEY, value); } catch { /* ignore */ }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="cookie-banner no-print" role="dialog" aria-label="رسالة استخدام ملفات تعريف الارتباط">
      <p className="small" style={{ margin: 0, lineHeight: 1.9 }}>
        نستخدم التخزين المحلي (ملفات تعريف الارتباط) لحفظ جلسة الدخول وتفضيلات العرض (الوضع الفاتح/الداكن).
        كما نسجل <b>معرّف جهاز مجهول</b> دائماً لأغراض أمنية ومنع إساءة الاستخدام — وهذا إجراء ضروري لحماية
        المنصة والمستخدمين ولا يمكن تعطيله. لا نجمع بيانات شخصية ولا نشاركها مع أي طرف ثالث.
      </p>
      <div className="row">
        <Button type="button" onClick={() => decide('accepted')}>قبول الكل</Button>
        <Button type="button" variant="secondary" onClick={() => decide('declined')}>رفض التفضيلات الاختيارية</Button>
      </div>
    </div>
  );
}
