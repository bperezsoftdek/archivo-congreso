-- ============================================================
-- TABLAS COMUNES
-- ============================================================
CREATE TABLE IF NOT EXISTS fondo (
    id_fondo SERIAL PRIMARY KEY,
    cod_fondo VARCHAR(50) UNIQUE NOT NULL,
    desc_fondo TEXT
);

CREATE TABLE IF NOT EXISTS sub_fondo (
    id_subfondo SERIAL PRIMARY KEY,
    cod_subfondo VARCHAR(50) UNIQUE NOT NULL,
    desc_subfondo TEXT,
    tabla_sql TEXT,
    id_fondo INT REFERENCES fondo(id_fondo)
);

-- ============================================================
-- DATOS INICIALES
-- ============================================================
INSERT INTO fondo (id_fondo, cod_fondo, desc_fondo) VALUES
    (1, 'FISC', 'Fondo Interno Senado y Cámara'),
    (2, 'FHC',  'Fondo Histórico Convenio')
ON CONFLICT (id_fondo) DO UPDATE SET
    cod_fondo = EXCLUDED.cod_fondo,
    desc_fondo = EXCLUDED.desc_fondo;

INSERT INTO sub_fondo (id_subfondo, cod_subfondo, desc_subfondo, tabla_sql, id_fondo) VALUES
    (1,  'ACT',   'Actas de sesiones',              'actas_sesiones',             1),
    (2,  'PL',    'Proyectos de ley',                'proyectos_ley',              1),
    (3,  'PLIA',  'Proyecto de ley IA',              'proyectos_ley_ia',           1),
    (4,  'PAL',   'Proyectos de actos legislativos', 'proyectos_acto_legislativo', 1),
    (5,  'GAC',   'Publicaciones seriadas gacetas',  'gacetas_congreso',           1),
    (6,  'ANA',   'Publicaciones seriadas anales',   'anales',                     1),
    (7,  'LEY',   'Leyes',                           'leyes',                      1),
    (8,  'PC',    'Propuestas ciudadanas',           'propuestas_ciudadanas',      2),
    (9,  'ANC',   'Asamblea Nacional Constituyente', 'asamblea_constituyente',     2),
    (10, 'AHLIA', 'AHL IA',                          'ahl_ia',                     2),
    (11, 'AHLM',  'AHL Manual',                      'ahl_manual',                 2),
    (12, 'FCON',  'Fondo Congreso',                  'fondo_congreso',             2),
    (13, 'FCG',   'Fondo Congresito',                'fondo_congresito',           2)
ON CONFLICT (id_subfondo) DO UPDATE SET
    cod_subfondo = EXCLUDED.cod_subfondo,
    desc_subfondo = EXCLUDED.desc_subfondo,
    tabla_sql = EXCLUDED.tabla_sql,
    id_fondo = EXCLUDED.id_fondo;

SELECT setval('fondo_id_fondo_seq', 2, true);
SELECT setval('sub_fondo_id_subfondo_seq', 13, true);

-- ============================================================
-- ACTAS DE SESIONES
-- ============================================================
CREATE TABLE IF NOT EXISTS actas_sesiones (
    id_acta SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT,
    codigo_referencia TEXT,
    titulo_formal TEXT,
    titulo_atribuido TEXT,
    tipologia TEXT,
    tomo_caja_numero TEXT,
    alterno TEXT,
    carpeta TEXT,
    fecha_inicial_ano INT,
    fecha_inicial_mes INT,
    fecha_inicial_dia INT,
    fecha_final_ano INT,
    fecha_final_mes INT,
    fecha_final_dia INT,
    soporte TEXT,
    volumen TEXT,
    nombre_productor TEXT,
    historia_institucional TEXT,
    historia_archivistica TEXT,
    lugar TEXT,
    alcance_contenido TEXT,
    palabras_clave TEXT,
    funciones_congreso TEXT,
    condiciones_acceso TEXT,
    condiciones_reproduccion TEXT,
    lengua_documentos TEXT,
    caracteristicas_tecnicas TEXT,
    instrumentos_descripcion TEXT,
    existencia_originales TEXT,
    unidades_descripcion_relacionadas TEXT,
    notas TEXT,
    nombre_digitador TEXT,
    reglas_normas TEXT,
    fecha_descripcion TEXT
);

-- ============================================================
-- TABLA DE AUDITORIA
-- ============================================================
CREATE TABLE IF NOT EXISTS registro_operaciones (
    id_registro SERIAL PRIMARY KEY,
    nombre_tabla VARCHAR(100),
    operacion VARCHAR(6),
    id_fila_afectada INT,
    usuario VARCHAR(100),
    fecha_hora TIMESTAMPTZ DEFAULT NOW(),
    datos_previos JSONB,
    datos_nuevos JSONB
);

-- ============================================================
-- FUNCION Y TRIGGER DE AUDITORIA
-- ============================================================
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

