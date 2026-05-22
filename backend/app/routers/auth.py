from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.core.db import get_cursor, get_db
from app.core.security import (
    ROLES,
    create_token,
    current_user,
    ensure_users_table,
    hash_password,
    require_roles,
    verify_password,
)

router = APIRouter()


class LoginPayload(BaseModel):
    username: str
    password: str


class UserPayload(BaseModel):
    username: str
    nombre: str
    password: str
    rol: str
    activo: bool = True


class UserUpdatePayload(BaseModel):
    username: str
    nombre: str
    rol: str
    activo: bool = True
    password: str | None = None


@router.post("/login")
def login(payload: LoginPayload):
    ensure_users_table()
    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id_usuario, username, nombre, password_hash, rol, activo
                FROM usuarios
                WHERE username = %s
                """,
                [payload.username.strip()],
            )
            user = cur.fetchone()

    if not user or not user["activo"] or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Usuario o contrasena incorrectos")

    public_user = {
        "id_usuario": user["id_usuario"],
        "username": user["username"],
        "nombre": user["nombre"],
        "rol": user["rol"],
    }
    return {"token": create_token(public_user), "user": public_user}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return user


@router.get("/usuarios")
def listar_usuarios(_: dict = Depends(require_roles("admin"))):
    ensure_users_table()
    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                SELECT id_usuario, username, nombre, rol, activo, fecha_creacion
                FROM usuarios
                ORDER BY id_usuario
                """
            )
            rows = cur.fetchall()
    return [dict(row) for row in rows]


@router.post("/usuarios")
def crear_usuario(payload: UserPayload, _: dict = Depends(require_roles("admin"))):
    ensure_users_table()
    rol = payload.rol.strip().lower()
    if rol not in ROLES:
        raise HTTPException(status_code=400, detail="Rol invalido")
    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="La contrasena debe tener al menos 6 caracteres")

    try:
        with get_db() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    """
                    INSERT INTO usuarios (username, nombre, password_hash, rol, activo)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id_usuario, username, nombre, rol, activo, fecha_creacion
                    """,
                    [
                        payload.username.strip(),
                        payload.nombre.strip(),
                        hash_password(payload.password),
                        rol,
                        payload.activo,
                    ],
                )
                user = cur.fetchone()
            conn.commit()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="No se pudo crear el usuario. Revisa si ya existe.") from exc

    return dict(user)


@router.put("/usuarios/{id_usuario}")
def actualizar_usuario(id_usuario: int, payload: UserUpdatePayload, user: dict = Depends(require_roles("admin"))):
    ensure_users_table()
    rol = payload.rol.strip().lower()
    if rol not in ROLES:
        raise HTTPException(status_code=400, detail="Rol invalido")
    if id_usuario == user["id_usuario"] and (not payload.activo or rol != "admin"):
        raise HTTPException(status_code=400, detail="No puedes quitarte permisos de administrador o desactivar tu propio usuario")
    if payload.password is not None and payload.password != "" and len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="La contrasena debe tener al menos 6 caracteres")

    fields = ["username = %s", "nombre = %s", "rol = %s", "activo = %s"]
    params = [payload.username.strip(), payload.nombre.strip(), rol, payload.activo]
    if payload.password:
        fields.append("password_hash = %s")
        params.append(hash_password(payload.password))
    params.append(id_usuario)

    try:
        with get_db() as conn:
            with get_cursor(conn) as cur:
                cur.execute(
                    f"""
                    UPDATE usuarios
                    SET {', '.join(fields)}
                    WHERE id_usuario = %s
                    RETURNING id_usuario, username, nombre, rol, activo, fecha_creacion
                    """,
                    params,
                )
                updated = cur.fetchone()
            conn.commit()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="No se pudo actualizar el usuario. Revisa si el usuario ya existe.") from exc

    if not updated:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return dict(updated)


@router.patch("/usuarios/{id_usuario}/estado")
def cambiar_estado(id_usuario: int, activo: bool, user: dict = Depends(require_roles("admin"))):
    if id_usuario == user["id_usuario"] and not activo:
        raise HTTPException(status_code=400, detail="No puedes desactivar tu propio usuario")

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                UPDATE usuarios
                SET activo = %s
                WHERE id_usuario = %s
                RETURNING id_usuario, username, nombre, rol, activo, fecha_creacion
                """,
                [activo, id_usuario],
            )
            updated = cur.fetchone()
        conn.commit()

    if not updated:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return dict(updated)


@router.delete("/usuarios/{id_usuario}")
def eliminar_usuario(id_usuario: int, user: dict = Depends(require_roles("admin"))):
    if id_usuario == user["id_usuario"]:
        raise HTTPException(status_code=400, detail="No puedes eliminar tu propio usuario")

    with get_db() as conn:
        with get_cursor(conn) as cur:
            cur.execute(
                """
                DELETE FROM usuarios
                WHERE id_usuario = %s
                RETURNING id_usuario
                """,
                [id_usuario],
            )
            deleted = cur.fetchone()
        conn.commit()

    if not deleted:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return {"deleted": True, "id_usuario": id_usuario}
