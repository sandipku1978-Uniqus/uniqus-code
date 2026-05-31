/**
 * Workspace route loading state (Next.js App Router convention). Shown while
 * the project segment streams in. Mirrors the workspace shell background
 * (`--bg-pane`, the IDE pane/topbar surface) so the swap into the real
 * Workspace is seamless. Self-contained inline styles against the design
 * tokens, with a brand-tinted spinner and a context label.
 */
export default function Loading() {
  return (
    <div
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg-pane)",
      }}
    >
      <style>{`@keyframes uq-spin { to { transform: rotate(360deg); } }`}</style>
      <div
        role="status"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 14,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "2.5px solid var(--border-default)",
            borderTopColor: "var(--accent)",
            animation: "uq-spin 0.7s linear infinite",
          }}
        />
        <span style={{ color: "var(--text-muted)", fontSize: 14 }}>
          Loading project…
        </span>
      </div>
    </div>
  );
}
