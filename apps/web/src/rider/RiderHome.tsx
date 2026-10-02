/**
 * Rider view: assigned deliveries, status updates and pay-on-delivery confirmation.
 * Lives in the storefront app so riders install one PWA on their phones.
 * Built in the payments and delivery phase (weeks 7–8).
 */
export default function RiderHome() {
  return (
    <main className="container" style={{ maxWidth: 480, paddingTop: 24 }}>
      <h1 style={{ fontSize: 22 }}>Rider deliveries</h1>
      <p className="muted">Sign in to see the deliveries assigned to you.</p>
    </main>
  );
}
