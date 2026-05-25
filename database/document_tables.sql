-- Tablas documentales adicionales (misma plantilla ISAAR que actas_sesiones)
-- Ejecutar en BD existente: psql -U congreso -d archivo_congreso -f database/document_tables.sql

-- Macro de columnas de metadatos (repetido en cada tabla)
-- id_fondo, id_subfondo + 34 campos de descripción

CREATE TABLE IF NOT EXISTS proyectos_ley (
    id_proyecto_ley SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS proyectos_ley_ia (
    id_proyecto_ley_ia SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS proyectos_acto_legislativo (
    id_pal SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS gacetas_congreso (
    id_gaceta SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS anales (
    id_anal SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS leyes (
    id_ley SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS propuestas_ciudadanas (
    id_propuesta SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS asamblea_constituyente (
    id_anc SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS ahl_ia (
    id_ahl_ia SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS ahl_manual (
    id_ahl_manual SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS fondo_congreso (
    id_fondo_congreso SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

CREATE TABLE IF NOT EXISTS fondo_congresito (
    id_fondo_congresito SERIAL PRIMARY KEY,
    id_fondo INT REFERENCES fondo(id_fondo),
    id_subfondo INT REFERENCES sub_fondo(id_subfondo),
    nivel_descripcion TEXT, codigo_referencia TEXT, titulo_formal TEXT, titulo_atribuido TEXT,
    tipologia TEXT, tomo_caja_numero TEXT, alterno TEXT, carpeta TEXT,
    fecha_inicial_ano INT, fecha_inicial_mes INT, fecha_inicial_dia INT,
    fecha_final_ano INT, fecha_final_mes INT, fecha_final_dia INT,
    soporte TEXT, volumen TEXT, nombre_productor TEXT, historia_institucional TEXT,
    historia_archivistica TEXT, lugar TEXT, alcance_contenido TEXT, palabras_clave TEXT,
    funciones_congreso TEXT, condiciones_acceso TEXT, condiciones_reproduccion TEXT,
    lengua_documentos TEXT, caracteristicas_tecnicas TEXT, instrumentos_descripcion TEXT,
    existencia_originales TEXT, unidades_descripcion_relacionadas TEXT, notas TEXT,
    nombre_digitador TEXT, reglas_normas TEXT, fecha_descripcion TEXT
);

-- Triggers de auditoría
CREATE OR REPLACE TRIGGER trg_audit_proyectos_ley
    AFTER INSERT OR UPDATE OR DELETE ON proyectos_ley
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_proyecto_ley');

CREATE OR REPLACE TRIGGER trg_audit_proyectos_ley_ia
    AFTER INSERT OR UPDATE OR DELETE ON proyectos_ley_ia
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_proyecto_ley_ia');

CREATE OR REPLACE TRIGGER trg_audit_proyectos_acto_legislativo
    AFTER INSERT OR UPDATE OR DELETE ON proyectos_acto_legislativo
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_pal');

CREATE OR REPLACE TRIGGER trg_audit_gacetas_congreso
    AFTER INSERT OR UPDATE OR DELETE ON gacetas_congreso
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_gaceta');

CREATE OR REPLACE TRIGGER trg_audit_anales
    AFTER INSERT OR UPDATE OR DELETE ON anales
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_anal');

CREATE OR REPLACE TRIGGER trg_audit_leyes
    AFTER INSERT OR UPDATE OR DELETE ON leyes
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_ley');

CREATE OR REPLACE TRIGGER trg_audit_propuestas_ciudadanas
    AFTER INSERT OR UPDATE OR DELETE ON propuestas_ciudadanas
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_propuesta');

CREATE OR REPLACE TRIGGER trg_audit_asamblea_constituyente
    AFTER INSERT OR UPDATE OR DELETE ON asamblea_constituyente
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_anc');

CREATE OR REPLACE TRIGGER trg_audit_ahl_ia
    AFTER INSERT OR UPDATE OR DELETE ON ahl_ia
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_ahl_ia');

CREATE OR REPLACE TRIGGER trg_audit_ahl_manual
    AFTER INSERT OR UPDATE OR DELETE ON ahl_manual
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_ahl_manual');

CREATE OR REPLACE TRIGGER trg_audit_fondo_congreso
    AFTER INSERT OR UPDATE OR DELETE ON fondo_congreso
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_fondo_congreso');

CREATE OR REPLACE TRIGGER trg_audit_fondo_congresito
    AFTER INSERT OR UPDATE OR DELETE ON fondo_congresito
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria('id_fondo_congresito');

-- Índices básicos por tabla
CREATE INDEX IF NOT EXISTS idx_pl_cod_ref ON proyectos_ley (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_plia_cod_ref ON proyectos_ley_ia (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_pal_cod_ref ON proyectos_acto_legislativo (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_gac_cod_ref ON gacetas_congreso (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_ana_cod_ref ON anales (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_ley_cod_ref ON leyes (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_pc_cod_ref ON propuestas_ciudadanas (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_anc_cod_ref ON asamblea_constituyente (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_ahlia_cod_ref ON ahl_ia (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_ahlm_cod_ref ON ahl_manual (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_fcon_cod_ref ON fondo_congreso (codigo_referencia);
CREATE INDEX IF NOT EXISTS idx_fcgt_cod_ref ON fondo_congresito (codigo_referencia);
