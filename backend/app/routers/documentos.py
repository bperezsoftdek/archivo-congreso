from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query, Body
from fastapi.responses import FileResponse, Response
from app.core.config import get_table_config, get_consulta_meta, TABLES
from app.core.db import get_db, get_cursor
from app.core.excel import CHUNK_SIZE, stream_excel_chunks
from app.core.security import current_user, require_roles
import hashlib
import io
import json
import math
import os
import threading
import uuid
from datetime import datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment

router = APIRouter()

UPLOAD_DIR = os.environ.get("UPLOAD_DIR", "uploads")

# Estado de jobs en memoria: { job_id: { status, progress, total, inserted, errors, result } }
_jobs: dict = {}
_jobs_lock = threading.Lock()


def _set_audit_user(cur, usuario: str):
    """Establece el usuario de la aplicación para triggers de auditoría."""
    cur.execute("SELECT set_config('app.audit_user', %s, true)", [usuario or "sistema"])


def _consulta_from_clause(tabla: str) -> str:
    return f"""
        {tabla} t
        LEFT JOIN fondo f ON t.id_fondo = f.id_fondo
        LEFT JOIN sub_fondo sf ON t.id_subfondo = sf.id_subfondo
    """


def _consulta_select_cols(tabla: str, cfg: dict) -> str:
    """SELECT con nombres descriptivos de fondo/subfondo en lugar de solo IDs."""
    pk = cfg["pk"]
    doc_cols = [f"t.{c}" for c in cfg["columns"].keys()]
    cols = [f"t.{pk}"] + doc_cols + [
        "t.id_fondo",
        "t.id_subfondo",
        "f.cod_fondo",
        "f.desc_fondo AS nombre_fondo",
        "sf.cod_subfondo",
        "sf.desc_subfondo AS nombre_subfondo",
    ]
    return ", ".join(cols)


def _set_job(job_id: str, **kwargs):
    with _jobs_lock:
        _jobs[job_id].update(kwargs)


def _style_header_row(ws, row_idx: int = 1):
    header_fill = PatternFill(start_color="1A3A5C", end_color="1A3A5C", fill_type="solid")
    header_font = Font(bold=True, color="FFFFFF")
    for cell in ws[row_idx]:
        cell.fill = header_fill
        cell.font = header_font
        cell.alignment = Alignment(horizontal="center", vertical="center")


def _rows_to_xlsx_bytes(rows: list, sheet_title: str = "Datos") -> bytes:
    """Convierte filas (dict o RealDictRow) a bytes de un libro Excel."""
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_title[:31]
    if not rows:
        ws.append(["Sin datos"])
    else:
        keys = list(rows[0].keys())
        ws.append(keys)
        _style_header_row(ws)
        for row in rows:
            r = dict(row)
            ws.append([r.get(k) for k in keys])
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    return buf.getvalue()


def _xlsx_response(rows: list, filename: str, sheet_title: str = "Datos") -> Response:
    if not filename.lower().endswith(".xlsx"):
        filename = f"{filename}.xlsx"
    content = _rows_to_xlsx_bytes(rows, sheet_title)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _dup_payload(record: dict, db_cols: list, tipo: str, mensaje: str) -> dict:
    dup = {
        col: record.get(col)
        for col in db_cols
        if col not in ("id_fondo", "id_subfondo", "_row_hash", "_excel_row")
    }
    dup["_row_hash"] = record.get("_row_hash")
    dup["_excel_row"] = record.get("_excel_row")
    dup["tipo_duplicado"] = tipo
    dup["mensaje_duplicado"] = mensaje
    dup["codigo_referencia"] = record.get("codigo_referencia") or dup.get("codigo_referencia")
    return dup


def _hashes_existentes_en_bd(conn, tabla: str, hashes: list) -> set:
    if not hashes:
        return set()
    with get_cursor(conn) as cur:
        cur.execute(
            "SELECT row_hash FROM carga_registros_hash WHERE tabla = %s AND row_hash = ANY(%s)",
            [tabla, hashes],
        )
        return {row["row_hash"] for row in cur.fetchall()}


def _registrar_hashes_nuevos(conn, tabla: str, records: list, db_cols: list):
    if not records:
        return
    with get_cursor(conn) as cur:
        for record in records:
            h = record.get("_row_hash") or _row_hash(record, db_cols)
            cur.execute(
                """
                INSERT INTO carga_registros_hash (tabla, row_hash)
                VALUES (%s, %s)
                ON CONFLICT DO NOTHING
                """,
                [tabla, h],
            )


def _build_csv_buffer(records: list, db_cols: list) -> io.StringIO:
    """Convierte registros a CSV en memoria para copy_from."""
    buf = io.StringIO()
    for record in records:
        row = []
        for col in db_cols:
            val = record.get(col)
            if val is None:
                row.append("\\N")
            else:
                val = str(val).replace("\\", "\\\\").replace("\t", " ").replace("\n", " ").replace("\r", "")
                row.append(val)
        buf.write("\t".join(row) + "\n")
    buf.seek(0)
    return buf


def _get_catalog_ids(conn, tabla: str) -> tuple[int, int]:
    with get_cursor(conn) as cur:
        cur.execute(
            """
            SELECT id_fondo, id_subfondo
            FROM sub_fondo
            WHERE tabla_sql = %s
            """,
            [tabla],
        )
        row = cur.fetchone()
    if not row:
        raise ValueError(f"No existe sub_fondo configurado para la tabla '{tabla}'")
    return row["id_fondo"], row["id_subfondo"]


def _apply_catalog_ids(records: list, id_fondo: int, id_subfondo: int):
    for record in records:
        record["id_fondo"] = id_fondo
        record["id_subfondo"] = id_subfondo


def _ensure_upload_history(conn):
    with get_cursor(conn) as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS carga_archivos (
                id_carga SERIAL PRIMARY KEY,
                tabla TEXT NOT NULL,
                nombre_archivo TEXT NOT NULL,
                file_hash TEXT NOT NULL,
                file_size BIGINT NOT NULL,
                job_id UUID,
                id_archivo INT,
                estado TEXT NOT NULL DEFAULT 'processing',
                filas_insertadas INT DEFAULT 0,
                errores INT DEFAULT 0,
                fecha_carga TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (tabla, file_hash)
            )
        """)
        cur.execute("ALTER TABLE carga_archivos ADD COLUMN IF NOT EXISTS id_archivo INT")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS carga_registros_hash (
                tabla TEXT NOT NULL,
                row_hash TEXT NOT NULL,
                fecha_registro TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (tabla, row_hash)
            )
        """)
        cur.execute("ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS ruta_archivo TEXT")
        cur.execute("ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS registros_vinculados INT DEFAULT 0")
        cur.execute("ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS registros_eliminados INT DEFAULT 0")
        cur.execute("ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS fecha_reversion TIMESTAMPTZ")
        cur.execute("ALTER TABLE archivo_cargado ADD COLUMN IF NOT EXISTS usuario_reversion VARCHAR(200)")
        cur.execute("""
            CREATE TABLE IF NOT EXISTS archivo_carga_evento (
                id_evento SERIAL PRIMARY KEY,
                id_archivo INT REFERENCES archivo_cargado(id_archivo) ON DELETE SET NULL,
                tabla_destino VARCHAR(100),
                nombre_archivo VARCHAR(500),
                evento VARCHAR(50) NOT NULL,
                usuario VARCHAR(200),
                detalle JSONB,
                fecha_evento TIMESTAMPTZ DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS carga_archivo_registro (
                id SERIAL PRIMARY KEY,
                id_archivo INT NOT NULL REFERENCES archivo_cargado(id_archivo) ON DELETE CASCADE,
                tabla TEXT NOT NULL,
                row_hash TEXT NOT NULL,
                id_registro INT,
                fecha_vinculo TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (id_archivo, tabla, row_hash)
            )
        """)
    conn.commit()


