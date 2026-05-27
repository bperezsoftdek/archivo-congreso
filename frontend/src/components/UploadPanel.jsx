import { useState, useRef, useEffect } from 'react'
import { API_BASE, formatApiError } from '../utils/api'

const STATUS_LABEL = {
  reading: 'Leyendo archivo...',
  checking: 'Verificando duplicados...',
  inserting: 'Insertando registros...',
  done: 'Carga completada',
  error: 'Error en la carga',
  warning: 'Carga completada con advertencias',
}

const TIPO_DUP_LABEL = {
  ya_en_base_de_datos: 'Ya en base de datos',
  repetido_en_archivo: 'Repetido en el archivo',
}

export default function UploadPanel({ tablas, token }) {
  const [tabla, setTabla] = useState('')
  const [file, setFile] = useState(null)
  const [over, setOver] = useState(false)
  const [jobId, setJobId] = useState(null)
  const [job, setJob] = useState(null)
  const [uploadWarnings, setUploadWarnings] = useState([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef()
  const pollRef = useRef()

  const authHeaders = { Authorization: `Bearer ${token}` }

  const clearSelectedFile = () => {
    setFile(null)
    if (inputRef.current) inputRef.current.value = ''
  }

  const handleFile = (f) => {
    if (!f) return
    const ext = f.name.toLowerCase()
    if (!ext.endsWith('.xlsx') && !ext.endsWith('.xls')) {
      setJob({ status: 'error', message: 'Solo se permiten archivos Excel (.xlsx, .xls)' })
      return
    }
    setFile(f)
    setJob(null)
    setJobId(null)
    setUploadWarnings([])
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  useEffect(() => {
    if (!jobId) return
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/upload/progress/${jobId}`, { headers: authHeaders })
        const data = await res.json()
        if (!res.ok) {
          clearInterval(pollRef.current)
          setLoading(false)
          setJob({ status: 'error', message: formatApiError(data, `Error HTTP ${res.status}`) })
          return
        }
        const merged = {
          ...data,
          warnings: [...uploadWarnings, ...(data.warnings || [])],
        }
        setJob(merged)
        if (data.status === 'done' || data.status === 'error' || data.status === 'warning') {
          clearInterval(pollRef.current)
          setLoading(false)
          if (data.status === 'done') clearSelectedFile()
        }
      } catch (e) {
        clearInterval(pollRef.current)
        setLoading(false)
        setJob({ status: 'error', message: e.message })
      }
    }, 800)
    return () => clearInterval(pollRef.current)
  }, [jobId, token, uploadWarnings])

  const handleUpload = async () => {
    if (!tabla || !file) return
    setLoading(true)
    setUploadWarnings([])
    setJob({ status: 'reading', progress: 0, inserted: 0, total: 0, errors: 0, duplicates: 0 })

    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch(`${API_BASE}/upload/${tabla}`, {
        method: 'POST',
        body: form,
        headers: authHeaders,
      })
      const data = await res.json()
      if (!res.ok) {
        setJob({ status: 'error', message: formatApiError(data, `Error HTTP ${res.status}`) })
        setLoading(false)
        return
      }
      if (data.warnings?.length) {
        setUploadWarnings(data.warnings)
        setJob(prev => ({ ...prev, warnings: data.warnings }))
      }
      if (data.job_id) {
        setJobId(data.job_id)
      } else {
        setJob({ status: 'error', message: formatApiError(data, 'No se recibió job_id del servidor') })
        setLoading(false)
      }
    } catch (e) {
      setJob({ status: 'error', message: e.message })
      setLoading(false)
    }
  }

  const handleDownloadReport = async (url, filename) => {
    try {
      const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`
      const res = await fetch(fullUrl, { headers: authHeaders })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setJob(prev => ({
          ...prev,
          status: 'warning',
          message: formatApiError(body, `No se pudo descargar ${filename}`),
        }))
        return
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(objectUrl)
    } catch (e) {
      setJob(prev => ({ ...prev, status: 'warning', message: e.message }))
    }
  }

  const progress = job?.progress ?? 0
  const statusMsg = job ? (STATUS_LABEL[job.status] ?? job.status) : ''
  const allWarnings = job?.warnings || uploadWarnings
  const r = job?.result

  return (
    <div className="card">
      <h2>Carga masiva de documentos</h2>

      <div className="filters" style={{ marginBottom: '1rem' }}>
        <label>
          Tipo documental
          <select value={tabla} onChange={e => { setTabla(e.target.value); setJob(null); setJobId(null); clearSelectedFile(); setUploadWarnings([]) }}>
            <option value="">-- Seleccionar --</option>
            {tablas.map(t => <option key={t.tabla} value={t.tabla}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div
        className={`drop-zone ${over ? 'over' : ''}`}
        onDragOver={e => { e.preventDefault(); setOver(true) }}
        onDragLeave={() => setOver(false)}
        onDrop={handleDrop}
        onClick={() => !loading && inputRef.current.click()}
        style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
      >
        {file
          ? <span><strong>{file.name}</strong> ({(file.size / 1024 / 1024).toFixed(1)} MB)</span>
          : <span>Arrastra el archivo Excel aqui<br /><small>o haz clic para seleccionar</small></span>
        }
        <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden
          onChange={e => handleFile(e.target.files[0])} />
      </div>

      {allWarnings.length > 0 && (
        <div className="result-box" style={{ marginTop: '1rem', background: '#fff8e6', borderColor: '#f6ad55' }}>
          {allWarnings.map((w, i) => <p key={i} style={{ margin: '0.25rem 0', fontSize: '0.9rem' }}>{w}</p>)}
        </div>
      )}

      {job && (
        <div style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '0.3rem' }}>
            <span>{statusMsg}</span>
            <strong>{progress}%</strong>
          </div>
          <div className="progress-bar">
            <div style={{
              width: `${progress}%`,
              background: job.status === 'error' ? '#e53e3e' : job.status === 'done' ? '#38a169' : job.status === 'warning' ? '#d69e2e' : '#1a3a5c',
              transition: 'width 0.4s ease'
            }} />
          </div>
          {job.status === 'inserting' && job.total > 0 && (
            <p style={{ fontSize: '0.8rem', color: '#555', marginTop: '0.3rem' }}>
              {job.inserted.toLocaleString()} de {job.total.toLocaleString()} registros insertados
              {job.duplicates > 0 && <span style={{ color: '#c05621' }}> · {job.duplicates} filas omitidas (duplicados)</span>}
              {job.errors > 0 && <span style={{ color: '#e53e3e' }}> · {job.errors} errores</span>}
            </p>
          )}
          {(job.message || r?.resumen) && job.status !== 'error' && (
            <p style={{ fontSize: '0.85rem', color: '#744210', marginTop: '0.4rem' }}>{r?.resumen || job.message}</p>
          )}
        </div>
      )}

      <div style={{ marginTop: '1rem' }}>
        <button className="btn" onClick={handleUpload} disabled={!tabla || !file || loading}>
          {loading ? 'Procesando...' : 'Subir archivo'}
        </button>
        {job?.status === 'done' && (
          <button className="btn secondary" style={{ marginLeft: '0.5rem' }}
            onClick={() => { clearSelectedFile(); setJob(null); setJobId(null); setUploadWarnings([]) }}>
            Nueva carga
          </button>
        )}
      </div>

      {job?.status === 'done' && r && (
        <div className="result-box" style={{ marginTop: '1rem' }}>
          <p style={{ marginBottom: '0.75rem' }}>{r.resumen}</p>

          <div className="upload-resumen-grid">
            <div className="upload-resumen-item success">
              <span className="upload-resumen-num">{r.insertadas?.toLocaleString() ?? 0}</span>
              <span className="upload-resumen-label">Insertados en BD</span>
            </div>
            <div className="upload-resumen-item warn">
              <span className="upload-resumen-num">{r.duplicados_bd?.toLocaleString() ?? 0}</span>
              <span className="upload-resumen-label">Ya en base de datos</span>
              <small>Mismos metadatos que un registro existente</small>
            </div>
            <div className="upload-resumen-item warn">
              <span className="upload-resumen-num">{r.duplicados_archivo?.toLocaleString() ?? 0}</span>
              <span className="upload-resumen-label">Repetidos en el Excel</span>
              <small>Filas duplicadas dentro del archivo</small>
            </div>
            <div className="upload-resumen-item muted">
              <span className="upload-resumen-num">{r.total_filas_excel?.toLocaleString() ?? 0}</span>
              <span className="upload-resumen-label">Filas en el Excel</span>
            </div>
          </div>

          {r.errores > 0 && (
            <p style={{ color: '#c05621', marginTop: '0.5rem' }}>{r.errores} fila(s) con error de inserción</p>
          )}

          {r.columnas_no_encontradas?.length > 0 && (
            <p style={{ color: '#c05621', marginTop: '0.3rem' }}>
              Columnas no encontradas: {r.columnas_no_encontradas.join(', ')}
            </p>
          )}

          {r.archivos_reporte?.duplicados_bd && (
            <div className="dup-report-box dup-report-bd">
              <h3>{r.archivos_reporte.duplicados_bd.titulo || 'Duplicados en base de datos'}</h3>
              <p>{r.archivos_reporte.duplicados_bd.descripcion}</p>
              <button
                type="button"
                className="btn secondary"
                onClick={() => handleDownloadReport(
                  r.archivos_reporte.duplicados_bd.url,
                  r.archivos_reporte.duplicados_bd.filename,
                )}
              >
                Descargar reporte (.xlsx)
              </button>
            </div>
          )}

          {r.archivos_reporte?.duplicados_archivo && (
            <div className="dup-report-box dup-report-file">
              <h3>{r.archivos_reporte.duplicados_archivo.titulo || 'Repetidos en el archivo'}</h3>
              <p>{r.archivos_reporte.duplicados_archivo.descripcion}</p>
              <button
                type="button"
                className="btn secondary"
                onClick={() => handleDownloadReport(
                  r.archivos_reporte.duplicados_archivo.url,
                  r.archivos_reporte.duplicados_archivo.filename,
                )}
              >
                Descargar reporte (.xlsx)
              </button>
            </div>
          )}

          {(r.duplicados_detalle_bd?.length > 0 || r.duplicados_detalle_archivo?.length > 0) && (
            <details style={{ marginTop: '0.75rem' }}>
              <summary style={{ cursor: 'pointer', fontWeight: 'bold', fontSize: '0.9rem' }}>
                Ver detalle de filas omitidas (
                {(r.duplicados_detalle_bd?.length || 0) + (r.duplicados_detalle_archivo?.length || 0)})
              </summary>
              <div className="dup-detalle-list">
                {r.duplicados_detalle_bd?.map((d, idx) => (
                  <div key={`bd-${idx}`} className="dup-detalle-item dup-detalle-bd">
                    <strong>Fila {d.fila_excel}</strong> — {TIPO_DUP_LABEL.ya_en_base_de_datos}
                    {d.codigo_referencia && <> · Código: <em>{d.codigo_referencia}</em></>}
                    <p>{d.mensaje}</p>
                  </div>
                ))}
                {r.duplicados_detalle_archivo?.map((d, idx) => (
                  <div key={`ar-${idx}`} className="dup-detalle-item dup-detalle-ar">
                    <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                      <span>📋 <strong>Fila repetida: {d.fila_excel}</strong></span>
                      {d.fila_original != null && (
                        <span>🔁 Es igual a la <strong>fila {d.fila_original}</strong> (primera aparición)</span>
                      )}
                      {d.codigo_referencia && <span>Código: <em>{d.codigo_referencia}</em></span>}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.82rem', color: '#744210' }}>
                      Esta fila tiene exactamente los mismos datos que la fila {d.fila_original ?? '?'} del mismo archivo, por eso no se insertó.
                    </p>
                  </div>
                ))}
              </div>
            </details>
          )}

          {r.detalle_errores?.length > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                Ver detalle de errores ({r.detalle_errores.length})
              </summary>
              <pre style={{ fontSize: '0.75rem', maxHeight: 200, overflow: 'auto', marginTop: '0.5rem', background: '#fff8f8', padding: '0.5rem', borderRadius: 4 }}>
                {r.detalle_errores.map(e => `Fila ${e.fila}: ${e.error}`).join('\n')}
              </pre>
            </details>
          )}
        </div>
      )}

      {job?.status === 'error' && (
        <div className="result-box error" style={{ marginTop: '1rem' }}>
          {job.message || 'Error desconocido durante la carga'}
        </div>
      )}
    </div>
  )
}
