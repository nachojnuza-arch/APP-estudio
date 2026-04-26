# 📖 Sistema de Resumen Ejecutivo

## 🎯 Objetivo

Crear materiales de estudio completos y claros que te permitan **repasar temas sin leer toda la fuente**.

---

## 🔄 Cómo Funciona (Nuevo Flujo)

```
Tus apuntes 
  ↓
1️⃣ Extraer conceptos clave (usando saltos de línea como separadores de ideas)
  ↓
2️⃣ Para CADA concepto, buscar los mejores párrafos explicativos de los PDFs
  ↓
3️⃣ Generar resumen ejecutivo estructurado y claro
  ↓
✅ Material de estudio completo y organizado por conceptos
```

---

## 📋 Paso 1: Extracción de Conceptos de Tus Apuntes

### Estrategia de 3 niveles:

#### Nivel 1: Frases completas (peso: 3.0) 💡
```
Tu apunte: "Médula suprarrenal produce adrenalina"
→ Concepto: "Médula suprarrenal produce adrenalina" (frase completa)
```

#### Nivel 2: Líneas individuales (peso: 2.5) 📌
```
Tu apunte (con saltos de línea):
Médula suprarrenal
Produce catecolaminas
Adrenalina y noradrenalina
→ Conceptos: Cada línea separada
```

#### Nivel 3: Palabras frecuentes (peso: variable) 🔑
```
Tu apunte menciona 5 veces "adrenalina", 3 veces "catecolaminas"
→ Conceptos: adrenalina (peso 7.5), catecolaminas (peso 4.5)
```

### Por qué los saltos de línea importan:
**Cuando escribís así:**
```
Médula suprarrenal
→ Parte interna de la glándula adrenal
→ Produce adrenalina (80%) y noradrenalina (20%)
→ Respuesta de lucha o huida
```

**El sistema interpreta CADA línea como una idea/concepto separado.**

---

## 🔍 Paso 2: Búsqueda de Párrafos Explicativos

Para **cada concepto** extraído de tus apuntes:

### Scoring inteligente:
| Criterio | Puntos | Ejemplo |
|----------|--------|---------|
| Match exacto del concepto | `5.0 × peso` | "médula suprarrenal" aparece completo |
| Match de término individual | `2.0 × peso` | "médula" o "suprarrenal" |
| Fuzzy matching (tolerancia ortográfica) | `1.2 × peso × similitud` | "medula suprarrenal" (sin tilde) |
| Párrafo con 3+ oraciones | +2.0 | Contenido desarrollado |
| Párrafo largo (>250 chars) | +1.5 | Información completa |
| Demasiadas siglas | `-5 × ratio` | Penaliza glosarios |

### Resultado:
Los **2-3 mejores párrafos** de las fuentes para cada concepto.

---

## 📝 Paso 3: Resumen Ejecutivo Generado

### Formato de salida:

```
╔══════════════════════════════════════════════════════════╗
║       📖 RESUMEN EJECUTIVO - MATERIAL DE ESTUDIO       ║
╚══════════════════════════════════════════════════════════╝

📚 Fuentes analizadas: 3 archivo(s)
📝 Conceptos clave extraídos: 8
🎯 Objetivo: Repaso claro y completo del tema

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 MÉDULA SUPRARRENAL PRODUCE ADRENALINA
────────────────────────────────────────

   📄 Endocrinología - Capítulo 15 (pág. ~234)
   La médula suprarrenal es la porción interna de la glándula adrenal.
   Está formada por células cromafines que sintetizan y secretan 
   catecolaminas, principalmente adrenalina (80%) y noradrenalina (20%).
   Estas hormonas actúan en la respuesta de lucha o huida del organismo.

   📄 Fisiología Médica (pág. ~456)
   Las células de la médula adrenal derivan de la cresta neural y 
   constituyen un ganglio simpático modificado que responde a estímulos 
   del sistema nervioso autónomo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 PRODUCE CATECOLAMINAS
─────────────────────────

   📄 Endocrinología - Capítulo 15 (pág. ~235)
   Las catecolaminas son hormonas y neurotransmisores derivados de la 
   tirosina. Incluyen adrenalina, noradrenalina y dopamina.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 🎓 Ejemplo Práctico Completo

### Tus apuntes en el editor:
```
Médula suprarrenal
→ Parte interna de la glándula adrenal
→ Células cromafines
→ Produce adrenalina (80%) y noradrenalina (20%)
→ Respuesta de lucha o huida
→ Receptores alfa y beta adrenérgicos
→ Feocromocitoma: tumor de la médula
```

### Lo que el sistema hace:

**1. Extrae 7 conceptos:**
- 💡 "Médula suprarrenal" (línea completa, peso 2.5)
- 💡 "Parte interna de la glándula adrenal" (línea completa, peso 2.5)
- 💡 "Células cromafines" (línea completa, peso 2.5)
- 💡 "Produce adrenalina (80%) y noradrenalina (20%)" (línea completa, peso 2.5)
- 💡 "Respuesta de lucha o huida" (línea completa, peso 2.5)
- 💡 "Receptores alfa y beta adrenérgicos" (línea completa, peso 2.5)
- 💡 "Feocromocitoma: tumor de la médula" (línea completa, peso 2.5)

**2. Para cada concepto, busca en los PDFs:**
- Para "Médula suprarrenal" → Encuentra 2-3 párrafos que explican qué es
- Para "Células cromafines" → Encuentra párrafos sobre su origen y función
- Para "Adrenalina (80%)" → Encuentra explicación de la síntesis y proporción

**3. Genera el resumen ejecutivo:**
Cada concepto con sus párrafos explicativos de las fuentes, organizado y claro.

---

## ✨ Características Clave

### ✅ Lo que INCLUYE:
- Párrafos completos con oraciones desarrolladas
- Explicaciones detalladas de cada concepto
- Múltiples fuentes para el mismo tema
- Contenido con verbos y desarrollo argumental

### ❌ Lo que EXCLUYE:
- Glosarios y abreviaturas (ACE, ACTH, DOC, etc.)
- Tablas de contenido e índices
- Referencias bibliográficas
- Fragmentos muy cortos (<100 caracteres)
- Listas de siglas sin explicación

---

## 🔧 Configuración

Si necesitas ajustar el comportamiento:

```javascript
const FILTER_CONFIG = {
    maxChunks: 40,           // Máximo fragments extraídos
    maxTokens: 3500,         // Máximo tokens del resumen
    minRelevanceScore: 0.15, // Umbral mínimo de relevancia
    chunkSize: 500,          // Tamaño de cada fragmento
    chunkOverlap: 50,        // Overlap entre fragmentos
    minParagraphLength: 20,  // Longitud mínima de párrafo
    maxKeyTerms: 15          // Máximo conceptos a extraer
};
```

### Ajustes recomendados:

**Más conceptos:**
```javascript
maxKeyTerms: 20  // De 15 a 20
maxTokens: 4500  // De 3500 a 4500
```

**Más contenido por concepto:**
```javascript
minRelevanceScore: 0.1  // De 0.15 a 0.1 (más permisivo)
```

---

## 🚀 Cómo Usarlo

1. **Escribí tus apuntes** en el editor (usá saltos de línea para separar ideas)
2. **Seleccioná las fuentes** en el panel "Fuentes IA"
3. **Hacé clic** en "Resumí mis apuntes con las fuentes seleccionadas"
4. **Recibí el resumen ejecutivo** listo para estudiar

---

**¡Listo! Ahora tenés material de estudio completo sin leer toda la fuente.** 📚✨