def _save_uploaded_file(content: bytes, id_archivo: int, nombre_archivo: str) -> str:
    """Guarda el Excel en disco y retorna la ruta relativa."""
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    safe_name = os.path.basename(nombre_archivo or "archivo.xlsx")
    rel_path = os.path.join(UPLOAD_DIR, f"{id_archivo}_{safe_name}")
    with open(rel_path, "wb") as f:
        f.write(content)
    return rel_path


def _link_chunk_records(cur, id_archivo: int, tabla: str, pk: str, records: list):
    """Vincula hashes insertados con sus PK en carga_archivo_registro."""
    for record in records:
        row_hash = record.get("_row_hash")
        id_registro = record.get("_inserted_pk")
        if not row_hash or id_registro is None:
            continue
        cur.execute(
            """
            INSERT INTO carga_archivo_registro (id_archivo, tabla, row_hash, id_registro)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (id_archivo, tabla, row_hash)
            DO UPDATE SET id_registro = EXCLUDED.id_registro
            """,
            [id_archivo, tabla, row_hash, id_registro],
        )


def _insert_chunk_with_audit(
    conn,
    tabla: str,
    records: list,
    db_cols: list,
    pk: str,
    usuario: str,
    id_archivo: int | None = None,
) -> int:
    """
    Inserta un chunk en lote con triggers de auditoría activos
    y vincula cada fila al archivo de origen.
    """
    if not records:
        return 0

    cols_sql = ", ".join(db_cols)
    row_ph = f"({', '.join(['%s'] * len(db_cols))})"
    all_ph = ", ".join([row_ph] * len(records))
    flat_values = [record.get(col) for record in records for col in db_cols]

    with get_cursor(conn) as cur:
        _set_audit_user(cur, usuario)
        cur.execute(
            f"INSERT INTO {tabla} ({cols_sql}) VALUES {all_ph} RETURNING {pk}",
            flat_values,
        )
        pks = [row[pk] for row in cur.fetchall()]
        for record, pk_val in zip(records, pks):
            record["_inserted_pk"] = pk_val
        if id_archivo and pks:
            _link_chunk_records(cur, id_archivo, tabla, pk, records)
    return len(pks)


def _update_archivo_stats(conn, id_archivo: int, inserted: int, ruta: str | None = None, usuario: str | None = None):
    with get_cursor(conn) as cur:
        cur.execute(
            """
            UPDATE archivo_cargado
            SET estado = 'done',
                cantidad_registros = %s,
                registros_vinculados = (
                    SELECT COUNT(*) FROM carga_archivo_registro
                    WHERE id_archivo = %s AND id_registro IS NOT NULL
                ),
                ruta_archivo = COALESCE(%s, ruta_archivo)
            WHERE id_archivo = %s
            RETURNING tabla_destino, nombre_archivo, usuario_carga
            """,
            [inserted, id_archivo, ruta, id_archivo],
        )
        row = cur.fetchone()
        if row:
            _log_archivo_evento(
                conn,
                id_archivo,
                row["tabla_destino"],
                row["nombre_archivo"],
                "completado",
                usuario or row["usuario_carga"] or "sistema",
                {"insertados": inserted},
            )


def _row_hash(record: dict, db_cols: list) -> str:
    values = [record.get(col) for col in db_cols]
    raw = json.dumps(values, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _filter_new_records(
    conn,
    tabla: str,
    records: list,
    db_cols: list,
    seen_in_upload: set,
    first_seen_in_upload: dict,
) -> tuple[list, list, list, dict]:
    """
    Clasifica filas nuevas vs duplicados.
    Retorna: (nuevas, duplicados_bd, duplicados_archivo_list, duplicados_archivo_dict)
    """
    if not records:
        return [], [], [], {}

    for record in records:
        record["_row_hash"] = _row_hash(record, db_cols)

    unique_hashes = list({r["_row_hash"] for r in records})
    existing_bd = _hashes_existentes_en_bd(conn, tabla, unique_hashes)

    new_records = []
    duplicados_bd = []
    duplicados_archivo_list = []
    duplicados_archivo = {}

    for record in records:
        row_hash = record["_row_hash"]
        if row_hash in existing_bd:
            duplicados_bd.append(
                _dup_payload(
                    record,
                    db_cols,
                    "ya_en_base_de_datos",
                    "Ya existe en la base de datos: otro registro tiene los mismos metadatos (no se insertó).",
                )
            )
        elif row_hash in seen_in_upload:
            dup = _dup_payload(
                record,
                db_cols,
                "repetido_en_archivo",
                "Repetido dentro del mismo Excel: esta fila es igual a otra fila anterior del archivo (no se insertó).",
            )
            dup["_fila_original"] = first_seen_in_upload.get(row_hash)
            duplicados_archivo_list.append(dup)
            duplicados_archivo.setdefault(row_hash, []).append(dup)
        else:
            new_records.append(record)
            seen_in_upload.add(row_hash)
            first_seen_in_upload[row_hash] = record.get("_excel_row")

    return new_records, duplicados_bd, duplicados_archivo_list, duplicados_archivo


def _seed_existing_hashes(conn, tabla: str, db_cols: list):
    with get_cursor(conn) as cur:
        cur.execute("SELECT 1 FROM carga_registros_hash WHERE tabla = %s LIMIT 1", [tabla])
        if cur.fetchone():
            return

        cur.execute(f"SELECT {', '.join(db_cols)} FROM {tabla}")
        rows = cur.fetchall()

    if not rows:
        return

    hash_buf = io.StringIO()
    seen = set()
    for row in rows:
        row_hash = _row_hash(row, db_cols)
        if row_hash in seen:
            continue
        seen.add(row_hash)
        hash_buf.write(row_hash + "\n")
    hash_buf.seek(0)

    with get_cursor(conn) as cur:
        cur.execute("CREATE TEMP TABLE IF NOT EXISTS tmp_existing_hashes (row_hash TEXT)")
        cur.execute("TRUNCATE tmp_existing_hashes")
        cur.copy_from(hash_buf, "tmp_existing_hashes", columns=["row_hash"], sep="\t")
        cur.execute(
            """
            INSERT INTO carga_registros_hash (tabla, row_hash)
            SELECT DISTINCT %s, row_hash
            FROM tmp_existing_hashes
            ON CONFLICT DO NOTHING
            """,
            [tabla],
        )
    conn.commit()


def _mark_upload_history(job_id: str, estado: str, inserted: int = 0, errors: int = 0):
    with get_db() as conn:
        _ensure_upload_history(conn)
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE carga_archivos
                SET estado = %s, filas_insertadas = %s, errores = %s
                WHERE job_id = %s
                """,
                [estado, inserted, errors, job_id],
            )
        conn.commit()


def _calculate_file_hash(content: bytes) -> str:
    """Calcula SHA256 del contenido del archivo."""
    return hashlib.sha256(content).hexdigest()


def _check_file_exists(conn, nombre_archivo: str, hash_archivo: str) -> dict:
    """
    Valida si el archivo ya existe.
    Retorna:
    - 'hash_duplicado': True si hash existe (rechazar)
    - 'nombre_duplicado': True si nombre existe (advertencia)
    - 'id_archivo': ID del archivo previo si existe
    - 'fecha_carga': Fecha de carga anterior
    """
    with get_cursor(conn) as cur:
        # Verificar por hash (contenido idéntico)
        cur.execute(
            "SELECT id_archivo, fecha_carga FROM archivo_cargado WHERE hash_archivo = %s LIMIT 1",
            [hash_archivo]
        )
        hash_match = cur.fetchone()
        
        # Verificar por nombre
        cur.execute(
            "SELECT id_archivo, fecha_carga FROM archivo_cargado WHERE nombre_archivo = %s ORDER BY fecha_carga DESC LIMIT 1",
            [nombre_archivo]
        )
        name_match = cur.fetchone()
    
    result = {
        'hash_duplicado': hash_match is not None,
        'nombre_duplicado': name_match is not None,
        'id_archivo': None,
        'fecha_carga': None
    }
    
    if hash_match:
        result['id_archivo'] = hash_match['id_archivo']
        result['fecha_carga'] = hash_match['fecha_carga']
    elif name_match:
        result['id_archivo'] = name_match['id_archivo']
        result['fecha_carga'] = name_match['fecha_carga']
    
    return result


def _register_file_load(
    conn,
    nombre_archivo: str,
    hash_archivo: str,
    tabla: str,
    usuario: str,
    cantidad: int,
    ruta_archivo: str | None = None,
) -> int:
    """Registra la carga de archivo en la tabla archivo_cargado. Retorna id_archivo."""
    with get_cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO archivo_cargado
            (nombre_archivo, ruta_archivo, hash_archivo, tabla_destino, usuario_carga, cantidad_registros, estado)
            VALUES (%s, %s, %s, %s, %s, %s, 'pending')
            RETURNING id_archivo
            """,
            [nombre_archivo, ruta_archivo, hash_archivo, tabla, usuario, cantidad],
        )
        result = cur.fetchone()
        id_archivo = result["id_archivo"] if result else None
        if id_archivo:
            _log_archivo_evento(
                conn, id_archivo, tabla, nombre_archivo, "subida", usuario,
                {"hash": hash_archivo, "filas_excel": cantidad},
            )
    conn.commit()
    return id_archivo


