"""Verschlüsselte Ablage der API-Schlüssel im Schlüsselspeicher des Betriebssystems.

- Windows: Anmeldeinformationsverwaltung (mit DPAPI an das Benutzerkonto gebunden)
- macOS:   Schlüsselbund (Keychain)
- Linux:   Secret Service (GNOME Keyring / KWallet)

Schlüssel werden nie in Einstellungsdateien oder Logs geschrieben und von der
Web-Oberfläche nie zurückgegeben (nur maskiert, z. B. "••••a1b2").
Für Server ohne Schlüsselspeicher können Umgebungsvariablen genutzt werden.
"""

from __future__ import annotations

import os
import threading

import keyring
import keyring.errors
from keyring.backend import KeyringBackend

from zotllm import APP_NAME, LEGACY_NAME

SERVICE = APP_NAME
# Schlüssel des früheren Namens (bis 0.7.3) werden beim ersten Lesen übernommen
LEGACY_SERVICE = LEGACY_NAME

# Nur lesend genutzte Alternativen (z. B. für Linux-Server ohne Schlüsselspeicher)
ENV_VARS: dict[str, tuple[str, ...]] = {
    "openai": ("ZOTLLM_OPENAI_API_KEY", "ZOTEROLLM_OPENAI_API_KEY", "OPENAI_API_KEY"),
    "anthropic": ("ZOTLLM_ANTHROPIC_API_KEY", "ZOTEROLLM_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY"),
    "gemini": ("ZOTLLM_GEMINI_API_KEY", "ZOTEROLLM_GEMINI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "deepseek": ("ZOTLLM_DEEPSEEK_API_KEY", "ZOTEROLLM_DEEPSEEK_API_KEY", "DEEPSEEK_API_KEY"),
    "openai_compatible": ("ZOTLLM_OPENAI_COMPATIBLE_API_KEY", "ZOTEROLLM_OPENAI_COMPATIBLE_API_KEY"),
}

_INSECURE_BACKENDS = ("PlaintextKeyring", "fail.Keyring", "null.Keyring", "EncryptedKeyring")


class SecretStoreError(RuntimeError):
    pass


def _backend_name(backend: KeyringBackend) -> str:
    cls = type(backend)
    return f"{cls.__module__}.{cls.__name__}"


class SecretStore:
    def __init__(self, service: str = SERVICE, legacy: str | None = LEGACY_SERVICE):
        self.service = service
        self.legacy = legacy if legacy != service else None
        self._lock = threading.Lock()

    def _stored(self, name: str) -> str | None:
        """Wert im Schlüsselspeicher; ein Schlüssel des früheren Namens wird dabei übernommen (und dort gelöscht)."""
        try:
            value = keyring.get_password(self.service, name)
            if value or not self.legacy:
                return value
            value = keyring.get_password(self.legacy, name)
        except keyring.errors.KeyringError:
            return None
        if value:
            try:
                keyring.set_password(self.service, name, value)
                if keyring.get_password(self.service, name) == value:
                    keyring.delete_password(self.legacy, name)
            except keyring.errors.KeyringError:
                pass  # bleibt unter dem früheren Namen und wird beim nächsten Mal erneut übernommen
        return value

    # -- Backend ---------------------------------------------------------------
    def backend_info(self) -> dict:
        backend = keyring.get_keyring()
        name = _backend_name(backend)
        secure = not any(bad in name for bad in _INSECURE_BACKENDS)
        return {"backend": name, "secure": secure}

    def _require_secure(self) -> None:
        info = self.backend_info()
        if not info["secure"]:
            raise SecretStoreError(
                "Kein sicherer Schlüsselspeicher verfügbar "
                f"({info['backend']}). Unter Linux z. B. gnome-keyring installieren "
                "oder den Schlüssel als Umgebungsvariable setzen."
            )

    # -- API -------------------------------------------------------------------
    def set(self, name: str, secret: str) -> None:
        secret = (secret or "").strip()
        if not secret:
            raise SecretStoreError("Leerer Schlüssel.")
        self._require_secure()
        with self._lock:
            try:
                keyring.set_password(self.service, name, secret)
            except keyring.errors.KeyringError as e:
                raise SecretStoreError(f"Speichern fehlgeschlagen: {e}") from e

    def get(self, name: str) -> str | None:
        with self._lock:
            value = self._stored(name)
        if value:
            return value
        for var in ENV_VARS.get(name, ()):
            if os.environ.get(var):
                return os.environ[var]
        return None

    def delete(self, name: str) -> bool:
        with self._lock:
            deleted = False
            for service in (self.service, self.legacy):  # auch unter dem früheren Namen, sonst käme er zurück
                if not service:
                    continue
                try:
                    keyring.delete_password(service, name)
                    deleted = True
                except keyring.errors.PasswordDeleteError:
                    pass
                except keyring.errors.KeyringError as e:
                    raise SecretStoreError(f"Löschen fehlgeschlagen: {e}") from e
            return deleted

    def source(self, name: str) -> str | None:
        """'keyring', 'env' oder None – ohne den Wert preiszugeben."""
        with self._lock:
            if self._stored(name):
                return "keyring"
        for var in ENV_VARS.get(name, ()):
            if os.environ.get(var):
                return "env"
        return None

    def masked(self, name: str) -> str | None:
        value = self.get(name)
        if not value:
            return None
        return "••••" + value[-4:] if len(value) > 8 else "••••"


_store: SecretStore | None = None


def get_store() -> SecretStore:
    global _store
    if _store is None:
        _store = SecretStore()
    return _store
