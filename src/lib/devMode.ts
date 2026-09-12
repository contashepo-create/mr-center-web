// وضع المطور المؤقت: يُفتح بعد إعادة إدخال الرقم السري في هذه الجلسة فقط
// (يُخزن في sessionStorage فلا يبقى بعد إغلاق المتصفح).

const KEY = 'mrcenter.web.dev.unlock';

export function isDevUnlocked(): boolean {
  if (typeof window === 'undefined') return false;
  try { return window.sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setDevUnlocked(value: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (value) window.sessionStorage.setItem(KEY, '1');
    else window.sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
}
