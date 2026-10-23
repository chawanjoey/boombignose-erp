export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5" role="status" aria-live="polite">
      <div className="h-7 w-56 animate-pulse rounded bg-muted" />
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
      <div className="h-96 animate-pulse rounded-2xl bg-muted" />
      <span className="sr-only">Loading ERP records</span>
    </div>
  )
}