def _save_duplicates_to_db(conn, id_archivo: int, tabla: str, duplicados_bd: list, duplicados_archivo: dict):
    """
    Guarda los duplicados detectados en las tablas correspondientes.
    duplicados_bd: Lista de registros que ya existen en BD
    duplicados_archivo: Dict con {'grupo_hash': [fila1, fila2, ...], ...}
    """
    if not duplicados_bd and not duplicados_archivo:
        return
    
    # Guardar duplicados encontrados en BD
    if duplicados_bd:
        with get_cursor(conn) as cur:
            for dup in duplicados_bd:
                cur.execute(
                    """
                    INSERT INTO carga_duplicados_bd 
                    (id_archivo, numero_fila_excel, hash_registro, registro_json, criterio_duplicidad)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    [
                        id_archivo,
                        dup.get('_excel_row'),
                        dup.get('_row_hash'),
                        json.dumps(dup, default=str, ensure_ascii=False),
                        dup.get('tipo_duplicado') or 'ya_en_base_de_datos',
                    ]
                )
            conn.commit()
    
    # Guardar duplicados dentro del archivo
    if duplicados_archivo:
        with get_cursor(conn) as cur:
            for hash_val, filas in duplicados_archivo.items():
                if len(filas) > 1:
                    for i in range(1, len(filas)):
                        cur.execute(
                            """
                            INSERT INTO carga_duplicados_archivo 
                            (id_archivo, numero_fila_original, numero_fila_duplicada, hash_registro, registro_json, criterio_duplicidad)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            """,
                            [
                                id_archivo,
                                filas[i].get('_fila_original') or filas[0].get('_excel_row'),
                                filas[i].get('_excel_row'),
                                hash_val,
                                json.dumps(filas[i], default=str, ensure_ascii=False),
                                filas[i].get('tipo_duplicado') or 'repetido_en_archivo',
                            ]
                        )
            conn.commit()


def _generate_duplicates_report(conn, id_archivo: int, tabla: str) -> str:
    """
    Genera archivo Excel con duplicados encontrados en BD.
    Retorna ruta del archivo generado.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = 'Duplicados en BD'
    headers = [
        'Fila Excel',
        'Código referencia',
        'Tipo de duplicado',
        'Explicación',
        'Resumen registro',
        'Fecha detección',
    ]
    ws.append(headers)
    _style_header_row(ws)
    header_fill = PatternFill(start_color='FFC7CE', end_color='FFC7CE', fill_type='solid')
    for cell in ws[1]:
        cell.fill = header_fill
    
    # Obtener duplicados
    with get_cursor(conn) as cur:
        cur.execute(
            """
            SELECT numero_fila_excel, registro_json, id_existente_bd, criterio_duplicidad, fecha_deteccion
            FROM carga_duplicados_bd
            WHERE id_archivo = %s
            ORDER BY numero_fila_excel
            """,
            [id_archivo]
        )
        duplicados = cur.fetchall()
    
    for dup in duplicados:
        reg = dup['registro_json'] or {}
        if isinstance(reg, str):
            try:
                reg = json.loads(reg)
            except json.JSONDecodeError:
                reg = {}
        ws.append([
            dup['numero_fila_excel'],
            reg.get('codigo_referencia', ''),
            'Ya en base de datos',
            reg.get('mensaje_duplicado') or 'Registro con metadatos idénticos a uno ya almacenado.',
            json.dumps(reg, ensure_ascii=False)[:200],
            dup['fecha_deteccion'].isoformat() if dup['fecha_deteccion'] else '',
        ])
    
    # Ancho de columnas
    ws.column_dimensions['A'].width = 12
    ws.column_dimensions['B'].width = 40
    ws.column_dimensions['C'].width = 15
    ws.column_dimensions['D'].width = 15
    ws.column_dimensions['E'].width = 20
    
    # Guardar archivo
    os.makedirs('exports', exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'duplicados_bd_{id_archivo}_{timestamp}.xlsx'
    filepath = os.path.join('exports', filename)
    wb.save(filepath)
    
    return filepath, filename


def _generate_file_duplicates_report(conn, id_archivo: int, tabla: str) -> str:
    """
    Genera archivo Excel con duplicados dentro del mismo Excel.
    Retorna ruta del archivo generado.
    """
    wb = Workbook()
    ws = wb.active
    ws.title = 'Repetidos en archivo'
    headers = [
        'Fila original (1ª aparición)',
        'Fila repetida',
        'Código referencia',
        'Tipo de duplicado',
        'Explicación',
        'Resumen registro',
    ]
    ws.append(headers)
    _style_header_row(ws)
    header_fill = PatternFill(start_color='FFEB9C', end_color='FFEB9C', fill_type='solid')
    for cell in ws[1]:
        cell.fill = header_fill
    
    # Obtener duplicados
    with get_cursor(conn) as cur:
        cur.execute(
            """
            SELECT numero_fila_original, numero_fila_duplicada, criterio_duplicidad, registro_json
            FROM carga_duplicados_archivo
            WHERE id_archivo = %s
            ORDER BY numero_fila_original, numero_fila_duplicada
            """,
            [id_archivo]
        )
        duplicados = cur.fetchall()
    
    for dup in duplicados:
        reg = dup['registro_json'] or {}
        if isinstance(reg, str):
            try:
                reg = json.loads(reg)
            except json.JSONDecodeError:
                reg = {}
        ws.append([
            dup['numero_fila_original'],
            dup['numero_fila_duplicada'],
            reg.get('codigo_referencia', ''),
            'Repetido en el archivo',
            reg.get('mensaje_duplicado') or 'Misma fila duplicada dentro del Excel subido.',
            json.dumps(reg, ensure_ascii=False)[:200],
        ])
    
    # Ancho de columnas
    ws.column_dimensions['A'].width = 15
    ws.column_dimensions['B'].width = 15
    ws.column_dimensions['C'].width = 15
    ws.column_dimensions['D'].width = 40
    
    # Guardar archivo
    os.makedirs('exports', exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    filename = f'duplicados_archivo_{id_archivo}_{timestamp}.xlsx'
    filepath = os.path.join('exports', filename)
    wb.save(filepath)
    
    return filepath, filename


def _count_duplicados_archivo(duplicados_archivo: dict) -> int:
    """Cuenta filas repetidas dentro del Excel (excluye la primera aparición de cada hash)."""
    return sum(max(0, len(filas) - 1) for filas in duplicados_archivo.values())


def _run_upload(
    job_id: str,
    tabla: str,
    content: bytes,
    cfg: dict,
    nombre_archivo: str,
    usuario: str,
):
    col_map = cfg["columns"]
    date_cols = cfg.get("date_columns", [])
    pk = cfg["pk"]

    file_hash = _calculate_file_hash(content)

    _set_job(job_id, status="reading", progress=0)
    try:
        chunks, total_rows, missing_cols = stream_excel_chunks(content, col_map, date_cols)
    except Exception as e:
        _mark_upload_history(job_id, "error")
        _set_job(job_id, status="error", message=f"Error leyendo Excel: {e}")
        return

    _set_job(job_id, status="inserting", total=total_rows, inserted=0, errors=0, duplicates=0)

    inserted = 0
    skipped_duplicates = 0
    errors = []
    duplicados_bd = []
    duplicados_archivo = {}
    duplicados_archivo_list = []
    seen_in_upload = set()
    first_seen_in_upload = {}
    all_duplicate_records = []
    excel_cols = list(col_map.keys())
    db_cols = ["id_fondo", "id_subfondo"] + excel_cols
    total_chunks = max(1, math.ceil(total_rows / CHUNK_SIZE))
    
    id_archivo = None

    try:
        with get_db() as conn:
            _ensure_upload_history(conn)
            
            try:
                id_archivo = _register_file_load(conn, nombre_archivo, file_hash, tabla, usuario, total_rows)
                if id_archivo:
                    ruta = _save_uploaded_file(content, id_archivo, nombre_archivo)
                    with get_cursor(conn) as cur:
                        cur.execute(
                            "UPDATE archivo_cargado SET ruta_archivo = %s WHERE id_archivo = %s",
                            [ruta, id_archivo],
                        )
                    conn.commit()
            except Exception as e:
                _set_job(job_id, status="warning", message=f"No se pudo registrar archivo: {e}")

            id_fondo, id_subfondo = _get_catalog_ids(conn, tabla)
            _set_job(job_id, status="checking")
            _seed_existing_hashes(conn, tabla, db_cols)
            _set_job(job_id, status="inserting")

            with get_cursor(conn) as cur:
                cur.execute("SET synchronous_commit TO OFF")
            conn.commit()

            for chunk_idx, chunk in enumerate(chunks):
                _apply_catalog_ids(chunk, id_fondo, id_subfondo)
                try:
                    new_chunk, chunk_dups_bd, chunk_dups_file, chunk_dup_dict = _filter_new_records(
                        conn, tabla, chunk, db_cols, seen_in_upload, first_seen_in_upload
                    )

                    duplicados_bd.extend(chunk_dups_bd)
                    duplicados_archivo_list.extend(chunk_dups_file)
                    for h, filas in chunk_dup_dict.items():
                        if h not in duplicados_archivo:
                            duplicados_archivo[h] = []
                        duplicados_archivo[h].extend(filas)

                    skipped = len(chunk_dups_bd) + len(chunk_dups_file)
                    skipped_duplicates += skipped
                    all_duplicate_records.extend(chunk_dups_bd)
                    all_duplicate_records.extend(chunk_dups_file)

                    if new_chunk:
                        try:
                            chunk_inserted = _insert_chunk_with_audit(
                                conn, tabla, new_chunk, db_cols, pk, usuario, id_archivo
                            )
                            inserted += chunk_inserted
                            _registrar_hashes_nuevos(conn, tabla, new_chunk, db_cols)
                            conn.commit()
                        except Exception:
                            conn.rollback()
                            for record in new_chunk:
                                try:
                                    record_hash = record.get("_row_hash") or _row_hash(record, db_cols)
                                    with get_cursor(conn) as cur:
                                        cur.execute(
                                            """
                                            INSERT INTO carga_registros_hash (tabla, row_hash)
                                            VALUES (%s, %s)
                                            ON CONFLICT DO NOTHING
                                            RETURNING row_hash
                                            """,
                                            [tabla, record_hash],
                                        )
                                        if not cur.fetchone():
                                            skipped_duplicates += 1
                                            duplicados_bd.append(
                                                _dup_payload(
                                                    record,
                                                    db_cols,
                                                    "ya_en_base_de_datos",
                                                    "Ya existe en la base de datos (detectado al insertar).",
                                                )
                                            )
                                            continue
                                    one = _insert_chunk_with_audit(
                                        conn, tabla, [record], db_cols, pk, usuario, id_archivo
                                    )
                                    inserted += one
                                    conn.commit()
                                except Exception as e:
                                    conn.rollback()
                                    errors.append({"fila": record.get("_excel_row"), "error": str(e)})
                except Exception as chunk_err:
                    conn.rollback()
                    errors.append({"fila": None, "error": str(chunk_err)})

                progress = min(99, round(((chunk_idx + 1) / total_chunks) * 100))
                _set_job(job_id, inserted=inserted, errors=len(errors), duplicates=skipped_duplicates, progress=progress)

            if id_archivo:
                try:
                    _save_duplicates_to_db(conn, id_archivo, tabla, duplicados_bd, duplicados_archivo)
                    _update_archivo_stats(conn, id_archivo, inserted, usuario=usuario)
                    conn.commit()
                    with get_cursor(conn) as cur:
                        cur.execute(
                            "UPDATE carga_archivos SET id_archivo = %s WHERE job_id = %s",
                            [id_archivo, job_id],
                        )
                    conn.commit()
                except Exception as e:
                    _set_job(job_id, status="warning", message=f"Error guardando duplicados: {e}")
                
    except Exception as e:
        _mark_upload_history(job_id, "error", inserted, len(errors))
        _set_job(job_id, status="error", message=f"Error insertando datos: {e}")
        return

    _mark_upload_history(job_id, "done", inserted, len(errors))

    dup_bd_count = len(duplicados_bd)
    dup_file_count = _count_duplicados_archivo(duplicados_archivo)
    omitidas = dup_bd_count + dup_file_count

    resumen_texto = (
        f"Se insertaron {inserted} registro(s) de {total_rows} fila(s) en el Excel. "
        f"Se omitieron {omitidas} fila(s): "
        f"{dup_bd_count} porque ya existían en la base de datos y "
        f"{dup_file_count} porque estaban repetidas dentro del mismo archivo."
    )

    # Generar reportes Excel
    archivos_reporte = {}
    try:
        with get_db() as conn:
            if id_archivo and dup_bd_count > 0:
                filepath_bd, filename_bd = _generate_duplicates_report(conn, id_archivo, tabla)
                archivos_reporte['duplicados_bd'] = {
                    'url': f'/api/exports/{filename_bd}',
                    'filename': filename_bd,
                    'titulo': 'Duplicados en base de datos',
                    'descripcion': (
                        f'{dup_bd_count} fila(s) no se insertaron porque ya había un registro '
                        'equivalente en la base de datos.'
                    ),
                }

            if id_archivo and dup_file_count > 0:
                filepath_archivo, filename_archivo = _generate_file_duplicates_report(conn, id_archivo, tabla)
                archivos_reporte['duplicados_archivo'] = {
                    'url': f'/api/exports/{filename_archivo}',
                    'filename': filename_archivo,
                    'titulo': 'Repetidos dentro del archivo Excel',
                    'descripcion': (
                        f'{dup_file_count} fila(s) no se insertaron porque repetían otra fila '
                        'del mismo archivo (mismos metadatos en el Excel).'
                    ),
                }
    except Exception as e:
        _set_job(job_id, status="warning", message=f"Error generando reportes: {e}")

    _set_job(job_id,
        status="done",
        progress=100,
        message=resumen_texto,
        result={
            "total_filas_excel": total_rows,
            "insertadas": inserted,
            "omitidas_total": omitidas,
            "duplicados_bd": dup_bd_count,
            "duplicados_archivo": dup_file_count,
            "errores": len(errors),
            "resumen": resumen_texto,
            "columnas_no_encontradas": missing_cols,
            "detalle_errores": errors[:100],
            "duplicados_detalle_bd": [
                {
                    "fila_excel": d.get("_excel_row"),
                    "codigo_referencia": d.get("codigo_referencia"),
                    "tipo": "ya_en_base_de_datos",
                    "mensaje": d.get("mensaje_duplicado"),
                }
                for d in duplicados_bd[:200]
            ],
            "duplicados_detalle_archivo": [
                {
                    "fila_excel": d.get("_excel_row"),
                    "codigo_referencia": d.get("codigo_referencia"),
                    "tipo": "repetido_en_archivo",
                    "mensaje": d.get("mensaje_duplicado"),
                }
                for d in duplicados_archivo_list[:200]
            ],
            "registros_duplicados": all_duplicate_records[:500],
            "archivos_reporte": archivos_reporte,
        },
    )


@router.post("/upload/{tabla}")
async def upload(tabla: str, file: UploadFile = File(...), user: dict = Depends(require_roles("admin", "operador"))):
    try:
        cfg = get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    content = await file.read()
    file_hash = hashlib.sha256(content).hexdigest()
    job_id = str(uuid.uuid4())
    warnings = []

    with get_db() as conn:
        _ensure_upload_history(conn)
        with get_cursor(conn) as cur:
            # Buscar archivo por HASH (contenido exacto)
            cur.execute(
                """
                SELECT nombre_archivo, fecha_carga, estado
                FROM carga_archivos
                WHERE tabla = %s AND file_hash = %s AND estado IN ('processing', 'done')
                ORDER BY fecha_carga DESC
                LIMIT 1
                """,
                [tabla, file_hash],
            )
            existing_by_hash = cur.fetchone()
            if existing_by_hash:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Este archivo tiene el mismo contenido y ya fue cargado anteriormente "
                        f"({existing_by_hash['nombre_archivo']}, estado: {existing_by_hash['estado']})."
                    ),
                )
            
            # Buscar archivo por NOMBRE (advertencia; solo cargas activas)
            cur.execute(
                """
                SELECT nombre_archivo, fecha_carga, estado
                FROM carga_archivos
                WHERE tabla = %s AND nombre_archivo = %s
                  AND estado IN ('processing', 'done')
                ORDER BY fecha_carga DESC
                LIMIT 1
                """,
                [tabla, file.filename],
            )
            existing_by_name = cur.fetchone()
            if existing_by_name:
                warnings.append(
                    f"⚠️ ADVERTENCIA: Ya existe un archivo con el nombre '{file.filename}' "
                    f"(cargado el {existing_by_name['fecha_carga']}). "
                    "Se procederá a validar el contenido y solo se insertarán registros nuevos."
                )
            
            cur.execute(
                """
                INSERT INTO carga_archivos (tabla, nombre_archivo, file_hash, file_size, job_id)
                VALUES (%s, %s, %s, %s, %s)
                """,
                [tabla, file.filename, file_hash, len(content), job_id],
            )
        conn.commit()

    with _jobs_lock:
        _jobs[job_id] = {
            "status": "reading",
            "progress": 0,
            "total": 0,
            "inserted": 0,
            "errors": 0,
            "duplicates": 0,
            "warnings": warnings
        }

    t = threading.Thread(
        target=_run_upload,
        args=(job_id, tabla, content, cfg, file.filename or "archivo.xlsx", user["username"]),
        daemon=True,
    )
    t.start()

    return {"job_id": job_id, "warnings": warnings}


@router.get("/upload/progress/{job_id}")
def upload_progress(job_id: str, _: dict = Depends(require_roles("admin", "operador"))):
    with _jobs_lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job no encontrado")
    return job


def _log_archivo_evento(
    conn,
    id_archivo: int,
    tabla: str,
    nombre_archivo: str,
    evento: str,
    usuario: str,
    detalle: dict | None = None,
):
    with get_cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO archivo_carga_evento
            (id_archivo, tabla_destino, nombre_archivo, evento, usuario, detalle)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            [id_archivo, tabla, nombre_archivo, evento, usuario, json.dumps(detalle or {}, default=str)],
        )


