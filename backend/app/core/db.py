import os
import psycopg2
from psycopg2.extras import RealDictCursor
from contextlib import contextmanager

DATABASE_URL = os.environ["DATABASE_URL"]

def _get_conn():
    return psycopg2.connect(DATABASE_URL, options="-c statement_timeout=600000")

@contextmanager
def get_db():
    conn = _get_conn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

@contextmanager
def get_cursor(conn):
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        yield cur
