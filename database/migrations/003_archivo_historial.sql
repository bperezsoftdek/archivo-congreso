-- Historial persistente de cargas (subidas y reversiones)
-- psql -U congreso -d archivo_congreso -f database/migrations/003_archivo_historial.sql

ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS fecha_reversion TIMESTAMPTZ;
ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS usuario_reversion VARCHAR(200);
ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS registros_eliminados INT DEFAULT 0;

CREATE TABLE IF NOT EXISTS archivo_carga_evento (
    id_evento SERIAL PRIMARY KEY,
    id_archivo INT REFERENCES archivo_cargado(id_archivo) ON DELETE SET NULL,
    tabla_destino VARCHAR(100),
    nombre_archivo VARCHAR(500),
    evento VARCHAR(50) NOT NULL,
    usuario VARCHAR(200),
    detalle JSONB,
    fecha_evento TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ace_archivo ON archivo_carga_evento (id_archivo);
CREATE INDEX IF NOT EXISTS idx_ace_fecha ON archivo_carga_evento (fecha_evento DESC);
CREATE INDEX IF NOT EXISTS idx_ace_evento ON archivo_carga_evento (evento);
