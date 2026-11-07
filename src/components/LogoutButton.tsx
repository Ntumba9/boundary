'use client';

import { useRouter } from 'next/navigation';
import { api } from '@/lib/client/api';

export function LogoutButton() {
  const router = useRouter();
  async function onClick() {
    await api('POST', '/api/auth/logout');
    router.replace('/login');
    router.refresh();
  }
  return (
    <button type="button" className="link-button" onClick={onClick}>
      Log out
    </button>
  );
}