def _hash_base(hash_archivo: str) -> str:
    """Hash original sin sufijo de reversión."""
    if not hash_archivo:
        return ""
    return hash_archivo.split(":rev:")[0]


def _mark_archivo_revertido(
    conn,
    id_archivo: int,
    tabla: str,
    usuario: str,
    registros_eliminados: int = 0,
):
    """Marca la carga como revertida, conserva historial y libera el hash para nueva subida."""
    with get_cursor(conn) as cur:
        cur.execute(
            """
            SELECT hash_archivo, nombre_archivo, estado
            FROM archivo_cargado WHERE id_archivo = %s
            """,
            [id_archivo],
        )
        row = cur.fetchone()
        if not row:
            return
        file_hash = _hash_base(row["hash_archivo"])
        nombre = row["nombre_archivo"]

        cur.execute(
            """
            UPDATE archivo_cargado SET
                estado = 'revertido',
                fecha_reversion = NOW(),
                usuario_reversion = %s,
                registros_eliminados = %s,
                registros_vinculados = 0,
                hash_archivo = %s
            WHERE id_archivo = %s
            """,
            [usuario, registros_eliminados, f"{file_hash}:rev:{id_archivo}", id_archivo],
        )
        cur.execute("DELETE FROM carga_duplicados_bd WHERE id_archivo = %s", [id_archivo])
        cur.execute("DELETE FROM carga_duplicados_archivo WHERE id_archivo = %s", [id_archivo])
        cur.execute("DELETE FROM carga_archivos WHERE id_archivo = %s", [id_archivo])
        if file_hash:
            cur.execute(
                "DELETE FROM carga_archivos WHERE tabla = %s AND file_hash = %s",
                [tabla, file_hash],
            )
        _log_archivo_evento(
            conn,
            id_archivo,
            tabla,
            nombre,
            "revertido",
            usuario,
            {"registros_eliminados": registros_eliminados},
        )


