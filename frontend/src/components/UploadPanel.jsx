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
      const res = await fetch(url, { headers: authHeaders })
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
      link.download = filename
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
              {job.duplicates > 0 && <span style={{ color: '#c05621' }}> · {job.duplicates} duplicados omitidos</span>}
              {job.errors > 0 && <span style={{ color: '#e53e3e' }}> · {job.errors} errores</span>}
            </p>
          )}
          {job.message && job.status !== 'error' && (
            <p style={{ fontSize: '0.85rem', color: '#744210', marginTop: '0.4rem' }}>{job.message}</p>
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

      {job?.status === 'done' && job.result && (
        <div className="result-box" style={{ marginTop: '1rem' }}>
          <p><strong>{job.result.insertadas.toLocaleString()}</strong> registros insertados correctamente de {job.result.total_filas_excel.toLocaleString()}</p>
          {job.result.errores > 0 && (
            <p style={{ color: '#c05621', marginTop: '0.3rem' }}>{job.result.errores} filas no se pudieron insertar</p>
          )}
          
          <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#f5f5f5', borderRadius: 4 }}>
            <strong style={{ display: 'block', marginBottom: '0.3rem' }}>Validación de duplicados:</strong>
            <p style={{ margin: '0.2rem 0', fontSize: '0.9rem' }}>
              <span style={{ color: '#c05621', fontWeight: 'bold' }}>{job.result.duplicados_bd || 0}</span> registros ya existían en BD
            </p>
            <p style={{ margin: '0.2rem 0', fontSize: '0.9rem' }}>
              <span style={{ color: '#c05621', fontWeight: 'bold' }}>{job.result.duplicados_archivo || 0}</span> registros repetidos en el archivo
            </p>
          </div>

          {job.result.columnas_no_encontradas?.length > 0 && (
            <p style={{ color: '#c05621', marginTop: '0.3rem' }}>
              Columnas no encontradas: {job.result.columnas_no_encontradas.join(', ')}
            </p>
          )}

          {job.result.archivos_reporte?.duplicados_bd && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#1a5490', fontWeight: 'bold' }}>
                Duplicados en BD ({job.result.duplicados_bd})
              </summary>
              <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#e3f2fd', borderRadius: 4 }}>
                <button 
                  className="btn secondary"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                  type="button"
                  onClick={() => handleDownloadReport(
                    job.result.archivos_reporte.duplicados_bd.url,
                    job.result.archivos_reporte.duplicados_bd.filename
                  )}
                >
                  Descargar reporte BD (.xlsx)
                </button>
              </div>
            </details>
          )}

          {job.result.archivos_reporte?.duplicados_archivo && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#ff8a00', fontWeight: 'bold' }}>
                Repetidos en el archivo ({job.result.duplicados_archivo})
              </summary>
              <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#fff8f0', borderRadius: 4 }}>
                <button 
                  className="btn secondary"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                  type="button"
                  onClick={() => handleDownloadReport(
                    job.result.archivos_reporte.duplicados_archivo.url,
                    job.result.archivos_reporte.duplicados_archivo.filename
                  )}
                >
                  Descargar reporte archivo (.xlsx)
                </button>
              </div>
            </details>
          )}

          {job.result.registros_duplicados?.length > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem', color: '#c05621', fontWeight: 'bold' }}>
                Ver detalles de registros duplicados ({job.result.registros_duplicados.length})
              </summary>
              <div style={{ marginTop: '0.5rem', maxHeight: 300, overflow: 'auto', background: '#fffbf0', padding: '0.5rem', borderRadius: 4, fontSize: '0.75rem' }}>
                {job.result.registros_duplicados.map((reg, idx) => (
                  <div key={idx} style={{ marginBottom: '0.3rem', paddingBottom: '0.3rem', borderBottom: '1px solid #ffe0cc' }}>
                    <strong>Duplicado #{idx + 1}</strong>
                    <ul style={{ margin: '0.2rem 0', paddingLeft: '1rem' }}>
                      {Object.entries(reg).map(([k, v]) => (
                        <li key={k}><span style={{ color: '#666' }}>{k}:</span> <strong>{String(v ?? 'null')}</strong></li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </details>
          )}

          {job.result.detalle_errores?.length > 0 && (
            <details style={{ marginTop: '0.5rem' }}>
              <summary style={{ cursor: 'pointer', fontSize: '0.85rem' }}>
                Ver detalle de errores ({job.result.detalle_errores.length})
              </summary>
              <pre style={{ fontSize: '0.75rem', maxHeight: 200, overflow: 'auto', marginTop: '0.5rem', background: '#fff8f8', padding: '0.5rem', borderRadius: 4 }}>
                {job.result.detalle_errores.map(e => `Fila ${e.fila}: ${e.error}`).join('\n')}
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
