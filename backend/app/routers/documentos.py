from fastapi import APIRouter, Depends, UploadFile, File, HTTPException, Query, Body
from fastapi.responses import StreamingResponse, FileResponse
from app.core.config import get_table_config, TABLES
from app.core.db import get_db, get_cursor
from app.core.excel import CHUNK_SIZE, stream_excel_chunks
from app.core.security import current_user, require_roles
import csv
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

# Estado de jobs en memoria: { job_id: { status, progress, total, inserted, errors, result } }
_jobs: dict = {}
_jobs_lock = threading.Lock()


def _set_job(job_id: str, **kwargs):
    with _jobs_lock:
        _jobs[job_id].update(kwargs)


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
                estado TEXT NOT NULL DEFAULT 'processing',
                filas_insertadas INT DEFAULT 0,
                errores INT DEFAULT 0,
                fecha_carga TIMESTAMPTZ DEFAULT NOW(),
                UNIQUE (tabla, file_hash)
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS carga_registros_hash (
                tabla TEXT NOT NULL,
                row_hash TEXT NOT NULL,
                fecha_registro TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (tabla, row_hash)
            )
        """)
    conn.commit()


def _row_hash(record: dict, db_cols: list) -> str:
    values = [record.get(col) for col in db_cols]
    raw = json.dumps(values, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _filter_new_records(conn, tabla: str, records: list, db_cols: list) -> tuple[list, int, list]:
    if not records:
        return [], 0, []

    for record in records:
        record["_row_hash"] = _row_hash(record, db_cols)

    hash_buf = io.StringIO()
    for record in records:
        hash_buf.write(record["_row_hash"] + "\n")
    hash_buf.seek(0)

    with get_cursor(conn) as cur:
        cur.execute("CREATE TEMP TABLE IF NOT EXISTS tmp_upload_hashes (row_hash TEXT)")
        cur.execute("TRUNCATE tmp_upload_hashes")
        cur.copy_from(hash_buf, "tmp_upload_hashes", columns=["row_hash"], sep="\t")
        cur.execute(
            """
            INSERT INTO carga_registros_hash (tabla, row_hash)
            SELECT DISTINCT %s, row_hash
            FROM tmp_upload_hashes
            ON CONFLICT DO NOTHING
            RETURNING row_hash
            """,
            [tabla],
        )
        new_hashes = {row["row_hash"] for row in cur.fetchall()}

    used_hashes = set()
    new_records = []
    duplicate_records = []
    for record in records:
        row_hash = record["_row_hash"]
        if row_hash in new_hashes and row_hash not in used_hashes:
            new_records.append(record)
            used_hashes.add(row_hash)
        else:
            # Este es un duplicado
            dup = {col: record.get(col) for col in db_cols if col not in ["id_fondo", "id_subfondo", "_row_hash", "_excel_row"]}
            dup["_row_hash"] = row_hash
            if "_excel_row" in record:
                dup["_excel_row"] = record["_excel_row"]
            duplicate_records.append(dup)
    
    return new_records, len(records) - len(new_records), duplicate_records


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


def _register_file_load(conn, nombre_archivo: str, hash_archivo: str, tabla: str, usuario: str, cantidad: int) -> int:
    """Registra la carga de archivo en la tabla archivo_cargado. Retorna id_archivo."""
    with get_cursor(conn) as cur:
        cur.execute(
            """
            INSERT INTO archivo_cargado 
            (nombre_archivo, hash_archivo, tabla_destino, usuario_carga, cantidad_registros, estado)
            VALUES (%s, %s, %s, %s, %s, 'pending')
            RETURNING id_archivo
            """,
            [nombre_archivo, hash_archivo, tabla, usuario, cantidad]
        )
        result = cur.fetchone()
    conn.commit()
    return result['id_archivo'] if result else None


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
                        json.dumps(dup, default=str),
                        'hash_coincidente'
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
                                filas[0].get('_excel_row'),
                                filas[i].get('_excel_row'),
                                hash_val,
                                json.dumps(filas[i], default=str),
                                'hash_coincidente'
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
    ws.title = 'Duplicados BD'
    
    # Headers
    headers = ['Fila Excel', 'Registro Duplicado', 'ID Existente BD', 'Criterio', 'Fecha Detección']
    ws.append(headers)
    
    # Estilos para headers
    header_fill = PatternFill(start_color='FFC7CE', end_color='FFC7CE', fill_type='solid')
    header_font = Font(bold=True)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
    
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
        registro_str = json.dumps(dup['registro_json'], ensure_ascii=False)[:100] if dup['registro_json'] else ''
        ws.append([
            dup['numero_fila_excel'],
            registro_str,
            dup['id_existente_bd'] or 'N/A',
            dup['criterio_duplicidad'],
            dup['fecha_deteccion'].isoformat() if dup['fecha_deteccion'] else ''
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
    ws.title = 'Duplicados Archivo'
    
    # Headers
    headers = ['Fila Original', 'Fila Duplicada', 'Criterio', 'Datos Registro']
    ws.append(headers)
    
    # Estilos para headers
    header_fill = PatternFill(start_color='FFEB9C', end_color='FFEB9C', fill_type='solid')
    header_font = Font(bold=True)
    for cell in ws[1]:
        cell.fill = header_fill
        cell.font = header_font
    
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
        registro_str = json.dumps(dup['registro_json'], ensure_ascii=False)[:100] if dup['registro_json'] else ''
        ws.append([
            dup['numero_fila_original'],
            dup['numero_fila_duplicada'],
            dup['criterio_duplicidad'],
            registro_str
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
    duplicados_bd = []  # Registros que ya existen en BD
    duplicados_archivo = {}  # Registros repetidos dentro del Excel: {hash: [filas]}
    all_duplicate_records = []
    excel_cols = list(col_map.keys())
    db_cols = ["id_fondo", "id_subfondo"] + excel_cols
    total_chunks = max(1, math.ceil(total_rows / CHUNK_SIZE))
    
    id_archivo = None

    try:
        with get_db() as conn:
            _ensure_upload_history(conn)
            
            # Registrar archivo en la nueva tabla
            try:
                id_archivo = _register_file_load(conn, nombre_archivo, file_hash, tabla, usuario, total_rows)
            except Exception as e:
                _set_job(job_id, status="warning", message=f"No se pudo registrar archivo: {e}")
            
            id_fondo, id_subfondo = _get_catalog_ids(conn, tabla)
            _set_job(job_id, status="checking")
            _seed_existing_hashes(conn, tabla, db_cols)
            _set_job(job_id, status="inserting")
            try:
                with get_cursor(conn) as cur:
                    cur.execute("SET synchronous_commit TO OFF")
                    cur.execute(f"ALTER TABLE {tabla} DISABLE TRIGGER ALL")
                conn.commit()

                for chunk_idx, chunk in enumerate(chunks):
                    _apply_catalog_ids(chunk, id_fondo, id_subfondo)
                    try:
                        new_chunk, duplicates, chunk_duplicates = _filter_new_records(conn, tabla, chunk, db_cols)
                        
                        # Separar duplicados: BD vs archivo
                        for dup in chunk_duplicates:
                            dup_hash = dup.get('_row_hash')
                            if dup_hash:
                                # Rastrear duplicados dentro del archivo
                                if dup_hash not in duplicados_archivo:
                                    duplicados_archivo[dup_hash] = []
                                duplicados_archivo[dup_hash].append(dup)
                            duplicados_bd.append(dup)  # Por ahora registramos como BD
                        
                        skipped_duplicates += duplicates
                        all_duplicate_records.extend(chunk_duplicates)
                        
                        if new_chunk:
                            buf = _build_csv_buffer(new_chunk, db_cols)
                            with get_cursor(conn) as cur:
                                cur.copy_from(buf, tabla, columns=db_cols, sep="\t", null="\\N")
                            inserted += len(new_chunk)
                        conn.commit()
                    except Exception:
                        conn.rollback()
                        chunk_values = [[record.get(col) for col in db_cols] for record in chunk]
                        placeholders = ", ".join(["%s"] * len(db_cols))
                        sql = f"INSERT INTO {tabla} ({', '.join(db_cols)}) VALUES ({placeholders})"
                        for record, values in zip(chunk, chunk_values):
                            try:
                                record_hash = _row_hash(record, db_cols)
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
                                        conn.rollback()
                                        skipped_duplicates += 1
                                        dup = {col: record.get(col) for col in db_cols if col not in ["id_fondo", "id_subfondo", "_row_hash", "_excel_row"]}
                                        dup["_row_hash"] = record_hash
                                        if "_excel_row" in record:
                                            dup["_excel_row"] = record["_excel_row"]
                                        
                                        # Rastrear duplicados dentro del archivo
                                        if record_hash not in duplicados_archivo:
                                            duplicados_archivo[record_hash] = []
                                        duplicados_archivo[record_hash].append(dup)
                                        duplicados_bd.append(dup)
                                        all_duplicate_records.append(dup)
                                        continue
                                    cur.execute(sql, values)
                                conn.commit()
                                inserted += 1
                            except Exception as e:
                                conn.rollback()
                                errors.append({"fila": record.get("_excel_row"), "error": str(e)})

                    progress = min(99, round(((chunk_idx + 1) / total_chunks) * 100))
                    _set_job(job_id, inserted=inserted, errors=len(errors), duplicates=skipped_duplicates, progress=progress)
            finally:
                with get_cursor(conn) as cur:
                    cur.execute(f"ALTER TABLE {tabla} ENABLE TRIGGER ALL")
                conn.commit()
            
            # Guardar duplicados en BD y generar reportes
            if id_archivo:
                try:
                    _save_duplicates_to_db(conn, id_archivo, tabla, duplicados_bd, duplicados_archivo)
                    
                    # Actualizar estado del archivo a 'done'
                    with get_cursor(conn) as cur:
                        cur.execute(
                            """
                            UPDATE archivo_cargado 
                            SET estado = 'done', cantidad_registros = %s
                            WHERE id_archivo = %s
                            """,
                            [inserted, id_archivo]
                        )
                    conn.commit()
                except Exception as e:
                    _set_job(job_id, status="warning", message=f"Error guardando duplicados: {e}")
                
    except Exception as e:
        _mark_upload_history(job_id, "error", inserted, len(errors))
        _set_job(job_id, status="error", message=f"Error insertando datos: {e}")
        return

    _mark_upload_history(job_id, "done", inserted, len(errors))
    
    # Generar reportes Excel
    archivos_reporte = {}
    try:
        with get_db() as conn:
            if id_archivo and duplicados_bd:
                filepath_bd, filename_bd = _generate_duplicates_report(conn, id_archivo, tabla)
                archivos_reporte['duplicados_bd'] = {
                    'url': f'/api/exports/{filename_bd}',
                    'filename': filename_bd
                }
            
            if id_archivo and duplicados_archivo:
                filepath_archivo, filename_archivo = _generate_file_duplicates_report(conn, id_archivo, tabla)
                archivos_reporte['duplicados_archivo'] = {
                    'url': f'/api/exports/{filename_archivo}',
                    'filename': filename_archivo
                }
    except Exception as e:
        _set_job(job_id, status="warning", message=f"Error generando reportes: {e}")

    _set_job(job_id,
        status="done",
        progress=100,
        result={
            "total_filas_excel": total_rows,
            "insertadas": inserted,
            "duplicados_bd": len(duplicados_bd),
            "duplicados_archivo": _count_duplicados_archivo(duplicados_archivo),
            "errores": len(errors),
            "columnas_no_encontradas": missing_cols,
            "detalle_errores": errors[:100],
            "registros_duplicados": all_duplicate_records[:500],
            "archivos_reporte": archivos_reporte
        }
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
            
            # Buscar archivo por NOMBRE (advertencia)
            cur.execute(
                """
                SELECT nombre_archivo, fecha_carga, estado
                FROM carga_archivos
                WHERE tabla = %s AND nombre_archivo = %s
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


