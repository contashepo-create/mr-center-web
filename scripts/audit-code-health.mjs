import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const issues = [];
function walk(dir, pred, out = []) {
  for (const ent of readdirSync(dir)) {
    if (['node_modules', '.next', '.git'].includes(ent)) continue;
    const p = join(dir, ent);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}
function read(p) { return readFileSync(p, 'utf8'); }
function rel(p) { return relative(root, p); }

const sourceFiles = walk(root, (p) => /\.(tsx?|mjs)$/.test(p) && /^(app|src|scripts)\//.test(rel(p)));
const appPages = walk(join(root, 'app'), (p) => p.endsWith('/page.tsx') || p.endsWith('/not-found.tsx'));

function routeFromPage(file) {
  let r = rel(file).replace(/^app/, '').replace(/\/page\.tsx$/, '').replace(/\/not-found\.tsx$/, '/_not-found');
  r = r.replace(/\/\([^/]+\)/g, '');
  return r === '' ? '/' : r;
}
const routes = appPages.map(routeFromPage).sort();

function cleanUrl(url) {
  if (!url || !url.startsWith('/')) return null;
  if (url.startsWith('//')) return null;
  return url.split(/[?#]/)[0].replace(/\/$/, '') || '/';
}
function routeMatches(url, route) {
  const u = url.split('/').filter(Boolean);
  const r = route.split('/').filter(Boolean);
  if (u.length !== r.length) return false;
  return r.every((seg, i) => /^\[[^\]]+\]$/.test(seg) || seg === u[i] || /\$\{[^}]+\}/.test(u[i]));
}
function routeExists(url) {
  return routes.some((route) => routeMatches(url, route));
}
function collectUrls(text) {
  const urls = [];
  const regexes = [
    /href=\"(\/[^\"]*)\"/g,
    /href=\{`(\/[^`]+)`\}/g,
    /href=\{'(\/[^']+)'\}/g,
    /href=\{\"(\/[^\"]+)\"\}/g,
    /(?:router\.(?:push|replace)|redirect)\(['`](\/[^'`]+)['`]\)/g,
  ];
  for (const re of regexes) for (const m of text.matchAll(re)) urls.push(m[1]);
  return urls;
}

for (const file of sourceFiles) {
  const text = read(file);
  const path = rel(file);
  if (/\b(useState|useEffect|useMemo|useCallback|useSearchParams|useRouter|useParams|usePathname)\b/.test(text)) {
    const firstMeaningful = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('//')) ?? '';
    if (path.startsWith('app/') && firstMeaningful !== "'use client';" && firstMeaningful !== '"use client";') {
      issues.push(`${path}: React/client hook used without 'use client'`);
    }
  }
  if (/console\.log\(|debugger;/.test(text) && path.startsWith('app/')) issues.push(`${path}: debug statement in app source`);
  if (/\.from\(['"]undefined['"]/.test(text) || /\.rpc\(['"]undefined['"]/.test(text)) issues.push(`${path}: invalid Supabase reference`);
  for (const raw of collectUrls(text)) {
    const url = cleanUrl(raw);
    if (!url) continue;
    if (!routeExists(url)) issues.push(`${path}: internal route does not exist: ${raw}`);
  }
}

const sql = read(join(root, 'supabase/android_multitenant_schema.sql'));
const sqlTables = new Set([...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]));
const sqlFunctions = new Set([...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.([a-zA-Z0-9_]+)/g)].map((m) => m[1]));
for (const file of sourceFiles.filter((p) => /^(app|src)\//.test(rel(p)))) {
  const text = read(file);
  for (const m of text.matchAll(/\.from\(['"`]([^'"`]+)['"`]\)/g)) {
    if (!sqlTables.has(m[1])) issues.push(`${rel(file)}: table '${m[1]}' is not declared in Supabase schema`);
  }
  for (const m of text.matchAll(/\.rpc\(['"`]([^'"`]+)['"`]/g)) {
    if (!sqlFunctions.has(m[1])) issues.push(`${rel(file)}: RPC '${m[1]}' is not declared in Supabase schema`);
  }
}

const api = read(join(root, 'src/lib/api.ts'));
const exports = [...api.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/mg)].map((m) => m[1]);
const duplicates = exports.filter((name, i) => exports.indexOf(name) !== i);
if (duplicates.length) issues.push(`src/lib/api.ts: duplicate exported functions: ${[...new Set(duplicates)].join(', ')}`);

if (!existsSync(join(root, '.env.example'))) issues.push('.env.example is missing');

if (issues.length) {
  console.error('❌ code health audit failed:\n' + issues.map((x) => `- ${x}`).join('\n'));
  process.exit(1);
}
console.log(`✅ code health audit passed (${sourceFiles.length} source files, ${routes.length} routes)`);
