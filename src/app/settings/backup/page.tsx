import { redirect } from 'next/navigation';

// Moved into the owner module (وحدة المالك) — /owner/backup (20261009120000)
export default function Page() {
  redirect('/owner/backup');
}
