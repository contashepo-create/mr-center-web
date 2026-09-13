import { redirect } from 'next/navigation';

/** العهدة أصبحت تبويباً ضمن المحاسبة؛ نحافظ على الروابط القديمة بإعادة توجيه آمنة. */
export default function CustodyPage() {
  redirect('/admin/accounting');
}
