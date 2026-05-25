import yaml
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent.parent / "tables_config.yaml"


def load_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        raw = yaml.safe_load(f)

    column_template = raw.get("column_template", {})
    date_columns = raw.get("date_columns", [])
    tables = {}

    for name, meta in raw.get("tables", {}).items():
        tables[name] = {
            "pk": meta["pk"],
            "label": meta["label"],
            "subfondo_cod": meta.get("subfondo_cod", ""),
            "pk_label": meta.get("pk_label", f"ID ({meta['pk']})"),
            "columns": meta.get("columns", column_template),
            "date_columns": meta.get("date_columns", date_columns),
        }
    return tables


TABLES: dict = load_config()


def get_table_config(table_name: str) -> dict:
    if table_name not in TABLES:
        raise KeyError(f"Tabla '{table_name}' no está en la configuración.")
    return TABLES[table_name]


def get_consulta_meta(cfg: dict) -> dict:
    """Metadatos de consulta/DataTable por tipo documental."""
    pk = cfg["pk"]
    return {
        "search_fields": [
            {
                "key": "codigo_referencia",
                "label": "Código de referencia",
                "type": "text",
                "placeholder": "Buscar por código...",
            },
            {
                "key": pk,
                "label": cfg.get("pk_label", f"ID ({pk})"),
                "type": "number",
                "placeholder": "Ej. 12345",
                "maps_to": "id_registro",
            },
        ],
        "extra_filters": [
            {"key": "titulo_formal", "label": "Título formal", "type": "text"},
            {"key": "titulo_atribuido", "label": "Título atribuido", "type": "text"},
            {"key": "palabras_clave", "label": "Palabras clave", "type": "text"},
            {"key": "fecha_inicial_ano", "label": "Año inicial", "type": "number"},
            {"key": "fecha_final_ano", "label": "Año final", "type": "number"},
        ],
        "hidden_columns": ["id_fondo", "id_subfondo"],
        "column_labels": {
            "nombre_fondo": "Fondo",
            "nombre_subfondo": "Subfondo",
            "cod_fondo": "Cód. fondo",
            "cod_subfondo": "Cód. subfondo",
            "codigo_referencia": "Código de referencia",
            pk: cfg.get("pk_label", pk),
        },
    }
