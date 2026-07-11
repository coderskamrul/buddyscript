export default function FullPageLoader() {
  return (
    <div
      className="bs-ui flex min-h-screen items-center justify-center"
      role="status"
      aria-live="polite"
    >
      <span
        className="inline-block h-10 w-10 animate-spin rounded-full border-[3px] border-brand/20 border-t-brand"
        aria-hidden="true"
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
