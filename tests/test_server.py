import io
import json
import re
import time
import zipfile
from pathlib import Path

import pytest
from fakes import ScriptedModel
from fastapi.testclient import TestClient
from test_indexing_search import build_library, run_index

import zotllm
from zotllm.rag import chat as chat_mod
from zotllm.server.app import create_app

H = {"X-ZotLLM": "1"}


@pytest.fixture
def client(zengine, fake_zotero, monkeypatch):
    build_library(fake_zotero)
    run_index(zengine)
    monkeypatch.setattr("zotllm.server.app.ollama_available", lambda url: False)
    app = create_app(zengine)
    with TestClient(app) as c:
        yield c


def test_csrf_and_host_protection(client):
    assert client.put("/api/settings", json={"retrieval": {"top_k": 5}}).status_code == 403
    assert client.get("/api/status", headers={"Host": "evil.example"}).status_code == 403
    r = client.put("/api/settings", json={"retrieval": {"top_k": 5}}, headers=H)
    assert r.status_code == 200 and r.json()["retrieval"]["top_k"] == 5


def test_static_files_are_revalidated(client):
    """Ohne no-cache verwendet der Browser nach einem Update veraltete Module – die Oberfläche startet dann nicht."""
    r = client.get("/static/js/core/util.js")
    assert r.headers["cache-control"] == "no-cache" and r.headers.get("etag")
    assert client.get("/static/js/core/util.js", headers={"If-None-Match": r.headers["etag"]}).status_code == 304
    page = client.get("/")
    assert page.headers["cache-control"] == "no-cache"
    # Module unter einem Pfad je Version: nach einem Update stammt nichts aus dem Zwischenspeicher der alten Version
    from zotllm import __version__

    assert f'src="/static/v{__version__}/js/main.js"' in page.text and '"/static/js/' not in page.text
    r = client.get(f"/static/v{__version__}/js/main.js")
    assert r.status_code == 200 and "boot()" in r.text and r.headers["cache-control"] == "no-cache"


def test_status_and_ui(client):
    st = client.get("/api/status").json()
    assert st["zotero"]["running"] and st["index"]["items"] == 2
    assert st["keystore"]["secure"]
    page = client.get("/").text
    assert "ZotLLM" in page
    for asset in re.findall(r'(?:src|href)="(/static/[^"]+)"', page):
        assert client.get(asset).status_code == 200, asset


def test_llm_choice_healed_on_start(zengine):
    """Früher gespeicherter Gemini-Schlüssel, eingestellt ist noch Anthropic ohne Schlüssel → beim Start umstellen."""
    from zotllm.keystore import get_store

    get_store().set("gemini", "test-gemini-key-1234")
    zengine.settings_store.update({"llm": {"provider": "anthropic", "helper_provider": "anthropic"}})
    create_app(zengine)
    llm = zengine.settings.llm
    assert (llm.provider, llm.model) == ("gemini", "gemini-pro-latest")
    assert (llm.helper_provider, llm.helper_model) == ("gemini", "gemini-flash-latest")


def test_update_check_and_defaults(client, tmp_path):
    manifest = tmp_path / "zotllm-update.json"
    manifest.write_text(json.dumps({"version": "99.0.0", "url": "ZotLLM-Setup-99.0.0.exe", "sha256": "ab"}))
    r = client.post("/api/update/check", json={"url": str(manifest)}, headers=H).json()
    assert r["available"] and r["latest"] == "99.0.0"
    assert Path(r["installer"]) == tmp_path / "ZotLLM-Setup-99.0.0.exe"
    # Ohne Quelle: nicht eingerichtet; unverschlüsseltes HTTP wird abgelehnt
    assert client.post("/api/update/check", json={}, headers=H).json()["configured"] is False
    assert client.post("/api/update/check", json={"url": "http://example.org/u.json"}, headers=H).status_code == 400
    assert client.get("/api/settings/defaults").json()["retrieval"]["top_k"] == 15


