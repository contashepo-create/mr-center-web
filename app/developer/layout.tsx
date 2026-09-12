import { AppFrame } from '@/components/app-frame';
import { DeveloperGate } from '@/components/dev-gate';
import { RequireAuth } from '@/components/guards';

export default function DeveloperLayout({ children }: { children: React.ReactNode }) {
  return (
    <RequireAuth roles={['super_admin']}>
      <DeveloperGate>
        <AppFrame area="developer">{children}</AppFrame>
      </DeveloperGate>
    </RequireAuth>
  );
}
