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

interface NavGroup {
  title: string;
  items: NavItem[];
}

const adminNav: NavGroup[] = [
  {
    title: 'الرئيسية',
    items: [
      { href: '/admin', label: 'الرئيسية', icon: '⌂' },
    ],
  },
  {
    title: 'الطلاب والتعليم',
    items: [
      { href: '/admin/students', label: 'الطلاب', icon: '👥' },
      { href: '/admin/groups', label: 'المجموعات', icon: '🗂' },
      { href: '/admin/attendance', label: 'الحضور', icon: '✓', perm: 'attendance' },
      { href: '/admin/grades', label: 'الدرجات', icon: '★', perm: 'grades' },
      { href: '/admin/exams', label: 'الاختبارات', icon: '📝', perm: 'exams' },
      { href: '/admin/schedule', label: 'الجدول', icon: '🗓' },
      { href: '/admin/surveys', label: 'الاستبيانات', icon: '📋', perm: 'surveys' },
      { href: '/admin/library', label: 'المكتبة والشرف', icon: '📚', perm: 'honors' },
    ],
  },
  {
    title: 'المال',
    items: [
      { href: '/admin/payments', label: 'المدفوعات', icon: '💳', perm: 'collect' },
      { href: '/admin/accounting', label: 'المحاسبة', icon: '💼', ownerOnly: true, feature: 'accounting' },
      { href: '/admin/custody', label: 'العهدة', icon: '🧾' },
      { href: '/admin/reports', label: 'التقارير', icon: '📊', perm: 'reports' },
    ],
  },
  {
    title: 'التواصل',
    items: [
      { href: '/admin/announcements', label: 'الإعلانات', icon: '📣', perm: 'announcements' },
      { href: '/admin/notifications', label: 'الإشعارات', icon: '🔔', perm: 'notify' },
      { href: '/admin/whatsapp', label: 'واتساب', icon: '☏', perm: 'notify' },
      { href: '/admin/inquiries', label: 'طلبات الطلاب', icon: '💬', perm: 'inquiries' },
      { href: '/admin/support', label: 'الدعم', icon: '🎧', ownerOnly: true },
    ],
  },
  {
    title: 'الإدارة',
    items: [
      { href: '/admin/staff', label: 'فريق العمل', icon: '🧑‍🏫', ownerOnly: true },
      { href: '/admin/settings', label: 'الإعدادات', icon: '⚙', ownerOnly: true },
      { href: '/admin/subscription', label: 'الاشتراك', icon: '◆', ownerOnly: true },
      { href: '/admin/scan', label: 'ماسح QR', icon: '▣', perm: 'attendance' },
      { href: '/admin/activity', label: 'النشاط', icon: '≋', ownerOnly: true },
      { href: '/admin/dev-notices', label: 'تنبيهات المطور', icon: '🛡', ownerOnly: true },
      { href: '/admin/guide', label: 'الدليل', icon: '؟' },
    ],
  },
];

const studentNav: NavItem[] = [
  { href: '/student', label: 'الرئيسية', icon: '⌂' },
  { href: '/student/attendance', label: 'حضوري', icon: '✓' },
  { href: '/student/grades', label: 'درجاتي', icon: '★' },
  { href: '/student/report', label: 'تقريري', icon: '🧾' },
  { href: '/student/payments', label: 'مدفوعاتي', icon: '💳' },
  { href: '/student/exams', label: 'اختباراتي', icon: '📝' },
  { href: '/student/surveys', label: 'استبياناتي', icon: '📋' },
  { href: '/student/library', label: 'المكتبة', icon: '📚' },
  { href: '/student/schedule', label: 'جدولي', icon: '🗓' },
  { href: '/student/notifications', label: 'إشعاراتي', icon: '🔔' },
  { href: '/student/inquiries', label: 'طلباتي', icon: '💬' },
  { href: '/student/profile', label: 'حسابي', icon: '👤' },
];

const devNav: NavItem[] = [
  { href: '/developer', label: 'لوحة المطور', icon: '⌘' },
  { href: '/developer/centers', label: 'السناتر', icon: '🏢' },
  { href: '/developer/subscriptions', label: 'الاشتراكات', icon: '◆' },
  { href: '/developer/broadcast', label: 'بث وإشعارات', icon: '📣' },
  { href: '/developer/support', label: 'دعم العملاء', icon: '💬' },
  { href: '/developer/app-info', label: 'حول التطبيق', icon: '⚙' },
  { href: '/developer/connection', label: 'الاتصال', icon: '🔌' },
];

function visibleAdminNav(profile: Profile | null, features: MyFeatures | null): NavGroup[] {
  return adminNav
    .map((group): NavGroup => ({
      title: group.title,
      items: group.items
        .map((item): NavItem | null => {
          if (!profile) return null;
          // قسم المحاسبة: يظهر لصاحب السنتر دائماً — مقفلاً برسالة عدم الاشتراك إن لم تكن الخدمة مفعلة.
          if (item.feature === 'accounting') {
            if (!isOwner(profile)) return null;
            return { ...item, locked: !features?.accounting };
          }
          if (item.ownerOnly && !isOwner(profile)) return null;
          if (isStaff(profile) && item.perm && !can(profile, item.perm)) return null;
          return item;
        })
        .filter((item): item is NavItem => item !== null),
    }))
    .filter((group) => group.items.length > 0);
}

