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
  const rel = relative(root, file).replace(/\\/g, '/');
  const text = readFileSync(file, 'utf8');
  const isDoc = /(^docs\/|README\.md$|\.env\.example$)/.test(rel);
  const isScript = rel.startsWith('scripts/');
  const isClientSource = rel.startsWith('app/') || rel.startsWith('src/');

  if (isClientSource && /service[_-]?role/i.test(text)) issues.push(`${rel}: mentions service role in browser source`);
  if (isClientSource && /SUPABASE_SERVICE|SERVICE_ROLE|NEXT_PUBLIC_.*SERVICE/i.test(text)) issues.push(`${rel}: suspicious service env reference in browser source`);
  if (isClientSource && /dangerouslySetInnerHTML/.test(text)) issues.push(`${rel}: dangerouslySetInnerHTML is not allowed`);
  if (isClientSource && /\beval\s*\(/.test(text)) issues.push(`${rel}: eval() is not allowed`);
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
const supabaseText = readFileSync(join(root, 'src/lib/supabase.ts'), 'utf8');
const refreshRoute = readFileSync(join(root, 'app/api/auth/refresh/route.ts'), 'utf8');
const storeRoute = readFileSync(join(root, 'app/api/auth/store-refresh/route.ts'), 'utf8');

const checks = [];
checks.push({ ok: /auth\.onAuthStateChange/.test(sessionText) && !/supabase\.from\(\s*['"]auth\.users['"]\)/.test(sessionText), label: 'session: no direct auth.users queries in client' });
checks.push({ ok: /is_active/.test(loginText), label: 'login: checks is_active' });
checks.push({ ok: /service_role/i.test(supabaseText) === false, label: 'supabase client: no service role exposure' });

const passed = checks.filter((c) => c.ok).length;
const failed = checks.length - passed;
if (failed > 0) {
  const failedChecks = checks.filter((c) => !c.ok).map((c) => `  ✗ ${c.label}`);
  console.error(`❌ security audit: ${failed} advanced check(s) failed:\n${failedChecks.join('\n')}`);
  process.exit(1);
}
console.log(`✅ security audit passed (${auditedFiles.length} files, ${checks.length} advanced checks)`);
