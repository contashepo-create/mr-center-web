'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, ErrorNotice, Input, Notice } from '@/components/ui';
import { Modal } from '@/components/modal';

type BarcodeDetectorCtor = {
  new (options?: { formats?: string[] }): { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };
  getSupportedFormats?: () => Promise<string[]>;
};
declare global { interface Window { BarcodeDetector?: BarcodeDetectorCtor } }

/**
 * قارئ QR / Code 128 للتحصيل. يقرأ كود الطالب ثم يسلّمه للشاشة لتحديد حسابه والتحصيل
 * الذري عبر record_payment؛ لا يحفظ أي دفعة أو بيانات اعتماد بنفسه.
 */
export function CollectionQrScanner({ onScanned }: { onScanned: (raw: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const handlingRef = useRef(false);

  const stopCamera = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setRunning(false);
  };

  const consumeCode = async (raw: string) => {
    if (!raw.trim() || handlingRef.current) return;
    handlingRef.current = true;
    setError(null);
    try {
      await onScanned(raw.trim());
      stopCamera(); setOpen(false); setManualCode('');
    } catch (err) {
      setError(err);
    } finally { handlingRef.current = false; }
  };

  const startCamera = async () => {
    setError(null);
    if (!window.BarcodeDetector) {
      setError(new Error('المتصفح الحالي لا يدعم قارئ QR أو الباركود. استخدم Chrome أو Edge حديثاً، أو الصق رمز الطالب يدوياً.'));
      return;
    }
    try {
      // QR هو الشكل الافتراضي في حساب الطالب. يدعم القارئ أيضاً Code 128 عندما
      // يطبع السنتر نص MRC1 نفسه على بطاقة باركود خطية.
      let supported: string[] = [];
      if (window.BarcodeDetector.getSupportedFormats) {
        try { supported = await window.BarcodeDetector.getSupportedFormats(); } catch { /* سنبدأ بوضع QR الافتراضي */ }
      }
      const formats = supported.length ? ['qr_code', 'code_128'].filter((format) => supported.includes(format)) : ['qr_code'];
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setRunning(true);
      const detector = new window.BarcodeDetector({ formats: formats.length ? formats : ['qr_code'] });
      const tick = async () => {
        try {
          const video = videoRef.current;
          if (video && video.readyState >= 2) {
            const hits = await detector.detect(video);
            if (hits[0]?.rawValue) { await consumeCode(hits[0].rawValue); return; }
          }
        } catch { /* تجاهل إطار غير قابل للقراءة واستمر في المسح */ }
        if (streamRef.current) frameRef.current = requestAnimationFrame(tick);
      };
      frameRef.current = requestAnimationFrame(tick);
    } catch (err) { setError(err); stopCamera(); }
  };

  useEffect(() => () => stopCamera(), []);

  return <>
    <Button type="button" variant="secondary" onClick={() => { setError(null); setManualCode(''); setOpen(true); }}>▣ مسح QR / باركود</Button>
    <Modal open={open} title="تحصيل برمز الطالب" subtitle="امسح QR اليومي أو باركود Code 128 الذي يحمل نص MRC1 نفسه، ثم راجع التحصيل قبل حفظه." onClose={() => { stopCamera(); setOpen(false); }} wide footer={<div className="row"><Button type="button" disabled={running} onClick={() => void startCamera()}>{running ? 'الكاميرا تعمل…' : 'تشغيل الكاميرا'}</Button><Button type="button" variant="secondary" onClick={stopCamera}>إيقاف الكاميرا</Button><Button type="button" variant="ghost" onClick={() => { stopCamera(); setOpen(false); }}>إلغاء</Button></div>}>
      <div className="stack">
        <video ref={videoRef} autoPlay playsInline muted className="collection-qr-video" />
        <Notice tone="info">QR هو الشكل الافتراضي في حساب الطالب، ويُقبل أيضاً Code 128 بالنص المشفر نفسه إن طبعه السنتر. لا يسجل المسح دفعة؛ يفتح نافذة مراجعة المبلغ فقط.</Notice>
        <div className="row" style={{ alignItems: 'end' }}><div style={{ flex: 1 }}><Input label="أو الصق نص الرمز يدوياً" value={manualCode} onChange={(event) => setManualCode(event.target.value)} dir="ltr" placeholder="MRC1…" /></div><Button type="button" disabled={!manualCode.trim()} onClick={() => void consumeCode(manualCode)}>فتح التحصيل</Button></div>
        <ErrorNotice error={error} />
      </div>
    </Modal>
  </>;
}
