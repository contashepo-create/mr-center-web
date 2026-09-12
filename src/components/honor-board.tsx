'use client';

// ============================================================
// لوحة الشرف الاحتفالية — كروت مبهجة بترتيب الميداليات مع
// لمعان وأنيميشن خفيف يحفز الطلاب ويُشعر المتفوق بالفخر.
// ============================================================

import type { Honoree } from '@/lib/api';
import { EmptyState } from './ui';
import { formatDate } from '@/lib/utils';

const MEDALS = ['🥇', '🥈', '🥉'];

export function HonorBoard({ honors, highlightName }: { honors: Honoree[]; highlightName?: string | null }) {
  if (honors.length === 0) {
    return <EmptyState title="لا توجد تكريمات بعد" />;
  }
  return (
    <div className="honor-board">
      {honors.map((h, i) => {
        const isTop = i < 3;
        const isMe = highlightName && h.student_id && highlightName.length > 0 && (h.name.includes(highlightName) || highlightName.includes(h.name));
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
