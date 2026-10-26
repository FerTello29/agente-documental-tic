"""Configuración centralizada; carga .env solo en el servidor.

En localhost los valores vienen de .env. En Vercel se definen como variables de
entorno del proyecto (Settings > Environment Variables) y nunca llegan al navegador.
"""
import os
from dataclasses import dataclass
from dotenv import load_dotenv
load_dotenv()


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_model: str = os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    drive_folder_id: str = os.getenv("GOOGLE_DRIVE_FOLDER_ID", "")
    vector_store_id: str = os.getenv("VECTOR_STORE_ID", "")
    local_admin_key: str = os.getenv("LOCAL_ADMIN_KEY", "")
    # --- Adaptación a Vercel ---
    # Copia de data/manifest.json en formato JSON. Vercel tiene un sistema de archivos
    # efímero y de solo lectura, así que el inventario indexado se publica como variable.
    documents_manifest: str = os.getenv("DOCUMENTS_MANIFEST", "")
    # Si se define, /api/ask exige la cabecera X-Access-Key con este valor.
    app_access_key: str = os.getenv("APP_ACCESS_KEY", "")
    # Límite de preguntas por minuto y por IP (protege el consumo de OPENAI_API_KEY).
    ask_rate_limit: int = _int("ASK_RATE_LIMIT", 12)
    # Vercel define VERCEL=1 en todas sus funciones.
    is_vercel: bool = os.getenv("VERCEL", "") == "1"


settings = Settings()
