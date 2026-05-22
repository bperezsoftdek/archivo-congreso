from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.security import ensure_users_table
from app.routers import auth, documentos

app = FastAPI(title="Archivo Congreso API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("startup")
def startup():
    ensure_users_table()


app.include_router(auth.router, prefix="/api/auth")
app.include_router(documentos.router, prefix="/api")
