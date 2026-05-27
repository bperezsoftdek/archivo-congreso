export default function DownloadProgressCard({ progress }) {
  if (!progress) return null
  const { pct, label } = progress
  const isComplete = pct === 100

  return (
    <div className={`download-progress-card${isComplete ? ' complete' : ''}`}>
      <div className="download-progress-icon">{isComplete ? '✅' : '⬇️'}</div>
      <div className="download-progress-body">
        <span className="download-progress-label">{label}</span>
        {pct != null && (
          <div className="download-progress-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
        )}
        {pct != null && <span className="download-progress-pct">{pct}%</span>}
      </div>
    </div>
  )
}
