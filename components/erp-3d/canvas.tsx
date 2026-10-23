"use client"

import { useEffect, useRef, useState } from "react"
import type { RecordGraph } from "@/lib/erp-3d/graph"
import type { RecordKey, RecordKind } from "@/lib/erp-3d/model"
import type { RecordSceneHandle } from "./scene"
import styles from "./erp-3d.module.css"

const LEGEND: { kind: RecordKind; label: string; shape: string }[] = [
  { kind: "deal", label: "Deals", shape: "◇" },
  { kind: "project", label: "Projects", shape: "■" },
  { kind: "invoice", label: "Invoices", shape: "●" },
  { kind: "task", label: "Tasks", shape: "▲" },
]

export function RecordCanvas({ graph, selectedKey, onSelect }: { graph: RecordGraph; selectedKey: RecordKey | null; onSelect(key: RecordKey, origin: HTMLCanvasElement): void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<RecordSceneHandle | null>(null)
  const selectRef = useRef(onSelect)
  const selectedRef = useRef(selectedKey)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading")
  useEffect(() => { selectRef.current = onSelect; selectedRef.current = selectedKey }, [onSelect, selectedKey])

  useEffect(() => {
    let active = true
    let mounted: RecordSceneHandle | null = null
    const host = hostRef.current
    if (!host) return
    import("./scene").then(({ mountRecordScene }) => {
      if (!active) return
      try {
        mounted = mountRecordScene(host, graph, {
          onSelect: (key) => {
            const canvas = host.querySelector("canvas")
            if (canvas) selectRef.current(key, canvas)
          },
          onUnavailable: () => { if (active) setState("unavailable") },
        })
        handleRef.current = mounted
        mounted.focus(selectedRef.current)
        setState("ready")
      } catch {
        setState("unavailable")
      }
    }).catch(() => { if (active) setState("unavailable") })
    return () => {
      active = false
      mounted?.dispose()
      if (handleRef.current === mounted) handleRef.current = null
    }
  }, [graph, attempt])

  useEffect(() => { handleRef.current?.focus(selectedKey) }, [selectedKey])

  return (
    <section aria-label="Record map" className={styles.panel}>
      <div className={styles.heading}>
        <div><p className={styles.eyebrow}>Spatial overview</p><h2 className={styles.title}>Records in view</h2></div>
        <div className={styles.actions}><span className={styles.badge}>{graph.nodes.length} records</span><button type="button" onClick={() => handleRef.current?.focus(selectedRef.current, true)} disabled={state !== "ready"}>Reset view</button></div>
      </div>
      <p className={styles.explainer}>Drag to rotate, scroll to zoom, or select a shape. Positions group record types for browsing. They do not show physical locations or financial value.</p>
      <div className={styles.stage}>
        <div ref={hostRef} data-testid="erp3d-scene" data-state={state} className={styles.canvas} />
        {state === "loading" && <p className={styles.status}>Opening record map…</p>}
        {state === "unavailable" && <div className={styles.fallback}><p>The 3D map is unavailable. The record list below is ready to use.</p><button type="button" onClick={() => { setState("loading"); setAttempt((value) => value + 1) }}>Try 3D map again</button></div>}
      </div>
      <div className={styles.legend} aria-label="Shape legend">
        {LEGEND.map(({ kind, label, shape }) => <span key={kind} className={styles.legendItem} data-kind={kind}><span aria-hidden="true" className={styles.symbol}>{shape}</span>{label}<strong>{graph.nodes.filter((node) => node.kind === kind).length}</strong></span>)}
      </div>
      <p className={styles.footnote}>Lines appear for saved relationships of the selected record when both records are in this sample. Every record remains available in the list below.</p>
    </section>
  )
}
