// ============================================================
// باركود الطالب: ترميز مُعمّى لا يفيد قارئ الباركود الخارجي بشيء،
// ولا يفكّه إلا تطبيقنا. العزل الحقيقي بين السناتر يبقى على الخادم
// (RLS): سنتر آخر يمسح الكود لن يحصل على أي بيانات.
// ============================================================

const PREFIX = 'MRC1.';
const SALT = 'mr-center::qr-v1::sat-7f3a';

const B64ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** بصمة FNV-1a (8 خانات) لكشف أي عبث بالمحتوى */
export function fnv1aHex(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function xorAscii(data: string, key: string): string {
  let out = '';
  for (let i = 0; i < data.length; i++) {
    out += String.fromCharCode(data.charCodeAt(i) ^ key.charCodeAt(i % key.length));
  }
  return out;
}

/** ترميز UTF-8 لسلسلة أحرف (يدعم العربية) إلى بايتات 0-255 */
function utf8Bytes(s: string): number[] | null {
  try {
    const bin = unescape(encodeURIComponent(s));
    const bytes: number[] = [];
    for (let i = 0; i < bin.length; i++) bytes.push(bin.charCodeAt(i));
    return bytes;
  } catch {
    return null;
  }
}

function bytesToUtf8(bytes: number[]): string | null {
  try {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return decodeURIComponent(escape(bin));
  } catch {
    return null;
  }
}

function asciiToBytes(s: string): number[] | null {
  return utf8Bytes(s);
}

function b64urlEncode(bytes: number[]): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64ABC[(n >> 18) & 63] + B64ABC[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64ABC[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64ABC[n & 63];
  }
  return out;
}

function b64urlDecode(s: string): number[] | null {
  if (!s || /[^A-Za-z0-9\-_]/.test(s)) return null;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of s) {
    const v = B64ABC.indexOf(ch);
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((acc >> bits) & 0xff);
    }
  }
  return bytes;
}

function bytesToAscii(bytes: number[]): string | null {
  return bytesToUtf8(bytes);
}

/**
 * توليد نص الباركود لطالب (يُعرض كـ QR في تطبيقه) — مربوط باليوم (YYYY-MM-DD)
 * حتى لا تُعاد لقطة شاشة قديمة لتزوير الحضور في يوم آخر.
 */
export function encodeStudentQr(centerId: string, studentId: string, day: string): string {
  const cid = centerId.trim();
  const sid = studentId.trim();
  const d = day.trim();
  const sum = fnv1aHex(`${SALT}|${cid}|${sid}|${d}`);
  const body = JSON.stringify({ v: 2, cid, sid, day: d });
  const bytes = asciiToBytes(xorAscii(`${sum}.${body}`, SALT));
  if (!bytes) return '';
  return PREFIX + b64urlEncode(bytes);
}

/** فكّ نص الباركود — يرد null لأي رمز خارجي أو معبث به أو منتهي */
export function decodeStudentQr(text: string): { centerId: string; studentId: string; day: string } | null {
  try {
    const s = (text ?? '').trim();
    if (!s.startsWith(PREFIX)) return null;
    const bytes = b64urlDecode(s.slice(PREFIX.length));
    if (!bytes || bytes.length < 12) return null;
    const bin = bytesToAscii(bytes);
    if (bin === null) return null;
    const raw = xorAscii(bin, SALT);
    const dot = raw.indexOf('.');
    if (dot !== 8) return null;
    const sum = raw.slice(0, dot);
    if (!/^[0-9a-f]{8}$/.test(sum)) return null;
    const payload = JSON.parse(raw.slice(dot + 1)) as { v?: number; cid?: unknown; sid?: unknown; day?: unknown };
    if (payload?.v !== 2 || typeof payload.cid !== 'string' || typeof payload.sid !== 'string' || typeof payload.day !== 'string') return null;
    const cid = payload.cid.trim();
    const sid = payload.sid.trim();
    const d = payload.day.trim();
    if (!cid || !sid || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
    if (fnv1aHex(`${SALT}|${cid}|${sid}|${d}`) !== sum) return null;
    return { centerId: cid, studentId: sid, day: d };
  } catch {
    return null;
  }
}

/** هل باركود مفكوك صالح لهذا اليوم؟ (يمنع إعادة لقطات الأيام السابقة) */
export function isQrFresh(decoded: { day: string } | null, today: string): boolean {
  return !!decoded && decoded.day === today.trim();
}

const CENTER_PREFIX = 'MRC0.';

/**
 * باركود السنتر (ثابت — للطباعة على المكتب): يحمل معرف السنتر وكوده واسمه.
 * القارئ الخارجي يرى غموضاً؛ والتحقق من الكود يتم عبر lookup_center_by_code
 * (سنتر موقوف = مرفوض) — فلا دخول إلا لسنتر فعّال.
 */
export function encodeCenterQr(centerId: string, code: string, name: string): string {
  const cid = centerId.trim();
  const c = code.trim().toUpperCase();
  const n = name.trim().slice(0, 60);
  const sum = fnv1aHex(`${SALT}|center|${cid}|${c}`);
  const body = JSON.stringify({ v: 1, t: 'center', cid, code: c, name: n });
  const bytes = asciiToBytes(xorAscii(`${sum}.${body}`, SALT));
  if (!bytes) return '';
  return CENTER_PREFIX + b64urlEncode(bytes);
}

export function decodeCenterQr(text: string): { centerId: string; code: string; name: string } | null {
  try {
    const s = (text ?? '').trim();
    if (!s.startsWith(CENTER_PREFIX)) return null;
    const bytes = b64urlDecode(s.slice(CENTER_PREFIX.length));
    if (!bytes || bytes.length < 12) return null;
    const bin = bytesToAscii(bytes);
    if (bin === null) return null;
    const raw = xorAscii(bin, SALT);
    const dot = raw.indexOf('.');
    if (dot !== 8) return null;
    const sum = raw.slice(0, dot);
    if (!/^[0-9a-f]{8}$/.test(sum)) return null;
    const payload = JSON.parse(raw.slice(dot + 1)) as { v?: number; t?: unknown; cid?: unknown; code?: unknown; name?: unknown };
    if (payload?.v !== 1 || payload?.t !== 'center'
      || typeof payload.cid !== 'string' || typeof payload.code !== 'string') return null;
    const cid = payload.cid.trim();
    const c = payload.code.trim().toUpperCase();
    const n = typeof payload.name === 'string' ? payload.name.trim() : '';
    if (!cid || !c) return null;
    if (fnv1aHex(`${SALT}|center|${cid}|${c}`) !== sum) return null;
    return { centerId: cid, code: c, name: n };
  } catch {
    return null;
  }
}
