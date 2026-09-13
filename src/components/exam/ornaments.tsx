'use client';

// ============================================================
// زخارف ورقة الاختبار + صورة السؤال
// - توزيع تلقائي حسب الكثافة والمادة
// - أختام يدوية (كنسبة مئوية من الورقة) مع محرر وضع الأختام
// - صورة السؤال: بجانب النص (ورقي) أو فوق/تحت (إلكتروني) مع تحكم بالحجم
// ============================================================

import { useMemo, useRef, useState } from 'react';
import { ALL_ORNAMENTS, ornamentGlyph } from '@/lib/exam-ornaments';
import type { ExamOrnaments, ExamQuestion, OrnamentDensity, OrnamentStamp } from '@/lib/types';

/** ختم زخرفة واحدة (خفيف الشفافية ولا يغطي النص) */
export function OrnamentGlyph({ kind, size = 24, opacity = 0.2, style }: { kind: string; size?: number; opacity?: number; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        fontSize: size,
        lineHeight: 1,
        opacity,
        userSelect: 'none',
        pointerEvents: 'none',
        transform: 'translate(-50%, -50%)',
        ...style,
      }}
    >
      {ornamentGlyph(kind)}
    </span>
  );
}

interface Slot { top?: number | string; left?: number | string; right?: number | string; bottom?: number | string; size: number }

const CORNERS: Slot[] = [
  { top: '1.5%', right: '1.5%', size: 1 },
  { top: '1.5%', left: '1.5%', size: 1 },
  { bottom: '1.5%', right: '1.5%', size: 1 },
  { bottom: '1.5%', left: '1.5%', size: 1 },
];
const EDGES: Slot[] = [
  { top: '1.5%', left: '50%', size: 0.9 },
  { bottom: '1.5%', left: '50%', size: 0.9 },
  { top: '50%', right: '0.5%', size: 0.85 },
  { top: '50%', left: '0.5%', size: 0.85 },
];
const INNER: Slot[] = [
  { top: '24%', right: '1.5%', size: 0.7 },
  { top: '24%', left: '1.5%', size: 0.7 },
  { top: '76%', right: '1.5%', size: 0.7 },
  { top: '76%', left: '1.5%', size: 0.7 },
];

function slotsFor(density: OrnamentDensity): Slot[] {
  if (density === 'low') return CORNERS;
  if (density === 'medium') return [...CORNERS, ...EDGES];
  return [...CORNERS, ...EDGES, ...INNER];
}

/** زخارف تلقائية حول حواف الورقة حسب الكثافة وطقم الأنواع المختارة */
export function AutoOrnaments({ kinds, density, opacity, baseSize = 30, seed = 0 }: { kinds: string[]; density: OrnamentDensity; opacity: number; baseSize?: number; seed?: number }) {
  const slots = slotsFor(density);
  const list = kinds.length > 0 ? kinds : ALL_ORNAMENTS.slice(0, 12).map((o) => o.kind);
  return (
    <>
      {slots.map((s, i) => (
        <OrnamentGlyph
          key={i}
          kind={list[(i + seed) % list.length]}
          size={Math.round(baseSize * s.size)}
          opacity={opacity}
          style={{ top: s.top, left: s.left, right: s.right, bottom: s.bottom }}
        />
      ))}
    </>
  );
}

/** الأختام اليدوية الموضوعة من المعلم */
export function ManualStamps({ stamps, opacity }: { stamps: OrnamentStamp[]; opacity: number }) {
  return (
    <>
      {stamps.map((st) => (
        <OrnamentGlyph key={st.id} kind={st.kind} size={st.size} opacity={Math.max(0.04, Math.min(0.5, opacity))} style={{ top: `${st.y}%`, left: `${st.x}%` }} />
      ))}
    </>
  );
}

/** طبقة زخارف الورقة الكاملة (تلقائي أو يدوي) */
export function PaperOrnaments({ ornaments, opacity }: { ornaments: ExamOrnaments | null | undefined; opacity?: number }) {
  if (!ornaments) return null;
  const effOpacity = typeof opacity === 'number' ? opacity : (ornaments.opacity ?? 0.18);
  if (ornaments.placement === 'manual') return <ManualStamps stamps={ornaments.stamps ?? []} opacity={effOpacity} />;
  return <AutoOrnaments kinds={ornaments.kinds ?? []} density={ornaments.density ?? 'medium'} opacity={effOpacity} />;
}

