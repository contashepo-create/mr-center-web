import { redirect } from 'next/navigation';
export default function LoginStudentAlias() { redirect('/auth/login?role=student'); }
