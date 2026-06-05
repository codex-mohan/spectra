import { useRef, useState, useCallback } from "react"
import type { SecurityManager } from "../../security/index.js"
import type { PermissionRequest } from "../../security/types.js"

export function usePermissionQueue(securityRef: React.MutableRefObject<SecurityManager | null>) {
  const permissionQueueRef = useRef<PermissionRequest[]>([])
  const [permissionRequest, setPermissionRequest] = useState<PermissionRequest | null>(null)

  const showNextPermission = useCallback(() => {
    const next = permissionQueueRef.current[0] ?? null
    setPermissionRequest(next)
  }, [])

  const enqueuePermission = useCallback((req: PermissionRequest) => {
    permissionQueueRef.current.push(req)
    if (!permissionRequest) {
      showNextPermission()
    }
  }, [permissionRequest, showNextPermission])

  const resolvePermission = useCallback((id: string, response: { action: "once" | "always" | "deny" }) => {
    securityRef.current?.respondToRequest(id, response)
    permissionQueueRef.current = permissionQueueRef.current.filter((r) => r.id !== id)
    showNextPermission()
  }, [showNextPermission])

  return {
    permissionRequest,
    enqueuePermission,
    resolvePermission,
  }
}