def test_frontend_imports_resolve():
    """Ohne Build-Schritt: jeder Import muss auf eine vorhandene Datei und einen exportierten Namen zeigen."""
    root = Path(zotllm.__file__).parent / "server" / "static" / "js"
    exports: dict[Path, set[str]] = {}

    def exported(path: Path) -> set[str]:
        if path not in exports:
            text = path.read_text(encoding="utf-8")
            names = set(re.findall(r"export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)", text))
            for group in re.findall(r"export\s*\{([^}]*)\}", text):
                names.update(p.split(" as ")[-1].strip() for p in group.split(",") if p.strip())
            exports[path] = names
        return exports[path]

    files = list(root.rglob("*.js"))
    assert len(files) > 10
    for f in files:
        text = f.read_text(encoding="utf-8")
        for names, target in re.findall(r"import\s*\{([^}]*)\}\s*from\s*'([^']+)'", text):
            dep = (f.parent / target).resolve()
            assert dep.is_file(), f"{f.name}: {target} fehlt"
            for n in (x.split(" as ")[0].strip() for x in names.split(",") if x.strip()):
                assert n in exported(dep), f"{f.name}: {n} wird von {target} nicht exportiert"
        for target in re.findall(r"import\s+\*\s+as\s+\w+\s+from\s+'([^']+)'", text):
            assert (f.parent / target).resolve().is_file(), f"{f.name}: {target} fehlt"


def test_invalid_settings_rejected(client):
    r = client.put("/api/settings", json={"retrieval": {"hybrid_weight": 7}}, headers=H)
    assert r.status_code == 422


def test_keys_never_returned(client):
    r = client.put("/api/keys/anthropic", json={"key": "sk-ant-geheim-0000ABCD"}, headers=H)
    assert r.json() == {"stored": True, "masked": "••••ABCD", "switched": None}
    listing = client.get("/api/keys").text
    assert "geheim" not in listing and "••••ABCD" in listing
    assert client.delete("/api/keys/anthropic", headers=H).json()["deleted"] is True


def test_search_and_chat_stream(client, monkeypatch):
    model = ScriptedModel([("Textstellen aus der Bibliothek", "Antwort mit Beleg [1].")], default='{"queries": []}')
    monkeypatch.setattr(chat_mod, "helper_model", lambda cfg, meter=None: model)
    monkeypatch.setattr(chat_mod, "main_model", lambda cfg, meter=None: model)
    client.put("/api/keys/anthropic", json={"key": "sk-ant-test-0000"}, headers=H)
    r = client.post("/api/search", json={"query": "Chatbots Jugendliche"}, headers=H)
    assert r.json()["sources"][0]["item_key"] == "ITEMA001"
    with client.stream("POST", "/api/chat", json={"question": "Wie nutzen Jugendliche Chatbots?"}, headers=H) as r:
        events = [json.loads(line[6:]) for line in r.iter_lines() if line.startswith("data: ")]
    assert events[-1]["type"] == "done"
    assert "".join(e["text"] for e in events if e["type"] == "delta") == "Antwort mit Beleg [1]."
    assert client.get("/api/chats").json()["chats"][0]["title"].startswith("Wie nutzen")


def wait_job(client, job_id):
    for _ in range(200):
        state = client.get(f"/api/jobs/{job_id}").json()
        if state["status"] not in ("queued", "running"):
            return state
        time.sleep(0.05)
    raise AssertionError("Auftrag läuft zu lange")


def test_zotero_tree(client):
    tree = client.get("/api/zotero/tree").json()
    assert tree["online"] is True
    lib = tree["libraries"][0]
    assert lib["name"] == "Meine Bibliothek" and lib["id"] == "users/0:*"
    top = {c["name"]: c for c in lib["collections"]}
    assert set(top) == {"KI und Jugend", "Soziale Arbeit"}
    assert [c["name"] for c in top["KI und Jugend"]["children"]] == ["Unterordner"]


