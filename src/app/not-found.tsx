import Link from 'next/link';

// Also used for resources that belong to another company: we never reveal that they exist.
export default function NotFound() {
  return (
    <div className="narrow stack">
      <h1>404 - Not found</h1>
      <p>This page does not exist, or you do not have access to it.</p>
      <p><Link href="/dashboard">Back to dashboard</Link></p>
    </div>
  );
}
