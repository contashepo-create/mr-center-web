'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useSession } from '@/context/session';
import { planLabel } from '@/lib/billing';
import { setDevUnlocked } from '@/lib/devMode';
import { can, isOwner, isStaff, roleLabel } from '@/lib/rbac';
import type { MyFeatures } from '@/lib/features';
import type { Profile, TeacherPermKey } from '@/lib/types';
import { Badge, Button } from './ui';
import { ThemeToggle } from './theme-toggle';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  perm?: TeacherPermKey | null;
  ownerOnly?: boolean;
  feature?: 'accounting';
  locked?: boolean;
}
interface NavGroup { title: string; icon: string; accent: string; items: NavItem[]; }

const adminNav: NavGroup[] = [
  { title: 'الرئيسية', icon: '⌂', accent: '#64748b', items: [{ href: '/admin', label: 'نظرة عامة', icon: '⌂' }] },
  { title: 'التعليم والطلاب', icon: '✦', accent: '#4f6df5', items: [
    { href: '/admin/students', label: 'الطلاب', icon: '👥' }, { href: '/admin/groups', label: 'الصفوف والمجموعات', icon: '🗂' },
    { href: '/admin/attendance', label: 'الحضور', icon: '✓', perm: 'attendance' }, { href: '/admin/grades', label: 'الدرجات', icon: '★', perm: 'grades' },
    { href: '/admin/exams', label: 'الاختبارات', icon: '📝', perm: 'exams' }, { href: '/admin/schedule', label: 'الجدول', icon: '🗓' },
    { href: '/admin/surveys', label: 'الاستبيانات', icon: '📋', perm: 'surveys' }, { href: '/admin/library', label: 'المكتبة والشرف', icon: '📚', perm: 'honors' },
  ] },
  { title: 'المالية', icon: '◈', accent: '#14b87a', items: [
    { href: '/admin/payments', label: 'المدفوعات', icon: '💳', perm: 'collect' },
    { href: '/admin/accounting', label: 'المحاسبة والعهدة', icon: '💼', ownerOnly: true, feature: 'accounting' },
    { href: '/admin/reports', label: 'تقارير الطلاب', icon: '📊', perm: 'reports' },
  ] },
  { title: 'التواصل', icon: '◌', accent: '#a855f7', items: [
    { href: '/admin/announcements', label: 'الإعلانات', icon: '📣', perm: 'announcements' }, { href: '/admin/notifications', label: 'الإشعارات', icon: '🔔', perm: 'notify' },
    { href: '/admin/whatsapp', label: 'واتساب', icon: '☏', perm: 'notify' }, { href: '/admin/inquiries', label: 'طلبات الطلاب', icon: '💬', perm: 'inquiries' },
    { href: '/admin/support', label: 'الدعم', icon: '🎧', ownerOnly: true },
  ] },
  { title: 'إدارة السنتر', icon: '⚙', accent: '#f59e0b', items: [
    { href: '/admin/staff', label: 'فريق العمل', icon: '🧑‍🏫', ownerOnly: true }, { href: '/admin/settings', label: 'الإعدادات', icon: '⚙', ownerOnly: true },
    { href: '/admin/subscription', label: 'الاشتراك', icon: '◆', ownerOnly: true }, { href: '/admin/scan', label: 'ماسح QR', icon: '▣', perm: 'attendance' },
    { href: '/admin/activity', label: 'سجل النشاط', icon: '≋', ownerOnly: true }, { href: '/admin/dev-notices', label: 'تنبيهات المطور', icon: '🛡', ownerOnly: true },
    { href: '/admin/guide', label: 'الدليل', icon: '؟' },
  ] },
];

