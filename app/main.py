"""Archivo TIC IA — API FastAPI.

En localhost: sincroniza Drive (OAuth de escritorio) e indexa en OpenAI Vector Stores.
En Vercel: modo de consulta. La sincronización queda deshabilitada, /api/ask se protege
con límite de frecuencia y clave de acceso opcional, y OPENAI_API_KEY vive solo en el servidor.
"""
import threading
import time
from collections import defaultdict, deque
from pathlib import Path
from ipaddress import ip_address
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from app.core import config
from app.models.documento import AskRequest, AskResponse
from app.services.sync_service import SyncService
from app.services.agent_service import AgentService

ROOT = Path(__file__).resolve().parents[1]
app = FastAPI(title="Archivo TIC IA", version="2.0.0")

# En Vercel los estáticos los sirve la CDN; en local los sirve FastAPI.
if (ROOT / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=ROOT / "assets"), name="assets")


def current_settings():
    return config.settings


def local_only(request: Request):
    """Defensa básica para el laboratorio; no equivale a autenticación pública."""
    settings = current_settings()
    if settings.is_vercel:
        raise HTTPException(status_code=403, detail="La sincronización solo se ejecuta en localhost; en Vercel el índice es de solo lectura")
    host = request.client.host if request.client else ""
    try:
        if not ip_address(host).is_loopback: raise ValueError()
    except ValueError:
        raise HTTPException(status_code=403, detail="Sincronización disponible solo desde localhost")
    key = settings.local_admin_key
    if key and request.headers.get("X-Admin-Key") != key:
        raise HTTPException(status_code=401, detail="Clave administrativa incorrecta")


class RateLimiter:
    """Ventana deslizante de 60 s por IP. En serverless cada instancia lleva su propio
    conteo, así que es una barrera contra abuso casual, no un control de cuota global."""

    def __init__(self):
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window: float = 60.0) -> bool:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > window:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(now)
            return True

    def reset(self):
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()


def client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "desconocido"


def protect_ask(request: Request):
    settings = current_settings()
    if settings.app_access_key and request.headers.get("X-Access-Key") != settings.app_access_key:
        raise HTTPException(status_code=401, detail="Código de acceso incorrecto")
    if settings.ask_rate_limit > 0 and not limiter.check(client_ip(request), settings.ask_rate_limit):
        raise HTTPException(status_code=429, detail="Demasiadas consultas. Espera un minuto e inténtalo de nuevo.")


@app.get("/")
def index():
    return FileResponse(ROOT / "index.html")


@app.get("/api/health")
def health():
    settings = current_settings()
    manifest = SyncService.load_manifest()
    vector_store = bool(settings.vector_store_id or manifest.get("vector_store_id"))
    return {
        "status": "ok",
        "configured": bool(settings.openai_api_key and (settings.drive_folder_id or vector_store)),
        "openai": bool(settings.openai_api_key),
        "drive_folder": bool(settings.drive_folder_id),
        "vector_store": vector_store,
        "model": settings.openai_model,
        "environment": "vercel" if settings.is_vercel else "local",
        "sync_enabled": not settings.is_vercel,
        "access_key_required": bool(settings.app_access_key),
    }


@app.get("/api/documents")
def documents():
    settings = current_settings()
    doc = SyncService.load_manifest()
    return {"documents": list(doc.get("documents", {}).values()),
            "indexed": len(doc.get("documents", {})),
            "vector_store_configured": bool(settings.vector_store_id or doc.get("vector_store_id"))}


@app.post("/api/ask", response_model=AskResponse, dependencies=[Depends(protect_ask)])
def ask(payload: AskRequest):
    try:
        if not current_settings().openai_api_key: raise ValueError("Falta OPENAI_API_KEY")
        return AgentService().ask(payload.question, payload.use_search)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        raise HTTPException(status_code=502, detail="Error al consultar OpenAI. Revisa el registro del servidor.")


@app.post("/api/sync", dependencies=[Depends(local_only)])
def sync():
    try:
        if not current_settings().openai_api_key: raise ValueError("Falta OPENAI_API_KEY")
        return SyncService().sync()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Sincronización fallida: {exc}")
