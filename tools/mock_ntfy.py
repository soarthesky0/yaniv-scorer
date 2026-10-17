# ntfy.sh の必要な部分だけを真似た疑似サーバー（4096バイト超はエラーにして検出する）
import json, sys, time, threading, uuid
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
store = {}            # topic -> [messages]
cond = threading.Condition()
LOG = open(sys.argv[2], "a") if len(sys.argv) > 2 else sys.stderr
class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
    def do_OPTIONS(self):
        # 本番で失敗するのを防ぐため、プリフライトが来たら記録する
        LOG.write(f"PREFLIGHT {self.path}\n"); LOG.flush()
        self.send_response(204); self.cors(); self.send_header("Content-Length","0"); self.end_headers()
    def do_POST(self):
        u = urlparse(self.path); topic = u.path.strip("/")
        n = int(self.headers.get("Content-Length", 0)); body = self.rfile.read(n)
        LOG.write(f"POST {topic} {n}B ctype={self.headers.get('Content-Type')} q={u.query}\n"); LOG.flush()
        if n > 4096:
            self.send_response(413); self.cors(); self.send_header("Content-Length","0"); self.end_headers(); return
        msg = {"id": uuid.uuid4().hex[:12], "time": int(time.time()), "event": "message", "topic": topic, "message": body.decode()}
        with cond:
            store.setdefault(topic, []).append(msg); cond.notify_all()
        out = json.dumps(msg).encode()
        self.send_response(200); self.cors(); self.send_header("Content-Type","application/json")
        self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
    def do_GET(self):
        u = urlparse(self.path); parts = u.path.strip("/").split("/"); q = parse_qs(u.query)
        if len(parts) != 2: self.send_response(404); self.send_header("Content-Length","0"); self.end_headers(); return
        topic, kind = parts
        msgs = store.get(topic, [])
        latest = msgs[-1:] if q.get("since") == ["latest"] else msgs
        if kind == "json":
            out = "".join(json.dumps(m) + "\n" for m in latest).encode()
            self.send_response(200); self.cors(); self.send_header("Content-Type","application/x-ndjson")
            self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out); return
        if kind == "sse":
            self.send_response(200); self.cors(); self.send_header("Content-Type","text/event-stream")
            self.send_header("Cache-Control","no-cache"); self.end_headers()
            try:
                self.wfile.write(b'event: open\ndata: {"event":"open"}\n\n')
                for m in latest: self.wfile.write(f"data: {json.dumps(m)}\n\n".encode())
                self.wfile.flush(); seen = len(store.get(topic, []))
                while True:
                    with cond:
                        cond.wait(timeout=10)
                        cur = store.get(topic, [])
                        new = cur[seen:]; seen = len(cur)
                    for m in new: self.wfile.write(f"data: {json.dumps(m)}\n\n".encode())
                    if not new: self.wfile.write(b'event: keepalive\ndata: {"event":"keepalive"}\n\n')
                    self.wfile.flush()
            except Exception:
                return
ThreadingHTTPServer.daemon_threads = True
ThreadingHTTPServer(("127.0.0.1", int(sys.argv[1])), H).serve_forever()
