import { useState, useCallback } from 'react'

export function useXlsxDownload() {
  const [downloadProgress, setDownloadProgress] = useState(null)
  // null = idle, { pct: 0-100, label: string } = downloading

  const download = useCallback(async ({ url, filename, headers }) => {
    setDownloadProgress({ pct: 0, label: 'Iniciando descarga…' })
    try {
      const res = await fetch(url, { headers })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body?.detail || `HTTP ${res.status}`)
      }

      const contentLength = Number(res.headers.get('Content-Length') || 0)
      const reader = res.body.getReader()
      const chunks = []
      let received = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        const pct = contentLength > 0 ? Math.round((received / contentLength) * 100) : null
        setDownloadProgress({
          pct,
          label: pct != null ? `Descargando… ${pct}%` : `Descargando… ${(received / 1024).toFixed(0)} KB`,
        })
      }

      const blob = new Blob(chunks, {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename
      link.click()
      URL.revokeObjectURL(objectUrl)
      setDownloadProgress({ pct: 100, label: '¡Descarga completa!' })
      setTimeout(() => setDownloadProgress(null), 1800)
    } catch (err) {
      setDownloadProgress(null)
      throw err
    }
  }, [])

  return { download, downloadProgress }
}
