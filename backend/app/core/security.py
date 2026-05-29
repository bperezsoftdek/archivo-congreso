import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from typing import Iterable

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.db import get_cursor, get_db

TOKEN_SECRET = os.environ.get("TOKEN_SECRET", "archivo-congreso-local-secret")
TOKEN_TTL_SECONDS = 12 * 60 * 60
ROLES = {"admin", "operador", "consulta", "registro"}

bearer = HTTPBearer(auto_error=False)


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def _unb64url(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000)
    return f"pbkdf2_sha256${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$", 2)
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


def create_token(user: dict) -> str:
    payload = {
        "sub": user["id_usuario"],
        "username": user["username"],
        "nombre": user["nombre"],
        "rol": user["rol"],
        "exp": int(time.time()) + TOKEN_TTL_SECONDS,
    }
    body = _b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signature = hmac.new(TOKEN_SECRET.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url(signature)}"


def decode_token(token: str) -> dict:
    try:
        body, signature = token.split(".", 1)
        expected = hmac.new(TOKEN_SECRET.encode("utf-8"), body.encode("ascii"), hashlib.sha256).digest()
        if not hmac.compare_digest(_unb64url(signature), expected):
            raise ValueError
        payload = json.loads(_unb64url(body))
        if payload["exp"] < int(time.time()):
            raise ValueError
        return payload
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Sesion invalida o vencida") from exc


def ensure_users_table():
    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS usuarios (
                    id_usuario SERIAL PRIMARY KEY,
                    username TEXT UNIQUE NOT NULL,
                    nombre TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    rol TEXT NOT NULL CHECK (rol IN ('admin', 'operador', 'consulta', 'registro')),
                    activo BOOLEAN NOT NULL DEFAULT TRUE,
                    fecha_creacion TIMESTAMPTZ DEFAULT NOW()
                )
            """)
            cur.execute("ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check")
            cur.execute("ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check CHECK (rol IN ('admin', 'operador', 'consulta', 'registro'))")
            cur.execute("SELECT COUNT(*) AS total FROM usuarios")
            if cur.fetchone()["total"] == 0:
                cur.execute(
                    """
                    INSERT INTO usuarios (username, nombre, password_hash, rol)
                    VALUES (%s, %s, %s, %s)
                    """,
                    ["admin", "Administrador", hash_password("admin123"), "admin"],
                )
        conn.commit()


def current_user(credentials: HTTPAuthorizationCredentials = Depends(bearer)) -> dict:
    if not credentials:
        raise HTTPException(status_code=401, detail="Debes iniciar sesion")
    payload = decode_token(credentials.credentials)
    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id_usuario, username, nombre, rol, activo
                FROM usuarios
                WHERE id_usuario = %s
                """,
                [payload["sub"]],
            )
            user = cur.fetchone()
    if not user or not user["activo"]:
        raise HTTPException(status_code=401, detail="Usuario inactivo o no encontrado")
    return dict(user)


def require_roles(*roles: Iterable[str]):
    allowed = set(roles)

    def dependency(user: dict = Depends(current_user)) -> dict:
        if user["rol"] not in allowed:
            raise HTTPException(status_code=403, detail="No tienes permiso para esta accion")
        return user

    return dependency
