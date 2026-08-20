import crypto from 'crypto';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
  maxDuration: 60,
};

function normalizeString(str) {
  return String(str || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function hashString(str) {
  return crypto.createHash('sha256').update(normalizeString(str)).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-User-Id, X-User-Pin');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  body = body || {};

  const baseUrl = (process.env.NEXTCLOUD_URL || 'http://127.0.0.1:8080').trim().replace(/^["']|["']$/g, '').replace(/\/+$/, '');
  const ncUser = (process.env.NEXTCLOUD_USER || 'nacho').trim().replace(/^["']|["']$/g, '');
  const token = (process.env.NEXTCLOUD_TOKEN || 'j0qQfIZe4rar6PBLlj7YjQbZfuUFV3giK35Jg6lg0dVytl627iLKlMtrX7k6cLjLNJmfAdSt').trim().replace(/^["']|["']$/g, '');
  const baseDir = (process.env.NEXTCLOUD_DIR || 'APP-Estudio').trim().replace(/^["']|["']$/g, '');

  const rawUserId = req.headers['x-user-id'] || req.query.userId || body.userId || '';
  const rawPin = req.headers['x-user-pin'] || req.query.pin || body.pin || '';
  
  const userId = String(rawUserId).replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase().trim();
  const userPinHash = rawPin ? hashString(rawPin) : '';

  const authHeader = 'Basic ' + Buffer.from(`${ncUser}:${token}`).toString('base64');
  const webdavRoot = `${baseUrl}/remote.php/dav/files/${encodeURIComponent(ncUser)}/${encodeURIComponent(baseDir)}`;
  const userRoot = userId ? `${webdavRoot}/users/${encodeURIComponent(userId)}` : '';

  const action = req.query.action || body.action;

  async function davFetch(url, options = {}, timeoutMs = 15000) {
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
      throw new Error(`Error conectando con Nextcloud (${baseUrl}): ${err.message}`);
    }
  }

  async function ensureFolder(folderUrl) {
    const cleanUrl = folderUrl.replace(/\/+$/, '');
    try {
      const check = await davFetch(cleanUrl, { method: 'PROPFIND' }, 10000);
      if (check.status === 404) {
        await davFetch(cleanUrl, { method: 'MKCOL' }, 10000);
      }
    } catch (e) {
      try {
        await davFetch(cleanUrl, { method: 'MKCOL' }, 10000);
      } catch (e2) {}
    }
  }

  async function ensureUserHierarchy(subject) {
    await ensureFolder(webdavRoot);
    await ensureFolder(`${webdavRoot}/users`);
    await ensureFolder(userRoot);
    if (subject) {
      await ensureFolder(`${userRoot}/${encodeURIComponent(subject)}`);
    }
  }

  async function getStoredAuth() {
    if (!userId) return { error: 'Falta usuario' };
    const authFileUrl = `${userRoot}/auth.json`;
    try {
      const check = await davFetch(authFileUrl, { method: 'GET' }, 15000);
      if (check.status === 404) {
        return { notFound: true };
      }
      if (check.ok) {
        const data = await check.json();
        return { success: true, data };
      }
      return { error: `Servidor respondió ${check.status}` };
    } catch (e) {
      return { serverUnreachable: true, error: e.message };
    }
  }

  try {
    // 1. ESTADO DEL SERVIDOR
    if (action === 'status') {
      try {
        const resp = await davFetch(`${webdavRoot}/`, { method: 'PROPFIND' }, 15000);
        if (resp.status >= 200 && resp.status < 300) {
          return res.status(200).json({ online: true, server: 'Nextcloud' });
        }
        return res.status(200).json({ online: false, message: `Servidor respondió status ${resp.status}` });
      } catch (err) {
        return res.status(200).json({ online: false, message: err.message });
      }
    }

    // 2. OBTENER PREGUNTA DE SEGURIDAD DEL USUARIO (para la vista de recuperación)
    if (action === 'getSecurityQuestion') {
      if (!userId) return res.status(400).json({ error: 'Ingresa un usuario' });
      const authResult = await getStoredAuth();
      if (authResult.serverUnreachable) {
        return res.status(503).json({ error: `Servidor no responde: ${authResult.error}` });
      }
      if (authResult.notFound || !authResult.data) {
        return res.status(404).json({ error: 'El usuario especificado no existe.' });
      }
      return res.status(200).json({
        success: true,
        userId,
        securityQuestion: authResult.data.securityQuestion || 'mascota'
      });
    }

    // 3. CREAR CUENTA (REGISTRO EXPLÍCITO CON PREGUNTA DE SEGURIDAD)
    if (action === 'register' && req.method === 'POST') {
      if (!userId || !rawPin) {
        return res.status(400).json({ error: 'Debes ingresar un nombre de usuario y una contraseña.' });
      }
      
      const authResult = await getStoredAuth();
      if (authResult.serverUnreachable) {
        return res.status(503).json({ error: `No se pudo conectar con el servidor en la nube (${authResult.error})` });
      }
      if (authResult.data) {
        return res.status(400).json({ error: 'Este usuario ya está registrado. Por favor inicia sesión.' });
      }

      await ensureUserHierarchy();

      const securityQuestion = body.securityQuestion || req.query.securityQuestion || 'mascota';
      const securityAnswer = body.securityAnswer || req.query.securityAnswer || '';

      if (!securityAnswer) {
        return res.status(400).json({ error: 'Debes responder a la pregunta de seguridad.' });
      }

      const authData = JSON.stringify({
        userId,
        pinHash: userPinHash,
        securityQuestion,
        securityAnswerHash: hashString(securityAnswer),
        createdAt: Date.now()
      }, null, 2);

      await davFetch(`${userRoot}/auth.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: authData
      }, 15000);

      return res.status(200).json({ success: true, userId, message: 'Usuario creado exitosamente.' });
    }

    // 4. RECUPERAR CONTRASEÑA
    if (action === 'recover' && req.method === 'POST') {
      const securityAnswer = body.securityAnswer || req.query.securityAnswer || '';
      const newPin = body.newPin || req.query.newPin || '';

      if (!userId || !securityAnswer || !newPin) {
        return res.status(400).json({ error: 'Faltan datos para la recuperación.' });
      }

      const authResult = await getStoredAuth();
      if (authResult.serverUnreachable) {
        return res.status(503).json({ error: `Servidor no responde: ${authResult.error}` });
      }
      if (authResult.notFound || !authResult.data) {
        return res.status(404).json({ error: 'El usuario especificado no existe.' });
      }

      const storedAuth = authResult.data;
      const expectedAnswerHash = storedAuth.securityAnswerHash || storedAuth.recoveryHash;
      if (!expectedAnswerHash || expectedAnswerHash !== hashString(securityAnswer)) {
        return res.status(401).json({ error: 'La respuesta a la pregunta de seguridad es incorrecta.' });
      }

      storedAuth.pinHash = hashString(newPin);
      storedAuth.updatedAt = Date.now();

      await davFetch(`${userRoot}/auth.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storedAuth, null, 2)
      }, 15000);

      return res.status(200).json({ success: true, message: 'Contraseña restablecida con éxito. Ya puedes ingresar.' });
    }

    // 5. INICIAR SESIÓN / VALIDACIÓN
    if (action === 'login' || action === 'auth') {
      if (!userId) return res.status(400).json({ error: 'Ingresa un usuario' });
      const authResult = await getStoredAuth();
      if (authResult.serverUnreachable) {
        return res.status(503).json({ error: `No se pudo conectar con el servidor Nextcloud (${authResult.error}). Revisa tu conexión.` });
      }
      if (authResult.notFound || !authResult.data) {
        return res.status(404).json({ error: `El usuario "${userId}" no existe. Por favor crea tu cuenta primero en la pestaña "Crear Cuenta".` });
      }
      const storedAuth = authResult.data;
      if (storedAuth.pinHash && storedAuth.pinHash !== userPinHash) {
        return res.status(401).json({ error: 'Contraseña o PIN incorrecto.' });
      }
      return res.status(200).json({ success: true, userId });
    }

    // Validar credenciales del usuario para acciones de datos
    const authResult = await getStoredAuth();
    if (authResult.serverUnreachable || !authResult.data || (authResult.data.pinHash && authResult.data.pinHash !== userPinHash)) {
      return res.status(401).json({ error: 'No autorizado. Inicia sesión con tus credenciales.' });
    }

    // 6. CONFIGURACIÓN DE SUBIDA DIRECTA (Para archivos de cualquier tamaño sin límites de Vercel)
    if (action === 'getUploadConfig') {
      await ensureUserHierarchy();
      return res.status(200).json({
        success: true,
        webdavRoot,
        authHeader,
        userId
      });
    }

    // 7. OBTENER WORKSPACE
    if (action === 'getWorkspace') {
      const fileUrl = `${userRoot}/workspace_data.json`;
      const resp = await davFetch(fileUrl, { method: 'GET' }, 15000);
      if (resp.status === 404) {
        return res.status(200).json({ exists: false, data: null, userId });
      }
      if (!resp.ok) {
        return res.status(resp.status).json({ error: `Error: ${resp.statusText}` });
      }
      const data = await resp.json();
      return res.status(200).json({ exists: true, data, userId });
    }

    // 8. GUARDAR WORKSPACE
    if (action === 'putWorkspace' && req.method === 'POST') {
      await ensureUserHierarchy();
      const payload = body.data || body;
      const fileUrl = `${userRoot}/workspace_data.json`;
      const jsonContent = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);

      const resp = await davFetch(fileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: jsonContent,
      }, 15000);

      if (!resp.ok && resp.status !== 201 && resp.status !== 204) {
        return res.status(resp.status).json({ error: `Error guardando: ${resp.statusText}` });
      }
      return res.status(200).json({ success: true, userId, timestamp: Date.now() });
    }

    // 9. ELIMINAR PDF
    if (action === 'deletePdf' && (req.method === 'POST' || req.method === 'DELETE')) {
      const filename = req.query.filename || body.filename;
      const subject = req.query.subject || body.subject;
      if (!filename) return res.status(400).json({ error: 'Falta filename' });

      const fileUrl = subject
        ? `${userRoot}/${encodeURIComponent(subject)}/${encodeURIComponent(filename)}`
        : `${userRoot}/${encodeURIComponent(filename)}`;

      const resp = await davFetch(fileUrl, { method: 'DELETE' }, 15000);
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
