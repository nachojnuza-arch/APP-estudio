export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 60,
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const baseUrl = (process.env.NEXTCLOUD_URL || 'http://127.0.0.1:8080').replace(/\/+$/, '');
  const ncUser = process.env.NEXTCLOUD_USER || 'nacho';
  const token = process.env.NEXTCLOUD_TOKEN || 'j0qQfIZe4rar6PBLlj7YjQbZfuUFV3giK35Jg6lg0dVytl627iLKlMtrX7k6cLjLNJmfAdSt';
  const baseDir = process.env.NEXTCLOUD_DIR || 'APP-Estudio';

  // Identificador de usuario para aislar datos entre distintas personas
  const rawUserId = req.headers['x-user-id'] || req.query.userId || (req.body && req.body.userId) || 'default';
  const userId = String(rawUserId).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'default';

  const authHeader = 'Basic ' + Buffer.from(`${ncUser}:${token}`).toString('base64');
  const webdavRoot = `${baseUrl}/remote.php/dav/files/${encodeURIComponent(ncUser)}/${encodeURIComponent(baseDir)}`;
  const userRoot = `${webdavRoot}/users/${encodeURIComponent(userId)}`;

  const action = req.query.action || (req.body && req.body.action);

  // Helper para hacer fetch con timeout
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

  // Helper para asegurar que una subcarpeta exista
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

  try {
    // 1. VERIFICAR ESTADO DEL SERVIDOR
    if (action === 'status') {
      try {
        const resp = await davFetch(webdavRoot, { method: 'PROPFIND' }, 4000);
        if (resp.status >= 200 && resp.status < 300) {
          return res.status(200).json({ online: true, server: 'Nextcloud', userId });
        }
        return res.status(200).json({ online: false, status: resp.status, message: 'Servidor respondió con error' });
      } catch (err) {
        return res.status(200).json({ online: false, message: 'Servidor no alcanzable' });
      }
    }

    // 2. OBTENER WORKSPACE
    if (action === 'getWorkspace') {
      const fileUrl = `${userRoot}/workspace_data.json`;
      const resp = await davFetch(fileUrl, { method: 'GET' });
      if (resp.status === 404) {
        return res.status(200).json({ exists: false, data: null, userId });
      }
      if (!resp.ok) {
        return res.status(resp.status).json({ error: `Error al obtener workspace: ${resp.statusText}` });
      }
      const data = await resp.json();
      return res.status(200).json({ exists: true, data, userId });
    }

    // 3. GUARDAR WORKSPACE
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
        return res.status(resp.status).json({ error: `Error al guardar workspace: ${resp.statusText}` });
      }
      return res.status(200).json({ success: true, userId, timestamp: Date.now() });
    }

    // 4. SUBIR PDF
    if (action === 'uploadPdf' && req.method === 'POST') {
      const { filename, subject, dataBase64 } = req.body;
      if (!filename || !dataBase64) {
        return res.status(400).json({ error: 'Faltan parámetros filename o dataBase64' });
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
        return res.status(resp.status).json({ error: `Error al subir PDF: ${resp.statusText}` });
      }
      return res.status(200).json({ success: true, filename, subject, userId });
    }

    // 5. DESCARGAR PDF
    if (action === 'getPdf' && req.method === 'GET') {
      const filename = req.query.filename;
      const subject = req.query.subject;
      if (!filename) {
        return res.status(400).json({ error: 'Falta parámetro filename' });
      }

      const fileUrl = subject
        ? `${userRoot}/${encodeURIComponent(subject)}/${encodeURIComponent(filename)}`
        : `${userRoot}/${encodeURIComponent(filename)}`;

      const resp = await davFetch(fileUrl, { method: 'GET' });
      if (resp.status === 404) {
        return res.status(404).json({ error: 'PDF no encontrado en el servidor' });
      }
      if (!resp.ok) {
        return res.status(resp.status).json({ error: `Error al obtener PDF: ${resp.statusText}` });
      }

      const arrayBuf = await resp.arrayBuffer();
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
      return res.status(200).send(Buffer.from(arrayBuf));
    }

    // 6. ELIMINAR PDF
    if (action === 'deletePdf' && (req.method === 'POST' || req.method === 'DELETE')) {
      const filename = req.query.filename || (req.body && req.body.filename);
      const subject = req.query.subject || (req.body && req.body.subject);
      if (!filename) {
        return res.status(400).json({ error: 'Falta parámetro filename' });
      }

      const fileUrl = subject
        ? `${userRoot}/${encodeURIComponent(subject)}/${encodeURIComponent(filename)}`
        : `${userRoot}/${encodeURIComponent(filename)}`;

      const resp = await davFetch(fileUrl, { method: 'DELETE' });
      if (resp.status === 404 || resp.ok || resp.status === 204) {
        return res.status(200).json({ success: true, userId, message: 'Archivo eliminado' });
      }
      return res.status(resp.status).json({ error: `Error al eliminar archivo: ${resp.statusText}` });
    }

    return res.status(400).json({ error: `Acción desconocida: ${action}` });
  } catch (error) {
    console.error('Error en sync handler:', error);
    return res.status(500).json({ error: error.message || 'Error interno del servidor' });
  }
}
