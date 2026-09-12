import { AppFrame } from '@/components/app-frame';
import { RequireAuth } from '@/components/guards';

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth roles={['super_admin']}>
      <AppFrame area="developer">{children}</AppFrame>
    </RequireAuth>
  );
}
