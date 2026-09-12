'use client';

// ============================================================
// لوحة الشرف الاحتفالية — كروت مبهجة بترتيب الميداليات مع
// لمعان وأنيميشن خفيف يحفز الطلاب ويُشعر المتفوق بالفخر.
// ============================================================

import type { Honoree } from '@/lib/api';
import { EmptyState } from './ui';
import { formatDate } from '@/lib/utils';

const MEDALS = ['🥇', '🥈', '🥉'];

/** توحيد الاسم للمقارنة: إزالة التشكيل والتطويل والمسافات الزائدة */
function normalizeName(s: string): string {
  return s
    .trim()
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function HonorBoard({ honors, highlightName, highlightStudentId }: { honors: Honoree[]; highlightName?: string | null; highlightStudentId?: string | null }) {
  if (honors.length === 0) {
    return <EmptyState title="لا توجد تكريمات بعد" />;
  }
  return (
    <div className="honor-board">
      {honors.map((h, i) => {
        const isTop = i < 3;
        const idMatch = !!highlightStudentId && !!h.student_id && h.student_id === highlightStudentId;
        const nameMatch = !!highlightName && !!h.name && highlightName.length > 0
          && normalizeName(h.name) === normalizeName(highlightName);
        const isMe = idMatch || nameMatch;
        return (
          <div
            key={h.id}
            className={`honor-card ${isTop ? 'top' : ''} ${isMe ? 'me' : ''}`}
            style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}
          >
            <div className="honor-medal">{MEDALS[i] ?? '🏅'}</div>
            <div className="honor-body">
              <strong className="honor-name">{h.name}</strong>
              {h.details ? <p className="honor-details">{h.details}</p> : null}
              {isMe ? <span className="honor-me-badge">أنت يا بطل! ✨</span> : null}
              <span className="tiny muted">{formatDate(h.created_at)}</span>
            </div>
            {isTop ? <div className="honor-sparkle" aria-hidden>✦</div> : null}
          </div>
        );
      })}
    </div>
  );
}
