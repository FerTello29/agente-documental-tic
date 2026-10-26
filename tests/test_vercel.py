"""Pruebas de la adaptación a Vercel. No usan claves reales ni consumen OpenAI."""
import json
from dataclasses import replace
import pytest
from fastapi.testclient import TestClient
from app import main
from app.core import config
from app.services import sync_service
from app.services.sync_service import SyncService

client = TestClient(main.app)

MANIFEST = {"vector_store_id": "vs_demo", "documents": {
    "drive1": {"name": "Practica 4 - Amazon RDS MySQL.pdf", "modified_time": "2026-10-01T00:00:00Z",
               "mime_type": "application/pdf", "openai_file_id": "file_1",
               "url": "https://drive.google.com/file/d/drive1/view"}}}


@pytest.fixture
def settings(monkeypatch, tmp_path):
    """Permite cambiar la configuración en cada prueba sin tocar .env ni data/."""
    monkeypatch.setattr(sync_service, "MANIFEST", tmp_path / "manifest.json")
    main.limiter.reset()

    def apply(**changes):
        monkeypatch.setattr(config, "settings", replace(config.settings, **changes))
    apply()
    return apply


def test_manifest_from_env(settings):
    settings(documents_manifest=json.dumps(MANIFEST))
    r = client.get("/api/documents")
    assert r.status_code == 200
    assert r.json()["indexed"] == 1
    assert r.json()["vector_store_configured"] is True


def test_invalid_manifest_env_is_ignored(settings):
    settings(documents_manifest="{no es json")
    assert SyncService.load_manifest() == {"vector_store_id": "", "documents": {}}


def test_health_reports_environment(settings):
    settings(is_vercel=True, openai_api_key="sk-test", documents_manifest=json.dumps(MANIFEST))
    data = client.get("/api/health").json()
    assert data["environment"] == "vercel"
    assert data["sync_enabled"] is False
    assert data["configured"] is True
    assert "sk-test" not in json.dumps(data)  # la clave nunca se expone


def test_sync_blocked_on_vercel(settings):
    settings(is_vercel=True)
    r = client.post("/api/sync")
    assert r.status_code == 403
    assert "localhost" in r.json()["detail"]


def test_ask_requires_access_key(settings):
    settings(app_access_key="clave-demo")
    r = client.post("/api/ask", json={"question": "¿Qué es RDS?", "use_search": False})
    assert r.status_code == 401


def test_ask_rate_limit(settings):
    settings(ask_rate_limit=2, openai_api_key="")
    codes = [client.post("/api/ask", json={"question": "¿Qué es RDS?"}).status_code for _ in range(3)]
    assert codes == [400, 400, 429]  # 400: falta clave (no llama a OpenAI); 429: límite alcanzado


class _Obj:
    def __init__(self, **kw): self.__dict__.update(kw)


class FakeOpenAI:
    """Simula vector_stores y files sin llamar a la API real."""
    def __init__(self):
        self.uploaded, self.detached, self.deleted = [], [], []
        outer = self

        class Files:
            def upload_and_poll(self, vector_store_id, file):
                outer.uploaded.append(file)
                return _Obj(id=f"file_{len(outer.uploaded)}", status="completed")
            def delete(self, vector_store_id, file_id):
                outer.detached.append(file_id)

        class Stores:
            files = Files()
            def create(self, name): return _Obj(id="vs_test")

        class RawFiles:
            def delete(self, file_id): outer.deleted.append(file_id)

        self.vector_stores = Stores()
        self.files = RawFiles()


class FakeDrive:
    def __init__(self, items): self.items = items
    def list_files(self, folder_id): return self.items
    def get_bytes(self, item):
        if item["mimeType"] == "application/vnd.google-apps.document":
            return b"texto", item["name"] + ".txt", "text/plain"
        return b"%PDF", item["name"], item["mimeType"]


def test_sync_uses_real_names_and_cleans_old_files(settings):
    settings(drive_folder_id="folder", vector_store_id="")
    doc = {"id": "d1", "name": "Guía de seguridad", "mimeType": "application/vnd.google-apps.document", "modifiedTime": "1"}
    pdf = {"id": "d2", "name": "Practica 5 - VPC Peering.pdf", "mimeType": "application/pdf", "modifiedTime": "1"}
    client = FakeOpenAI()
    r = SyncService(client=client, drive=FakeDrive([doc, pdf])).sync()
    assert r["stats"]["added"] == 2
    assert [f[0] for f in client.uploaded] == ["Guía de seguridad.txt", "Practica 5 - VPC Peering.pdf"]

    doc2 = {**doc, "modifiedTime": "2"}
    r = SyncService(client=client, drive=FakeDrive([doc2])).sync()
    assert (r["stats"]["updated"], r["stats"]["removed"]) == (1, 1)
    assert set(client.deleted) == {"file_1", "file_2"}  # versión vieja y archivo eliminado