// ---------------------------------------------------------------------------
// صورة السؤال
// ---------------------------------------------------------------------------

export function QuestionImage({ q, mode }: { q: ExamQuestion; mode: 'paper' | 'screen'; size?: number }) {
  const src = q.image;
  if (!src) return null;
  const width = Math.min(600, Math.max(80, Number(q.imageSize) || 160));
  // ورقي: بجانب السؤال افتراضياً — إلكتروني: فوق/تحت
  let position = q.imagePosition ?? 'beside';
  if (mode === 'screen' && position === 'beside') position = 'above';
  const img = (
    <img
      src={src}
      alt="صورة السؤال"
      style={{
        width: position === 'beside' ? width : '100%',
        maxWidth: position === 'beside' ? width : 420,
        height: 'auto',
        borderRadius: 8,
        border: '1px solid var(--border)',
        background: '#fff',
        objectFit: 'contain',
        display: 'block',
      }}
      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
    />
  );
  if (position === 'above') {
    return <div className="q-image" style={{ marginBottom: 8 }}>{img}</div>;
  }
  if (position === 'below') {
    return <div className="q-image" style={{ marginTop: 8 }}>{img}</div>;
  }
  // beside: بجانب نص السؤال (يسار النص في اتجاه RTL)
  return <div className="q-image" style={{ flexShrink: 0, alignSelf: 'flex-start' }}>{img}</div>;
}

// ---------------------------------------------------------------------------
// محرر الأختام اليدوية: لوحة اختيار + وضع بالنقر على الورقة + تحديد/حذف/حجم
// ---------------------------------------------------------------------------