const studentNav: NavItem[] = [
  { href: '/student', label: 'الرئيسية', icon: '⌂' }, { href: '/student/attendance', label: 'حضوري', icon: '✓' }, { href: '/student/grades', label: 'درجاتي', icon: '★' },
  { href: '/student/report', label: 'تقريري', icon: '🧾' }, { href: '/student/payments', label: 'مدفوعاتي', icon: '💳' }, { href: '/student/exams', label: 'اختباراتي', icon: '📝' },
  { href: '/student/surveys', label: 'استبياناتي', icon: '📋' }, { href: '/student/library', label: 'المكتبة', icon: '📚' }, { href: '/student/schedule', label: 'جدولي', icon: '🗓' },
  { href: '/student/notifications', label: 'إشعاراتي', icon: '🔔' }, { href: '/student/inquiries', label: 'طلباتي', icon: '💬' }, { href: '/student/profile', label: 'حسابي', icon: '👤' },
];
const devNav: NavItem[] = [
  { href: '/developer', label: 'لوحة المطور', icon: '⌘' }, { href: '/developer/centers', label: 'السناتر', icon: '🏢' }, { href: '/developer/subscriptions', label: 'الاشتراكات', icon: '◆' },
  { href: '/developer/broadcast', label: 'بث وإشعارات', icon: '📣' }, { href: '/developer/support', label: 'دعم العملاء', icon: '💬' }, { href: '/developer/app-info', label: 'حول التطبيق', icon: '⚙' }, { href: '/developer/connection', label: 'الاتصال', icon: '🔌' },
];

function visibleAdminNav(profile: Profile | null, features: MyFeatures | null): NavGroup[] {
  return adminNav.map((group) => ({ ...group, items: group.items.map((item): NavItem | null => {
    if (!profile) return null;
    if (item.feature === 'accounting') {
      // المالك يرى الخدمة مقفلة حتى قبل التفعيل؛ المدير/السكرتير يريانها عند التفعيل لتسليم العهدة فقط.
      if (isOwner(profile)) return { ...item, locked: !features?.accounting };
      if ((profile.role === 'manager' || profile.role === 'secretary') && features?.accounting) return { ...item, ownerOnly: false, locked: false };
      return null;
    }
    if (item.ownerOnly && !isOwner(profile)) return null;
    if (isStaff(profile) && item.perm && !can(profile, item.perm)) return null;
    return item;
  }).filter((item): item is NavItem => item !== null) })).filter((group) => group.items.length > 0);
}

function itemIsActive(pathname: string, href: string, area: string) {
  return pathname === href || (href !== `/${area}` && pathname.startsWith(`${href}/`));
}

