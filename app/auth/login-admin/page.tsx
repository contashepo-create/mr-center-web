import { redirect } from 'next/navigation';
export default function LoginAdminAlias() { redirect('/auth/login?role=admin'); }
