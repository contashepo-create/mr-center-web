import { AppFrame } from '@/components/app-frame';
import { RequireAuth } from '@/components/guards';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth roles={['center_admin', 'teacher', 'manager', 'secretary']}>
      <AppFrame area="admin">{children}</AppFrame>
    </RequireAuth>
  );
}