export function AppFrame({ area, children }: { area: 'admin' | 'student' | 'developer'; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, subscription, features, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [compact, setCompact] = useState(false);
  const [closedGroups, setClosedGroups] = useState<string[]>([]);

  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    try {
      setCompact(window.localStorage.getItem('mr.sidebar.compact') === '1');
      const stored = JSON.parse(window.localStorage.getItem(`mr.sidebar.closed.${area}`) ?? '[]');
      if (Array.isArray(stored)) setClosedGroups(stored.filter((value): value is string => typeof value === 'string'));
    } catch { /* التخزين اختياري */ }
  }, [area]);
  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 900) setMenuOpen(false); };
    window.addEventListener('resize', onResize); return () => window.removeEventListener('resize', onResize);
  }, []);

  const nav = area === 'admin' ? visibleAdminNav(profile, features) : area === 'student' ? studentNav : devNav;
  const displayRole = area === 'admin' && profile?.role === 'super_admin' ? 'الإدارة' : roleLabel(profile?.role ?? '');
  const updateCompact = () => { const next = !compact; setCompact(next); try { window.localStorage.setItem('mr.sidebar.compact', next ? '1' : '0'); } catch { /* التخزين اختياري */ } };
  const toggleGroup = (title: string) => setClosedGroups((current) => {
    const next = current.includes(title) ? current.filter((item) => item !== title) : [...current, title];
    try { window.localStorage.setItem(`mr.sidebar.closed.${area}`, JSON.stringify(next)); } catch { /* التخزين اختياري */ }
    return next;
  });
  const logout = async () => { await signOut(); router.replace('/'); };

  const renderItem = (item: NavItem) => {
    const active = itemIsActive(pathname, item.href, area);
    return <Link key={item.href} href={item.href} title={compact ? item.label : undefined} className={`nav-link ${active ? 'active' : ''}`} onClick={() => setMenuOpen(false)}><span className="nav-icon">{item.icon}</span><span className="nav-label">{item.label}</span>{item.locked ? <span title="خدمة غير مفعلة" className="nav-lock">🔒</span> : null}</Link>;
  };

  return <div className={`app-shell ${compact ? 'sidebar-compact' : ''}`}>
    <div className="mobile-bar no-print"><div className="brand mobile-brand"><div className="logo">MR</div><strong>Mr Center</strong></div><button type="button" className="hamburger" aria-label="القائمة" onClick={() => setMenuOpen((value) => !value)}>{menuOpen ? '✕' : '☰'}</button></div>
    {menuOpen ? <div className="sidebar-backdrop show" onClick={() => setMenuOpen(false)} /> : null}
    <aside className={`sidebar no-print ${menuOpen ? 'open' : ''}`}>
      <div className="sidebar-brand-row"><Link href="/" className="brand" onClick={() => setMenuOpen(false)}><div className="logo">MR</div><div className="brand-copy"><strong>Mr Center</strong><span>منصة إدارة السنتر</span></div></Link><button type="button" className="sidebar-collapse" aria-label={compact ? 'توسيع القائمة' : 'طي القائمة'} onClick={updateCompact}>{compact ? '›' : '‹'}</button></div>
      <div className="sidebar-profile"><div className="profile-avatar">{(profile?.full_name || 'م').trim().charAt(0)}</div><div className="profile-copy"><strong>{profile?.full_name || 'مستخدم'}</strong><span>{displayRole}</span></div>{area === 'developer' && profile?.role === 'super_admin' ? <Badge tone="info">مطور</Badge> : null}</div>
      {subscription && isOwner(profile) ? <div className="sidebar-plan"><Badge tone={subscription.status === 'active' ? 'success' : 'warn'}>{planLabel(subscription.plan_type)}</Badge>{typeof subscription.days_left === 'number' ? <span>{subscription.days_left} يوم متبقي</span> : null}</div> : null}
      {area === 'admin' && isOwner(profile) && subscription?.status === 'active' && typeof subscription.days_left === 'number' && subscription.days_left <= 7 && subscription.days_left >= 0 ? <div className="sidebar-expiry">⏳ متبقٍ {subscription.days_left} يوم على الباقة</div> : null}
      <nav className="nav-section" aria-label="التنقل الرئيسي">
        {area === 'admin' ? (nav as NavGroup[]).map((group) => {
          const containsActive = group.items.some((item) => itemIsActive(pathname, item.href, area));
          const isClosed = !containsActive && closedGroups.includes(group.title);
          return <section className={`nav-group ${isClosed ? 'closed' : ''}`} style={{ '--nav-accent': group.accent } as React.CSSProperties} key={group.title}><button type="button" className="nav-group-head" onClick={() => toggleGroup(group.title)} aria-expanded={!isClosed}><span className="nav-group-icon">{group.icon}</span><span className="nav-group-title">{group.title}</span><span className="nav-caret">⌄</span></button><div className="nav-group-items">{group.items.map(renderItem)}</div></section>;
        }) : <section className="nav-group flat-nav" style={{ '--nav-accent': area === 'developer' ? '#f59e0b' : '#4f6df5' } as React.CSSProperties}><div className="nav-group-head"><span className="nav-group-icon">{area === 'developer' ? '⌘' : '✦'}</span><span className="nav-group-title">التنقل</span></div><div className="nav-group-items">{(nav as NavItem[]).map(renderItem)}</div></section>}
      </nav>
      <div className="sidebar-footer"><div className="footer-actions">{area === 'admin' && profile?.role === 'super_admin' ? <Button className="block" onClick={() => router.push('/developer')}>⌘ <span className="nav-label">لوحة المطور</span></Button> : null}{area === 'developer' ? <Button variant="secondary" className="block" onClick={() => { setDevUnlocked(false); router.replace('/admin'); }}><span className="nav-label">العودة للسنتر</span></Button> : null}</div><div className="sidebar-utility"><ThemeToggle variant="secondary" /><Link href="/about" title="حول النظام" className="utility-link">؟<span className="nav-label">حول النظام</span></Link></div><Button variant="ghost" className="logout-button" onClick={() => void logout()}>⇥ <span className="nav-label">تسجيل الخروج</span></Button></div>
    </aside>
    <main className="main">{children}</main>
  </div>;
}