CREATE OR REPLACE TRIGGER trg_audit_actas_sesiones
    AFTER INSERT OR UPDATE OR DELETE ON actas_sesiones
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_acta');

-- ============================================================
-- INDICES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_actas_cod_ref   ON actas_sesiones (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_actas_fi_ano    ON actas_sesiones (fecha_inicial_ano);
CREATE INDEX IF NOT EXISTS idx_actas_ff_ano    ON actas_sesiones (fecha_final_ano);
CREATE INDEX IF NOT EXISTS idx_actas_fondo     ON actas_sesiones (id_fondo);
CREATE INDEX IF NOT EXISTS idx_actas_subfondo  ON actas_sesiones (id_subfondo);
CREATE INDEX IF NOT EXISTS idx_actas_tipologia ON actas_sesiones (tipologia);
CREATE INDEX IF NOT EXISTS idx_actas_titulo    ON actas_sesiones USING gin(to_tsvector('spanish', coalesce(titulo_atribuido, '')));
CREATE INDEX IF NOT EXISTS idx_actas_kw        ON actas_sesiones USING gin(to_tsvector('spanish', coalesce(palabras_clave, '')));

-- ============================================================
-- TABLA DE ARCHIVOS CARGADOS
-- ============================================================
CREATE TABLE IF NOT EXISTS archivo_cargado (
    id_archivo SERIAL PRIMARY KEY,
    nombre_archivo VARCHAR(500) NOT NULL,
    ruta_archivo TEXT,
    hash_archivo VARCHAR(256) NOT NULL UNIQUE,
    tabla_destino VARCHAR(100),
    fecha_carga TIMESTAMPTZ DEFAULT NOW(),
    usuario_carga VARCHAR(200),
    cantidad_registros INT DEFAULT 0,
    registros_vinculados INT DEFAULT 0,
    registros_eliminados INT DEFAULT 0,
    estado VARCHAR(50) DEFAULT 'pending',
    fecha_reversion TIMESTAMPTZ,
    usuario_reversion VARCHAR(200)
);

CREATE INDEX IF NOT EXISTS idx_archivo_hash ON archivo_cargado (hash_archivo);
CREATE INDEX IF NOT EXISTS idx_archivo_nombre ON archivo_cargado (nombre_archivo);
CREATE INDEX IF NOT EXISTS idx_archivo_tabla ON archivo_cargado (tabla_destino);

-- Relación archivo ↔ registros documentales insertados
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

-- ============================================================
-- TABLA DE DUPLICADOS EN BASE DE DATOS
-- ============================================================
CREATE TABLE IF NOT EXISTS carga_duplicados_bd (
    id SERIAL PRIMARY KEY,
    id_archivo INT REFERENCES archivo_cargado(id_archivo) ON DELETE CASCADE,
    numero_fila_excel INT,
    hash_registro TEXT,
    registro_json JSONB,
    id_existente_bd INT,
    criterio_duplicidad TEXT,
    fecha_deteccion TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dup_bd_archivo ON carga_duplicados_bd (id_archivo);
CREATE INDEX IF NOT EXISTS idx_dup_bd_hash ON carga_duplicados_bd (hash_registro);

-- ============================================================
-- TABLA DE DUPLICADOS DENTRO DEL ARCHIVO
-- ============================================================
CREATE TABLE IF NOT EXISTS carga_duplicados_archivo (
    id SERIAL PRIMARY KEY,
    id_archivo INT REFERENCES archivo_cargado(id_archivo) ON DELETE CASCADE,
    numero_fila_original INT,
    numero_fila_duplicada INT,
    hash_registro TEXT,
    registro_json JSONB,
    criterio_duplicidad TEXT,
    fecha_deteccion TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dup_archivo_id ON carga_duplicados_archivo (id_archivo);
CREATE INDEX IF NOT EXISTS idx_dup_archivo_hash ON carga_duplicados_archivo (hash_registro);

-- ============================================================
-- HISTORIAL DE CARGAS Y HASHES (persistencia desde el inicio)
-- ============================================================
CREATE TABLE IF NOT EXISTS carga_archivos (
    id_carga SERIAL PRIMARY KEY,
    tabla TEXT NOT NULL,
    nombre_archivo TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    file_size BIGINT NOT NULL DEFAULT 0,
    job_id UUID,
    estado TEXT NOT NULL DEFAULT 'processing',
    filas_insertadas INT DEFAULT 0,
    errores INT DEFAULT 0,
    fecha_carga TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tabla, file_hash)
);

CREATE TABLE IF NOT EXISTS carga_registros_hash (
    tabla TEXT NOT NULL,
    row_hash TEXT NOT NULL,
    fecha_registro TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tabla, row_hash)
);

CREATE INDEX IF NOT EXISTS idx_carga_archivos_tabla ON carga_archivos (tabla);
CREATE INDEX IF NOT EXISTS idx_carga_hash_tabla ON carga_registros_hash (tabla);
