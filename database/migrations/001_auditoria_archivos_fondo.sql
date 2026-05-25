-- Migración para bases de datos existentes (ejecutar una vez en producción)
-- psql -U congreso -d archivo_congreso -f database/migrations/001_auditoria_archivos_fondo.sql

-- 1) Auditoría con usuario de aplicación (session app.audit_user)
CREATE OR REPLACE FUNCTION fn_auditoria()
RETURNS TRIGGER AS $$
DECLARE
    v_id  INT;
    v_prev JSONB;
    v_new  JSONB;
    v_usuario TEXT;
BEGIN
    v_usuario := NULLIF(trim(current_setting('app.audit_user', true)), '');
    IF v_usuario IS NULL THEN
        v_usuario := current_user;
    END IF;

    IF TG_OP = 'DELETE' THEN
        EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v_id USING OLD;
        v_prev := row_to_json(OLD)::JSONB;
        v_new  := NULL;
    ELSIF TG_OP = 'INSERT' THEN
        EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v_id USING NEW;
        v_prev := NULL;
        v_new  := row_to_json(NEW)::JSONB;
    ELSE
        EXECUTE format('SELECT ($1).%I', TG_ARGV[0]) INTO v_id USING NEW;
        v_prev := row_to_json(OLD)::JSONB;
        v_new  := row_to_json(NEW)::JSONB;
    END IF;

    INSERT INTO registro_operaciones(nombre_tabla, operacion, id_fila_afectada, usuario, datos_previos, datos_nuevos)
    VALUES (TG_TABLE_NAME, TG_OP, v_id, v_usuario, v_prev, v_new);

    IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$ LANGUAGE plpgsql;

-- 2) Metadatos de archivos y vínculo con registros
ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS ruta_archivo TEXT;
ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS registros_vinculados INT DEFAULT 0;

CREATE TABLE IF NOT EXISTS carga_archivo_registro (
    id SERIAL PRIMARY KEY,
    id_archivo INT NOT NULL REFERENCES archivo_cargado(id_archivo) ON DELETE CASCADE,
    tabla TEXT NOT NULL,
    row_hash TEXT NOT NULL,
    id_registro INT,
    fecha_vinculo TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (id_archivo, tabla, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_car_archivo ON carga_archivo_registro (id_archivo);
CREATE INDEX IF NOT EXISTS idx_car_registro ON carga_archivo_registro (tabla, id_registro);
CREATE INDEX IF NOT EXISTS idx_archivo_tabla ON archivo_cargado (tabla_destino);
