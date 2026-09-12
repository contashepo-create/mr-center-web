import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const includeDirs = ['app', 'src', 'scripts', 'docs'];
const files = [];
function walk(dir) {
  for (const ent of readdirSync(dir)) {
    if (['node_modules', '.next', '.git'].includes(ent)) continue;
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(tsx?|jsx?|mjs|md|css)$/.test(ent)) files.push(p);
  }
}
for (const d of includeDirs) walk(join(root, d));
files.push(join(root, 'README.md'), join(root, '.env.example'));
const self = relative(root, new URL(import.meta.url).pathname);
const auditedFiles = files.filter((file) => relative(root, file) !== self);

const issues = [];
for (const file of auditedFiles) {
  const rel = relative(root, file);
  const text = readFileSync(file, 'utf8');
  const isDoc = /(^docs\/|README\.md$|\.env\.example$)/.test(rel);
  const isScript = rel.startsWith('scripts/');
  const isClientSource = rel.startsWith('app/') || rel.startsWith('src/');

  if (isClientSource && /service[_-]?role/i.test(text)) issues.push(`${rel}: mentions service role in browser source`);
  if (isClientSource && /SUPABASE_SERVICE|SERVICE_ROLE|NEXT_PUBLIC_.*SERVICE/i.test(text)) issues.push(`${rel}: suspicious service env reference in browser source`);
  if (!isDoc && /dangerouslySetInnerHTML/.test(text)) issues.push(`${rel}: dangerouslySetInnerHTML is not allowed`);
  if (!isDoc && /\beval\s*\(/.test(text)) issues.push(`${rel}: eval() is not allowed`);
  if (!isDoc && !isScript && /http:\/\/(localhost|127\.0\.0\.1)/i.test(text)) issues.push(`${rel}: browser code references localhost`);
  if (!isDoc && /AIza[0-9A-Za-z\-_]{20,}|sk_live_[0-9A-Za-z]+|eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/.test(text)) issues.push(`${rel}: possible hardcoded credential`);
}

if (issues.length) {
  console.error('❌ security audit failed:\n' + issues.join('\n'));
  process.exit(1);
}

// --- فحوص أمان إضافية (جلسة واحدة + تحصيل ذري) ---
const apiText = readFileSync(join(root, 'src/lib/api.ts'), 'utf8');
const guardText = readFileSync(join(root, 'src/lib/sessionGuard.ts'), 'utf8');
const sessionText = readFileSync(join(root, 'src/context/session.tsx'), 'utf8');
const loginText = readFileSync(join(root, 'app/auth/login/page.tsx'), 'utf8');
const sqlText = readFileSync(join(root, 'supabase/20260912_security.sql'), 'utf8');
const supabaseText = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8');
const refreshRoute = readFileSync(join(root, 'app/api/auth/refresh/route.ts'), 'utf8');
const storeRoute = readFileSync(join(root, 'app/api/auth/store-refresh/route.ts'), 'utf8');
const clearRoute = readFileSync(join(root, 'app/api/auth/clear-refresh/route.ts'), 'utf8');

const extra = [];
if (!/\.rpc\('record_payment'/.test(apiText)) extra.push('api.ts: recordPayment must use the atomic record_payment RPC');
if (!/claim_session/.test(guardText)) extra.push('sessionGuard.ts: must claim a session via claim_session RPC');
if (!/check_session/.test(guardText)) extra.push('sessionGuard.ts: must verify the session via check_session RPC');
if (!/signOut\(\{ scope: 'others' \}\)/.test(guardText)) extra.push('sessionGuard.ts: must revoke other devices with signOut({ scope: "others" })');
if (!/isMySessionCurrent/.test(sessionText)) extra.push('session.tsx: must periodically verify the active session and sign out when it loses it');
if (!/FOR UPDATE/.test(sqlText)) extra.push('20260912_security.sql: record_payment must lock the due row with FOR UPDATE');
if (!/user_active_sessions/.test(sqlText)) extra.push('20260912_security.sql: user_active_sessions table is missing');
if (!/login_attempts/.test(sqlText)) extra.push('20260912_security.sql: login_attempts rate-limit table is missing');
if (!/check_login_allowed/.test(sqlText)) extra.push('20260912_security.sql: check_login_allowed rate-limit function is missing');
if (!/check_login_allowed/.test(apiText)) extra.push('api.ts: loginWithEmail must enforce check_login_allowed before sign-in');
if (!/honeypot/.test(loginText)) extra.push('login page: honeypot anti-bot field is missing');
// --- نموذج الكوكيز الهجين: رمز التجديد HttpOnly + رمز الوصول مقروء فقط ---
if (!/autoRefreshToken:\s*false/.test(supabaseText)) extra.push('supabase.ts: autoRefreshToken must be off (refresh goes through the server HttpOnly cookie)');
if (!/refresh_token:\s*''/.test(supabaseText)) extra.push('supabase.ts: refresh token must be stripped from local storage');
if (!/httpOnly:\s*true/.test(storeRoute)) extra.push('store-refresh route: must set the refresh cookie as HttpOnly');
if (!/httpOnly:\s*true/.test(refreshRoute)) extra.push('refresh route: must set the refresh cookie as HttpOnly');
if (!/httpOnly:\s*true/.test(clearRoute)) extra.push('clear-refresh route: must clear the refresh cookie');
if (!/secure:\s*true/.test(storeRoute)) extra.push('store-refresh route: cookie must set secure');
if (!/sameSite:\s*'lax'/.test(storeRoute)) extra.push('store-refresh route: cookie must set sameSite=lax');
if (!/access_token/.test(refreshRoute)) extra.push('refresh route: must return only the access token (never the refresh token)');
if (/refresh_token:\s*session\.refresh_token/.test(refreshRoute) && /return\s+NextResponse\.json\(\{[\s\S]*refresh_token/.test(refreshRoute)) extra.push('refresh route: must not leak the refresh token in the response body');

if (extra.length) {
  console.error('❌ security audit failed:\n' + extra.join('\n'));
  process.exit(1);
}

console.log(`✅ security audit passed (${auditedFiles.length} files scanned + session/race-condition checks)`);
