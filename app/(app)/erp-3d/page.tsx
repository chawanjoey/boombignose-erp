import type { Metadata } from "next"
import { Erp3dView } from "@/components/erp-3d/view"
import { readErpScene } from "@/lib/erp-3d/snapshot.server"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "ERP Record Explorer · BoomBigNose Company OS",
}

export default async function Erp3dPage() {
  const snapshot = await readErpScene()
  return <Erp3dView key={snapshot.scope.key} snapshot={snapshot} />
}