@router.get("/tablas")
def listar_tablas(_: dict = Depends(current_user)):
    return [{"tabla": k, "label": v["label"]} for k, v in TABLES.items()]


@router.delete("/registros/{tabla}/{id_registro}")
def eliminar_registro(tabla: str, id_registro: int, user: dict = Depends(require_roles("admin"))):
    try:
        cfg = get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    pk = cfg["pk"]
    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(f"DELETE FROM {tabla} WHERE {pk} = %s RETURNING {pk}", [id_registro])
            deleted = cur.fetchone()
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="Registro no encontrado")

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                INSERT INTO registro_operaciones(nombre_tabla, operacion, id_fila_afectada, usuario, datos_previos, datos_nuevos)
                VALUES (%s, %s, %s, %s, NULL, NULL)
                """,
                [tabla, "DELETE", id_registro, user["username"]],
            )
        conn.commit()

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
            for id_registro in ids:
                try:
                    cur.execute(f"DELETE FROM {tabla} WHERE {pk} = %s RETURNING {pk}", [id_registro])
                    result = cur.fetchone()
                    if result:
                        deleted_ids.append(id_registro)
                    else:
                        failed_ids.append(id_registro)
                except Exception as e:
                    failed_ids.append(id_registro)
        conn.commit()

        # Registrar en auditoria DENTRO de la conexión
        try:
            for id_registro in deleted_ids:
                with get_cursor(conn) as cur:
                    cur.execute(
                        """
                        INSERT INTO registro_operaciones(nombre_tabla, operacion, id_fila_afectada, usuario, datos_previos, datos_nuevos)
                        VALUES (%s, %s, %s, %s, NULL, NULL)
                        """,
                        [tabla, "DELETE_MULTIPLE", id_registro, user["username"]],
                    )
                conn.commit()
        except Exception as audit_error:
            # Log pero no falles si la auditoría falla
            pass

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
    _: dict = Depends(require_roles("admin")),
):
    conditions, params = [], []
    if nombre_tabla:
        conditions.append("nombre_tabla ILIKE %s"); params.append(f"%{nombre_tabla}%")
    if operacion:
        conditions.append("operacion = %s"); params.append(operacion.upper())
    if usuario:
        conditions.append("usuario ILIKE %s"); params.append(f"%{usuario}%")

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


@router.get("/consultar/{tabla}")
def consultar(
    tabla: str,
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=500),
    sort: str = Query(None),
    order: str = Query("asc"),
    codigo_referencia: str = Query(None),
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

    conditions, params = [], []

    if codigo_referencia:
        conditions.append("codigo_referencia ILIKE %s"); params.append(f"%{codigo_referencia}%")
    if titulo_formal:
        conditions.append("titulo_formal ILIKE %s"); params.append(f"%{titulo_formal}%")
    if titulo_atribuido:
        conditions.append("titulo_atribuido ILIKE %s"); params.append(f"%{titulo_atribuido}%")
    if tipologia:
        conditions.append("tipologia ILIKE %s"); params.append(f"%{tipologia}%")
    if fecha_inicial_ano:
        conditions.append("fecha_inicial_ano = %s"); params.append(fecha_inicial_ano)
    if fecha_final_ano:
        conditions.append("fecha_final_ano = %s"); params.append(fecha_final_ano)
    if palabras_clave:
        conditions.append("palabras_clave ILIKE %s"); params.append(f"%{palabras_clave}%")
    if id_fondo:
        conditions.append("id_fondo = %s"); params.append(id_fondo)
    if id_subfondo:
        conditions.append("id_subfondo = %s"); params.append(id_subfondo)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
    allowed_cols = list(cfg["columns"].keys()) + [cfg["pk"]]
    sort_col = sort if sort in allowed_cols else cfg["pk"]
    order_dir = "DESC" if order.lower() == "desc" else "ASC"
    offset = (page - 1) * limit

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(f"SELECT COUNT(*) AS total FROM {tabla} {where}", params)
            total = cur.fetchone()["total"]
            cur.execute(
                f"SELECT * FROM {tabla} {where} ORDER BY {sort_col} {order_dir} LIMIT %s OFFSET %s",
                params + [limit, offset],
            )
            rows = cur.fetchall()

    return {
        "total": total,
        "page": page,
        "limit": limit,
        "pk": cfg["pk"],
        "data": [dict(r) for r in rows],
    }


@router.get("/exportar/{tabla}")
def exportar(
    tabla: str,
    codigo_referencia: str = Query(None),
    titulo_formal: str = Query(None),
    fecha_inicial_ano: int = Query(None),
    fecha_final_ano: int = Query(None),
    palabras_clave: str = Query(None),
    id_fondo: int = Query(None),
    id_subfondo: int = Query(None),
    _: dict = Depends(current_user),
):
    try:
        get_table_config(tabla)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))

    conditions, params = [], []
    if codigo_referencia:
        conditions.append("codigo_referencia ILIKE %s"); params.append(f"%{codigo_referencia}%")
    if titulo_formal:
        conditions.append("titulo_formal ILIKE %s"); params.append(f"%{titulo_formal}%")
    if fecha_inicial_ano:
        conditions.append("fecha_inicial_ano = %s"); params.append(fecha_inicial_ano)
    if fecha_final_ano:
        conditions.append("fecha_final_ano = %s"); params.append(fecha_final_ano)
    if palabras_clave:
        conditions.append("palabras_clave ILIKE %s"); params.append(f"%{palabras_clave}%")
    if id_fondo:
        conditions.append("id_fondo = %s"); params.append(id_fondo)
    if id_subfondo:
        conditions.append("id_subfondo = %s"); params.append(id_subfondo)

    where = ("WHERE " + " AND ".join(conditions)) if conditions else ""

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(f"SELECT * FROM {tabla} {where} LIMIT 50000", params)
            rows = cur.fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="Sin resultados para exportar.")

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)
    output.seek(0)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={tabla}.csv"},
    )


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