@router.get("/tablas")
def listar_tablas(_: dict = Depends(current_user)):
    return [
        {
            "tabla": k,
            "label": v["label"],
            "pk": v["pk"],
            "pk_label": v.get("pk_label"),
            "subfondo_cod": v.get("subfondo_cod"),
            "consulta": get_consulta_meta(v),
        }
        for k, v in TABLES.items()
    ]


def _archivo_fisico_existe(ruta: str | None) -> bool:
    return bool(ruta and os.path.isfile(ruta))


def _estado_contenido(registros_vinculados: int, registros_en_bd: int, estado_carga: str) -> str:
    if estado_carga == "revertido":
        return "revertido"
    if estado_carga == "pending":
        return "pendiente"
    if registros_en_bd > 0:
        if registros_en_bd < registros_vinculados:
            return "parcial"
        return "activo"
    if registros_vinculados > 0:
        return "sin_datos"
    return "vacio"


def _estado_historial(estado: str, registros_eliminados: int) -> str:
    if estado == "revertido":
        return "Eliminado (revertido)"
    if estado == "pending":
        return "Subiendo"
    if estado == "done":
        return "Subido"
    if estado == "error":
        return "Error"
    return estado or "—"


def _count_registros_en_bd(conn, tabla: str, pk: str, id_archivo: int) -> int:
    with get_cursor(conn) as cur:
        cur.execute(
            f"""
            SELECT COUNT(*) AS n
            FROM carga_archivo_registro car
            INNER JOIN {tabla} t ON t.{pk} = car.id_registro
            WHERE car.id_archivo = %s AND car.tabla = %s AND car.id_registro IS NOT NULL
            """,
            [id_archivo, tabla],
        )
        row = cur.fetchone()
    return row["n"] if row else 0


