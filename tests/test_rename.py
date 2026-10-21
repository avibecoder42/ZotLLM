"""Umbenennung ZoteroLLM → ZotLLM (0.8.0): Daten, Schlüssel, Plugin und Dateien der früheren Version gehen weiter."""
import io
import json
import os
import zipfile
from types import SimpleNamespace

import httpx
import pytest
from fastapi.testclient import TestClient

from zotllm import paths, projects_io
from zotllm.keystore import SecretStore
from zotllm.server.app import create_app
from zotllm.zotero import ZoteroClient


def _dirs(base, name):
    root = base / name
    return SimpleNamespace(user_data_dir=str(root / "data"), user_config_dir=str(root / "config"),
                           user_log_dir=str(root / "data" / "Logs"))


def test_legacy_folders_are_adopted(tmp_path):
    old, new = _dirs(tmp_path, "ZoteroLLM"), _dirs(tmp_path, "ZotLLM")
    for d in (old.user_data_dir, old.user_config_dir, old.user_log_dir):
        os.makedirs(d)
    (tmp_path / "ZoteroLLM" / "data" / "index.sqlite3").write_text("index")
    (tmp_path / "ZoteroLLM" / "config" / "settings.json").write_text("{}")
    assert paths._adopt_legacy(new, old)
    assert (tmp_path / "ZotLLM" / "data" / "index.sqlite3").read_text() == "index"
    assert (tmp_path / "ZotLLM" / "config" / "settings.json").is_file()
    assert (tmp_path / "ZotLLM" / "data" / "Logs").is_dir()  # zog mit den Daten um
    assert not (tmp_path / "ZoteroLLM" / "data").exists()


def test_legacy_folders_all_or_nothing(tmp_path, monkeypatch):
    """Lässt sich ein Ordner nicht umbenennen (alte Version läuft noch), bleibt alles beim Alten."""
    old, new = _dirs(tmp_path, "ZoteroLLM"), _dirs(tmp_path, "ZotLLM")
    os.makedirs(old.user_data_dir)
    os.makedirs(old.user_config_dir)
    real_replace = os.replace

    def replace(src, dst):
        if "config" in str(src) and "ZoteroLLM" in str(src):
            raise PermissionError("in Gebrauch")
        return real_replace(src, dst)

    monkeypatch.setattr(paths.os, "replace", replace)
    assert not paths._adopt_legacy(new, old)
    assert os.path.isdir(old.user_data_dir) and os.path.isdir(old.user_config_dir)
    assert not os.path.exists(new.user_data_dir)


def test_legacy_keys_are_moved(memory_keyring):
    memory_keyring.set_password("ZoteroLLM", "gemini", "AIza-alt-0000")
    store = SecretStore()
    assert store.source("gemini") == "keyring"
    assert store.get("gemini") == "AIza-alt-0000"
    assert memory_keyring.get_password("ZotLLM", "gemini") == "AIza-alt-0000"
    assert memory_keyring.get_password("ZoteroLLM", "gemini") is None
    # gelöscht wird unter beiden Namen, sonst käme der Schlüssel zurück
    memory_keyring.set_password("ZoteroLLM", "gemini", "AIza-alt-0000")
    assert store.delete("gemini") is True
    assert store.get("gemini") is None


def test_legacy_header_accepted(engine, monkeypatch):
    monkeypatch.setattr("zotllm.server.app.ollama_available", lambda url: False)
    with TestClient(create_app(engine)) as c:
        body = {"retrieval": {"top_k": 6}}
        assert c.put("/api/settings", json=body).status_code == 403
        assert c.put("/api/settings", json=body, headers={"X-ZoteroLLM": "1"}).status_code == 200
        assert c.put("/api/settings", json=body, headers={"X-ZotLLM": "1"}).status_code == 200


def test_legacy_project_file_imports(engine):
    data = {"format": "zoterollm-project", "version": 1, "project": {"name": "Alt"}, "corpora": [], "chats": [],
            "reviews": [], "sheets": [], "searches": []}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("project.json", json.dumps(data))
    projects_io.import_project(engine, buf.getvalue())
    assert any(p["name"] == "Alt" for p in engine.store.projects())
    data["format"] = "fremd"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("project.json", json.dumps(data))
    with pytest.raises(ValueError):
        projects_io.import_project(engine, buf.getvalue())


@pytest.mark.parametrize("plugin_path", ["/zotllm/uris", "/zoterollm/uris"])
def test_word_uris_from_old_or_new_plugin(plugin_path):
    def handle(request):
        if request.url.path == "/api/":
            return httpx.Response(200, headers={"Zotero-Server-ID": "srv"})
        if request.url.path == plugin_path:
            return httpx.Response(200, json={"uris": {"users/0:K1": "http://zotero.org/users/local/srv/items/K1"}})
        return httpx.Response(404)

    zot = ZoteroClient("http://127.0.0.1:9", keystore=object(), transport=httpx.MockTransport(handle))
    assert zot.item_uris(["users/0:K1"]) == {"users/0:K1": "http://zotero.org/users/local/srv/items/K1"}
