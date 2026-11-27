'use client'

import { useEffect, useState } from 'react'

export function RecordHash({ value }: { value: string }) {
  const [digest, setDigest] = useState('')
  useEffect(() => {
    let active = true
    setDigest('')
    if (!globalThis.crypto?.subtle) return
    void crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(value))
      .then((buffer) => {
        if (active)
          setDigest(
            Array.from(new Uint8Array(buffer), (byte) =>
              byte.toString(16).padStart(2, '0'),
            ).join(''),
          )
      })
    return () => {
      active = false
    }
  }, [value])
  return <code>{digest || 'Preparing record hash…'}</code>
}
