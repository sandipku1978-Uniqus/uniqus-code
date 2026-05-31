/**
 * Top-level route loading state (Next.js App Router convention). Shown while a
 * segment under the root layout streams in. Kept minimal and self-contained:
 * a subtle brand-tinted spinner centered on the app background, styled inline
 * against the design tokens so it works before any segment CSS resolves.
 */
export default function Loading() {
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg-dark)",
      }}
    >
      <style>{`@keyframes uq-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        aria-label="Loading"
        role="status"
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          border: "2.5px solid var(--border-default)",
          borderTopColor: "var(--accent)",
          animation: "uq-spin 0.7s linear infinite",
        }}
      />
    </div>
  );
}
