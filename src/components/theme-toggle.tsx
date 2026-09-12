'use client';

import { useEffect, useState } from 'react';
import { Button } from './ui';

type Mode = 'light' | 'dark';

function currentMode(): Mode {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function ThemeToggle({ variant = 'ghost' as const }: { variant?: 'secondary' | 'ghost' }) {
  const [mode, setMode] = useState<Mode>('dark');

  useEffect(() => {
    setMode(currentMode());
  }, []);

  const toggle = () => {
    const next: Mode = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('mrcenter.theme', JSON.stringify({ mode: next })); } catch { /* ignore */ }
    setMode(next);
  };

  return (
    <Button type="button" variant={variant} onClick={toggle} title={mode === 'dark' ? 'الوضع الفاتح' : 'الوضع الداكن'}>
      {mode === 'dark' ? '☀︎ فاتح' : '☾ داكن'}
    </Button>
  );
}