def _enrich_archivo_row(conn, row: dict, labels: dict) -> dict:
    tabla = row.get("tabla_destino")
    item = dict(row)
    item["tipo_label"] = labels.get(tabla, tabla)
    item["archivo_en_disco"] = _archivo_fisico_existe(item.get("ruta_archivo"))
    registros_vinculados = item.get("registros_vinculados") or 0
    registros_en_bd = 0
    if tabla and tabla in TABLES:
        pk = TABLES[tabla]["pk"]
        registros_en_bd = _count_registros_en_bd(conn, tabla, pk, item["id_archivo"])

    item["registros_en_bd"] = registros_en_bd
    estado_carga = item.get("estado") or ""
    item["estado_contenido"] = _estado_contenido(
        registros_vinculados, registros_en_bd, estado_carga
    )
    item["estado_historial"] = _estado_historial(
        estado_carga, item.get("registros_eliminados") or 0
    )
    item["hash_corto"] = _hash_base(item.get("hash_archivo") or "")[:12]
    item["puede_revertir"] = (
        estado_carga == "done"
        and registros_en_bd > 0
    )
    with get_cursor(conn) as cur:
        cur.execute(
            """
            SELECT evento, usuario, fecha_evento
            FROM archivo_carga_evento
            WHERE id_archivo = %s
            ORDER BY fecha_evento DESC
            LIMIT 1
            """,
            [item["id_archivo"]],
        )
        ult = cur.fetchone()
    item["ultimo_evento"] = ult["evento"] if ult else None
    return item


@router.get("/archivos-control")
def listar_control_archivos(
    tabla: str = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    estado: str = Query(None),
    nombre: str = Query(None),
    _: dict = Depends(require_roles("admin", "operador")),
):
    """Panel de control: todos los archivos subidos con estado, versión y presencia en disco."""
    conditions, params = [], []
    if tabla:
        conditions.append("ac.tabla_destino = %s")
        params.append(tabla)
    if estado:
        conditions.append("ac.estado = %s")
        params.append(estado)
    if nombre:
        conditions.append("ac.nombre_archivo ILIKE %s")
        params.append(f"%{nombre}%")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * limit
    labels = {k: v["label"] for k, v in TABLES.items()}

    with get_db() as conn:
        _ensure_upload_history(conn)
        with get_cursor(conn) as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM archivo_cargado ac {where}", params)
            total = cur.fetchone()["total"]
            cur.execute(
                f"""
                SELECT
                    ac.id_archivo,
                    ac.nombre_archivo,
                    ac.ruta_archivo,
                    ac.hash_archivo,
                    ac.tabla_destino,
                    ac.fecha_carga,
                    ac.usuario_carga,
                    ac.cantidad_registros,
                    ac.registros_vinculados,
                    ac.registros_eliminados,
                    ac.estado,
                    ac.fecha_reversion,
                    ac.usuario_reversion,
                    sf.cod_subfondo,
                    sf.desc_subfondo,
                    ca.estado AS estado_job,
                    ca.filas_insertadas AS job_filas_insertadas,
                    ca.errores AS job_errores,
                    ROW_NUMBER() OVER (
                        PARTITION BY ac.tabla_destino, ac.nombre_archivo
                        ORDER BY ac.fecha_carga, ac.id_archivo
                    ) AS version_por_nombre,
                    ROW_NUMBER() OVER (
                        PARTITION BY ac.tabla_destino, ac.hash_archivo
                        ORDER BY ac.fecha_carga, ac.id_archivo
                    ) AS version_por_contenido
                FROM archivo_cargado ac
                LEFT JOIN sub_fondo sf ON sf.tabla_sql = ac.tabla_destino
                LEFT JOIN carga_archivos ca ON ca.id_archivo = ac.id_archivo
                {where}
                ORDER BY ac.fecha_carga DESC, ac.id_archivo DESC
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            rows = cur.fetchall()

        data = [_enrich_archivo_row(conn, dict(r), labels) for r in rows]

    return {"total": total, "page": page, "limit": limit, "data": data}


@router.get("/archivos-control/{id_archivo}/historial")
def historial_archivo(
    id_archivo: int,
    _: dict = Depends(require_roles("admin", "operador")),
):
    with get_db() as conn:
        _ensure_upload_history(conn)
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id_archivo, nombre_archivo, tabla_destino, estado,
                       fecha_carga, usuario_carga, fecha_reversion, usuario_reversion,
                       cantidad_registros, registros_vinculados, registros_eliminados
                FROM archivo_cargado WHERE id_archivo = %s
                """,
                [id_archivo],
            )
            archivo = cur.fetchone()
            if not archivo:
                raise HTTPException(status_code=404, detail="Archivo no encontrado")
            cur.execute(
                """
                SELECT id_evento, evento, usuario, detalle, fecha_evento
                FROM archivo_carga_evento
                WHERE id_archivo = %s
                ORDER BY fecha_evento ASC, id_evento ASC
                """,
                [id_archivo],
            )
            eventos = cur.fetchall()

    return {
        "archivo": dict(archivo),
        "eventos": [dict(e) for e in eventos],
    }


@router.delete("/registros/{tabla}/{id_registro}")
def eliminar_registro(tabla: str, id_registro: int, user: dict = Depends(require_roles("admin"))):
    try:
        cfg = get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pk = cfg["pk"]
    with get_db() as conn:
        with get_cursor(conn) as cur:
            _set_audit_user(cur, user["username"])
            cur.execute(f"DELETE FROM {tabla} WHERE {pk} = %s RETURNING {pk}", [id_registro])
            deleted = cur.fetchone()
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="Registro no encontrado")

    return {"deleted": True, "tabla": tabla, "id": id_registro}


@router.post("/registros/delete-multiple/{tabla}")
def eliminar_multiples(tabla: str, request_body: dict = Body(...), user: dict = Depends(require_roles("admin"))):
    ids = request_body.get("ids", [])
    if not ids:
        raise HTTPException(status_code=400, detail="Se requiere lista de IDs a eliminar en campo 'ids'")
    if not all(isinstance(i, int) for i in ids):
        raise HTTPException(status_code=400, detail="Todos los IDs deben ser números enteros")
    
    try:
        cfg = get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pk = cfg["pk"]
    deleted_ids = []
    failed_ids = []
    
    with get_db() as conn:
        with get_cursor(conn) as cur:
            _set_audit_user(cur, user["username"])
            for id_registro in ids:
                try:
                    cur.execute(f"DELETE FROM {tabla} WHERE {pk} = %s RETURNING {pk}", [id_registro])
                    result = cur.fetchone()
                    if result:
                        deleted_ids.append(id_registro)
                    else:
                        failed_ids.append(id_registro)
                except Exception:
                    failed_ids.append(id_registro)
        conn.commit()

    message = f"{len(deleted_ids)} registro(s) eliminado(s)"
    if failed_ids:
        message += f"; {len(failed_ids)} no encontrado(s) o con error"

    return {
        "deleted_count": len(deleted_ids),
        "deleted_ids": deleted_ids,
        "failed_ids": failed_ids,
        "tabla": tabla,
        "message": message,
    }


