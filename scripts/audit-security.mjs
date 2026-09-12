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
console.log(`✅ security audit passed (${auditedFiles.length} files scanned)`);
