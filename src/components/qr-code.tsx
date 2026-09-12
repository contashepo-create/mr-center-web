'use client';

import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { Notice } from './ui';

export function QrCode({ value, size = 220 }: { value: string; size?: number }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setError(null);
    QRCode.toDataURL(value, { width: size, margin: 1, color: { dark: '#00130e', light: '#ffffff' } })
      .then((url) => { if (alive) setSrc(url); })
      .catch((err) => { if (alive) setError((err as Error).message); });
    return () => { alive = false; };
  }, [value, size]);

  if (error) return <Notice tone="error">تعذر توليد QR: {error}</Notice>;
  if (!src) return <div className="notice">جاري توليد QR...</div>;
  return <img src={src} width={size} height={size} alt="QR Code" style={{ borderRadius: 18, background: '#fff', padding: 8, maxWidth: '100%' }} />;
}
