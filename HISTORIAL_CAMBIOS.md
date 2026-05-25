# Historial de cambios — Archivo Congreso

Registro de modificaciones del proyecto. **Actualizar este archivo en cada entrega** con fecha, descripción, autor y referencia (ticket, issue o conversación).

---

## Formato de entradas

| Campo | Descripción |
|--------|-------------|
| **Fecha** | AAAA-MM-DD |
| **Autor** | Persona o agente que aplicó el cambio |
| **Referencia** | Ticket, issue, PR o contexto (opcional) |
| **Cambios** | Lista breve de qué se modificó y por qué |

---

## 2026-05-25 — Exportaciones XLSX y duplicados explícitos en carga

| Campo | Valor |
|--------|--------|
| **Autor** | Auto (Cursor Agent) |
| **Referencia** | Exportar Excel + mensajes claros duplicados BD/archivo |

### Cambios

- **Todas las exportaciones en formato .xlsx**
  - Consulta documental (`GET /api/exportar/{tabla}`).
  - Auditoría (`GET /api/registros/exportar`).
  - Control de archivos (`GET /api/archivos-control/exportar`).
  - Reportes de duplicados en carga (ya eran .xlsx).

- **Duplicados clasificados correctamente**
  - `ya_en_base_de_datos`: fila con metadatos idénticos a un registro ya almacenado.
  - `repetido_en_archivo`: fila repetida dentro del mismo Excel.
  - Resumen textual en resultado de carga y tarjetas en la UI.
  - Reportes Excel con columnas: tipo, explicación, código de referencia, fila.

---

## 2026-05-25 — DataTable en todos los módulos e historial de archivos

| Campo | Valor |
|--------|--------|
| **Autor** | Auto (Cursor Agent) |
| **Referencia** | DataTables en menús + registro persistente subidas/eliminaciones |

### Cambios

- **DataTable en todos los módulos de listado**
  - Auditoría de operaciones (`RegistrosPanel`): paginación completa, filtros por tabla, operación, usuario e ID de fila.
  - Usuarios (`UsuariosPanel`): listado con DataTable y acciones por fila.
  - Consulta y Control archivos: ya usaban DataTable (sin cambio de patrón).

- **Historial de archivos (no se borra al revertir)**
  - Tabla `archivo_carga_evento`: eventos `subida`, `completado`, `revertido`.
  - Al revertir una carga el registro pasa a `estado=revertido` (ya no se elimina de `archivo_cargado`).
  - Columnas: `fecha_reversion`, `usuario_reversion`, `registros_eliminados`.
  - Se libera el hash para volver a subir el mismo contenido.
  - `GET /api/archivos-control/{id}/historial`: línea de tiempo de eventos.
  - Control archivos: columnas Estado, fechas de subida/eliminación, botón Historial.

- **Migración:** `database/migrations/003_archivo_historial.sql`

---

## 2026-05-25 — Todos los tipos documentales, DataTable y control de archivos

| Campo | Valor |
|--------|--------|
| **Autor** | Auto (Cursor Agent) |
| **Referencia** | Extensión a 13 subfondos + menú control de archivos |

### Cambios

- **13 tipos documentales operativos**
  - `tables_config.yaml` con plantilla de columnas compartida y entrada por cada subfondo del catálogo.
  - `database/document_tables.sql`: DDL + triggers de auditoría para las 12 tablas adicionales.
  - Docker monta `02-document_tables.sql` en init; migración manual `database/migrations/002_document_tables.sql`.

- **DataTable en consulta para todos los tipos**
  - `GET /api/tablas` incluye `consulta` (campos de búsqueda, filtros, etiquetas) por tipo.
  - `ConsultaPanel` consume metadatos dinámicos (código de referencia + ID según PK de cada tabla).

- **Menú «Control archivos»**
  - `ControlArchivosPanel.jsx` con DataTable global de cargas.
  - `GET /api/archivos-control`: versión por nombre/contenido, archivo en disco, estado de carga y de datos, registros en BD.
  - Reversión de carga (admin) integrada en columna Acciones.
  - Visible para admin y operador; eliminado panel duplicado bajo Registro.

---

## 2026-05-25 — DataTable, paginación y re-carga de archivos

| Campo | Valor |
|--------|--------|
| **Autor** | Auto (Cursor Agent) |
| **Referencia** | Solicitud de mejora UX consulta + flujo eliminación por origen |

### Cambios

- **Consulta — componente `DataTable`**
  - Nuevo `frontend/src/components/DataTable.jsx`: tabla con búsqueda destacada por **código de referencia** e **ID de acta** (PK dinámica según tipo documental).
  - Paginación ampliada: botones Primera/Última, campo numérico «Ir a página», selector de página (hasta 200 páginas) además de Anterior/Siguiente.
  - `ConsultaPanel.jsx` refactorizado para usar `DataTable`; filtros adicionales (título, palabras clave, años) en la barra de herramientas.

- **API consulta**
  - Parámetro `id_registro` en `GET /api/consultar/{tabla}` y `GET /api/exportar/{tabla}` para filtrar por ID de acta (o PK configurada).
  - `GET /api/tablas` devuelve también el campo `pk` por tipo documental.

- **Re-subida tras eliminación por origen**
  - Nueva función `_release_archivo_for_reupload`: al revertir una carga elimina filas en `archivo_cargado`, `carga_archivos`, duplicados y libera el `hash` (restricción UNIQUE).
  - Sustituye el marcado `estado = 'eliminado'` que impedía volver a subir el mismo contenido u otro nombre.
  - Advertencia por nombre duplicado solo considera cargas activas (`processing`, `done`).
  - Si no hay registros vinculados, igualmente libera metadatos para permitir nueva carga.

- **Estilos**
  - Clases CSS `.data-table-*` en `frontend/src/index.css`.

---

## 2026-05-25 — Auditoría, archivos, consulta fondo/subfondo

| Campo | Valor |
|--------|--------|
| **Autor** | Auto (Cursor Agent) |
| **Referencia** | Mejora inicial: auditoría, trazabilidad de cargas, eliminación por archivo, nombres descriptivos |

### Cambios

- **Auditoría**
  - `fn_auditoria()` usa `app.audit_user` (usuario JWT) en lugar del rol PostgreSQL.
  - Los INSERT en carga masiva ya no desactivan triggers; todos los INSERT quedan en `registro_operaciones`.
  - Migración: `database/migrations/001_auditoria_archivos_fondo.sql`.

- **Trazabilidad de archivos**
  - Tabla `carga_archivo_registro` (vínculo archivo ↔ registro).
  - `archivo_cargado` con `ruta_archivo` y `registros_vinculados`.
  - Guardado de Excel en volumen `uploads/`.

- **Eliminación por origen**
  - Endpoints `GET/POST /api/archivos/{tabla}/...` y panel `ArchivosPanel.jsx` (solo admin).

- **Consulta**
  - JOIN con `fondo` y `sub_fondo`; columnas `nombre_fondo` y `nombre_subfondo` en listado y CSV.

---

## Plantilla para próximas entradas

```markdown
## AAAA-MM-DD — Título breve del cambio

| Campo | Valor |
|--------|--------|
| **Autor** | Nombre |
| **Referencia** | TICKET-123 / PR #N / descripción |

### Cambios

- ...
```
