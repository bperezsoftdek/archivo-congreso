import { Alert, Box, LinearProgress, Typography } from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'

export default function DownloadProgressCard({ progress }) {
  if (!progress) return null
  const { pct, label } = progress
  const isComplete = pct === 100

  return (
    <Alert
      severity={isComplete ? 'success' : 'info'}
      icon={<DownloadIcon />}
      sx={{ mb: 1, maxWidth: 520, alignItems: 'center' }}
    >
      <Box sx={{ minWidth: 260 }}>
        <Typography variant="body2" sx={{ fontWeight: 700 }}>{label}</Typography>
        {pct != null && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75 }}>
            <LinearProgress variant="determinate" value={pct} sx={{ flex: 1, height: 7, borderRadius: 1 }} />
            <Typography variant="caption" sx={{ minWidth: 36, textAlign: 'right' }}>{pct}%</Typography>
          </Box>
        )}
      </Box>
    </Alert>
  )
}
