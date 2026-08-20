import { redirect } from 'next/navigation';

/**
 * Root Page Redirect
 *
 * All users landing on / are redirected to /dashboard.
 */
export default function RootPage() {
  redirect('/dashboard');
}