export function AppFrame({ area, children }: { area: 'admin' | 'student' | 'developer'; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, subscription, features, signOut } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  // إغلاق القائمة تلقائياً عند تغيير المسار أو تكبير الشاشة
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    const onResize = () => { if (window.innerWidth > 900) setMenuOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const nav = area === 'admin' ? visibleAdminNav(profile, features) : area === 'student' ? studentNav : devNav;
  const displayRole = area === 'admin' && profile?.role === 'super_admin' ? 'الإدارة' : roleLabel(profile?.role ?? '');

  const exitDevPanel = () => {
    setDevUnlocked(false);
    router.replace('/admin');
  };

  const logout = async () => {
    await signOut();
    router.replace('/');
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      <div className="mobile-bar no-print">
        <div className="brand" style={{ marginBottom: 0, gap: 10 }}>
          <div className="logo" style={{ width: 38, height: 38, fontSize: '.8rem' }}>MR</div>
          <strong>Mr Center</strong>
        </div>
        <button type="button" className="hamburger" aria-label="القائمة" onClick={() => setMenuOpen((v) => !v)}>{menuOpen ? '✕' : '☰'}</button>
      </div>
      {menuOpen ? <div className="sidebar-backdrop show" onClick={closeMenu} /> : null}
      <aside className={`sidebar no-print ${menuOpen ? 'open' : ''}`}>
        <Link href="/" className="brand" onClick={closeMenu}>
          <div className="logo">MR</div>
          <div>
            <strong>Mr Center</strong>
            <div className="tiny muted">Web Console</div>
          </div>
        </Link>

        <div className="card compact soft stack" style={{ marginBottom: 16 }}>
          <div className="row-between">
            <div>
              <strong>{profile?.full_name || 'مستخدم'}</strong>
              <div className="tiny muted">{displayRole}</div>
            </div>
            {area === 'developer' && profile?.role === 'super_admin' ? <Badge tone="info">مطور</Badge> : null}
          </div>
          {subscription && isOwner(profile) ? (
            <div className="row">
              <Badge tone={subscription.status === 'active' ? 'success' : 'warn'}>{planLabel(subscription.plan_type)}</Badge>
              {typeof subscription.days_left === 'number' ? <span className="tiny muted">{subscription.days_left} يوم متبقي</span> : null}
            </div>
          ) : null}
          {area === 'admin' && isOwner(profile)
            && subscription?.status === 'active'
            && typeof subscription.days_left === 'number'
            && subscription.days_left <= 7
            && subscription.days_left >= 0 ? (
            <div className="notice warn" style={{ marginTop: 10, fontSize: '.82rem', padding: '9px 12px' }}>
              ⏳ باقتك على وشك الانتهاء (متبقٍ {subscription.days_left} يوم) — يمكنك طلب التجديد أو الترقية من صفحة الاشتراك.
            </div>
          ) : null}
        </div>

        <nav className="nav-section" aria-label="التنقل الرئيسي">
          {area === 'admin'
            ? (nav as NavGroup[]).map((group) => (
                <div key={group.title} style={{ marginBottom: 14 }}>
                  <p className="nav-title">{group.title}</p>
                  {group.items.map((item) => {
                    const active = pathname === item.href || (item.href !== `/${area}` && pathname.startsWith(item.href));
                    return (
                      <Link key={item.href} href={item.href} className={`nav-link ${active ? 'active' : ''}`} onClick={closeMenu}>
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                        {item.locked ? <span title="خدمة غير مفعلة" style={{ marginInlineStart: 'auto' }}>🔒</span> : null}
                      </Link>
                    );
                  })}
                </div>
              ))
            : (nav as NavItem[]).map((item) => {
                const active = pathname === item.href || (item.href !== `/${area}` && pathname.startsWith(item.href));
                return (
                  <Link key={item.href} href={item.href} className={`nav-link ${active ? 'active' : ''}`} onClick={closeMenu}>
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                    {item.locked ? <span title="خدمة غير مفعلة" style={{ marginInlineStart: 'auto' }}>🔒</span> : null}
                  </Link>
                );
              })}
        </nav>

        <div style={{ marginTop: 24 }} className="stack">
          {area === 'admin' && profile?.role === 'super_admin' ? (
            <Button className="block" onClick={() => router.push('/developer')}>⌘ لوحة المطور</Button>
          ) : null}
          {area === 'developer' ? (
            <Button variant="secondary" className="block" onClick={exitDevPanel}>العودة للوحة السنتر</Button>
          ) : null}
          <div className="row">
            <ThemeToggle variant="secondary" />
            <Link className="nav-link" href="/about" style={{ flex: 1 }}><span>؟</span><span>حول النظام</span></Link>
          </div>
          <Button variant="secondary" onClick={logout}>تسجيل الخروج</Button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
