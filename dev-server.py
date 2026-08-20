#!/usr/bin/env python3
import http.server
import socketserver
import urllib.request
import urllib.parse
import json
import base64
import hashlib
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

def hash_string(s):
    return hashlib.sha256(str(s or "").strip().lower().encode('utf-8')).hexdigest()

class DevHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id, X-User-Pin')
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

    def get_user_root(self, user_id):
        clean_user = "".join(c for c in user_id if c.isalnum() or c in ('_', '-')).lower() or 'default'
        return f"{WEBDAV_ROOT}/users/{urllib.parse.quote(clean_user)}"

    def ensure_dir(self, url):
        try:
            req = urllib.request.Request(url, headers={"Authorization": AUTH_HEADER}, method="PROPFIND")
            urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                try:
                    mk = urllib.request.Request(url, headers={"Authorization": AUTH_HEADER}, method="MKCOL")
                    urllib.request.urlopen(mk, timeout=3)
                except Exception:
                    pass
        except Exception:
            pass

    def get_stored_auth(self, user_id):
        if not user_id:
            return None
        user_root = self.get_user_root(user_id)
        auth_url = f"{user_root}/auth.json"
        try:
            req = urllib.request.Request(auth_url, headers={"Authorization": AUTH_HEADER}, method="GET")
            with urllib.request.urlopen(req, timeout=4) as resp:
                return json.loads(resp.read().decode('utf-8'))
        except Exception:
            return None

    def handle_sync_get(self, parsed):
        qs = urllib.parse.parse_qs(parsed.query)
        action = qs.get("action", [""])[0]
        user_id = self.headers.get("X-User-Id") or qs.get("userId", [""])[0]
        pin = self.headers.get("X-User-Pin") or qs.get("pin", [""])[0]
        user_root = self.get_user_root(user_id)

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

        if action == "login" or action == "auth":
            stored = self.get_stored_auth(user_id)
            if not stored:
                self.send_json(404, {"error": "El usuario no existe. Por favor crea una cuenta primero."})
                return
            if stored.get("pinHash") and stored.get("pinHash") != hash_string(pin):
                self.send_json(401, {"error": "Contraseña o PIN incorrecto."})
                return
            self.send_json(200, {"success": True, "userId": user_id})
            return

        stored = self.get_stored_auth(user_id)
        if not stored or (stored.get("pinHash") and stored.get("pinHash") != hash_string(pin)):
            self.send_json(401, {"error": "No autorizado. Inicia sesión con tus credenciales."})
            return

        if action == "getWorkspace":
            url = f"{user_root}/workspace_data.json"
            try:
                req = urllib.request.Request(url, headers={"Authorization": AUTH_HEADER}, method="GET")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    self.send_json(200, {"exists": True, "data": data, "userId": user_id})
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.send_json(200, {"exists": False, "data": None, "userId": user_id})
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
            url = f"{user_root}/{urllib.parse.quote(subject)}/{urllib.parse.quote(filename)}" if subject else f"{user_root}/{urllib.parse.quote(filename)}"
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
        user_id = self.headers.get("X-User-Id") or body.get("userId") or qs.get("userId", [""])[0]
        pin = self.headers.get("X-User-Pin") or body.get("pin") or qs.get("pin", [""])[0]
        user_root = self.get_user_root(user_id)

        self.ensure_dir(f"{WEBDAV_ROOT}/users")
        self.ensure_dir(user_root)

        if action == "register":
            if not user_id or not pin:
                self.send_json(400, {"error": "Debes ingresar un nombre de usuario y una contraseña."})
                return
            stored = self.get_stored_auth(user_id)
            if stored:
                self.send_json(400, {"error": "Este usuario ya existe. Por favor inicia sesión."})
                return
            recovery_key = body.get("recoveryKey", "")
            auth_data = json.dumps({
                "userId": user_id,
                "pinHash": hash_string(pin),
                "recoveryHash": hash_string(recovery_key) if recovery_key else "",
                "createdAt": 1787240000
            }, indent=2).encode('utf-8')
            auth_url = f"{user_root}/auth.json"
            put_req = urllib.request.Request(auth_url, data=auth_data, headers={"Authorization": AUTH_HEADER, "Content-Type": "application/json"}, method="PUT")
            try:
                urllib.request.urlopen(put_req, timeout=4)
                self.send_json(200, {"success": True, "userId": user_id, "message": "Usuario creado exitosamente."})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if action == "recover":
            recovery_key = body.get("recoveryKey", "")
            new_pin = body.get("newPin", "")
            if not user_id or not recovery_key or not new_pin:
                self.send_json(400, {"error": "Faltan datos para restablecer la contraseña."})
                return
            stored = self.get_stored_auth(user_id)
            if not stored:
                self.send_json(404, {"error": "El usuario no existe."})
                return
            if not stored.get("recoveryHash") or stored.get("recoveryHash") != hash_string(recovery_key):
                self.send_json(401, {"error": "La palabra clave o respuesta de recuperación es incorrecta."})
                return
            stored["pinHash"] = hash_string(new_pin)
            auth_data = json.dumps(stored, indent=2).encode('utf-8')
            auth_url = f"{user_root}/auth.json"
            put_req = urllib.request.Request(auth_url, data=auth_data, headers={"Authorization": AUTH_HEADER, "Content-Type": "application/json"}, method="PUT")
            try:
                urllib.request.urlopen(put_req, timeout=4)
                self.send_json(200, {"success": True, "message": "Contraseña restablecida con éxito."})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if action == "login" or action == "auth":
            stored = self.get_stored_auth(user_id)
            if not stored:
                self.send_json(404, {"error": "El usuario no existe. Por favor crea una cuenta primero."})
                return
            if stored.get("pinHash") and stored.get("pinHash") != hash_string(pin):
                self.send_json(401, {"error": "Contraseña o PIN incorrecto."})
                return
            self.send_json(200, {"success": True, "userId": user_id})
            return

        stored = self.get_stored_auth(user_id)
        if not stored or (stored.get("pinHash") and stored.get("pinHash") != hash_string(pin)):
            self.send_json(401, {"error": "No autorizado. Inicia sesión con tus credenciales."})
            return

        if action == "putWorkspace":
            payload = body.get("data", body)
            json_bytes = json.dumps(payload, indent=2).encode('utf-8')
            url = f"{user_root}/workspace_data.json"
            try:
                req = urllib.request.Request(url, data=json_bytes, headers={"Authorization": AUTH_HEADER, "Content-Type": "application/json"}, method="PUT")
                with urllib.request.urlopen(req, timeout=8) as resp:
                    self.send_json(200, {"success": True, "userId": user_id, "timestamp": int(os.path.getmtime("/tmp") if os.path.exists("/tmp") else 0)})
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
            
            if subject:
                self.ensure_dir(f"{user_root}/{urllib.parse.quote(subject)}")

            file_bytes = base64.b64decode(data_b64)
            url = f"{user_root}/{urllib.parse.quote(subject)}/{urllib.parse.quote(filename)}" if subject else f"{user_root}/{urllib.parse.quote(filename)}"
            try:
                req = urllib.request.Request(url, data=file_bytes, headers={"Authorization": AUTH_HEADER, "Content-Type": "application/pdf"}, method="PUT")
                with urllib.request.urlopen(req, timeout=15) as resp:
                    self.send_json(200, {"success": True, "filename": filename, "subject": subject, "userId": user_id})
            except Exception as e:
                self.send_json(500, {"error": str(e)})
            return

        if action == "deletePdf":
            filename = body.get("filename") or qs.get("filename", [""])[0]
            subject = body.get("subject") or qs.get("subject", ["General"])[0]
            if not filename:
                self.send_json(400, {"error": "Falta filename"})
                return
            url = f"{user_root}/{urllib.parse.quote(subject)}/{urllib.parse.quote(filename)}" if subject else f"{user_root}/{urllib.parse.quote(filename)}"
            try:
                req = urllib.request.Request(url, headers={"Authorization": AUTH_HEADER}, method="DELETE")
                with urllib.request.urlopen(req, timeout=8) as resp:
                    self.send_json(200, {"success": True, "message": "Eliminado"})
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    self.send_json(200, {"success": True, "message": "Ya no existía"})
                else:
                    self.send_json(e.code, {"error": str(e)})
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
