export const maxDuration = 60;

export default async function handler(req, res) {
  // Habilitar CORS si es necesario (útil para desarrollo local)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Leer la clave de las variables de entorno de Vercel
  const apiKey = process.env.GEMINI_API_KEY;
  
  if (!apiKey) {
    return res.status(500).json({ 
      error: { message: "La clave de la API de Gemini (GEMINI_API_KEY) no está configurada en las variables de entorno de Vercel." } 
    });
  }

  // Extraer el path que el frontend quiere llamar (ej: models/gemini-1.5-flash:generateContent)
  const path = req.query.path;
  if (!path) {
    return res.status(400).json({ 
      error: { message: "Falta el parámetro 'path' en la consulta." } 
    });
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/${path}?key=${apiKey}`;

  try {
    const fetchOptions = {
      method: req.method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    // Si es POST, reenviar el cuerpo de la petición original
    if (req.method !== 'GET' && req.body) {
      fetchOptions.body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    console.error("Error en el proxy de Gemini:", error);
    res.status(500).json({ error: { message: error.message } });
  }
}
