'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Card, ErrorNotice, Input, Notice, PageHeader } from '@/components/ui';
import { useSession } from '@/context/session';
import { fetchStudentById, markStudentPresentToday } from '@/lib/api';
import { can } from '@/lib/rbac';
import { decodeStudentQr, isQrFresh } from '@/lib/qr';
import { todayIso } from '@/lib/utils';

type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

declare global { interface Window { BarcodeDetector?: BarcodeDetectorCtor } }

export default function ScanPage() {
  const { profile } = useSession();
  const [code, setCode] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);

  if (profile && !can(profile, 'attendance')) return <Card><Notice tone="error">ليس لديك صلاحية مسح الحضور.</Notice></Card>;

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setRunning(false);
  };

  const handleCode = async (raw: string) => {
    if (!profile?.center_id) return;
    setError(null); setMessage(null);
    const decoded = decodeStudentQr(raw);
    if (!decoded) throw new Error('باركود غير صالح');
    if (decoded.centerId !== profile.center_id) throw new Error('هذا الباركود لا يخص سنترك');
    if (!isQrFresh(decoded, todayIso())) throw new Error('باركود قديم أو ليس خاصاً بتاريخ اليوم');
    const student = await fetchStudentById(decoded.studentId);
    if (!student) throw new Error('لم يتم العثور على الطالب');
    await markStudentPresentToday(profile.center_id, { id: student.id, group_id: student.group_id });
    setMessage(`تم تسجيل حضور ${student.name} اليوم.`);
    setCode('');
  };

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault();
    try { await handleCode(code); } catch (err) { setError(err); }
  };

  const startCamera = async () => {
    setError(null); setMessage(null);
    if (!window.BarcodeDetector) return setError(new Error('المتصفح الحالي لا يدعم BarcodeDetector. استخدم الإدخال اليدوي أو Chrome/Edge حديث.'));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setRunning(true);
      if (videoRef.current) videoRef.current.srcObject = stream;
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        try {
          const video = videoRef.current;
          if (video && video.readyState >= 2) {
            const hits = await detector.detect(video);
            if (hits[0]?.rawValue) {
              stopCamera();
              await handleCode(hits[0].rawValue);
              return;
            }
          }
        } catch {
          // تجاهل إطار فاشل ونكمل
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) { setError(err); stopCamera(); }
  };

  useEffect(() => () => stopCamera(), []);

  return <>
    <PageHeader title="ماسح QR للحضور" subtitle="مسح باركود الطالب اليومي من الويب أو إدخال النص يدوياً." />
    <ErrorNotice error={error} />{message ? <Notice tone="success">{message}</Notice> : null}
    <div className="grid grid-2">
      <Card className="stack"><h2 className="h3">الكاميرا</h2><video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', borderRadius: 20, background: '#000', minHeight: 260 }} /> <div className="row"><Button type="button" disabled={running} onClick={startCamera}>تشغيل الكاميرا</Button><Button type="button" variant="secondary" onClick={stopCamera}>إيقاف</Button></div><Notice>لو لم تعمل الكاميرا بسبب دعم المتصفح، انسخ نص QR من حساب الطالب والصقه في الإدخال اليدوي.</Notice></Card>
      <Card className="stack"><h2 className="h3">إدخال يدوي</h2><form className="stack" onSubmit={submitManual}><Input label="نص QR" value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" placeholder="MRC1...." /><Button type="submit" disabled={!code.trim()}>تسجيل الحضور</Button></form></Card>
    </div>
  </>;
}
