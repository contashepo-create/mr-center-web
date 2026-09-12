'use client';

import { useEffect, useState } from 'react';
import { isDeviceBlocked, trackVisit } from '@/lib/visitors';
import { LinkButton } from './ui';

/** يسجل الجهاز مرة واحدة دائماً، ويمنع الأجهزة المحجوبة من استخدام الموقع. */
export function VisitorTracker() {
  const [blocked, setBlocked] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [isBlocked] = await Promise.all([isDeviceBlocked(), trackVisit()]);
      if (!cancelled) {
        setBlocked(isBlocked);
        setChecked(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!checked || !blocked) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'grid', placeItems: 'center', padding: 24,
      background: 'var(--bg)',
    }}>
      <div className="card stack-lg" style={{ maxWidth: 460, textAlign: 'center' }}>
        <div className="logo" style={{ margin: '0 auto' }}>⛔</div>
        <h1 className="h2">تم حجب هذا الجهاز</h1>
        <p className="muted" style={{ lineHeight: 1.9 }}>
          هذا الجهاز محجوب من الإدارة. إذا كنت تعتقد أن هذا خطأ، تواصل مع إدارة المنصة.
        </p>
        <LinkButton href="/about" variant="secondary">بيانات التواصل</LinkButton>
      </div>
    </div>
  );
}
