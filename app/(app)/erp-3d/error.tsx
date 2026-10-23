"use client"

export default function Error() {
  return (
    <main className="mx-auto w-full max-w-3xl rounded-2xl border bg-card p-8">
      <h1 className="text-xl font-semibold">Unable to open ERP records</h1>
      <p className="mt-2 text-sm text-muted-foreground">The workspace could not be loaded. Try a new request.</p>
      <a className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2" href="/erp-3d">Reload records</a>
    </main>
  )
}