function stampId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `st-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function StampEditor({ ornaments, onChange, children }: { ornaments: ExamOrnaments; onChange: (o: ExamOrnaments) => void; children: React.ReactNode }) {
  const [activeKind, setActiveKind] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const kinds = useMemo(() => (ornaments.kinds?.length ? ornaments.kinds : ALL_ORNAMENTS.map((o) => o.kind)), [ornaments.kinds]);
  const selected = ornaments.stamps?.find((s) => s.id === selectedId) ?? null;

  const place = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!activeKind) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100)));
    const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100)));
    const stamp: OrnamentStamp = { id: stampId(), kind: activeKind, x, y, size: 40 };
    onChange({ ...ornaments, stamps: [...(ornaments.stamps ?? []), stamp] });
    setSelectedId(stamp.id);
  };

  const randomFill = () => {
    const canvas = canvasRef.current;
    const n = Math.min(12, Math.max(4, kinds.length));
    // نقرأ مناطق النص الحقيقية من المعاينة، ثم نختار نقاطاً من الفراغات بينها.
    // هكذا التوزيع عشوائي بصرياً لكنه لا يغطي كلمات الأسئلة أو الاختيارات.
    const rect = canvas?.getBoundingClientRect();
    const blocked = canvas ? Array.from(canvas.querySelectorAll<HTMLElement>(
      '.exam-paper-head,.exam-paper-meta,.exam-paper-sec-head,.exam-paper-q-body,.exam-paper-choice,.exam-paper-tf,.exam-paper-match,.exam-paper-footer,.q-image',
    )).map((element) => element.getBoundingClientRect()) : [];
    const candidates: Array<{ x: number; y: number; size: number }> = [];
    if (rect && rect.width > 0 && rect.height > 0) {
      for (let y = 7; y <= 93; y += 7) for (let x = 6; x <= 94; x += 8) {
        const size = 28 + Math.round(Math.random() * 18);
        const radius = Math.max(17, size * .48);
        const pointX = rect.left + (x / 100) * rect.width;
        const pointY = rect.top + (y / 100) * rect.height;
        const hitsText = blocked.some((area) => pointX + radius > area.left && pointX - radius < area.right && pointY + radius > area.top && pointY - radius < area.bottom);
        const hitsStamp = (ornaments.stamps ?? []).some((stamp) => Math.hypot(stamp.x - x, stamp.y - y) < 8);
        if (!hitsText && !hitsStamp) candidates.push({ x, y, size });
      }
    }
    // عندما تكون الورقة مليئة جداً نفضل الحواف الآمنة على وضع الختم فوق كلمة.
    const edgeFallback = [{ x: 5, y: 5 }, { x: 95, y: 5 }, { x: 5, y: 95 }, { x: 95, y: 95 }, { x: 5, y: 50 }, { x: 95, y: 50 }];
    const safeEdges = rect ? edgeFallback.filter((point) => {
      const pointX = rect.left + (point.x / 100) * rect.width;
      const pointY = rect.top + (point.y / 100) * rect.height;
      return !blocked.some((area) => pointX + 18 > area.left && pointX - 18 < area.right && pointY + 18 > area.top && pointY - 18 < area.bottom);
    }) : edgeFallback;
    const pool = candidates.length ? [...candidates].sort(() => Math.random() - .5) : safeEdges.map((point) => ({ ...point, size: 32 }));
    const stamps: OrnamentStamp[] = pool.slice(0, Math.min(n, pool.length)).map((point, index) => ({
      id: stampId(), kind: kinds[index % kinds.length], x: point.x, y: point.y, size: point.size,
    }));
    onChange({ ...ornaments, stamps });
    setSelectedId(null);
  };

  const updateSelected = (patch: Partial<OrnamentStamp>) => {
    if (!selected) return;
    onChange({ ...ornaments, stamps: (ornaments.stamps ?? []).map((s) => (s.id === selected.id ? { ...s, ...patch } : s)) });
  };

  const removeSelected = () => {
    if (!selected) return;
    onChange({ ...ornaments, stamps: (ornaments.stamps ?? []).filter((s) => s.id !== selected.id) });
    setSelectedId(null);
  };

  return (
    <div className="stack">
      <div className="card compact soft stack">
        <div className="row-between">
          <strong>أختام يدوية — اختر ختماً ثم اضغط على الورقة لوضعه</strong>
          <div className="row">
            <button type="button" className="btn secondary" onClick={randomFill}>🎲 توزيع عشوائي آمن</button>
            <button type="button" className="btn secondary" onClick={() => { onChange({ ...ornaments, stamps: [] }); setSelectedId(null); }}>مسح الكل</button>
          </div>
        </div>
        <div className="stamp-palette">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              title={k}
              className={`stamp-chip ${activeKind === k ? 'active' : ''}`}
              onClick={() => setActiveKind(activeKind === k ? null : k)}
            >
              {ornamentGlyph(k)}
            </button>
          ))}
        </div>
        {selected ? (
          <div className="row" style={{ alignItems: 'end', flexWrap: 'wrap' }}>
            <label className="stack tiny muted" style={{ gap: 4 }}>
              الحجم (px)
              <input className="input" style={{ width: 90 }} type="number" min={16} max={200} value={selected.size} onChange={(e) => updateSelected({ size: Number(e.target.value) || 40 })} />
            </label>
            <button type="button" className="btn danger" onClick={removeSelected}>حذف الختم المحدد</button>
            <span className="tiny muted">الختم المحدد: {selected.kind}</span>
          </div>
        ) : (
          <p className="tiny muted">اضغط أي ختم من اللوحة ثم انقر داخل الورقة لوضعه فوق السؤال أو في أي موضع تريده. اضغط ختماً موجوداً لتحديده وتغيير حجمه أو حذفه. التوزيع العشوائي يختار الفراغات فقط.</p>
        )}
      </div>
      <div ref={canvasRef} className="stamp-canvas" onClick={place} style={{ cursor: activeKind ? 'crosshair' : 'default' }}>
        {children}
        {ornaments.stamps?.map((st) => (
          <span
            key={st.id}
            aria-hidden
            onClick={(e) => { e.stopPropagation(); setSelectedId(st.id); }}
            style={{
              position: 'absolute',
              top: `${st.y}%`,
              left: `${st.x}%`,
              fontSize: st.size,
              lineHeight: 1,
              // شفافية الأختام اليدوية هي نفسها التي اختارها المستخدم في لوحة المعاينة.
              opacity: Math.max(0.04, Math.min(0.5, ornaments.opacity ?? 0.18)),
              transform: 'translate(-50%, -50%)',
              zIndex: 4,
              cursor: 'pointer',
              border: selectedId === st.id ? '1.5px dashed var(--primary)' : '1.5px solid transparent',
              borderRadius: 4,
              padding: 2,
              userSelect: 'none',
            }}
          >
            {ornamentGlyph(st.kind)}
          </span>
        ))}
      </div>
    </div>
  );
}
