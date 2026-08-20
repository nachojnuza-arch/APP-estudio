#!/usr/bin/env python3
import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import base64
import os
import sys

PORT = 3000
NEXTCLOUD_URL = os.environ.get("NEXTCLOUD_URL", "http://127.0.0.1:8080").rstrip("/")
NEXTCLOUD_USER = os.environ.get("NEXTCLOUD_USER", "nacho")
NEXTCLOUD_TOKEN = os.environ.get("NEXTCLOUD_TOKEN", "j0qQfIZe4rar6PBLlj7YjQbZfuUFV3giK35Jg6lg0dVytl627iLKlMtrX7k6cLjLNJmfAdSt")
NEXTCLOUD_DIR = os.environ.get("NEXTCLOUD_DIR", "APP-Estudio")

auth_bytes = f"{NEXTCLOUD_USER}:{NEXTCLOUD_TOKEN}".encode("utf-8")
AUTH_HEADER = f"Basic {base64.b64encode(auth_bytes).decode('utf-8')}"
WEBDAV_ROOT = f"{NEXTCLOUD_URL}/remote.php/dav/files/{urllib.parse.quote(NEXTCLOUD_USER)}/{urllib.parse.quote(NEXTCLOUD_DIR)}"

class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/sync":
            self.handle_sync_get(parsed)
        else:
            super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/sync":
            self.handle_sync_post(parsed)
        else:
            self.send_response(404)
            self.end_headers()

    def handle_sync_get(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        action = qs.get("action", [""])[0]

        if action == "status":
            try:
                req = urllib.request.Request(WEBDAV_ROOT, headers={"Authorization": AUTH_HEADER}, method="PROPFIND")
                with urllib.request.urlopen(req, timeout=3) as resp:
                    if 200 <= resp.status < 300:
                        self.send_json(200, {"online": True, "server": "Nextcloud (Local Dev)"})
                        return
                self.send_json(200, {"online": False, "message": "Respuesta no exitosa"})
            except Exception as e:
                self.send_json(200, {"online": False, "message": str(e)})
            return

        if action == "getWorkspace":
            url = f"{WEBDAV_ROOT}/workspace_data.json"
            try:
                req = urllib.request.Request(url, headers={"Authorization": AUTH_HEADER}, method="GET")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    self.send_json(200, {"exists": True, "data": data})
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.send_json(200, {"exists": False, "data": None})
                else:
                    self.send_json(e.code, {"error": str(e)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if action == "getPdf":
            filename = qs.get("filename", [""])[0]
            subject = qs.get("subject", [""])[0]
            if not filename:
                self.send_json(400, {"error": "Falta filename"})
                return
            url = f"{WEBDAV_ROOT}/{urllib.parse.quote(subject)}/{urllib.parse.quote(filename)}" if subject else f"{WEBDAV_ROOT}/{urllib.parse.quote(filename)}"
            try:
                req = urllib.request.Request(url, headers={"Authorization": AUTH_HEADER}, method="GET")
                with urllib.request.urlopen(req, timeout=10) as resp:
                    content = resp.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Disposition", f'inline; filename="{filename}"')
                    self.send_header("Content-Length", str(len(content)))
                    self.end_headers()
                    self.wfile.write(content)
            except urllib.error.HTTPError as e:
                self.send_json(e.code, {"error": str(e)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        self.send_json(400, {"error": f"Acción desconocida: {action}"})

    def handle_sync_post(self, parsed):
        content_len = int(self.headers.get('Content-Length', 0))
        post_body = self.rfile.read(content_len)
        try:
            body = json.loads(post_body.decode('utf-8'))
        except Exception:
            body = {}

        qs = urllib.parse.parse_qs(parsed.query)
        action = qs.get("action", [""])[0] or body.get("action", "")

        if action == "putWorkspace":
            payload = body.get("data", body)
            json_bytes = json.dumps(payload, indent=2).encode('utf-8')
            url = f"{WEBDAV_ROOT}/workspace_data.json"
            try:
                req = urllib.request.Request(url, data=json_bytes, headers={"Authorization": AUTH_HEADER, "Content-Type": "application/json"}, method="PUT")
                with urllib.request.urlopen(req, timeout=8) as resp:
                    self.send_json(200, {"success": True, "timestamp": int(os.path.getmtime("/tmp") if os.path.exists("/tmp") else 0)})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if action == "uploadPdf":
            filename = body.get("filename")
            subject = body.get("subject", "General")
            data_b64 = body.get("dataBase64")
            if not filename or not data_b64:
                self.send_json(400, {"error": "Faltan datos de PDF"})
                return
            
            # Ensure folder exists
            if subject:
                folder_url = f"{WEBDAV_ROOT}/{urllib.parse.quote(subject)}"
                try:
                    chk_req = urllib.request.Request(folder_url, headers={"Authorization": AUTH_HEADER}, method="PROPFIND")
                    urllib.request.urlopen(chk_req, timeout=3)
                except urllib.error.HTTPError as e:
                    if e.code == 404:
                        try:
                            mk_req = urllib.request.Request(folder_url, headers={"Authorization": AUTH_HEADER}, method="MKCOL")
                            urllib.request.urlopen(mk_req, timeout=3)
                        except Exception:
                            pass
                except Exception:
                    pass

            file_bytes = base64.b64decode(data_b64)
            url = f"{WEBDAV_ROOT}/{urllib.parse.quote(subject)}/{urllib.parse.quote(filename)}" if subject else f"{WEBDAV_ROOT}/{urllib.parse.quote(filename)}"
            try:
                req = urllib.request.Request(url, data=file_bytes, headers={"Authorization": AUTH_HEADER, "Content-Type": "application/pdf"}, method="PUT")
                with urllib.request.urlopen(req, timeout=15) as resp:
                    self.send_json(200, {"success": True, "filename": filename, "subject": subject})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        self.send_json(400, {"error": f"Acción desconocida: {action}"})

    def send_json(self, status_code, obj):
        res_bytes = json.dumps(obj).encode('utf-8')
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(res_bytes)))
        self.end_headers()
        self.wfile.write(res_bytes)

if __name__ == "__main__":
    os.chdir("/home/nacho/APP-estudio")
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), DevHandler) as httpd:
        print(f"Servidor de prueba local iniciado en http://localhost:{PORT}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass
