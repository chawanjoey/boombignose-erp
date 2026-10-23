"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowUpRight, Database, RefreshCw, X } from "lucide-react"
import { buildRecordGraph, recordHref, recordLabel, type ParentRelation } from "@/lib/erp-3d/graph"
import type { ErpRecord, ErpSnapshot, RecordKey, RecordKind } from "@/lib/erp-3d/model"
import { RecordCanvas } from "./canvas"

const KINDS = ["deal", "project", "invoice", "task"] as const
const TITLES: Record<RecordKind, string> = { deal: "Deals", project: "Projects", invoice: "Invoices", task: "Tasks" }

function readable(value: string): string {
  return value.replaceAll("_", " ")
}

function date(value: string | null): string {
  return value ?? "Not set"
}

function recordDates(record: ErpRecord): { label: string; value: string | null }[] {
  switch (record.kind) {
    case "deal": return [{ label: "Expected close", value: record.expectedCloseDate }, { label: "Next follow-up", value: record.nextFollowUpDate }]
    case "project": return [{ label: "Deadline", value: record.deadline }]
    case "invoice": return [{ label: "Due date", value: record.dueDate }]
    case "task": return [{ label: "Due date", value: record.dueDate }]
  }
}

function relationText(relation: ParentRelation | undefined): string {
  if (!relation || relation.state === "none") return "No parent recorded"
  if (relation.state === "loaded") return `Loaded record · ${relation.key.slice(-8)}`
  if (relation.state === "outside-sample") return `${readable(relation.kind)} · ${relation.id.slice(-8)} is outside this sample`
  return `${readable(relation.kind)} · ${relation.id.slice(-8)} could not be checked because that collection is unavailable`
}

export function Erp3dView({ snapshot }: { snapshot: ErpSnapshot }) {
  const graph = useMemo(() => buildRecordGraph(snapshot), [snapshot])
  const [selectedKey, setSelectedKey] = useState<RecordKey | null>(null)
  const selected = selectedKey ? graph.byKey.get(selectedKey) : undefined
  const originRef = useRef<HTMLElement | null>(null)
  const detailRef = useRef<HTMLElement | null>(null)

  function focusDetail() {
    const detail = detailRef.current
    detail?.focus({ preventScroll: true })
    detail?.scrollIntoView({ block: "center", behavior: "auto" })
  }

  const closeDetail = useCallback(() => {
    const origin = originRef.current
    const row = selectedKey ? document.querySelector<HTMLElement>(`[data-testid="erp3d-record-${selectedKey}"]`) : null
    setSelectedKey(null)
    ;(origin?.isConnected ? origin : row)?.focus()
  }, [selectedKey])

  useEffect(() => {
    if (selectedKey) focusDetail()
  }, [selectedKey])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && selectedKey) {
        event.preventDefault()
        closeDetail()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [selectedKey, closeDetail])

  return (
    <main data-testid="erp3d-root" data-scope={snapshot.scope.key} className="mx-auto w-full min-w-0 max-w-7xl space-y-6 overflow-x-hidden pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Workspace records / read only</p>
          <h1 className="text-3xl font-semibold tracking-tight">ERP Record Explorer</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Explore saved deals, projects, invoices and tasks. Each link opens its record in the ERP.</p>
        </div>
        <a data-testid="erp3d-reload" href="/erp-3d" className="inline-flex shrink-0 items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm font-medium shadow-sm transition hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"><RefreshCw aria-hidden="true" className="size-4" /> Reload records</a>
      </div>

      <section aria-label="Snapshot information" className="grid gap-3 rounded-2xl border bg-card p-4 text-sm shadow-sm sm:grid-cols-2 lg:grid-cols-3">
        <div><span className="block text-xs text-muted-foreground">Authorized workspace</span><span data-testid="erp3d-scope" className="font-mono text-xs break-words">{snapshot.scope.orgId}<span className="whitespace-nowrap"> · {snapshot.scope.role}</span></span></div>
        <div><span className="block text-xs text-muted-foreground">Observed</span><time data-testid="erp3d-requested" dateTime={snapshot.requestedAt}>{snapshot.requestedAt}</time><span className="block text-xs text-muted-foreground">through {snapshot.completedAt}</span></div>
        <div><span className="block text-xs text-muted-foreground">Coverage</span><span data-testid="erp3d-coverage">{graph.nodes.length} displayed records · {graph.edges.length} loaded relations</span><span className="block text-xs text-muted-foreground">Four independent queries, not one atomic database snapshot.</span></div>
      </section>

      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)]">
        <RecordCanvas graph={graph} selectedKey={selectedKey} onSelect={(key, origin) => { originRef.current = origin; setSelectedKey(key); if (selectedKey === key) focusDetail() }} />

        <aside ref={detailRef} tabIndex={selected ? -1 : undefined} className="min-w-0 focus-visible:rounded-2xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring lg:sticky lg:top-20 lg:self-start" aria-label="Selected record details">
          {selected ? (
            <div data-testid="erp3d-detail" className="rounded-2xl border bg-card p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-wider text-muted-foreground">Selected record</p><h2 className="mt-1 break-all font-mono text-lg font-semibold">{recordLabel(selected)}</h2></div><button type="button" aria-label="Close details" onClick={closeDetail} className="rounded-md p-2 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><X className="size-4" /></button></div>
              <dl className="mt-5 space-y-3 text-sm">
                <div><dt className="text-xs text-muted-foreground">Record ID</dt><dd data-testid="erp3d-detail-id" className="break-all font-mono text-xs">{selected.id}</dd></div>
                <div><dt className="text-xs text-muted-foreground">Stored status</dt><dd data-testid="erp3d-detail-status" className="capitalize">{readable(selected.status)}</dd></div>
                {recordDates(selected).map(({ label, value }) => <div key={label}><dt className="text-xs text-muted-foreground">{label}</dt><dd>{date(value)}</dd></div>)}
                {selected.kind === "invoice" && <div><dt className="text-xs text-muted-foreground">Issued snapshot</dt><dd>{selected.issued ? "Issued" : "Not issued"}</dd></div>}
                {selected.kind === "task" && <div><dt className="text-xs text-muted-foreground">Done flag</dt><dd>{selected.done ? "Done" : "Not done"}</dd></div>}
                {selected.kind !== "deal" && <div><dt className="text-xs text-muted-foreground">Parent relation</dt><dd data-testid="erp3d-detail-parent">{relationText(graph.parent.get(selected.key))}</dd></div>}
              </dl>
              <a data-testid="erp3d-detail-link" href={recordHref(selected)} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Open in ERP <ArrowUpRight aria-hidden="true" className="size-4" /></a>
              {selected.kind === "task" && <p className="mt-2 text-xs text-muted-foreground">Tasks open on their project page.</p>}
            </div>
          ) : (
            <div data-testid="erp3d-detail-empty" className="rounded-2xl border border-dashed bg-card/50 p-7 text-sm text-muted-foreground"><p className="font-medium text-foreground">Select a record</p><p className="mt-2">Choose any row to see its stored status, dates, relationship and direct link.</p></div>
          )}
        </aside>
      </div>

      <div className="grid min-w-0 items-start gap-5 md:grid-cols-2">
          {KINDS.map((kind) => {
            const collection = snapshot.collections[kind]
            return (
              <section key={kind} data-testid={`erp3d-${kind}-collection`} className="min-w-0 overflow-hidden rounded-2xl border bg-card shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-4 sm:px-5">
                  <h2 className="flex items-center gap-2 text-lg font-semibold"><Database aria-hidden="true" className="size-4 text-muted-foreground" />{TITLES[kind]}</h2>
                  <div className="text-sm text-muted-foreground" data-testid={`erp3d-${kind}-count`}>
                    {collection.state === "unavailable" ? "Count unavailable" : `${collection.displayed} displayed / ${collection.total} total`}
                  </div>
                </div>
                {collection.state === "unavailable" ? (
                  <div data-testid={`erp3d-${kind}-unavailable`} className="p-5 text-sm text-destructive">This collection could not be loaded. <a className="underline underline-offset-2" href="/erp-3d">Try again</a>.</div>
                ) : collection.state === "empty" ? (
                  <p data-testid={`erp3d-${kind}-empty`} className="p-5 text-sm text-muted-foreground">No {TITLES[kind].toLowerCase()} are recorded in this workspace.</p>
                ) : (
                  <>
                    {collection.truncated && <p data-testid={`erp3d-${kind}-subset`} className="border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground sm:px-5">Showing the first {collection.displayed} by ID. Other records are outside this sample.</p>}
                    <ul className="divide-y">
                      {collection.records.map((record) => (
                        <li key={record.key}>
                          <button type="button" data-testid={`erp3d-record-${record.key}`} aria-pressed={selectedKey === record.key} onClick={(event) => { originRef.current = event.currentTarget; setSelectedKey(record.key); if (selectedKey === record.key) focusDetail() }} className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring aria-pressed:bg-accent sm:px-5">
                            <span className="min-w-0"><span className="block font-mono text-sm font-medium">{recordLabel(record)}</span><span className="mt-0.5 block text-xs capitalize text-muted-foreground">{readable(record.status)}</span></span>
                            <span className="shrink-0 rounded-full border px-2 py-1 text-xs text-muted-foreground">View details</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            )
          })}
      </div>
    </main>
  )
}
