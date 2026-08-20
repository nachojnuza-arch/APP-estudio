import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 60,
};

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin || '')).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id, X-User-Pin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const baseUrl = (process.env.NEXTCLOUD_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const ncUser = process.env.NEXTCLOUD_USER || 'nacho';
  const token = process.env.NEXTCLOUD_TOKEN || 'j0qQfIZe4rar6PBLlj7YjQbZfuUFV3giK35Jg6lg0dVytl627iLKlMtrX7k6cLjLNJmfAdSt';
  const baseDir = process.env.NEXTCLOUD_DIR || 'APP-Estudio';

  const rawUserId = req.headers['x-user-id'] || req.query.userId || (req.body && req.body.userId) || '';
  const rawPin = req.headers['x-user-pin'] || req.query.pin || (req.body && req.body.pin) || '';
  
  const userId = String(rawUserId).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().trim();
  const userPinHash = rawPin ? hashPin(rawPin) : '';

  const authHeader = 'Basic ' + Buffer.from(`${ncUser}:${token}`).toString('base64');
  const webdavRoot = `${baseUrl}/remote.php/dav/files/${encodeURIComponent(ncUser)}/${encodeURIComponent(baseDir)}`;
  const userRoot = userId ? `${webdavRoot}/users/${encodeURIComponent(userId)}` : '';

  const action = req.query.action || (req.body && req.body.action);

  async function davFetch(url, options = {}, timeoutMs = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: authHeader,
          ...(options.headers || {}),
        },
      });
      clearTimeout(timer);
      return resp;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async function ensureFolder(folderUrl) {
    try {
      const check = await davFetch(folderUrl, { method: 'PROPFIND' }, 3000);
      if (check.status === 404) {
        await davFetch(folderUrl, { method: 'MKCOL' }, 3000);
      }
    } catch (e) {
      // Ignorar si ya existe
    }
  }

  async function ensureUserHierarchy(subject) {
    await ensureFolder(`${webdavRoot}/users`);
    await ensureFolder(userRoot);
    if (subject) {
      await ensureFolder(`${userRoot}/${encodeURIComponent(subject)}`);
    }
  }

  // Verificar o Registrar PIN del usuario
  async function verifyUserAuth() {
    if (!userId) {
      return { ok: false, error: 'Usuario no especificado' };
    }
    
    await ensureFolder(`${webdavRoot}/users`);
    await ensureFolder(userRoot);

    const authFileUrl = `${userRoot}/auth.json`;
    try {
      const check = await davFetch(authFileUrl, { method: 'GET' });
      if (check.status === 404) {
        // Registro automático: si no existe, guardamos el hash del PIN
        if (userPinHash) {
          const authData = JSON.stringify({ userId, pinHash: userPinHash, createdAt: Date.now() }, null, 2);
          await davFetch(authFileUrl, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: authData
          });
        }
        return { ok: true, isNew: true };
      }
      if (check.ok) {
        const stored = await check.json();
        if (stored.pinHash && stored.pinHash !== userPinHash) {
          return { ok: false, error: 'PIN o contraseña incorrecta para este usuario.' };
        }
        return { ok: true, isNew: false };
      }
    } catch (e) {
      console.warn('Error validando auth:', e);
    }
    return { ok: true };
  }

  try {
    // 1. ESTADO DEL SERVIDOR
    if (action === 'status') {
      try {
        const resp = await davFetch(webdavRoot, { method: 'PROPFIND' }, 4000);
        if (resp.status >= 200 && resp.status < 300) {
          return res.status(200).json({ online: true, server: 'Nextcloud' });
        }
        return res.status(200).json({ online: false, message: 'Servidor no responde' });
      } catch (err) {
        return res.status(200).json({ online: false, message: 'Servidor apagado' });
      }
    }

    // 2. INICIAR SESIÓN / VALIDAR CREDENCIALES
    if (action === 'auth') {
      const authResult = await verifyUserAuth();
      if (!authResult.ok) {
        return res.status(401).json({ success: false, error: authResult.error });
      }
      return res.status(200).json({ success: true, userId, isNew: !!authResult.isNew });
    }

    // Para cualquier acción de datos, requerimos usuario autenticado
    const authCheck = await verifyUserAuth();
    if (!authCheck.ok) {
      return res.status(401).json({ error: authCheck.error });
    }

    // 3. OBTENER WORKSPACE
    if (action === 'getWorkspace') {
      const fileUrl = `${userRoot}/workspace_data.json`;
      const resp = await davFetch(fileUrl, { method: 'GET' });
      if (resp.status === 404) {
        return res.status(200).json({ exists: false, data: null, userId });
      }
      if (!resp.ok) {
        return res.status(resp.status).json({ error: `Error: ${resp.statusText}` });
      }
      const data = await resp.json();
      return res.status(200).json({ exists: true, data, userId });
    }

    // 4. GUARDAR WORKSPACE
    if (action === 'putWorkspace' && req.method === 'POST') {
      await ensureUserHierarchy();
      const payload = req.body.data || req.body;
      const fileUrl = `${userRoot}/workspace_data.json`;
      const jsonContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

      const resp = await davFetch(fileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: jsonContent,
      });

      if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
        return res.status(resp.status).json({ error: `Error guardando: ${resp.statusText}` });
      }
      return res.status(200).json({ success: true, userId, timestamp: Date.now() });
    }

    // 5. SUBIR PDF
    if (action === 'uploadPdf' && req.method === 'POST') {
      const { filename, subject, dataBase64 } = req.body;
      if (!filename || !dataBase64) {
        return res.status(400).json({ error: 'Faltan datos' });
      }

      await ensureUserHierarchy(subject);

      const fileUrl = subject
        ? `${userRoot}/${encodeURIComponent(subject)}/${encodeURIComponent(filename)}`
        : `${userRoot}/${encodeURIComponent(filename)}`;

      const buffer = Buffer.from(dataBase64, 'base64');
      const resp = await davFetch(fileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: buffer,
      });

      if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
        return res.status(resp.status).json({ error: `Error subiendo PDF: ${resp.statusText}` });
      }
      return res.status(200).json({ success: true, filename, subject, userId });
    }

    // 6. DESCARGAR PDF
    if (action === 'getPdf' && req.method === 'GET') {
      const filename = req.query.filename;
      const subject = req.query.subject;
      if (!filename) return res.status(400).json({ error: 'Falta filename' });

      const fileUrl = subject
        ? `${userRoot}/${encodeURIComponent(subject)}/${encodeURIComponent(filename)}`
        : `${userRoot}/${encodeURIComponent(filename)}`;

      const resp = await davFetch(fileUrl, { method: 'GET' });
      if (resp.status === 404) return res.status(404).json({ error: 'PDF no encontrado' });
      if (!resp.ok) return res.status(resp.status).json({ error: resp.statusText });

      const arrayBuf = await resp.arrayBuffer();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      return res.status(200).send(Buffer.from(arrayBuf));
    }

    // 7. ELIMINAR PDF
    if (action === 'deletePdf' && (req.method === 'POST' || req.method === 'DELETE')) {
      const filename = req.query.filename || (req.body && req.body.filename);
      const subject = req.query.subject || (req.body && req.body.subject);
      if (!filename) return res.status(400).json({ error: 'Falta filename' });

      const fileUrl = subject
        ? `${userRoot}/${encodeURIComponent(subject)}/${encodeURIComponent(filename)}`
        : `${userRoot}/${encodeURIComponent(filename)}`;

      const resp = await davFetch(fileUrl, { method: 'DELETE' });
      if (resp.status === 404 || resp.ok || resp.status === 204) {
        return res.status(200).json({ success: true });
      }
      return res.status(resp.status).json({ error: resp.statusText });
    }

    return res.status(400).json({ error: `Acción desconocida: ${action}` });
  } catch (error) {
    console.error('Error en sync handler:', error);
    return res.status(500).json({ error: error.message || 'Error interno' });
  }
}
