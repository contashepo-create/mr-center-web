import { redirect } from 'next/navigation';
export default function LoginTeacherAlias() { redirect('/auth/login?role=teacher'); }