@router.get("/registros")
def consultar_registros(
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    nombre_tabla: str = Query(None),
    operacion: str = Query(None),
    usuario: str = Query(None),
    id_fila_afectada: int = Query(None),
    _: dict = Depends(require_roles("admin")),
):
    conditions, params = [], []
    if nombre_tabla:
        conditions.append("nombre_tabla ILIKE %s"); params.append(f"%{nombre_tabla}%")
    if operacion:
        conditions.append("operacion = %s"); params.append(operacion.upper())
    if usuario:
        conditions.append("usuario ILIKE %s"); params.append(f"%{usuario}%")
    if id_fila_afectada is not None:
        conditions.append("id_fila_afectada = %s"); params.append(id_fila_afectada)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    offset = (page - 1) * limit

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM registro_operaciones {where}", params)
            total = cur.fetchone()["total"]
            cur.execute(
                f"""
                SELECT id_registro, nombre_tabla, operacion, id_fila_afectada, usuario, fecha_hora
                FROM registro_operaciones
                {where}
                ORDER BY fecha_hora DESC, id_registro DESC
                LIMIT %s OFFSET %s
                """,
                params + [limit, offset],
            )
            rows = cur.fetchall()

    return {"total": total, "page": page, "limit": limit, "data": [dict(r) for r in rows]}


@router.get("/registros/exportar")
def exportar_auditoria(
    nombre_tabla: str = Query(None),
    operacion: str = Query(None),
    usuario: str = Query(None),
    id_fila_afectada: int = Query(None),
    _: dict = Depends(require_roles("admin")),
):
    conditions, params = [], []
    if nombre_tabla:
        conditions.append("nombre_tabla ILIKE %s"); params.append(f"%{nombre_tabla}%")
    if operacion:
        conditions.append("operacion = %s"); params.append(operacion.upper())
    if usuario:
        conditions.append("usuario ILIKE %s"); params.append(f"%{usuario}%")
    if id_fila_afectada is not None:
        conditions.append("id_fila_afectada = %s"); params.append(id_fila_afectada)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT id_registro, nombre_tabla, operacion, id_fila_afectada, usuario, fecha_hora
                FROM registro_operaciones
                {where}
                ORDER BY fecha_hora DESC, id_registro DESC
                LIMIT 50000
                """,
                params,
            )
            rows = cur.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="Sin resultados para exportar.")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return _xlsx_response(
        [dict(r) for r in rows],
        f"auditoria_operaciones_{timestamp}.xlsx",
        sheet_title="Auditoría",
    )


@router.get("/archivos-control/exportar")
def exportar_control_archivos(
    tabla: str = Query(None),
    estado: str = Query(None),
    nombre: str = Query(None),
    _: dict = Depends(require_roles("admin", "operador")),
):
    conditions, params = [], []
    if tabla:
        conditions.append("ac.tabla_destino = %s"); params.append(tabla)
    if estado:
        conditions.append("ac.estado = %s"); params.append(estado)
    if nombre:
        conditions.append("ac.nombre_archivo ILIKE %s"); params.append(f"%{nombre}%")

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    labels = {k: v["label"] for k, v in TABLES.items()}

    with get_db() as conn:
        _ensure_upload_history(conn)
        with get_cursor(conn) as cur:
            cur.execute(
                f"""
                SELECT
                    ac.id_archivo, ac.nombre_archivo, ac.tabla_destino, ac.estado,
                    ac.fecha_carga, ac.usuario_carga, ac.fecha_reversion, ac.usuario_reversion,
                    ac.cantidad_registros, ac.registros_vinculados, ac.registros_eliminados,
                    ac.ruta_archivo
                FROM archivo_cargado ac
                {where}
                ORDER BY ac.fecha_carga DESC
                LIMIT 50000
                """,
                params,
            )
            rows = cur.fetchall()

        export_rows = []
        for r in rows:
            item = dict(r)
            item["tipo_documental"] = labels.get(item.get("tabla_destino"), item.get("tabla_destino"))
            item["archivo_en_disco"] = "Sí" if _archivo_fisico_existe(item.get("ruta_archivo")) else "No"
            item["estado_historial"] = _estado_historial(
                item.get("estado") or "", item.get("registros_eliminados") or 0
            )
            export_rows.append(item)

    if not export_rows:
        raise HTTPException(status_code=404, detail="Sin resultados para exportar.")

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return _xlsx_response(
        export_rows,
        f"control_archivos_{timestamp}.xlsx",
        sheet_title="Archivos cargados",
    )


@router.get("/consultar/{tabla}")
def consultar(
    tabla: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    sort: str = Query(None),
    order: str = Query("asc"),
    codigo_referencia: str = Query(None),
    id_registro: int = Query(None),
    titulo_formal: str = Query(None),
    titulo_atribuido: str = Query(None),
    tipologia: str = Query(None),
    fecha_inicial_ano: int = Query(None),
    fecha_final_ano: int = Query(None),
    palabras_clave: str = Query(None),
    id_fondo: int = Query(None),
    id_subfondo: int = Query(None),
    _: dict = Depends(current_user),
):
    try:
        cfg = get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pk = cfg["pk"]
    conditions, params = [], []

    def _cond(col, op, val):
        conditions.append(f"t.{col} {op}"); params.append(val)

    if id_registro is not None:
        _cond(pk, "= %s", id_registro)
    if codigo_referencia:
        _cond("codigo_referencia", "ILIKE %s", f"%{codigo_referencia}%")
    if titulo_formal:
        _cond("titulo_formal", "ILIKE %s", f"%{titulo_formal}%")
    if titulo_atribuido:
        _cond("titulo_atribuido", "ILIKE %s", f"%{titulo_atribuido}%")
    if tipologia:
        _cond("tipologia", "ILIKE %s", f"%{tipologia}%")
    if fecha_inicial_ano:
        _cond("fecha_inicial_ano", "= %s", fecha_inicial_ano)
    if fecha_final_ano:
        _cond("fecha_final_ano", "= %s", fecha_final_ano)
    if palabras_clave:
        _cond("palabras_clave", "ILIKE %s", f"%{palabras_clave}%")
    if id_fondo:
        _cond("id_fondo", "= %s", id_fondo)
    if id_subfondo:
        _cond("id_subfondo", "= %s", id_subfondo)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    allowed_cols = list(cfg["columns"].keys()) + [cfg["pk"], "nombre_fondo", "nombre_subfondo", "cod_fondo", "cod_subfondo"]
    sort_col = sort if sort in allowed_cols else cfg["pk"]
    sort_sql = sort_col if sort_col in ("nombre_fondo", "nombre_subfondo", "cod_fondo", "cod_subfondo") else f"t.{sort_col}"
    order_dir = "DESC" if order.lower() == "desc" else "ASC"
    offset = (page - 1) * limit
    from_clause = _consulta_from_clause(tabla)
    select_cols = _consulta_select_cols(tabla, cfg)

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM {from_clause} {where}", params)
            total = cur.fetchone()["total"]
            cur.execute(
                f"SELECT {select_cols} FROM {from_clause} {where} ORDER BY {sort_sql} {order_dir} LIMIT %s OFFSET %s",
                params + [limit, offset],
            )
            rows = cur.fetchall()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pk": cfg["pk"],
        "column_labels": {
            "nombre_fondo": "Fondo",
            "nombre_subfondo": "Subfondo",
            "cod_fondo": "Código fondo",
            "cod_subfondo": "Código subfondo",
        },
        "data": [dict(r) for r in rows],
    }


@router.get("/exportar/{tabla}")
def exportar(
    tabla: str,
    codigo_referencia: str = Query(None),
    id_registro: int = Query(None),
    titulo_formal: str = Query(None),
    fecha_inicial_ano: int = Query(None),
    fecha_final_ano: int = Query(None),
    palabras_clave: str = Query(None),
    id_fondo: int = Query(None),
    id_subfondo: int = Query(None),
    _: dict = Depends(current_user),
):
    try:
        cfg = get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pk = cfg["pk"]
    conditions, params = [], []
    if id_registro is not None:
        conditions.append(f"t.{pk} = %s"); params.append(id_registro)
    if codigo_referencia:
        conditions.append("t.codigo_referencia ILIKE %s"); params.append(f"%{codigo_referencia}%")
    if titulo_formal:
        conditions.append("t.titulo_formal ILIKE %s"); params.append(f"%{titulo_formal}%")
    if fecha_inicial_ano:
        conditions.append("t.fecha_inicial_ano = %s"); params.append(fecha_inicial_ano)
    if fecha_final_ano:
        conditions.append("t.fecha_final_ano = %s"); params.append(fecha_final_ano)
    if palabras_clave:
        conditions.append("t.palabras_clave ILIKE %s"); params.append(f"%{palabras_clave}%")
    if id_fondo:
        conditions.append("t.id_fondo = %s"); params.append(id_fondo)
    if id_subfondo:
        conditions.append("t.id_subfondo = %s"); params.append(id_subfondo)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    from_clause = _consulta_from_clause(tabla)
    select_cols = _consulta_select_cols(tabla, cfg)

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(f"SELECT {select_cols} FROM {from_clause} {where} LIMIT 50000", params)
            rows = cur.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="Sin resultados para exportar.")

    label = cfg.get("label", tabla).replace(" ", "_")[:20]
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"consulta_{tabla}_{timestamp}.xlsx"
    return _xlsx_response([dict(r) for r in rows], filename, sheet_title=label)


@router.get("/archivos/{tabla}")
def listar_archivos_cargados(
    tabla: str,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    _: dict = Depends(require_roles("admin", "operador")),
):
    try:
        get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    offset = (page - 1) * limit
    with get_db() as conn:
        _ensure_upload_history(conn)
        with get_cursor(conn) as cur:
            cur.execute(
                "SELECT COUNT(*) AS total FROM archivo_cargado WHERE tabla_destino = %s",
                [tabla],
            )
            total = cur.fetchone()["total"]
            cur.execute(
                """
                SELECT id_archivo, nombre_archivo, ruta_archivo, hash_archivo,
                       tabla_destino, fecha_carga, usuario_carga,
                       cantidad_registros, registros_vinculados, estado
                FROM archivo_cargado
                WHERE tabla_destino = %s
                ORDER BY fecha_carga DESC
                LIMIT %s OFFSET %s
                """,
                [tabla, limit, offset],
            )
            rows = cur.fetchall()

        labels = {k: v["label"] for k, v in TABLES.items()}
        data = [_enrich_archivo_row(conn, dict(r), labels) for r in rows]

    return {"total": total, "page": page, "limit": limit, "data": data}


@router.get("/archivos/{tabla}/{id_archivo}/preview-eliminacion")
def preview_eliminacion_por_archivo(
    tabla: str,
    id_archivo: int,
    _: dict = Depends(require_roles("admin")),
):
    try:
        cfg = get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pk = cfg["pk"]
    with get_db() as conn:
        _ensure_upload_history(conn)
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id_archivo, nombre_archivo, tabla_destino, fecha_carga,
                       usuario_carga, cantidad_registros, registros_vinculados, estado
                FROM archivo_cargado
                WHERE id_archivo = %s AND tabla_destino = %s
                """,
                [id_archivo, tabla],
            )
            archivo = cur.fetchone()
            if not archivo:
                raise HTTPException(status_code=404, detail="Archivo no encontrado")

            if archivo["estado"] == "revertido":
                raise HTTPException(
                    status_code=400,
                    detail="Esta carga ya fue revertida (eliminada). Consulte el historial.",
                )

            cur.execute(
                """
                SELECT COUNT(*) AS total
                FROM carga_archivo_registro
                WHERE id_archivo = %s AND tabla = %s AND id_registro IS NOT NULL
                """,
                [id_archivo, tabla],
            )
            vinculados = cur.fetchone()["total"]

            cur.execute(
                f"""
                SELECT COUNT(*) AS total
                FROM {tabla} doc
                WHERE doc.{pk} IN (
                    SELECT id_registro FROM carga_archivo_registro
                    WHERE id_archivo = %s AND tabla = %s AND id_registro IS NOT NULL
                )
                """,
                [id_archivo, tabla],
            )
            existentes = cur.fetchone()["total"]

    return {
        "archivo": dict(archivo),
        "registros_vinculados": vinculados,
        "registros_existentes_en_tabla": existentes,
        "mensaje": (
            f"Se eliminarán {existentes} registro(s) vinculados al archivo "
            f"«{archivo['nombre_archivo']}»."
        ),
        "requiere_confirmacion": archivo["nombre_archivo"],
    }


