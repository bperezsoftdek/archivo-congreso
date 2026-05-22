import yaml
from pathlib import Path

_CONFIG_PATH = Path(__file__).parent.parent.parent / "tables_config.yaml"

def load_config() -> dict:
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f)["tables"]

# Cargado una sola vez al iniciar
TABLES: dict = load_config()

def get_table_config(table_name: str) -> dict:
    if table_name not in TABLES:
        raise KeyError(f"Tabla '{table_name}' no está en la configuración.")
    return TABLES[table_name]
