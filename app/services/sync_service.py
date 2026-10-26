"""Sincronización unidireccional: Drive -> OpenAI Vector Store.
Nota: eliminar archivos de un vector store puede tener consistencia eventual.
"""
import json
import os
import threading
from pathlib import Path
from openai import OpenAI
from app.core import config
from app.services.drive_service import DriveService

MANIFEST = Path(__file__).resolve().parents[2] / "data" / "manifest.json"
_LOCK = threading.Lock()
SUPPORTED = {"application/pdf", "text/plain", "application/vnd.google-apps.document"}

class SyncService:
    def __init__(self, client=None, drive=None):
        self.client = client or OpenAI(api_key=config.settings.openai_api_key)
        self.drive = drive or DriveService()

    @staticmethod
    def load_manifest() -> dict:
        """Lee data/manifest.json (local). Si no existe, usa DOCUMENTS_MANIFEST (Vercel)."""
        if MANIFEST.exists():
            return json.loads(MANIFEST.read_text(encoding="utf-8"))
        raw = config.settings.documents_manifest
        if raw:
            try:
                data = json.loads(raw)
                if isinstance(data, dict) and isinstance(data.get("documents", {}), dict):
                    data.setdefault("vector_store_id", "")
                    data.setdefault("documents", {})
                    return data
            except json.JSONDecodeError:
                pass
        return {"vector_store_id": "", "documents": {}}

    @staticmethod
    def save_manifest(data: dict):
        MANIFEST.parent.mkdir(parents=True, exist_ok=True)
        tmp = MANIFEST.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(tmp, MANIFEST)

    def get_store(self, manifest):
        vector_id = config.settings.vector_store_id or manifest.get("vector_store_id")
        if not vector_id:
            vector_id = self.client.vector_stores.create(name="Archivo TIC IA - Documentos").id
        manifest["vector_store_id"] = vector_id
        return vector_id

    @staticmethod
    def upload_name(filename: str) -> str:
        """Nombre válido para OpenAI: conserva el título y garantiza extensión .pdf o .txt."""
        name = "".join(c for c in filename if c not in '\/:*?"<>|').strip() or "documento"
        return name if name.lower().endswith((".pdf", ".txt")) else name + ".txt"

    def discard(self, store: str, file_id: str):
        """Quita el archivo del Vector Store y también lo borra del almacenamiento de OpenAI,
        para no acumular archivos huérfanos que generan costo."""
        self.client.vector_stores.files.delete(vector_store_id=store, file_id=file_id)
        try:
            self.client.files.delete(file_id)
        except Exception:
            pass  # ya eliminado o sin permisos: el índice ya no lo usa

    def sync(self):
        if not _LOCK.acquire(blocking=False):
            raise RuntimeError("Ya existe una sincronización en curso")
        try:
            manifest = self.load_manifest()
            docs = manifest.setdefault("documents", {})
            store = self.get_store(manifest)
            self.save_manifest(manifest)
            source = self.drive.list_files(config.settings.drive_folder_id)
            eligible = {x["id"]: x for x in source if x["mimeType"] in SUPPORTED}
            stats = {"added": 0, "updated": 0, "removed": 0, "unchanged": 0, "errors": []}
            for drive_id, item in eligible.items():
                previous = docs.get(drive_id)
                if previous and previous.get("modified_time") == item.get("modifiedTime"):
                    stats["unchanged"] += 1
                    continue
                try:
                    raw, filename, target_mime = self.drive.get_bytes(item)
                    if not raw: raise ValueError("El archivo está vacío")
                    # Se sube con el nombre real del documento (no un nombre temporal) para que
                    # el modelo y las citas se refieran al archivo que el usuario reconoce.
                    upload = self.client.vector_stores.files.upload_and_poll(
                        vector_store_id=store, file=(self.upload_name(filename), raw, target_mime))
                    if upload.status != "completed": raise RuntimeError("Indexación no completada: " + upload.status)
                    # Solo se elimina la versión antigua después de indexar exitosamente la nueva.
                    if previous:
                        self.discard(store, previous["openai_file_id"])
                    docs[drive_id] = {
                        "name": item["name"], "modified_time": item.get("modifiedTime"),
                        "mime_type": item["mimeType"], "openai_file_id": upload.id,
                        "url": item.get("webViewLink") or (
                            "https://docs.google.com/document/d/" + drive_id + "/edit" if item["mimeType"] == "application/vnd.google-apps.document" else "https://drive.google.com/file/d/" + drive_id + "/view")
                    }
                    self.save_manifest(manifest)
                    stats["updated" if previous else "added"] += 1
                except Exception as exc:
                    stats["errors"].append({"file": item["name"], "error": str(exc)})
            for drive_id in set(docs) - set(eligible):
                try:
                    self.discard(store, docs[drive_id]["openai_file_id"])
                    del docs[drive_id]
                    self.save_manifest(manifest)
                    stats["removed"] += 1
                except Exception as exc:
                    stats["errors"].append({"file": drive_id, "error": str(exc)})
            return {"vector_store_id": store, "stats": stats, "documents": list(docs.values())}
        finally:
            _LOCK.release()