@router.post("/archivos/{tabla}/{id_archivo}/eliminar-por-archivo")
def eliminar_por_archivo(
    tabla: str,
    id_archivo: int,
    body: dict = Body(...),
    user: dict = Depends(require_roles("admin")),
):
    confirmar = body.get("confirmar") is True
    texto = (body.get("texto_confirmacion") or "").strip()

    if not confirmar:
        raise HTTPException(status_code=400, detail="Debe enviar confirmar: true")

    try:
        cfg = get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pk = cfg["pk"]
    with get_db() as conn:
        _ensure_upload_history(conn)
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id_archivo, nombre_archivo, ruta_archivo, tabla_destino, estado
                FROM archivo_cargado
                WHERE id_archivo = %s AND tabla_destino = %s
                """,
                [id_archivo, tabla],
            )
            archivo = cur.fetchone()
            if not archivo:
                raise HTTPException(status_code=404, detail="Archivo no encontrado")

            if texto != archivo["nombre_archivo"]:
                raise HTTPException(
                    status_code=400,
                    detail="El texto de confirmación debe coincidir exactamente con el nombre del archivo",
                )

            cur.execute(
                """
                SELECT id_registro, row_hash
                FROM carga_archivo_registro
                WHERE id_archivo = %s AND tabla = %s AND id_registro IS NOT NULL
                """,
                [id_archivo, tabla],
            )
            vinculos = cur.fetchall()

        if not vinculos:
            _mark_archivo_revertido(conn, id_archivo, tabla, user["username"], 0)
            conn.commit()
            return {
                "eliminados": 0,
                "id_archivo": id_archivo,
                "nombre_archivo": archivo["nombre_archivo"],
                "mensaje": "Carga marcada como revertida; puede volver a subir el archivo.",
            }

        ids = [v["id_registro"] for v in vinculos]
        hashes = [v["row_hash"] for v in vinculos]

        with get_cursor(conn) as cur:
            _set_audit_user(cur, user["username"])
            cur.execute(
                f"DELETE FROM {tabla} WHERE {pk} = ANY(%s) RETURNING {pk}",
                [ids],
            )
            deleted_rows = cur.fetchall()
            deleted_count = len(deleted_rows)

            for h in hashes:
                cur.execute(
                    "DELETE FROM carga_registros_hash WHERE tabla = %s AND row_hash = %s",
                    [tabla, h],
                )
            _mark_archivo_revertido(
                conn, id_archivo, tabla, user["username"], deleted_count
            )
        conn.commit()

    return {
        "eliminados": deleted_count,
        "id_archivo": id_archivo,
        "nombre_archivo": archivo["nombre_archivo"],
        "mensaje": f"Se eliminaron {deleted_count} registro(s) del archivo «{archivo['nombre_archivo']}».",
    }


@router.get("/exports/{filename}")
def descargar_reporte(filename: str, _: dict = Depends(require_roles("admin", "operador"))):
    """Descarga reportes Excel de duplicados generados durante carga."""
    filepath = os.path.join('exports', filename)
    
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Archivo no encontrado")
    
    # Validar que el archivo es del usuario actual (seguridad básica)
    if not filename.startswith('duplicados_'):
        raise HTTPException(status_code=400, detail="Tipo de archivo no válido")
    
    return FileResponse(
        filepath,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )
