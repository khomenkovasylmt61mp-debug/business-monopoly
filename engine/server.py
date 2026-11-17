# -*- coding: utf-8 -*-
"""Сервер Монополии: стандартная библиотека Python, без зависимостей."""
import argparse
import json
import os
import secrets
import socket
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from engine.game import Room, RulesError
from engine.data import BOARD, GROUPS, PLAYER_COLORS, GROUP_TILES, SCALES, THEMES, PIECES

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")

ROOMS = {}
ROOMS_LOCK = threading.Lock()
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

MAX_ROOMS = 20000
MAX_BODY = 2_000_000
RATE = {}
RATE_LOCK = threading.Lock()


def allow(ip, kind, limit, window=60.0):
    """Simple per-IP token bucket (sliding window)."""
    now = time.time()
    key = (ip, kind)
    with RATE_LOCK:
        hits = [t for t in RATE.get(key, ()) if now - t < window]
        if len(hits) >= limit:
            RATE[key] = hits
            return False
        hits.append(now)
        RATE[key] = hits
        if len(RATE) > 5000:
            for k in [k for k, v in RATE.items() if not v or now - v[-1] > 120]:
                RATE.pop(k, None)
    return True


class BodyError(Exception):
    def __init__(self, msg, code=400):
        super().__init__(msg)
        self.code = code


MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
    ".woff2": "font/woff2",
    ".mp3": "audio/mpeg",
}


def new_code():
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(5))
        if code not in ROOMS:
            return code


def cleanup_loop():
    while True:
        time.sleep(300)
        now = time.time()
        with ROOMS_LOCK:
            for code, room in list(ROOMS.items()):
                st = room.state
                if not st["players"]:
                    del ROOMS[code]
                    continue
                last = max([st["updated"]] + [p["lastSeen"] for p in st["players"]])
                if now - last > 6 * 3600:
                    del ROOMS[code]
                    continue
                # abandoned lobbies die much sooner
                if st["phase"] == "lobby" and len(st["players"]) <= 1 and now - last > 15 * 60:
                    del ROOMS[code]


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, ConnectionError):
            return
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "MonopolyRu"
    sys_version = ""
    timeout = 20

    def log_message(self, fmt, *args):
        if os.environ.get("MONOPOLY_VERBOSE"):
            line = fmt % args
            line = line.replace("token=", "token=***")
            sys.stderr.write("%s - %s\n" % (self.address_string(), line))

    # ---------- helpers ----------
    def _headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        if self.close_connection:
            self.send_header("Connection", "close")

    def _json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        try:
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self._headers()
            self.end_headers()
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def _err(self, msg, code=400):
        self._json({"error": msg}, code)

    def _body(self):
        te = (self.headers.get("Transfer-Encoding") or "").strip().lower()
        if te and te != "identity":
            raise BodyError("Непідтримувана передача", 400)
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise BodyError("Некоректна довжина запиту", 400)
        if length < 0:
            raise BodyError("Некоректна довжина запиту", 400)
        if length > MAX_BODY:
            raise BodyError("Занадто великий запит", 413)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            raise BodyError("Некоректний JSON", 400)
        if not isinstance(data, dict):
            raise BodyError("Некоректний запит", 400)
        return data

    def _static(self, path):
        if path in ("/", ""):
            path = "/index.html"
        rel = os.path.normpath(path.lstrip("/")).replace("\\", "/")
        full = os.path.abspath(os.path.join(WEB, rel))
        root = os.path.abspath(WEB)
        if not (full == root or full.startswith(root + os.sep)):
            return self._err("forbidden", 403)
        if not os.path.isfile(full):
            return self._err("not found", 404)
        ext = os.path.splitext(full)[1].lower()
        with open(full, "rb") as f:
            raw = f.read()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(raw)))
        if ext in (".html", ".js", ".css"):
            self.send_header("Cache-Control", "no-store")
        self._headers()
        self.end_headers()
        try:
            self.wfile.write(raw)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            return

    def _room(self, code):
        with ROOMS_LOCK:
            return ROOMS.get((code or "").upper())

    def _auth(self, code, token):
        room = self._room(code)
        if not room:
            raise RulesError("Кімнату не знайдено")
        with room.lock:
            p = room._by_token(token)
            p["lastSeen"] = time.time()
            return room, p

    # ---------- routing ----------
    def do_GET(self):
        try:
            u = urlparse(self.path)
            if u.path == "/api/state":
                return self.api_state(parse_qs(u.query))
            if u.path == "/api/board":
                return self._json({"board": BOARD, "groups": GROUPS, "colors": PLAYER_COLORS,
                                   "groupTiles": GROUP_TILES, "scales": SCALES,
                                   "themes": THEMES, "pieces": PIECES})
            if u.path == "/api/health":
                return self._json({"ok": True, "rooms": len(ROOMS)})
            return self._static(u.path)
        except RulesError as e:
            return self._err(str(e), 400)
        except ConnectionError:
            return
        except Exception:
            traceback.print_exc()
            return self._err("server error", 500)

    def do_POST(self):
        try:
            u = urlparse(self.path)
            data = self._body()
            if u.path == "/api/create":
                return self.api_create(data)
            if u.path == "/api/join":
                return self.api_join(data)
            if u.path == "/api/action":
                return self.api_action(data)
            return self._err("not found", 404)
        except BodyError as e:
            self.close_connection = True
            return self._err(str(e), e.code)
        except RulesError as e:
            return self._err(str(e), 400)
        except ConnectionError:
            return
        except Exception:
            traceback.print_exc()
            return self._err("server error", 500)

    # ---------- api ----------
    def api_create(self, data):
        name = str(data.get("name", "")).strip()
        if not name:
            return self._err("Введіть імʼя")
        if not allow(self.client_address[0], "create", 10):
            return self._err("Занадто багато кімнат — зачекайте хвилину", 429)
        token = secrets.token_urlsafe(18)
        with ROOMS_LOCK:
            if len(ROOMS) >= MAX_ROOMS:
                return self._err("Сервер перевантажений", 503)
            code = new_code()
            room = Room(code)
            ROOMS[code] = room
        pid = room.add_player(name, token)
        return self._json({"code": code, "playerId": pid, "token": token})

    def api_join(self, data):
        code = str(data.get("code", "")).strip().upper()
        name = str(data.get("name", "")).strip()
        if not name:
            return self._err("Введіть імʼя")
        if not allow(self.client_address[0], "join", 20):
            return self._err("Занадто багато спроб — зачекайте хвилину", 429)
        room = self._room(code)
        if not room:
            return self._err("Кімнату не знайдено — перевірте код", 404)
        token = secrets.token_urlsafe(18)
        pid = room.add_player(name, token)
        return self._json({"code": code, "playerId": pid, "token": token})

    def api_state(self, q):
        code = (q.get("code") or [""])[0].upper()
        token = (q.get("token") or [""])[0]
        try:
            since = int((q.get("since") or ["-1"])[0])
        except ValueError:
            since = -1
        room, p = self._auth(code, token)
        deadline = time.time() + 15
        with room.cond:
            while room.state["version"] <= since and time.time() < deadline:
                room.cond.wait(timeout=max(0.2, deadline - time.time()))
                if room.state["phase"] == "ended" and room.state["version"] <= since:
                    break
            snap = room.snapshot(p["id"])
        return self._json(snap)

    def api_action(self, data):
        code = str(data.get("code", "")).upper()
        token = str(data.get("token", ""))
        action = data.get("action") or {}
        room, p = self._auth(code, token)
        if not isinstance(action, dict):
            return self._err("Некоректна дія", 400)
        room.act(p["id"], action)
        return self._json({"ok": True, "version": room.state["version"]})


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8000)))
    ap.add_argument("--host", default="0.0.0.0")
    args = ap.parse_args()

    threading.Thread(target=cleanup_loop, daemon=True).start()

    httpd = Server((args.host, args.port), Handler)
    httpd.daemon_threads = True

    def ticker():
        while True:
            time.sleep(0.25)
            with ROOMS_LOCK:
                rooms = list(ROOMS.values())
            for room in rooms:
                try:
                    room.tick()
                except Exception:
                    traceback.print_exc()

    threading.Thread(target=ticker, daemon=True).start()

    ip = lan_ip()
    print("=" * 52)
    print("  МОНОПОЛІЯ — сервер запущено")
    print(f"  На цьому компʼютері:  http://localhost:{args.port}")
    print(f"  У локальній мережі:   http://{ip}:{args.port}")
    print("  Зупинити: Ctrl+C")
    print("=" * 52)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер зупинено.")


if __name__ == "__main__":
    main()
