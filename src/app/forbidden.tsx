import Link from 'next/link';

// Rendered (with HTTP 403) when a page calls forbidden(), e.g. a member opening /admin.
export default function Forbidden() {
  return (
    <div className="narrow stack">
      <h1>403 - Forbidden</h1>
      <p>Your role does not allow this action. Ask an admin in your company.</p>
      <p><Link href="/dashboard">Back to dashboard</Link></p>
    </div>
  );
}
