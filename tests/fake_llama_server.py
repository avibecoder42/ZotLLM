"""Ersatz für llama-server in Tests: /health, /v1/embeddings, /tokenize mit deterministischen Vektoren.

Versteht dieselben Argumente wie llama-server (unbekannte werden ignoriert) und prüft den Schlüssel aus
LLAMA_API_KEY. Ein „Token“ ist hier ein Wort; Eingaben mit mehr Wörtern als -ub werden wie bei llama.cpp abgelehnt.
"""

import argparse
import hashlib
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIM = 16


def vec(text: str) -> list[float]:
    out = [0.0] * DIM
    for w in text.lower().split():
        out[int(hashlib.md5(w[:6].encode()).hexdigest(), 16) % DIM] += 1.0
    out[0] += 0.01
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("-m")
    ap.add_argument("--port", type=int)
    ap.add_argument("-ub", type=int, default=512)
    args, _ = ap.parse_known_args()
    key = os.environ.get("LLAMA_API_KEY", "")
    requests = {"n": 0}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/health":
                self._send(200, {"status": "ok"})
            else:
                self._send(404, {})

        def do_POST(self):
            if self.headers.get("Authorization") != f"Bearer {key}":
                self._send(401, {"error": {"message": "Invalid API Key"}})
                return
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            requests["n"] += 1
            crash_after = int(os.environ.get("FAKE_LLAMA_CRASH_AFTER") or 0)
            if crash_after and requests["n"] > crash_after:
                os._exit(3)
            if self.path == "/tokenize":
                self._send(200, {"tokens": list(range(len(body.get("content", "").split())))})
                return
            if self.path == "/v1/embeddings":
                texts = body["input"] if isinstance(body["input"], list) else [body["input"]]
                for t in texts:
                    n = len(t.split())
                    if n > args.ub:
                        self._send(500, {"error": {"code": 500, "message": f"input ({n} tokens) is too large to "
                                                   "process. increase the physical batch size"}})
                        return
                self._send(200, {"data": [{"index": i, "embedding": vec(t)} for i, t in enumerate(texts)],
                                 "usage": {"prompt_tokens": sum(len(t.split()) for t in texts)}})
                return
            self._send(404, {})

    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()


if __name__ == "__main__":
    sys.exit(main())