def test_corpus_crud_and_index(client):
    r = client.post("/api/corpora", json={"name": "Jugend", "sources": ["users/0:COLA0001"]}, headers=H)
    assert r.status_code == 200
    c = r.json()
    assert c["sources_info"][0]["label"] == "KI und Jugend"
    assert c["stats"]["documents"] == 1  # Eintrag liegt in der Untersammlung
    assert client.post("/api/corpora", json={"name": "jugend"}, headers=H).status_code == 409
    assert client.post("/api/corpora", json={"name": " "}, headers=H).status_code == 400
    r = client.put(f"/api/corpora/{c['id']}", json={"name": "Jugend & KI", "sources": ["users/0:*"]}, headers=H)
    assert r.json()["name"] == "Jugend & KI" and r.json()["stats"]["documents"] == 2
    state = wait_job(client, client.post(f"/api/corpora/{c['id']}/index", headers=H).json()["id"])
    assert state["status"] == "done" and state["counters"]["docs_total"] == 0  # bereits aktuell
    # Fragen nur im Korpus
    r = client.post("/api/search", json={"query": "Chatbots", "filters": {"corpus_id": c["id"]}}, headers=H)
    assert r.json()["sources"]
    assert client.delete(f"/api/corpora/{c['id']}", headers=H).json() == {"deleted": c["id"]}


def test_plugin_index_creates_corpus(client):
    job = client.post("/api/plugin/index", json={"lib": "users/0", "collections": ["COLB0002"]}, headers=H).json()
    assert job["kind"] == "index"
    assert wait_job(client, job["id"])["status"] == "done"
    names = [c["name"] for c in client.get("/api/corpora").json()["corpora"]]
    assert "Soziale Arbeit" in names
    # Nochmals: kein zweiter Korpus für dieselbe Sammlung
    wait_job(client, client.post("/api/plugin/index", json={"lib": "users/0", "collections": ["COLB0002"]},
                                 headers=H).json()["id"])
    assert [c["name"] for c in client.get("/api/corpora").json()["corpora"]].count("Soziale Arbeit") == 1


def test_setup_and_provider_switch(client):
    steps = {s["id"]: s for s in client.get("/api/setup").json()["steps"]}
    assert steps["zotero"]["done"] and steps["corpus"]["done"] and steps["index"]["done"]
    assert not steps["llm"]["done"] and "Anthropic" in steps["llm"]["detail"]
    r = client.put("/api/keys/gemini", json={"key": "AIza-test-1234"}, headers=H).json()
    assert r["switched"] == {"provider": "Google Gemini", "model": "gemini-pro-latest",
                             "helper_model": "gemini-flash-latest"}
    llm = client.get("/api/settings").json()["llm"]
    assert (llm["provider"], llm["helper_provider"]) == ("gemini", "gemini")
    # Weiterer Schlüssel ändert die funktionierende Auswahl nicht
    assert client.put("/api/keys/openai", json={"key": "sk-test-5678"}, headers=H).json()["switched"] is None
    assert client.get("/api/setup").json()["steps"][1]["done"]


def test_provider_models_without_key_use_catalog(client):
    r = client.get("/api/providers/gemini/models").json()
    assert r["loaded"] is False and r["models"][0] == "gemini-pro-latest" and r["default_main"] == "gemini-pro-latest"


def test_plugin_package(client):
    r = client.get("/plugin/zotllm.xpi")
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(z.namelist())
    assert {"manifest.json", "bootstrap.js", "prefs.js", "content/zotllm.js", "locale/de-DE/zotllm.ftl"} <= names
    manifest = json.loads(z.read("manifest.json"))
    assert manifest["applications"]["zotero"]["id"] == "zotllm@zotllm.local"
    assert manifest["applications"]["zotero"]["update_url"].startswith("https:")
    assert "content/icon.svg" in names
