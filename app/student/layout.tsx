import { AppFrame } from '@/components/app-frame';
import { RequireAuth } from '@/components/guards';

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth roles={['student']}>
      <AppFrame area="student">{children}</AppFrame>
    </RequireAuth>
  );
}
