const aiResponseCache = new Map();
const CACHE_MAX_SIZE = 30;
const CACHE_TTL_MS = 1000 * 60 * 60; // 60 minutos

// 🆕 CONFIGURACIÓN DE FILTRADO GUIADO
const FILTER_CONFIG = {
    maxChunks: 40,  // AUMENTADO: de 20 a 40 para extraer más fragmentos
    maxTokens: 3500,  // AUMENTADO: de 2200 a 3500 para más contexto
    minRelevanceScore: 0.15,  // REDUCIDO: de 0.2 a 0.15 para captar más contenido
    chunkSize: 500,  // AUMENTADO: de 350 a 500 para más contexto por fragmento
    chunkOverlap: 50,  // AUMENTADO: de 25 a 50 para mejor continuidad
    minParagraphLength: 20,
    maxKeyTerms: 15  // AUMENTADO: de 12 a 15 para más términos de búsqueda
};

// 🆕 Stopwords en español para extracción de conceptos
const SPANISH_STOPWORDS = new Set([
    'el','la','los','las','un','una','de','del','al','en','con','por','para','que','y','o',
    'pero','si','no','es','son','ser','estar','esta','esto','como','mas','muy','tan','tanto',
    'tambien','aqui','alli','donde','cuando','quien','este','esta','estos','estas','ese','esa',
    'me','te','se','nos','os','les','mi','mis','tu','tus','su','sus','lo','la','le','hay',
    'tiene','tener','hacer','ir','venir','dar','ver','poder','deber','querer','saber','llegar',
    'pasar','quedar','poner','parecer','decir','hablar','mirar','seguir','encontrar','llamar',
    'volver','creer','buscar','vivir','sentir','esperar','comenzar','terminar','entrar','salir'
]);

// 🆕 Distancia de Levenshtein para matching con tolerancia a errores ortográficos
function levenshteinDistance(str1, str2) {
    const m = str1.length;
    const n = str2.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
            }
        }
    }
    return dp[m][n];
}

// 🆕 Similaridad fuzzy entre dos strings (0-1, donde 1 es idéntico)
function fuzzySimilarity(str1, str2) {
    const s1 = str1.toLowerCase().trim();
    const s2 = str2.toLowerCase().trim();
    
    if (s1 === s2) return 1.0;
    if (s1.length === 0 || s2.length === 0) return 0.0;
    
    const maxLen = Math.max(s1.length, s2.length);
    const distance = levenshteinDistance(s1, s2);
    
    // Normalizar: similarity = 1 - (distance / max_length)
    return 1 - (distance / maxLen);
}

// 🆕 Verificar si un término tiene match fuzzy con palabras en el texto
function fuzzyMatchInText(term, text, threshold = 0.75) {
    const textLower = text.toLowerCase();
    const termLower = term.toLowerCase();
    
    // Match exacto primero (rápido)
    if (textLower.includes(termLower)) return 1.0;
    
    // Tokenizar el texto y buscar matches fuzzy
    const textWords = textLower.split(/\s+/);
    let bestScore = 0;
    
    for (const word of textWords) {
        const cleanWord = word.replace(/[^\wáéíóúüñ]/g, '');
        if (cleanWord.length < 3) continue;
        
        const similarity = fuzzySimilarity(termLower, cleanWord);
        if (similarity > bestScore) {
            bestScore = similarity;
        }
        
        // Early exit si encontramos un buen match
        if (similarity >= threshold) return similarity;
    }
    
    // También verificar substrings más largos
    const termLen = termLower.length;
    if (termLen >= 4) {
        for (let i = 0; i <= textLower.length - termLen; i += 2) {
            const substring = textLower.substring(i, i + termLen);
            const similarity = fuzzySimilarity(termLower, substring);
            if (similarity > bestScore) {
                bestScore = similarity;
            }
            if (similarity >= threshold) return similarity;
        }
    }
    
    return bestScore >= threshold ? bestScore : 0;
}

// 🆕 CONFIGURACIÓN DE CALIDAD DE CHUNKS
const CHUNK_QUALITY_CONFIG = {
    minLength: 100,           // Longitud mínima en caracteres
    maxSiglaRatio: 0.25,      // Máximo 25% de siglas
    minSentenceCount: 2,      // Mínimo 2 oraciones completas
    minWordLength: 4          // Longitud promedio mínima de palabras
};

// 🆕 Verificar si un chunk es usable (no es glosario, índice ni basura)
function esChunkUtilizable(chunk) {
    const text = chunk.text;
    
    // Excluir muy cortos
    if (text.length < 100) return false;  // BAJADO: de 120 a 100

    // 🆕 Detectar índices/tablas de contenido (líneas con puntos o números de página)
    const lines = text.split(/\n+/).filter(l => l.trim().length > 5);
    if (lines.length > 3) {  // SOLO si hay muchas líneas
        let indexLines = 0;
        for (const line of lines) {
            // Patrón: "Tema ...... 123" o "Capítulo 5. Descripción ...... 234"
            if (/\.{3,}\s*\d{1,4}\s*$/.test(line)) indexLines++;
            // Patrón: línea que termina en número de página
            if (/\s\d{1,3}\s*$/.test(line) && line.length < 100) indexLines++;
        }
        // Si más del 50% son líneas de índice, excluir (ANTES: 40%)
        if (indexLines / lines.length > 0.5) return false;
    }

    // Excluir si contiene patrones de glosario/abreviaturas
    const glossaryPatterns = [
        /(?:ABREVIATURAS|GLOSARIO|SIGLAS|CUADRO|TABLA|REFERENCIAS|BIBLIOGRAFÍA|ÍNDICE|APÉNDICE)/i,
        /^[A-ZÁÉÍÓÚÑ]{2,6}\s+[A-Za-záéíóúñ\s]{5,}/,
        /^(?:GENERAL|APÉNDICE|ANEXO|NOTAS)\s*$/i
    ];
    
    for (const pattern of glossaryPatterns) {
        if (pattern.test(text)) return false;
    }

    // Excluir si más del 30% son siglas (ANTES: 25%)
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length > 5) {
        const siglas = words.filter(w => /^[A-ZÁÉÍÓÚÑ]{2,5}$/.test(w)).length;
        const siglaRatio = siglas / words.length;
        if (siglaRatio > 0.30) return false;
    }

    // 🆕 Verificar que tenga oraciones desarrolladas (contenido real)
    const sentenceCount = (text.match(/[.!?]+/g) || []).length;
    if (sentenceCount < 1) return false;  // BAJADO: de 2 a 1

    // Verificar que tenga contenido desarrollado (no solo lista de temas)
    const avgWordsPerSentence = words.length / Math.max(sentenceCount, 1);
    if (avgWordsPerSentence < 4) return false;  // BAJADO: de 5 a 4

    // Verificar que tenga verbos o sustantivos descriptivos
    const verbPattern = /\b\w+(?:ar|er|ir|ado|ido|ando|iendo|aba|ía|ó|é|amos|imos|ación|ción|sión|mente)\b/i;
    const hasVerbs = verbPattern.test(text);
    
    if (!hasVerbs && words.length < 15) return false;  // BAJADO: de 25 a 15
    
    return true;
}

function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^\wáéíóúüñ\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
}

// 🆕 Extraer TRIGRAMAS (grupos de 3 palabras consecutivas) de los apuntes
function extractKeyConceptsFromNotes(notesText, maxTerms = FILTER_CONFIG.maxKeyTerms) {
    if (!notesText || notesText.trim().length < 15) return [];

    // Estrategia PRINCIPAL: Extraer trigramas (3 palabras consecutivas)
    // Ejemplo: "médula suprarrenal produce catecolaminas" →
    //   "médula suprarrenal produce", "suprarrenal produce catecolaminas"
    const trigrams = new Set();
    const lines = notesText.split(/\n+/)
        .map(l => l.trim())
        .filter(l => l.length > 10);

    for (const line of lines) {
        const words = line.split(/\s+/).filter(w => w.length > 2);
        // Crear trigramas de 3 palabras consecutivas
        for (let i = 0; i <= words.length - 3; i++) {
            const trigram = words[i] + ' ' + words[i + 1] + ' ' + words[i + 2];
            if (trigram.length > 10) {
                trigrams.add(trigram.toLowerCase());
            }
        }
        // También agregar la línea completa si es razonable
        if (words.length >= 3 && words.length <= 15) {
            trigrams.add(line.toLowerCase());
        }
    }

    // Convertir a array con peso
    const concepts = [...trigrams].map(t => ({
        text: t,
        weight: 3.0,
        type: 'trigram'
    }));

    // Retornar top maxTerms
    return concepts.slice(0, maxTerms);
}

// 🆕 Chunking inteligente: agrupa párrafos SIN cortar oraciones
function smartChunkText(text, sourceName, options = {}) {
    const {
        maxChunkSize = FILTER_CONFIG.chunkSize,
        overlap = FILTER_CONFIG.chunkOverlap,
        minParagraphLength = FILTER_CONFIG.minParagraphLength
    } = { ...FILTER_CONFIG, ...options };

    if (!text || text.trim().length === 0) return [];

    // Dividir por párrafos reales (doble salto de línea)
    const rawParagraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length >= minParagraphLength);

    if (rawParagraphs.length === 0) {
        // Si no hay párrafos claros, dividir por oraciones
        return text.split(/(?<=[.!?])\s+/)
            .filter(s => s.trim().length >= minParagraphLength)
            .map((sentence, idx) => ({
                text: sentence.trim(),
                source: sourceName,
                page: Math.floor(idx / 5) + 1,
                words: new Set(tokenize(sentence)),
                tokenEstimate: Math.ceil(sentence.length / 4)
            }));
    }

    // 🆕 Agrupar párrafos en chunks SIN cortar ninguno
    const chunks = [];
    let currentChunk = "";
    let currentPage = 1;

    for (const paragraph of rawParagraphs) {
        // Si el párrafo solo es más grande que maxChunkSize, ponerlo igual (no cortar)
        if (currentChunk && (currentChunk + paragraph).length > maxChunkSize * 1.5) {
            // Cerrar chunk actual y empezar nuevo
            if (currentChunk.trim()) {
                chunks.push(createChunk(currentChunk.trim(), sourceName, currentPage));
                currentPage++;
            }
            // Overlap: últimas 2-3 oraciones del chunk anterior
            const lastSentences = currentChunk.split(/(?<=[.!?])\s+/).slice(-3).join(' ');
            currentChunk = lastSentences + " " + paragraph + " ";
        } else {
            currentChunk += paragraph + " ";
        }
    }

    // Último chunk
    if (currentChunk.trim()) {
        chunks.push(createChunk(currentChunk.trim(), sourceName, currentPage));
    }

    console.log(`   📝 ${rawParagraphs.length} párrafos → ${chunks.length} chunks`);
    return chunks;
}

function createChunk(text, source, page) {
    const words = tokenize(text);
    return {
        text, source, page,
        words: new Set(words),
        tokenEstimate: Math.ceil(text.length / 4),
        wordCount: words.length
    };
}

function classifyChunkByTopic(chunk) {
    const chunkTextLower = chunk.text.toLowerCase();
    const topicScores = [];

    for (const topic of MEDICAL_TOPIC_MAP) {
        let matchCount = 0;
        let keywordHits = [];

        for (const kw of topic.keywords) {
            if (chunkTextLower.includes(kw.toLowerCase())) {
                matchCount++;
                keywordHits.push(kw);
            }
        }

        if (matchCount > 0) {
            // Score: proporción de keywords encontradas + bonus por múltiples ocurrencias
            const coverage = matchCount / topic.keywords.length;
            topicScores.push({
                topic: topic,
                matchCount,
                coverage,
                keywordHits,
                score: coverage * 10 + matchCount * 2
            });
        }
    }

    // Ordenar por score y devolver el mejor
    topicScores.sort((a, b) => b.score - a.score);
    return topicScores.length > 0 ? topicScores[0] : null;
}

/**
 * Agrupa chunks por tema y los ordena por relevancia dentro de cada tema.
 * Devuelve un objeto: { topicId: { displayName, chunks[], keywordHits[] } }
 */
function groupChunksByTopic(chunks) {
    const groups = {};
    const unclassified = [];

    for (const chunk of chunks) {
        const classification = classifyChunkByTopic(chunk);

        if (classification) {
            const topicId = classification.topic.id;
            if (!groups[topicId]) {
                groups[topicId] = {
                    displayName: classification.topic.displayName,
                    chunks: [],
                    keywordHits: new Set()
                };
            }
            groups[topicId].chunks.push(chunk);
            classification.keywordHits.forEach(kw => groups[topicId].keywordHits.add(kw));
        } else {
            unclassified.push(chunk);
        }
    }

    // Ordenar chunks por score dentro de cada tema
    for (const topicId of Object.keys(groups)) {
        groups[topicId].chunks.sort((a, b) => b.score - a.score);
    }

    // Si hay chunks sin clasificar, crear grupo "Otros"
    if (unclassified.length > 0) {
        unclassified.sort((a, b) => b.score - a.score);
        groups['otros'] = {
            displayName: 'Otros temas (sin clasificar)',
            chunks: unclassified,
            keywordHits: new Set()
        };
    }

    return groups;
}

/**
 * Genera texto estructurado agrupado por tema con títulos y chunks ordenados.
 * Formato:
 * # TEMA PRINCIPAL
 * --- 📌 fuente (pág. X) [score: Y] ---
 * texto del chunk
 */
function formatContextByTopic(topicGroups) {
    let context = '';
    let usedTokens = 0;
    const maxTokens = FILTER_CONFIG.maxTokens;

    // Ordenar temas por cantidad de chunks (los más representativos primero)
    const sortedTopics = Object.entries(topicGroups).sort(
        (a, b) => b[1].chunks.length - a[1].chunks.length
    );

    for (const [topicId, group] of sortedTopics) {
        if (group.chunks.length === 0) continue;

        // Título del tema
        const topicHeader = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n📋 ${group.displayName.toUpperCase()}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        const headerTokens = Math.ceil(topicHeader.length / 4);
        if (usedTokens + headerTokens > maxTokens) break;

        context += topicHeader;
        usedTokens += headerTokens;

        // Keywords detectadas
        const keywords = [...group.keywordHits].slice(0, 8).join(', ');
        if (keywords) {
            const kwLine = `🔑 Palabras clave: ${keywords}\n\n`;
            const kwTokens = Math.ceil(kwLine.length / 4);
            if (usedTokens + kwTokens <= maxTokens) {
                context += kwLine;
                usedTokens += kwTokens;
            }
        }

        // Chunks ordenados por score
        for (const chunk of group.chunks) {
            const chunkHeader = `\n--- 📌 ${chunk.source} (pág. ~${chunk.page}) [score: ${chunk.score.toFixed(2)}] ---\n`;
            const chunkTokens = chunk.tokenEstimate || Math.ceil(chunk.text.length / 4);
            const headerTokenEstimate = Math.ceil(chunkHeader.length / 4);

            if (usedTokens + chunkTokens + headerTokenEstimate > maxTokens) break;

            context += chunkHeader + chunk.text + '\n';
            usedTokens += chunkTokens + headerTokenEstimate;
        }
    }

    console.log(`✅ Contexto temático: ${Object.keys(topicGroups).length} temas, ~${usedTokens} tokens`);
    return context.trim() || null;
}

// 🆕 FUNCIÓN PRINCIPAL: Generar resumen ejecutivo basado en apuntes del usuario
async function extractGuidedSources(notesText, options = {}) {
    const config = { ...FILTER_CONFIG, ...options };

    // PASO 1: Extraer conceptos clave de los apuntes del usuario
    const concepts = extractKeyConceptsFromNotes(notesText, config.maxKeyTerms);
    if (concepts.length === 0) return null;

    console.log(`📝 Conceptos extraídos de tus apuntes: ${concepts.length}`);
    console.log('  →', concepts.slice(0, 5).map(c => `"${c.text}"`).join(', '));

    // PASO 2: Extraer TODO el texto de las fuentes seleccionadas
    const allChunks = [];
    let sourcesProcessed = 0;

    for (const fileId of aiSourceFileIds) {
        let file = null;
        for (const sub of appData.subjects) {
            const found = sub.files.find(f => f.id === fileId);
            if (found) { file = found; break; }
        }
        if (!file || file.type !== 'pdf') continue;

        try {
            let fullText = '';

            if (file.driveId) {
                console.log(`☁️ Descargando ${file.name} desde Google Drive para la IA...`);
                const blob = await downloadPdfFromDrive(file.driveId);
                if (!blob) continue;
                fullText = await extractTextFromBlob(blob);
            } else if (file.isLocal) {
                const blob = await idb.get(fileId);
                if (!blob) continue;
                fullText = await extractTextFromBlob(blob);
            } else {
                console.log(`⚠ URLs externas no se pueden extraer sin backend: ${file.url}`);
                continue;
            }

            if (!fullText || fullText.trim().length < 50) continue;

            const chunks = smartChunkText(fullText, file.name, {
                maxChunkSize: config.chunkSize,
                overlap: config.chunkOverlap,
                minParagraphLength: config.minParagraphLength
            });
            allChunks.push(...chunks);
            sourcesProcessed++;
        } catch(e) {
            console.warn(`⚠ Error extrayendo ${file.name}:`, e);
        }
    }

    if (allChunks.length === 0) return null;

    // PASO 3: Filtrar glosarios y contenido basura
    const qualityChunks = allChunks.filter(esChunkUtilizable);
    console.log(`✅ Filtrado de calidad: ${allChunks.length} → ${qualityChunks.length} chunks válidos`);

    if (qualityChunks.length === 0) {
        console.warn('⚠️ No se encontraron chunks de calidad después del filtrado');
        return null;
    }

    // PASO 4: Para CADA CONCEPTO de tus apuntes, buscar los mejores párrafos explicativos
    const conceptMatches = [];

    for (const concept of concepts) {
        const conceptText = concept.text.toLowerCase();
        const conceptTerms = tokenize(conceptText);

        // Scorear todos los chunks contra este concepto
        const scoredForConcept = qualityChunks.map(chunk => {
            let score = 0;
            const chunkWords = chunk.words;
            const chunkTextLower = chunk.text.toLowerCase();

            // Match exacto del concepto completo
            if (chunkTextLower.includes(conceptText)) {
                score += 5.0 * concept.weight;
            }

            // Match de términos individuales del concepto
            conceptTerms.forEach(term => {
                if (chunkWords.has(term)) {
                    score += 2.0 * concept.weight;
                } else if (chunkWords.has(term + 's') || chunkWords.has(term + 'es')) {
                    score += 1.0 * concept.weight;
                } else {
                    // Fuzzy matching
                    const fuzzyScore = fuzzyMatchInText(term, chunk.text, 0.7);
                    if (fuzzyScore > 0) {
                        score += 1.2 * concept.weight * fuzzyScore;
                    }
                }
            });

            // Bonus por calidad del párrafo
            const sentenceCount = (chunk.text.match(/[.!?]+/g) || []).length;
            if (sentenceCount >= 3) score += 2.0;
            else if (sentenceCount >= 2) score += 1.0;

            if (chunk.text.length > 250) score += 1.5;
            else if (chunk.text.length < 120) score -= 1.5;

            // Penalizar siglas
            const words = chunk.text.split(/\s+/).filter(w => w.length > 0);
            if (words.length > 5) {
                const siglas = words.filter(w => /^[A-ZÁÉÍÓÚÑ]{2,5}$/.test(w)).length;
                const siglaRatio = siglas / words.length;
                if (siglaRatio > 0.15) score -= siglaRatio * 5;
            }

            return { ...chunk, score };
        });

        // Tomar los 2-3 mejores chunks para este concepto
        const bestMatches = scoredForConcept
            .filter(c => c.score >= config.minRelevanceScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);

        if (bestMatches.length > 0) {
            conceptMatches.push({
                concept: concept.text,
                conceptType: concept.type,
                conceptWeight: concept.weight,
                matches: bestMatches
            });
        }
    }

    if (conceptMatches.length === 0) return null;

    console.log(`📊 ${conceptMatches.length} conceptos con matches encontrados`);

    // PASO 5: Generar resumen ejecutivo estructurado
    return buildExecutiveSummary(conceptMatches, notesText, sourcesProcessed);
}

// 🆕 Construir resumen ejecutivo para estudio
function buildExecutiveSummary(conceptMatches, originalNotes, sourcesCount) {
    let summary = '';
    let totalTokens = 0;
    const maxTokens = FILTER_CONFIG.maxTokens;

    // HEADER del resumen
    summary += `╔══════════════════════════════════════════════════════════╗\n`;
    summary += `║       📖 RESUMEN EJECUTIVO - MATERIAL DE ESTUDIO       ║\n`;
    summary += `╚══════════════════════════════════════════════════════════╝\n\n`;
    summary += `📚 Fuentes analizadas: ${sourcesCount} archivo(s)\n`;
    summary += `📝 Conceptos clave extraídos: ${conceptMatches.length}\n`;
    summary += `🎯 Objetivo: Repaso claro y completo del tema\n\n`;
    summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    totalTokens += Math.ceil(summary.length / 4);

    // DESARROLLO: Cada concepto con su explicación de las fuentes
    for (const cm of conceptMatches) {
        if (totalTokens > maxTokens) break;

        // Título del concepto
        const icon = cm.conceptType === 'phrase' ? '💡' : cm.conceptType === 'line' ? '📌' : '🔑';
        const conceptHeader = `${icon} ${cm.concept.toUpperCase()}\n`;
        const headerTokens = Math.ceil(conceptHeader.length / 4);
        if (totalTokens + headerTokens > maxTokens) break;

        summary += conceptHeader;
        summary += `─`.repeat(conceptHeader.length - 1) + `\n\n`;
        totalTokens += headerTokens;

        // Agregar los párrafos explicativos de las fuentes
        const usedSources = new Set();
        for (const match of cm.matches) {
            const sourceKey = `${match.source} (pág. ~${match.page})`;
            
            // Evitar repetir la misma fuente más de 2 veces para el mismo concepto
            if (usedSources.has(sourceKey) && usedSources.has(sourceKey + '_2')) continue;
            usedSources.add(sourceKey + (usedSources.has(sourceKey) ? '_2' : ''));

            const chunkTokens = match.tokenEstimate || Math.ceil(match.text.length / 4);
            if (totalTokens + chunkTokens + 20 > maxTokens) break;

            summary += `   📄 ${sourceKey}\n`;
            summary += `   ${match.text}\n\n`;
            totalTokens += chunkTokens + 5;
        }

        summary += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        totalTokens += 15;
    }

    console.log(`✅ Resumen ejecutivo generado: ~${totalTokens} tokens, ${conceptMatches.length} conceptos`);
    return summary.trim();
}

// 🆕 FUNCIÓN: Verificar si una línea es basura/metadata
function esLineaUtil(linea) {
    const lineaTrim = linea.trim();
    if (lineaTrim.length < 3) return false;

    // Líneas que NUNCA deben aparecer
    const patronesBasura = [
        /descargado\s*para/i,
        /clinicalkey/i,
        /elsevier/i,
        /copyright\s*©/i,
        /todos\s*los\s*derechos\s*reservados/i,
        /soymedicina\.com/i,
        /©\s*\d{4}/i,
        /https?:\/\//i,
        /fotocopiar\s*sin\s*autorización/i,
        /para\s*uso\s*personal\s*exclusivamente/i,
        /no\s*se\s*permiten\s*otros\s*usos/i,
        /rights\s*reserved/i,
        /shlomo\s*melmed/i,
        /richard\s*j\.\s*auchus/i,
        /allison\s*b\.\s*goldfine/i,
        /ronald\s*j\.\s*koenig/i,
        /clifford\s*j\.\s*rosen/i,
        /p\.\s*reed\s*larsen/i,
        /kenneth\s*s\.\s*polonsky/i,
        /henry\s*m\.\s*kronenberg/i
    ];

    for (const patron of patronesBasura) {
        if (patron.test(lineaTrim)) return false;
    }

    // Líneas que son solo números de página
    if (/^pág\.?\s*~?\s*\d+$/i.test(lineaTrim)) return false;
    if (/^page\s+\d+$/i.test(lineaTrim)) return false;
    if (/^\d{1,4}$/.test(lineaTrim)) return false;

    // Líneas que son solo nombres de capítulos con números (índices)
    // Ej: "Medición de hormonas, 10 Glándulas endocrinas, 4"
    if (/, \d+/.test(lineaTrim) && lineaTrim.split(/, \d+/).length >= 3) return false;

    // Líneas demasiado cortas que no terminan en punto
    if (lineaTrim.length < 40 && !/[.!?]$/.test(lineaTrim)) return false;

    // Líneas que son solo guiones o caracteres especiales
    if (/^[-–—\s*]{3,}$/.test(lineaTrim)) return false;

    return true;
}

// 🆕 FUNCIÓN: Unir líneas cortadas y limpiar texto completo
function limpiarYUnirTexto(textoCompleto) {
    if (!textoCompleto) return '';

    // 1. Dividir en líneas
    let lineas = textoCompleto.split(/\n+/);

    // 2. Filtrar líneas basura
    lineas = lineas.filter(esLineaUtil);

    // 3. Unir líneas cortadas
    // Si una línea termina sin punto y la siguiente empieza en minúscula → unir
    let lineasUnidas = [];
    let lineaActual = '';

    for (let i = 0; i < lineas.length; i++) {
        const linea = lineas[i].trim();
        if (!linea) continue;

        if (lineaActual === '') {
            lineaActual = linea;
        } else {
            const terminaSinPunto = !/[.!?…]\s*$/.test(lineaActual);
            const empiezaMinuscula = /^[a-záéíóúñü]/.test(linea);

            if (terminaSinPunto && empiezaMinuscula) {
                // Unir con espacio
                lineaActual += ' ' + linea;
            } else {
                // Guardar línea actual y empezar nueva
                if (lineaActual.length > 20) {
                    lineasUnidas.push(lineaActual);
                }
                lineaActual = linea;
            }
        }
    }

    // Última línea
    if (lineaActual && lineaActual.length > 20) {
        lineasUnidas.push(lineaActual);
    }

    // 4. Normalizar espacios múltiples
    lineasUnidas = lineasUnidas.map(l => l.replace(/\s{2,}/g, ' ').trim());

    // 5. Filtrar líneas que aún son basura después de unión
    lineasUnidas = lineasUnidas.filter(l => l.length > 30);

    // 6. Unir en párrafos (separar por doble salto conceptual)
    let parrafos = [];
    let parrafoActual = '';

    for (const linea of lineasUnidas) {
        // Detectar si es inicio de nuevo párrafo:
        // - Termina en punto
        // - Siguiente línea empieza con mayúscula
        // - O la línea actual parece título (muy corta, todo mayúsculas)
        const esNuevoParrafo = /[.!?]\s*$/.test(linea) && 
                               parrafoActual.length > 50;

        if (esNuevoParrafo) {
            parrafos.push(parrafoActual.trim());
            parrafoActual = linea;
        } else {
            parrafoActual += (parrafoActual ? ' ' : '') + linea;
        }
    }

    // Último párrafo
    if (parrafoActual.trim()) {
        parrafos.push(parrafoActual.trim());
    }

    // Filtrar párrafos muy cortos o sin sentido
    parrafos = parrafos.filter(p => p.length > 40 && !/^[A-ZÁÉÍÓÚÑ\s]{10,60}$/.test(p));

    return parrafos.join('\n\n');
}

// 🆕 EXTRAER PÁGINAS COMPLETAS ordenadas por relevancia (máximo 4)
// Estrategia simple y confiable: comparar notas vs cada página del PDF
async function extraerPaginasRelevantes(userNotes, maxPaginas = 4) {
    if (!userNotes || userNotes.trim().length < 10) return null;

    // Extraer términos de búsqueda de los apuntes del usuario
    const noteWords = new Set(
        userNotes.toLowerCase()
            .replace(/[^\wáéíóúüñ\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2)
    );

    console.log(`📝 ${noteWords.size} términos de búsqueda extraídos de tus apuntes`);

    // Determinar qué PDFs usar
    let fileIds = [];
    if (aiSourceFileIds.size > 0) {
        fileIds = [...aiSourceFileIds];
    } else if (currentState.currentSubject) {
        const sub = appData.subjects.find(s => s.id === currentState.currentSubject);
        if (sub) {
            fileIds = sub.files.filter(f => f.type === 'pdf').map(f => f.id);
        }
    }

    if (fileIds.length === 0) {
        return { error: 'No hay PDFs seleccionados' };
    }

    // Todas las páginas encontradas con su score
    const allScoredPages = [];

    for (const fileId of fileIds) {
        let file = null;
        for (const sub of appData.subjects) {
            const found = sub.files.find(f => f.id === fileId);
            if (found) { file = found; break; }
        }
        if (!file || file.type !== 'pdf') continue;
        if (!file.isLocal && !file.driveId) continue;

        try {
            let blob;
            if (file.driveId) {
                blob = await downloadPdfFromDrive(file.driveId);
            } else {
                blob = await idb.get(fileId);
            }
            if (!blob) continue;

            const arrayBuffer = await blob.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const doc = await loadingTask.promise;

            console.log(`📄 Analizando: ${file.name} (${doc.numPages} páginas)`);

            // Extraer texto de CADA página y comparar
            const pagesToScan = Math.min(50, doc.numPages);  // Máximo 50 páginas por archivo

            for (let pageNum = 1; pageNum <= pagesToScan; pageNum++) {
                const page = await doc.getPage(pageNum);
                const textContent = await page.getTextContent();

                // Extraer texto completo de esta página
                const pageText = textContent.items
                    .map(item => item.str)
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();

                if (pageText.length < 50) continue;  // Página vacía o imagen

                // Contar coincidencias con los apuntes del usuario
                const pageWordsLower = pageText.toLowerCase();
                let matchCount = 0;
                let exactPhrases = 0;

                for (const word of noteWords) {
                    if (pageWordsLower.includes(word)) {
                        matchCount++;
                    }
                }

                // Bonus por frases completas que coinciden
                const userLines = userNotes.split(/[.\n]+/).filter(l => l.trim().length > 15);
                for (const line of userLines) {
                    if (pageWordsLower.includes(line.toLowerCase().trim())) {
                        exactPhrases++;
                        matchCount += 5;  // Bonus alto por frase completa
                    }
                }

                const score = matchCount;
                const matchPercent = noteWords.size > 0 ? Math.round((matchCount / noteWords.size) * 100) : 0;

                // Solo guardar páginas con al menos alguna coincidencia
                if (matchCount > 0) {
                    allScoredPages.push({
                        fileName: file.name,
                        pageNum: pageNum,
                        text: pageText,
                        score: score,
                        matchCount: matchCount,
                        matchPercent: matchPercent,
                        exactPhrases: exactPhrases
                    });
                }
            }

        } catch (e) {
            console.warn(`⚠ Error con ${file.name}:`, e);
        }
    }

    if (allScoredPages.length === 0) {
        return { error: 'No se encontraron coincidencias entre tus apuntes y los PDFs' };
    }

    // Ordenar por score y tomar las mejores maxPaginas
    allScoredPages.sort((a, b) => b.score - a.score);
    const bestPages = allScoredPages.slice(0, maxPaginas);

    console.log(`📊 ${allScoredPages.length} páginas con coincidencias encontradas`);
    console.log(`📄 Top ${maxPaginas} páginas más relevantes:`);
    bestPages.forEach((p, i) => {
        console.log(`  ${i+1}. ${p.fileName} · pág. ${p.pageNum} · ${p.matchCount} coincidencias (${p.matchPercent}%) · ${p.exactPhrases} frases exactas`);
    });

    // Construir texto con las páginas seleccionadas
    let resultText = '';
    for (const page of bestPages) {
        resultText += `═══════════════════════════════════════════════════\n`;
        resultText += `📄 ${page.fileName} · Página ${page.pageNum}\n`;
        resultText += `📊 ${page.matchCount} coincidencias (${page.matchPercent}%) · ${page.exactPhrases} frases de tus apuntes\n`;
        resultText += `═══════════════════════════════════════════════════\n\n`;
        resultText += page.text + '\n\n\n';
    }

    return {
        text: resultText.trim(),
        pagesExtracted: bestPages.length,
        totalPages: allScoredPages.length,
        stats: bestPages.map(p => ({
            file: p.fileName,
            page: p.pageNum,
            matches: p.matchCount,
            percent: p.matchPercent
        }))
    };
}

// 🆕 FUNCIÓN: Limpiar texto extraído de PDFs (eliminar basura de ClinicalKey/Elsevier)
function limpiarTextoPDF(texto) {
    if (!texto || texto.length < 50) return '';

    // 1. Dividir en líneas
    let lineas = texto.split(/\n+/);

    // 2. Eliminar líneas basura
    const lineasLimpias = lineas.filter(linea => {
        const l = linea.trim();
        if (l.length < 2) return false;

        // Patrones de basura (eliminar si coinciden)
        const patronesBasura = [
            /descargado\s*para/i,
            /clinicalkey/i,
            /elsevier/i,
            /copyright\s*©/i,
            /todos\s*los\s*derechos\s*reservados/i,
            /soymedicina\.com/i,
            /©\s*\d{4}/i,
            /https?:\/\//i,
            /fotocopiar\s*sin\s*autorización/i,
            /para\s*uso\s*personal\s*exclusivamente/i,
            /no\s*se\s*permiten\s*otros\s*usos/i,
            /rights\s*reserved/i,
            /shlomo\s*melmed/i,
            /richard\s*j\.\s*auchus/i,
            /allison\s*b\.\s*goldfine/i,
            /ronald\s*j\.\s*koenig/i,
            /clifford\s*j\.\s*rosen/i,
            /p\.\s*reed\s*larsen/i,
            /kenneth\s*s\.\s*polonsky/i,
            /henry\s*m\.\s*kronenberg/i
        ];

        for (const patron of patronesBasura) {
            if (patron.test(l)) return false;
        }

        // Solo números (páginas sueltas)
        if (/^\d{1,4}$/.test(l)) return false;

        // Listas de índices: "Tema, 10 Otro tema, 4 Tema más, 22"
        if (/, \d+/.test(l) && l.split(/, \d+/).length >= 3) return false;

        // Líneas que empiezan con "•" y son cortas (<40 chars)
        if (l.startsWith('•') && l.length < 40) return false;

        // Líneas que son SOLO mayúsculas y largas (>30 chars) - títulos de sección
        if (/^[A-ZÁÉÍÓÚÑ\s]{30,}$/.test(l)) return false;

        // Líneas que son solo guiones o caracteres especiales
        if (/^[-–—\s*]{3,}$/.test(l)) return false;

        return true;
    });

    // 3. Unir líneas cortadas
    let lineasUnidas = [];
    let lineaActual = '';

    for (let i = 0; i < lineasLimpias.length; i++) {
        const linea = lineasLimpias[i].trim();
        if (!linea) continue;

        if (lineaActual === '') {
            lineaActual = linea;
        } else {
            const terminaSinPunto = !/[.!?…]\s*$/.test(lineaActual);
            const empiezaMinuscula = /^[a-záéíóúñü]/.test(linea);

            if (terminaSinPunto && empiezaMinuscula) {
                // Unir con espacio (línea cortada en el PDF)
                lineaActual += ' ' + linea;
            } else {
                // Guardar línea actual y empezar nueva
                if (lineaActual.length > 10) {
                    lineasUnidas.push(lineaActual);
                }
                lineaActual = linea;
            }
        }
    }

    // Última línea
    if (lineaActual && lineaActual.length > 10) {
        lineasUnidas.push(lineaActual);
    }

    // 4. Normalizar espacios múltiples
    lineasUnidas = lineasUnidas.map(l => l.replace(/\s{2,}/g, ' ').trim());

    // 5. Filtrar líneas que aún son muy cortas después de unión
    lineasUnidas = lineasUnidas.filter(l => l.length > 20);

    // 6. Unir en párrafos (doble salto de línea)
    let parrafos = [];
    let parrafoActual = '';

    for (const linea of lineasUnidas) {
        // Detectar si es inicio de nuevo párrafo
        const terminaEnPunto = /[.!?]\s*$/.test(linea);
        const esParrafoNuevo = terminaEnPunto && parrafoActual.length > 50;

        if (esParrafoNuevo) {
            parrafos.push(parrafoActual.trim());
            parrafoActual = linea;
        } else {
            parrafoActual += (parrafoActual ? ' ' : '') + linea;
        }
    }

    // Último párrafo
    if (parrafoActual.trim()) {
        parrafos.push(parrafoActual.trim());
    }

    // Filtrar párrafos muy cortos o que parecen títulos
    parrafos = parrafos.filter(p => {
        if (p.length < 30) return false;
        if (/^[A-ZÁÉÍÓÚÑ\s]{10,60}$/.test(p)) return false;  // Solo mayúsculas
        return true;
    });

    // Devolver con doble salto entre párrafos
    return parrafos.join('\n\n');
}

// 🆕 FUNCIÓN: Detectar si un bloque de texto es un índice/tabla de contenido
function esIndice(texto) {
    const lineas = texto.split('\n').filter(l => l.trim().length > 10);
    if (lineas.length < 5) return false;

    let indiceLines = 0;
    for (const linea of lineas) {
        // Patrón de índice: "Título del capítulo" + número de página
        // Ej: "Hipotálamo y glándula hipófisis 71"
        // Ej: "Evaluación endocrinológica del eje hipotalámico hipofisario 91"
        if (/\s+\d{1,4}\s*$/.test(linea.trim())) {
            // Verifica que termine en número pero no sea un año
            const lastNum = linea.trim().match(/(\d{1,4})\s*$/)?.[1];
            if (lastNum && parseInt(lastNum) < 500) {  // Números de página típicamente <500
                // Pero NO si la línea tiene más de 3 números (puede ser contenido real con estadísticas)
                const numCount = (linea.match(/\d+/g) || []).length;
                if (numCount <= 2) {
                    indiceLines++;
                }
            }
        }
    }

    // Si más del 40% de las líneas terminan en número de página → es índice
    const ratio = indiceLines / lineas.length;
    return ratio > 0.4;
}

// 🆕 FUNCIÓN PRINCIPAL: Extraer texto limpio de PDF (salta índices, extrae contenido real)
async function extractTextFromBlob(blob) {
    return new Promise(async (resolve) => {
        try {
            const arrayBuffer = await blob.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
            const doc = await loadingTask.promise;

            let rawText = '';
            let pagesToExtract = Math.min(15, doc.numPages);
            let foundRealContent = false;
            let skippedPages = 0;

            // 🆕 Extraer más páginas para encontrar contenido real (hasta 25 páginas)
            const maxPagesToScan = Math.min(25, doc.numPages);

            for (let i = 1; i <= maxPagesToScan; i++) {
                // Si ya encontramos contenido real y extractamos suficientes páginas, parar
                if (foundRealContent && i > pagesToExtract) break;

                const page = await doc.getPage(i);
                const textContent = await page.getTextContent();

                // Extraer items con coordenadas completas
                const items = textContent.items
                    .filter(item => item.str && item.str.trim())
                    .map(item => ({
                        text: item.str.trim(),
                        y: Math.round(item.transform[5]),
                        x: Math.round(item.transform[4]),
                        width: Math.round(item.width || 0),
                        height: Math.round(item.height || 0)
                    }));

                if (items.length === 0) continue;

                // Ordenar por Y descendente (arriba a abajo) y luego por X
                items.sort((a, b) => b.y - a.y || a.x - b.x);

                // Agrupar por línea (misma Y ± 3px)
                const lineas = [];
                let lineaActual = [items[0]];
                let currentY = items[0].y;

                for (let j = 1; j < items.length; j++) {
                    const item = items[j];
                    if (Math.abs(item.y - currentY) > 3) {
                        lineaActual.sort((a, b) => a.x - b.x);
                        lineas.push(lineaActual.map(it => it.text).join(' '));
                        lineaActual = [item];
                        currentY = item.y;
                    } else {
                        lineaActual.push(item);
                    }
                }
                // Última línea
                if (lineaActual.length > 0) {
                    lineaActual.sort((a, b) => a.x - b.x);
                    lineas.push(lineaActual.map(it => it.text).join(' '));
                }

                const pageText = lineas.join('\n');

                // 🆕 Detectar si esta página es un índice
                if (!foundRealContent && esIndice(pageText)) {
                    skippedPages++;
                    console.log(`  ⏭ Página ${i}: ÍNDICE detectado, saltando (${skippedPages} páginas saltadas)`);
                    continue;
                }

                // Si llegamos aquí, es contenido real
                foundRealContent = true;
                rawText += pageText + '\n\n';

                if (skippedPages > 0) {
                    console.log(`  ✅ Página ${i}: Contenido real encontrado (después de saltar ${skippedPages} páginas de índice)`);
                }
            }

            if (skippedPages > 0) {
                console.log(`  📊 Total: ${skippedPages} páginas de índice saltadas, ${rawText.length} caracteres de contenido extraídos`);
            }

            // Limpiar texto con la nueva función
            const cleanText = limpiarTextoPDF(rawText);
            console.log(`  ✅ Texto final: ${cleanText.length} caracteres, ${cleanText.split('\n\n').length} párrafos`);
            resolve(cleanText);
        } catch (e) {
            console.warn('Error extrayendo texto de PDF:', e);
            resolve('');
        }
    });
}

class RateLimiter {
    constructor(options = {}) {
        this.maxRequests = options.maxRequests || 10;
        this.windowMs = options.windowMs || 60000;
        this.minDelayMs = options.minDelayMs || 6000;
        this.history = [];       // timestamps de requests exitosas
        this.pendingQueue = [];   // cola de espera
        this.processing = false;
        this.totalCalls = 0;
        this.successfulCalls = 0;
        this.failedCalls = 0;
        this.ratelimitedHits = 0;
    }

    // ¿Podemos hacer una request ahora?
    canMakeRequest() {
        // Verificar forceWaitUntil
        if (forceWaitUntil && Date.now() < forceWaitUntil) {
            const remaining = Math.ceil((forceWaitUntil - Date.now()) / 1000);
            console.warn(`⏱ Force wait: ${remaining}s restantes`);
            return false;
        }

        const now = Date.now();

        // Limpiar historial fuera de la ventana
        this.history = this.history.filter(ts => now - ts < this.windowMs);

        // Verificar límite de requests en la ventana
        if (this.history.length >= this.maxRequests) {
            console.warn(`⏱ Rate limit: ${this.history.length}/${this.maxRequests} en ventana de ${this.windowMs / 1000}s`);
            return false;
        }

        // Verificar delay mínimo entre requests
        if (this.history.length > 0) {
            const lastRequest = this.history[this.history.length - 1];
            const elapsed = now - lastRequest;
            if (elapsed < this.minDelayMs) {
                const waitNeeded = this.minDelayMs - elapsed;
                console.log(`⏳ Throttle: esperando ${Math.ceil(waitNeeded / 1000)}s (delay mínimo)`);
                return false;
            }
        }

        return true;
    }

    // Registrar una request realizada
    registerRequest(success = true) {
        this.history.push(Date.now());
        this.totalCalls++;
        if (success) {
            this.successfulCalls++;
        } else {
            this.failedCalls++;
        }
    }

    // Ejecutar una función respetando los límites
    async execute(fn, priority = 'normal') {
        return new Promise((resolve, reject) => {
            this.pendingQueue.push({ fn, priority, resolve, reject });
            this._processQueue();
        });
    }

    // Procesar cola de espera
    async _processQueue() {
        if (this.processing || this.pendingQueue.length === 0) return;
        this.processing = true;

        while (this.pendingQueue.length > 0) {
            // Esperar si no podemos hacer request
            if (!this.canMakeRequest()) {
                await new Promise(r => setTimeout(r, 1000));
                continue;
            }

            const item = this.pendingQueue.shift();
            try {
                const result = await item.fn();
                this.registerRequest(true);
                item.resolve(result);
            } catch (error) {
                this.registerRequest(false);
                item.reject(error);
            }

            // Delay mínimo entre requests
            if (this.pendingQueue.length > 0) {
                await new Promise(r => setTimeout(r, this.minDelayMs));
            }
        }

        this.processing = false;
    }

    // Forzar bloqueo por 429
    forceBlock(seconds) {
        forceWaitUntil = Date.now() + (seconds * 1000);
        this.ratelimitedHits++;
        console.warn(`🚫 Rate limit hit! Bloqueado por ${seconds}s`);
    }

    // Estadísticas actuales
    getStats() {
        const now = Date.now();
        const activeWindow = this.history.filter(ts => now - ts < this.windowMs).length;
        const forceWaitRemaining = forceWaitUntil ? Math.max(0, Math.ceil((forceWaitUntil - now) / 1000)) : 0;

        return {
            activeRequests: activeWindow,
            maxRequests: this.maxRequests,
            windowSecs: this.windowMs / 1000,
            minDelaySecs: this.minDelayMs / 1000,
            forceWaitRemaining,
            totalCalls: this.totalCalls,
            successfulCalls: this.successfulCalls,
            failedCalls: this.failedCalls,
            ratelimitedHits: this.ratelimitedHits,
            queueLength: this.pendingQueue.length,
            successRate: this.totalCalls > 0 ? Math.round((this.successfulCalls / this.totalCalls) * 100) : 100
        };
    }

    // Resetear límite de rate
    _resetRateLimit() {
        this.history = [];
        forceWaitUntil = null;
        console.log('♻️ Rate limiter reseteado');
    }
}

// Variable global de bloqueo forzado
let forceWaitUntil = null;

// Instancia del rate limiter (configuración conservadora)
const rateLimiter = new RateLimiter({
    maxRequests: 10,       // Máx 10 requests por minuto
    windowMs: 60000,       // Ventana de 1 minuto
    minDelayMs: 6000       // 6 segundos entre requests
});

let geminiApiKey = null;
let pendingAIFunction = null;

// Plantillas compactas (ahorrar tokens)
const PROMPT_TEMPLATES = {
    summary: `Resumí y estructurá estos apuntes de un estudiante en español.

📝 MIS APUNTES:
{{userNotes}}

{{filteredContext}}

Estructurá la respuesta así:
### 🧠 Conceptos Clave
• [Concepto]: definición precisa
### 📝 Explicación Integrada
[Desarrollo breve combinando mis ideas con datos del contexto]
### ❓ 3 Preguntas de Autoevaluación

Usá mis apuntes como guía principal. Del contexto, solo usá lo que complemente mis temas. Respuesta:`,

    quiz: `Creá un quiz de 5 preguntas sobre estos apuntes en español.

📝 APUNTES:
{{userNotes}}

{{#if filteredContext}}
📚 CONTEXTO:
{{filteredContext}}
{{/if}}

### ❓ Cuestionario
1-3. Preguntas de opción múltiple (a, b, c, d)
4-5. Preguntas de respuesta corta

### ✅ Respuestas
[Respuestas correctas con breve explicación]`
};

// Renderizar prompt desde template
function renderPrompt(templateName, variables) {
let prompt = PROMPT_TEMPLATES[templateName];
if (!prompt) return PROMPT_TEMPLATES.summary;

for (const [key, value] of Object.entries(variables)) {
const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
prompt = prompt.replace(placeholder, value || `[${key.toUpperCase()} NO DISPONIBLE]`);
}
// Remover placeholders condicionales no reemplazados
return prompt.replace(/\{\{#if.*?\}\}.*?\{\{\/if\}\}/gs, '').trim();
}

// 🆕 Cache de respuestas de IA con TTL
function getCachedResponse(promptHash) {
const cached = aiResponseCache.get(promptHash);
if (!cached) return null;
if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
aiResponseCache.delete(promptHash);
return null;
}
console.log('♻️ Respuesta recuperada de caché');
return cached.response;
}

function setCachedResponse(promptHash, response) {
if (aiResponseCache.size >= CACHE_MAX_SIZE) {
const oldestKey = aiResponseCache.keys().next().value;
aiResponseCache.delete(oldestKey);
}
aiResponseCache.set(promptHash, { response, timestamp: Date.now() });
}

// Hash simple para prompts
function hashPrompt(prompt) {
let hash = 0;
const sample = prompt.slice(0, 3000);
for (let i = 0; i < sample.length; i++) {
const char = sample.charCodeAt(i);
hash = ((hash << 5) - hash) + char;
hash = hash & hash;
}
return hash.toString(36);
}

// 🆔 Función de diagnóstico para API key (solo debug, no afecta producción)
async function diagnoseAPI() {
const chat = document.getElementById('chat-messages');
if (!chat) return;

chat.innerHTML += `<div class="msg-user p-2 text-xs text-slate-500 self-end max-w-[85%] rounded-l-xl rounded-tr-xl bg-slate-200">🔍 Diagnóstico de API...</div>`;

const apiKey = localStorage.getItem('gemini_api_key');
let html = '<div class="p-3 bg-slate-800 text-slate-200 text-xs rounded-lg space-y-1 font-mono">';

if (!apiKey) {
html += `<div class="text-red-400">❌ No hay API key guardada</div>`;
} else {
const masked = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);
html += `<div class="text-green-400">✅ API key: ${masked}</div>`;
}

// Test directo con modelo fijo (1 sola request)
const testModel = 'gemini-2.0-flash';
try {
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${testModel}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        contents: [{ parts: [{ text: 'Say OK' }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 5 }
    })
});

if (res.ok) {
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '?';
    html += `<div class="text-green-400">✅ ${testModel} → OK ("${text.trim()}")</div>`;
    html += `<div class="text-green-400">✅ Todo funciona. Intentá el resumen.</div>`;
} else if (res.status === 429) {
    html += `<div class="text-red-400">❌ 429 - Rate limit activo en ${testModel}</div>`;
    html += `<div class="text-yellow-400">⏳ Esperá 2-5 min sin hacer requests</div>`;
    html += `<div class="text-yellow-400">💡 O creá una key nueva en aistudio.google.com</div>`;
} else if (res.status === 403 || res.status === 400) {
    html += `<div class="text-red-400">❌ ${res.status} - API key inválida</div>`;
} else {
    html += `<div class="text-red-400">❌ ${res.status} ${res.statusText}</div>`;
}
} catch (e) {
html += `<div class="text-red-400">❌ Error: ${e.message}</div>`;
}

html += '</div>';
chat.innerHTML += `<div class="msg-ai p-3 text-sm self-start max-w-[95%] rounded-r-xl rounded-tl-xl bg-slate-50 border border-slate-200">${html}</div>`;
chat.scrollTop = chat.scrollHeight;
}

// ==========================================
// Funciones de UI para debug del rate limiter
// ==========================================

/**
* Resetear el rate limiter y forceWaitUntil
*/
function resetRateLimiter() {
rateLimiter._resetRateLimit();
showToast('♻️ Rate limiter reseteado', 'success');
}

/**
* Mostrar estadísticas del rate limiter en consola y toast
*/
function showRateLimiterStats() {
const stats = rateLimiter.getStats();
console.table(stats);

const msg = `📊 Requests: ${stats.activeRequests}/${stats.maxRequests} | ` +
        `Éxito: ${stats.successRate}% | ` +
        `429s: ${stats.ratelimitedHits} | ` +
        `Cola: ${stats.queueLength} | ` +
        (stats.forceWaitRemaining > 0 ? `⏱ Wait: ${stats.forceWaitRemaining}s` : '✅ OK');

showToast(msg, stats.forceWaitRemaining > 0 ? 'error' : 'info');
}

// ============================================================
async function callAI(prompt, options = {}) {
const { useCache = true, task = 'summary', retryCount = 0 } = options;
const MAX_RETRIES = 2;

// 1. Cache
const promptHash = hashPrompt(prompt);
if (useCache) {
const cached = getCachedResponse(promptHash);
if (cached) return cached;
}

// 2. Verificar forceWaitUntil
if (forceWaitUntil && Date.now() < forceWaitUntil) {
const remaining = Math.ceil((forceWaitUntil - Date.now()) / 1000);
throw new Error(`⏱ Rate limit activo. Esperá ${remaining}s más.`);
}

// 3. Ejecutar a través del RateLimiter
return rateLimiter.execute(async () => {
let lastError;

for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
        // Verificar forceWaitUntil antes de cada intento
        if (forceWaitUntil && Date.now() < forceWaitUntil) {
            const remaining = Math.ceil((forceWaitUntil - Date.now()) / 1000);
            throw new Error(`⏱ Rate limit activo. Esperá ${remaining}s más.`);
        }

        const model = 'gemini-2.0-flash';
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiApiKey}`;

        const body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
            systemInstruction: {
                parts: [{ text: task === 'quiz'
                    ? 'Eres un evaluador académico creando cuestionarios.'
                    : 'Eres un profesor universitario ayudando a organizar apuntes.'
                }]
            }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        // ── Manejo de 429 ──
        if (response.status === 429) {
            // Leer Retry-After header si existe
            const retryAfter = response.headers.get('Retry-After');
            const resetHeader = response.headers.get('x-ratelimit-reset');

            let waitSeconds;
            if (retryAfter) {
                waitSeconds = parseInt(retryAfter, 10);
            } else if (resetHeader) {
                const resetMs = parseInt(resetHeader, 10);
                waitSeconds = Math.ceil((resetMs - Date.now()) / 1000);
            } else {
                // Backoff exponencial: 15s, 30s, 60s
                waitSeconds = 15 * Math.pow(2, attempt);
            }

            waitSeconds = Math.max(waitSeconds, 15); // mínimo 15s
            console.warn(`🚫 429 en intento ${attempt + 1}. Wait: ${waitSeconds}s`);

            rateLimiter.forceBlock(waitSeconds);

            if (attempt < MAX_RETRIES) {
                // Esperar y reintentar
                await new Promise(r => setTimeout(r, (waitSeconds + 2) * 1000));
                continue;
            }

            throw new Error('⏱ Límite gratuito alcanzado. Esperá unos minutos antes de intentar de nuevo.');
        }

        // ── Otros errores ──
        if (response.status === 400 || response.status === 403) {
            localStorage.removeItem('gemini_api_key');
            throw new Error('🔑 Clave API inválida. Revisá Configuración IA ⚙️');
        }
        if (!response.ok) throw new Error(`Error del servidor (${response.status})`);

        // ── Respuesta exitosa ──
        const data = await response.json();

        if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
            const result = data.candidates[0].content.parts[0].text;
            if (useCache && result?.trim()) {
                setCachedResponse(promptHash, result);
            }
            return result;
        }
        throw new Error('La IA no generó una respuesta válida.');

    } catch (error) {
        lastError = error;

        // Si es 429 y ya usamos todos los reintentos, no catcheamos
        if (error.message.includes('Rate limit activo') || error.message.includes('Límite gratuito')) {
            throw error;
        }

        // Si es otro error y quedan reintentos, continuar
        if (attempt < MAX_RETRIES) {
            console.log(`🔄 Reintento ${attempt + 1}/${MAX_RETRIES} después de error: ${error.message}`);
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        }
    }
}

// Si llegamos acá, todos los reintentos fallaron
throw lastError || new Error('Error desconocido en la llamada a IA.');
});
}

function getCurrentSubjectNotes() {
if (!currentState.currentSubject) return '';

const notesKey = 'sub_' + currentState.currentSubject;
const notesHtml = appData.notes[notesKey];
if (!notesHtml) return '';

// Extraer texto plano del HTML
const temp = document.createElement('div');
temp.innerHTML = notesHtml;
return temp.textContent || temp.innerText;
}

function openApiModal() {
    const existingKey = localStorage.getItem('gemini_api_key');
    if (existingKey) document.getElementById('api-key-input').value = existingKey;
    openModal('api-modal');
}

function requireApiKey(callback) {
    geminiApiKey = localStorage.getItem('gemini_api_key');
    if (geminiApiKey && geminiApiKey.length > 10) {
        callback();
    } else {
        pendingAIFunction = callback;
        openApiModal();
    }
}

function saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        geminiApiKey = key;
        closeModal('api-modal');
        if (pendingAIFunction) {
            pendingAIFunction();
            pendingAIFunction = null;
        }
        showToast('✅ Clave IA guardada', 'success');
    } else {
        showToast('⚠️ Ingresa una clave válida', 'error');
    }
}

function formatMarkdownToHtml(text) {
    if (!text) return '';
    return text
        .replace(/^#### (.*$)/gim, '<h4 class="font-semibold text-sm mt-2 mb-1 text-slate-700">$1</h4>')
        .replace(/^### (.*$)/gim, '<h3 class="font-bold text-md mt-3 mb-1 text-slate-800">$1</h3>')
        .replace(/^## (.*$)/gim, '<h2 class="font-bold text-lg mt-4 mb-2 text-indigo-700 border-b pb-1">$1</h2>')
        .replace(/\*\*(.*?)\*\*/gim, '<strong class="text-slate-800">$1</strong>')
        .replace(/\*(.*?)\*/gim, '<em>$1</em>')
        .replace(/^- (.*$)/gim, '<li class="ml-4 list-disc marker:text-indigo-400">$1</li>')
        .replace(/^\d+\. (.*$)/gim, '<li class="ml-4 list-decimal marker:text-indigo-400">$1</li>')
        .replace(/\n(?=<h[1-4]|<ul|<ol|<li)/gim, '')
        .replace(/\n\n/gim, '<br><br>')
        .replace(/\n/gim, '<br>');
}

// 🆕 summarizeWithAI con extracción de páginas relevantes
function summarizeWithAI() {
    requireApiKey(async () => {
        const chat = document.getElementById('chat-messages');
        const typing = document.getElementById('typing-indicator');
        const notesEditor = document.getElementById('notes-editor');

        if (!chat || !notesEditor) {
            console.error('Elementos del DOM no encontrados');
            return showToast('⚠️ Error: interfaz no cargada correctamente', 'error');
        }

        // Obtener apuntes actuales del editor + materia
        const editorNotes = notesEditor.innerText;
        const subjectNotes = getCurrentSubjectNotes();
        const allNotes = (subjectNotes + '\n\n' + editorNotes).trim();

        if (!allNotes || allNotes.length < 30) {
            return showToast('📝 Escribí más apuntes para generar un resumen útil', 'error');
        }

        // Mostrar mensaje del usuario
        chat.innerHTML += `<div class="msg-user p-3 shadow-sm text-sm self-end max-w-[85%] rounded-l-xl rounded-tr-xl bg-indigo-600 text-white">Resumí mis apuntes con el contenido relevante de mis PDFs.</div>`;
        if (typing) typing.classList.remove('hidden');
        chat.scrollTop = chat.scrollHeight;

        try {
            // PASO 1: Extraer las 2 páginas más relevantes (reducido de 4 a 2 para ahorrar tokens)
            showToast('🔍 Buscando páginas relevantes en tus PDFs...');
            
            let relevantPages = null;
            try {
                relevantPages = await extraerPaginasRelevantes(allNotes, 2);  // REDUCIDO: solo 2 páginas
            } catch (e) {
                console.warn('⚠️ Error extrayendo páginas:', e.message);
            }

            // PASO 2: Construir el prompt con las páginas relevantes + apuntes
            let contextForAI = '';
            let contextSummary = '';
            
            if (relevantPages && !relevantPages.error && relevantPages.text) {
                console.log(`✅ ${relevantPages.pagesExtracted} páginas relevantes encontradas`);
                
                // 🆕 Resumir el contexto para ahorrar tokens (máximo ~1500 tokens)
                const maxContextLength = 5000;  // ~1250 tokens
                contextForAI = relevantPages.text;
                if (contextForAI.length > maxContextLength) {
                    // Tomar los primeros párrafos más relevantes de cada página
                    const pageBlocks = contextForAI.split(/═{20,}/).filter(b => b.trim());
                    contextForAI = '';
                    for (const block of pageBlocks.slice(0, 2)) {  // Solo primeras 2 páginas
                        contextForAI += block + '\n\n';
                    }
                    contextForAI = contextForAI.slice(0, maxContextLength);
                }
                contextSummary = `${relevantPages.pagesExtracted} páginas (${relevantPages.totalPages} analizadas)`;
                showToast(`📄 2 páginas encontradas. Generando resumen...`);
            } else {
                console.warn('⚠️ No se encontraron páginas relevantes, usando solo apuntes');
                contextForAI = '(No se encontraron páginas relevantes en los PDFs. Basate en mis apuntes.)';
                contextSummary = 'Sin contexto de PDFs';
            }

            // Construir prompt optimizado (máximo ~2000 tokens total)
            const maxNotesLength = 800;  // ~200 tokens para apuntes
            const notesSummary = allNotes.length > maxNotesLength ? allNotes.slice(0, maxNotesLength) + ' [...]' : allNotes;

            const prompt = `Soy estudiante de medicina. Ayudame a estudiar con mis apuntes y el libro.

MIS APUNTES:
${notesSummary}

LIBRO (páginas relevantes):
${contextForAI}

Generá un RESUMEN claro basado en mis apuntes, complementado con el libro.

Formato:
### 🧠 Conceptos Clave
• [Concepto]: definición
### 📝 Explicación
[Desarrollo]
### 📖 Detalles Importantes
[Puntos clave para el examen]
### ❓ 3 Preguntas de Autoevaluación

Usá mis apuntes como guía. Del libro, solo complementá. Escribí en español. Respuesta:`;

            console.log(`📏 Prompt size: ~${Math.ceil(prompt.length / 4)} tokens`);

            // 🤖 LLAMAR A IA
            const result = await callAI(prompt, { task: 'summary', useCache: false });

            // Mostrar respuesta en pantalla completa como los resúmenes sin IA
            const htmlContent = buildAISummaryHTML(result, notesSummary, relevantPages);
            openAIFullscreen(htmlContent, '🤖 Resumen generado por IA');

            // También mostrar en el chat un mensaje breve
            chat.innerHTML += `<div class="msg-ai p-4 shadow-sm text-sm self-start max-w-[95%] rounded-r-xl rounded-tl-xl leading-relaxed bg-indigo-50 border border-indigo-200">✅ <strong>Resumen con IA generado.</strong> Abrí pantalla completa para estudiar.${contextSummary ? `<br><small class="text-slate-500">📄 Contexto: ${contextSummary}</small>` : ''}</div>`;
            showToast('✅ Resumen con IA generado', 'success');

        } catch (e) {
            console.error('Error en IA:', e);
            chat.innerHTML += `<div class="msg-ai border-red-200 bg-red-50 text-red-700 p-3 shadow-sm text-sm self-start rounded-xl"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
            showToast('⚠️ Error al generar resumen', 'error');
        } finally {
            if (typing) typing.classList.add('hidden');
            chat.scrollTop = chat.scrollHeight;
        }
    });
}

// 🆕 generateQuiz con contexto filtrado
function generateQuiz() {
    requireApiKey(async () => {
        const chat = document.getElementById('chat-messages');
        const typing = document.getElementById('typing-indicator');
        const notesEditor = document.getElementById('notes-editor');

        if (!chat || !notesEditor) {
            console.error('Elementos del DOM no encontrados');
            return showToast('⚠️ Error: interfaz no cargada correctamente', 'error');
        }

        const editorNotes = notesEditor.innerText;
        const subjectNotes = getCurrentSubjectNotes();
        const allNotes = (subjectNotes + '\n\n' + editorNotes).trim();

        if (!allNotes || allNotes.length < 50) {
            return showToast('📚 Se necesita más contenido para crear un cuestionario', 'error');
        }

        chat.innerHTML += `<div class="msg-user p-3 shadow-sm text-sm self-end max-w-[85%] rounded-l-xl rounded-tr-xl bg-indigo-600 text-white">Creame un quiz de 5 preguntas sobre mis apuntes.</div>`;
        if (typing) typing.classList.remove('hidden');
        chat.scrollTop = chat.scrollHeight;

        try {
            // Filtrar contexto (opcional para quizzes)
            const filteredContext = await extractGuidedSources(allNotes, {
                maxChunks: 15,  // AUMENTADO: de 10 a 15
                maxTokens: 2000,  // AUMENTADO: de 1500 a 2000
                minRelevanceScore: 0.15  // REDUCIDO: de 0.25 a 0.15
            });

            const prompt = renderPrompt('quiz', {
                userNotes: allNotes.length > 1200 ? allNotes.slice(0, 1200) + ' [...]' : allNotes,
                filteredContext: filteredContext
            });

            const result = await callAI(prompt, { task: 'quiz', useCache: true });

            chat.innerHTML += `<div class="msg-ai p-4 shadow-sm text-sm self-start max-w-[95%] rounded-r-xl rounded-tl-xl leading-relaxed bg-slate-50 border border-slate-200">${formatMarkdownToHtml(result)}</div>`;
            showToast('✅ Cuestionario generado', 'success');

        } catch (e) {
            console.error('Error en IA:', e);
            chat.innerHTML += `<div class="msg-ai border-red-200 bg-red-50 text-red-700 p-3 shadow-sm text-sm self-start rounded-xl"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
            showToast('⚠️ Error al generar quiz', 'error');
        } finally {
            if (typing) typing.classList.add('hidden');
            chat.scrollTop = chat.scrollHeight;
        }
    });
}

async function extraerParrafosComoResumen(pdfSource = null) {
    let fileIds = [];

    // Determinar qué PDFs usar
    if (pdfSource instanceof Set) {
        fileIds = [...pdfSource];
    } else if (typeof pdfSource === 'string') {
        const sub = appData.subjects.find(s => s.id === pdfSource);
        if (sub) {
            fileIds = sub.files.filter(f => f.type === 'pdf').map(f => f.id);
        }
    } else if (aiSourceFileIds.size > 0) {
        fileIds = [...aiSourceFileIds];
    } else if (currentState.currentSubject) {
        const sub = appData.subjects.find(s => s.id === currentState.currentSubject);
        if (sub) {
            fileIds = sub.files.filter(f => f.type === 'pdf').map(f => f.id);
        }
    }

    if (fileIds.length === 0) {
        return { text: null, stats: { processed: 0, paragraphs: 0, reason: 'No hay PDFs disponibles' } };
    }

    const allSections = [];
    let totalProcessed = 0;
    let totalParagraphs = 0;
    const errors = [];

    for (const fileId of fileIds) {
        let file = null;
        let fileSubjectName = '';
        for (const sub of appData.subjects) {
            const found = sub.files.find(f => f.id === fileId);
            if (found) {
                file = found;
                fileSubjectName = sub.name;
                break;
            }
        }

        if (!file || file.type !== 'pdf') continue;
        if (!file.isLocal && !file.driveId) {
            errors.push(`${file.name} (URL externa)`);
            continue;
        }

        try {
            let blob;
            if (file.driveId) {
                blob = await downloadPdfFromDrive(file.driveId);
            } else {
                blob = await idb.get(fileId);
            }
            
            if (!blob) {
                errors.push(`${file.name} (no encontrado)`);
                continue;
            }

            console.log(`📄 Extrayendo texto de: ${file.name}`);
            const fullText = await extractTextFromBlob(blob);
            
            if (!fullText || fullText.trim().length < 50) {
                errors.push(`${file.name} (texto insuficiente: ${fullText?.length || 0} chars)`);
                console.warn(`⚠ ${file.name}: texto insuficiente (${fullText?.length || 0} chars)`);
                continue;
            }

            console.log(`  → Texto extraído: ${fullText.length} caracteres, ${fullText.split(/\n\n+/).length} párrafos`);
            console.log(`  → Primeros 300 chars: "${fullText.slice(0, 300).trim()}"`);

            // Estructurar con máximo 2 párrafos por sección (resumen corto)
            const structured = estructuraPorCapitulos(fullText, file.name, 2);
            
            console.log(`  → Después de filtrar: ${structured.totalParagraphs} párrafos válidos, ${structured.sections} secciones`);
            
            if (structured.totalParagraphs === 0) {
                errors.push(`${file.name} (todo el contenido fue filtrado - probablemente solo tiene glosarios/créditos)`);
                console.warn(`⚠ ${file.name}: todo el contenido fue filtrado`);
                continue;
            }
            
            allSections.push(structured);
            totalProcessed++;
            totalParagraphs += structured.totalParagraphs;

        } catch (e) {
            console.error(`❌ Error extrayendo ${file.name}:`, e);
            errors.push(`${file.name} (${e.message || 'error desconocido'})`);
        }
    }

    if (allSections.length === 0) {
        return {
            text: null,
            stats: { processed: 0, paragraphs: 0, errors, reason: 'No se pudieron extraer párrafos' }
        };
    }

    // Construir texto final — LIMITAR a ~3-4 hojas máximo (~10000 chars)
    let resultText = '';
    const MAX_CHARS = 40000; // ~10-15 hojas máximo

    for (let i = 0; i < allSections.length; i++) {
        const source = allSections[i];
        if (i > 0) resultText += `\n\n`;

        if (resultText.length + source.formattedText.length > MAX_CHARS) {
            const remaining = MAX_CHARS - resultText.length;
            if (remaining > 200) {
                resultText += source.formattedText.slice(0, remaining);
                resultText += '\n\n--- [Resumen limitado. Extraé por capítulos si necesitás más.]';
            }
            break;
        }
        resultText += source.formattedText;
    }

    return {
        text: resultText || null,
        stats: {
            processed: totalProcessed,
            paragraphs: totalParagraphs,
            files: allSections.length,
            errors: errors.length > 0 ? errors : null,
            totalChars: resultText.length,
            truncated: resultText.length >= MAX_CHARS
        }
    };
}

function estructuraPorCapitulos(fullText, fileName, maxParagraphsPerSection = 5) {
    // Separar por párrafos (doble salto de línea)
    const rawParagraphs = fullText.split(/\n\n+/).map(p => p.trim()).filter(p => p.length > 0);
    const sections = [];
    let currentSection = { type: 'chapter', title: 'Contenido del libro', paragraphs: [] };
    let totalParagraphs = 0;

    // Patrones
    const chapterPattern = /^(?:C[AÁ]PITULO\s+\d+|CHAPTER\s+\d+|UNIDAD\s+\d+|TEMA\s+\d+|SECCI[ÓO]N\s+\d+|MODULE\s+\d+|PART\s+\d+|PARTE\s+\d+)[\s.\-–—]*(.*)/i;
    const subtitlePattern = /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s]{3,59}[A-ZÁÉÍÓÚÑ]$/;  // Solo mayúsculas, 5-60 chars
    const pageNumberPattern = /^\d{1,4}$/;

    // 🆕 Patrones para filtrar créditos/páginas legales del inicio del PDF
    const junkPatterns = [
        /publisher/i, /medical\s*content/i, /gerente/i, /mercado/i, /comercial/i,
        /copyright/i, /all\s*rights\s*reserved/i, /isbn/i, /editorial/i,
        /edición\s*(\d+)?\s*de/i, /impres/i, /traducc/i, /design/i,
        /vice\s*president/i, /director\s*gerente/i, /content\s*lead/i,
        /project\s*manager/i, /marketing/i, /ventana\s*de\s*oportunidad/i,
        /latin\s*america/i, /méxico/i, /colombia/i, /chile/i, /argentina/i,
        /revisión\s*técnica/i, /asesor/i, /coordinador/i, /editor\s*en\s*jefe/i,
        /mhe\s*international/i, /professional/i, /shana/i,
        /printed\s*on/i, /printed\s*in/i, /library\s*of\s*congress/i,
        /cataloging/i, /publication\s*data/i
    ];

    const isJunkContent = (text) => {
        for (const pattern of junkPatterns) {
            if (pattern.test(text)) return true;
        }
        return false;
    };

    // 🆕 Líneas que parecen definiciones de glosario (patrón: SIGLA + definición)
    const isGlossaryLine = (text) => {
        // Patrón 1: "ACE Enzima convertidora" o "DOC Desoxicorticosterona"
        const glossaryDefPattern = /^([A-ZÁÉÍÓÚÑ]{2,6})\s+[A-Za-záéíóúñ]/;
        if (glossaryDefPattern.test(text)) {
            const firstWord = text.split(/\s+/)[0];
            if (/^[A-ZÁÉÍÓÚÑ]{2,6}$/.test(firstWord)) return true;
        }
        
        // Patrón 2: Líneas que son SOLO listas de siglas
        const words = text.split(/\s+/).filter(w => w.length > 0);
        if (words.length >= 3) {
            const acronymOnly = words.filter(w =>
                /^[A-ZÁÉÍÓÚÑ]{1,6}$/.test(w) ||
                /^\d{1,3}$/.test(w)
            );
            if (acronymOnly.length / words.length > 0.7) return true;
        }
        
        // Patrón 3: "SIGLA: definición" o "SIGLA - definición"
        if (/^[A-ZÁÉÍÓÚÑ]{2,8}\s*[\-:]\s*\w+/.test(text)) return true;
        
        return false;
    };

    // 🆕 Patrones de secciones de glosario
    const glossarySectionPattern = /^(?:REFERENCIAS|BIBLIOGRAFÍA|ABREVIATURAS|GLOSARIO|ÍNDICE|APÉNDICE|CUADRO|FIGURA|TABLA|ANEXO|Lecturas\s*recomendadas|Notas)/i;

    // 🆕 Modo glosario: si detectamos glosario al final, saltamos todo
    let inGlossarySection = false;
    // 🆕 Contador para detectar cuándo empieza el glosario final
    let consecutiveGlossaryLines = 0;

    for (const para of rawParagraphs) {
        // Ignorar páginas sueltas, números
        if (pageNumberPattern.test(para.trim())) continue;
        if (/^Page\s+\d+$/i.test(para.trim())) continue;
        
        // 🆕 Filtrar créditos del inicio
        if (isJunkContent(para)) continue;

        // 🆕 Si estamos en sección de glosario, saltar todo
        if (inGlossarySection) continue;

        // 🆕 Detectar inicio de glosario/referencias al final
        if (glossarySectionPattern.test(para.trim())) {
            inGlossarySection = true;
            continue;
        }

        // 🆕 Filtrar líneas individuales de glosario
        if (isGlossaryLine(para.trim())) {
            consecutiveGlossaryLines++;
            // Si hay muchas líneas de glosario seguidas, activar modo glosario
            if (consecutiveGlossaryLines >= 3) {
                inGlossarySection = true;
            }
            continue;
        } else {
            consecutiveGlossaryLines = 0;  // Resetear contador
        }

        // Detectar capítulo/unidad/tema
        const chapterMatch = para.match(chapterPattern);
        if (chapterMatch) {
            if (currentSection.paragraphs.length > 0) {
                sections.push({ ...currentSection });
                totalParagraphs += currentSection.paragraphs.length;
            }
            const chapterTitle = chapterMatch[1] ? chapterMatch[1].trim() : para;
            currentSection = { type: 'chapter', title: chapterTitle, paragraphs: [] };
            continue;
        }

        // Detectar subtítulo (solo mayúsculas, NO muy largo)
        if (subtitlePattern.test(para.trim()) && para.length < 80) {
            if (currentSection.paragraphs.length > 0) {
                sections.push({ ...currentSection });
                totalParagraphs += currentSection.paragraphs.length;
            }
            currentSection = { type: 'subtitle', title: para.trim(), paragraphs: [] };
            continue;
        }

        // 🆕 Párrafo normal — incluir texto desarrollado
        if (para.length >= 60 && !isGlossaryLine(para)) {
            // Verificar que no sea mayoritariamente mayúsculas (probablemente título)
            const upperRatio = (para.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length / para.length;
            if (upperRatio < 0.6) {
                currentSection.paragraphs.push(para);
            }
        }
    }

    // Agregar última sección
    if (currentSection.paragraphs.length > 0) {
        sections.push(currentSection);
        totalParagraphs += currentSection.paragraphs.length;
    }

    console.log(`📊 ${fileName}: ${rawParagraphs.length} párrafos crudos → ${totalParagraphs} párrafos válidos en ${sections.length} secciones`);

    // Limitar párrafos por sección
    let limitedSections = [];
    let limitedTotal = 0;
    for (const section of sections) {
        const limited = { ...section, paragraphs: section.paragraphs.slice(0, maxParagraphsPerSection) };
        if (limited.paragraphs.length > 0) {
            limitedSections.push(limited);
            limitedTotal += limited.paragraphs.length;
        }
    }

    // Formatear
    let formattedText = '';
    for (const section of limitedSections) {
        if (section.type === 'chapter') {
            formattedText += `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            formattedText += `📖 ${section.title.toUpperCase()}\n`;
            formattedText += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        } else if (section.type === 'subtitle') {
            formattedText += `\n## ${section.title}\n\n`;
        }
        formattedText += section.paragraphs.join('\n\n');
    }

    return { formattedText, totalParagraphs: limitedTotal, originalTotal: totalParagraphs, sections: limitedSections.length, fileName, filteredGlossary: inGlossarySection };
}

// 🆕 FUNCIÓN PRINCIPAL para resumen directo GUIADO por apuntes (usa páginas completas)
async function generarResumenDirecto() {
    const chat = document.getElementById('chat-messages');
    const typing = document.getElementById('typing-indicator');
    const notesEditor = document.getElementById('notes-editor');
    if (!chat) return;

    // Obtener apuntes del usuario
    const editorNotes = notesEditor ? (notesEditor.innerText || '').trim() : '';
    const subjectNotes = getCurrentSubjectNotes();
    const userNotes = (subjectNotes + '\n' + editorNotes).trim();

    if (!userNotes || userNotes.length < 15) {
        chat.innerHTML += `<div class="msg-user p-3 shadow-sm text-sm self-end max-w-[85%] rounded-l-xl rounded-tr-xl bg-emerald-600 text-white">Generá un resumen directo de mis PDFs basado en mis apuntes.</div>`;
        chat.innerHTML += `<div class="msg-ai p-4 shadow-sm text-sm self-start max-w-[95%] rounded-r-xl rounded-tl-xl bg-amber-50 border border-amber-200 text-amber-700">⚠️ <strong>Necesitás escribir apuntes primero.</strong> El sistema busca las páginas del libro que coinciden con tus notas y te las muestra completas.</div>`;
        chat.scrollTop = chat.scrollHeight;
        return;
    }

    chat.innerHTML += `<div class="msg-user p-3 shadow-sm text-sm self-end max-w-[85%] rounded-l-xl rounded-tr-xl bg-emerald-600 text-white">Buscá las páginas más relevantes de mis PDFs para mis apuntes.</div>`;
    if (typing) typing.classList.remove('hidden');
    chat.scrollTop = chat.scrollHeight;

    setTimeout(async () => {
        try {
            // 🆕 Extraer las 4 páginas más relevantes de los PDFs
            const result = await extraerPaginasRelevantes(userNotes, 4);

            if (result.error) {
                chat.innerHTML += `<div class="msg-ai p-4 shadow-sm text-sm self-start max-w-[95%] rounded-r-xl rounded-tl-xl bg-amber-50 border border-amber-200 text-amber-700">⚠️ ${result.error}</div>`;
                if (typing) typing.classList.add('hidden');
                chat.scrollTop = chat.scrollHeight;
                return;
            }

            console.log(`✅ ${result.pagesExtracted} páginas extraídas de ${result.totalPages} con coincidencias`);

            // Construir HTML del resultado
            const htmlContent = buildPageSummaryHTML(result, userNotes);
            openAIFullscreen(htmlContent, `📄 ${result.pagesExtracted} páginas relevantes encontradas`);

            const statsText = result.stats.map(s => `${s.file} p.${s.page} (${s.matches} matches)`).join(', ');
            chat.innerHTML += `<div class="msg-ai p-4 shadow-sm text-sm self-start max-w-[95%] rounded-r-xl rounded-tl-xl leading-relaxed bg-emerald-50 border border-emerald-200">✅ <strong>${result.pagesExtracted} páginas</strong> más relevantes extraídas. Abrí pantalla completa para estudiar.<br><small class="text-slate-500">${statsText}</small></div>`;
            showToast(`✅ ${result.pagesExtracted} páginas encontradas`, 'success');

        } catch (e) {
            console.error('Error resumen directo:', e);
            chat.innerHTML += `<div class="msg-ai border-red-200 bg-red-50 text-red-700 p-3 shadow-sm text-sm self-start rounded-xl"><i class="fas fa-exclamation-triangle"></i> ${e.message || e}</div>`;
            showToast('⚠️ Error al generar resumen', 'error');
        } finally {
            if (typing) typing.classList.add('hidden');
            chat.scrollTop = chat.scrollHeight;
        }
    }, 50);
}

// 🆕 Construir HTML de páginas relevantes
function buildPageSummaryHTML(result, userNotes) {
    let html = '<div class="space-y-0">';

    // Header
    html += `<div class="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-5 mb-6 sticky top-0 z-10 shadow-sm">`;
    html += `<h3 class="font-bold text-emerald-800 text-xl mb-2">📖 Páginas Más Relevantes del Libro</h3>`;
    html += `<p class="text-sm text-emerald-700"><strong>${result.pagesExtracted} páginas</strong> con mayor coincidencia · <strong>${result.totalPages} páginas</strong> analizadas en total</p>`;
    html += `<p class="text-xs text-slate-500 mt-2">Estas son las páginas completas del libro que más se relacionan con tus apuntes.</p>`;
    html += `</div>`;

    // Tus apuntes (colapsable)
    html += `<details class="mb-5 bg-blue-50 border border-blue-200 rounded-lg">`;
    html += `<summary class="p-3 cursor-pointer font-semibold text-blue-800 text-sm hover:bg-blue-100 rounded-lg"><i class="fas fa-pen-nib mr-1"></i> Ver tus apuntes (${userNotes.split('\n').length} líneas)</summary>`;
    html += `<div class="p-4 pt-0"><p class="text-sm text-blue-900 whitespace-pre-wrap">${userNotes.replace(/</g, '&lt;')}</p></div>`;
    html += `</details>`;

    // Parsear las páginas del resultado
    const pageRegex = /📄 (.+?) · Página (\d+)\n.+?\n(.+?)(?=\n\n\n|$)/gs;
    const pages = [];
    let match;
    while ((match = pageRegex.exec(result.text)) !== null) {
        pages.push({
            fileName: match[1].trim(),
            pageNum: match[2].trim(),
            text: match[3].trim()
        });
    }

    // Si no se pudieron parsear, usar los stats
    if (pages.length === 0 && result.stats) {
        for (const stat of result.stats) {
            pages.push({
                fileName: stat.file,
                pageNum: stat.page.toString(),
                text: 'Contenido extraído (ver texto abajo)'
            });
        }
    }

    // Páginas encontradas
    html += `<div class="space-y-6">`;
    for (let i = 0; i < pages.length; i++) {
        const page = pages[i];
        const stat = result.stats[i];
        const matchLabel = stat ? `${stat.matches} coincidencias · ${stat.percent}%` : '';

        html += `<div class="bg-white rounded-xl border-2 border-slate-200 overflow-hidden shadow-md">`;
        html += `<div class="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">`;
        html += `<p class="text-sm font-semibold text-slate-700"><i class="fas fa-book-open text-indigo-500 mr-1"></i> ${page.fileName} · Página ${page.pageNum}</p>`;
        if (matchLabel) {
            html += `<span class="text-xs font-bold px-3 py-1 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300">${matchLabel}</span>`;
        }
        html += `</div>`;
        html += `<div class="p-5 text-slate-700 text-sm leading-relaxed">`;
        html += `<p class="whitespace-pre-wrap">${page.text.replace(/</g, '&lt;')}</p>`;
        html += `</div>`;
        html += `</div>`;
    }
    html += `</div>`;

    html += '</div>';
    return html;
}

// 🆕 Construir HTML para resumen de IA en pantalla completa
function buildAISummaryHTML(aiResult, userNotes, relevantPages) {
    let html = '<div class="space-y-0">';

    // Header
    html += `<div class="bg-indigo-50 border-2 border-indigo-300 rounded-lg p-5 mb-6 sticky top-0 z-10 shadow-sm">`;
    html += `<h3 class="font-bold text-indigo-800 text-xl mb-2">🤖 Resumen Generado por Inteligencia Artificial</h3>`;
    if (relevantPages && !relevantPages.error) {
        html += `<p class="text-sm text-indigo-700"><strong>${relevantPages.pagesExtracted} páginas relevantes</strong> analizadas · <strong>${relevantPages.totalPages} páginas</strong> escaneadas en total</p>`;
        html += `<p class="text-xs text-slate-500 mt-2">La IA complementó tus apuntes con el contenido de las páginas más relevantes del libro.</p>`;
    } else {
        html += `<p class="text-sm text-amber-700">⚠️ No se encontraron páginas relevantes. Resumen basado solo en tus apuntes.</p>`;
    }
    html += `</div>`;

    // Tus apuntes (colapsable)
    html += `<details class="mb-5 bg-blue-50 border border-blue-200 rounded-lg">`;
    html += `<summary class="p-3 cursor-pointer font-semibold text-blue-800 text-sm hover:bg-blue-100 rounded-lg"><i class="fas fa-pen-nib mr-1"></i> Ver tus apuntes originales (${userNotes.split('\n').length} líneas)</summary>`;
    html += `<div class="p-4 pt-0"><p class="text-sm text-blue-900 whitespace-pre-wrap">${userNotes.replace(/</g, '&lt;')}</p></div>`;
    html += `</details>`;

    // Páginas usadas como contexto (colapsable)
    if (relevantPages && !relevantPages.error && relevantPages.text) {
        html += `<details class="mb-5 bg-slate-50 border border-slate-200 rounded-lg">`;
        html += `<summary class="p-3 cursor-pointer font-semibold text-slate-700 text-sm hover:bg-slate-100 rounded-lg"><i class="fas fa-book-open mr-1"></i> Ver páginas del libro usadas como contexto (${relevantPages.pagesExtracted} páginas)</summary>`;
        html += `<div class="p-4 pt-0 text-xs text-slate-600 whitespace-pre-wrap">${relevantPages.text.replace(/</g, '&lt;')}</div>`;
        html += `</details>`;
    }

    // Separador
    html += `<div class="border-t-2 border-indigo-200 my-6"></div>`;

    // Respuesta de la IA (formateada con markdown)
    html += `<div class="prose prose-slate max-w-none">`;
    html += formatMarkdownToHtml(aiResult);
    html += `</div>`;

    html += '</div>';
    return html;
}

// 🆕 Construir HTML de resumen guiado por apuntes
function buildGuidedSummaryHTML(sections, userNotes, sourcesCount, errors) {
    let html = '<div class="space-y-0">';

    // Header
    html += `<div class="bg-emerald-50 border-2 border-emerald-300 rounded-lg p-5 mb-6 sticky top-0 z-10 shadow-sm">`;
    html += `<h3 class="font-bold text-emerald-800 text-xl mb-2">📖 Resumen Basado en Tus Apuntes</h3>`;
    html += `<p class="text-sm text-emerald-700"><strong>${sections.length} conceptos</strong> con contenido relevante · <strong>${sourcesCount} fuente(s)</strong> analizadas</p>`;
    html += `<p class="text-xs text-slate-500 mt-2">Cada concepto de tus apuntes tiene párrafos del libro que lo explican con más del 30% de similitud.</p>`;
    if (errors && errors.length > 0) {
        html += `<p class="text-xs text-amber-600 mt-1">⚠️ ${errors.join(', ')}</p>`;
    }
    html += `</div>`;

    // Tus apuntes originales (colapsable)
    html += `<details class="mb-5 bg-blue-50 border border-blue-200 rounded-lg">`;
    html += `<summary class="p-3 cursor-pointer font-semibold text-blue-800 text-sm hover:bg-blue-100 rounded-lg"><i class="fas fa-pen-nib mr-1"></i> Ver tus apuntes originales (${userNotes.split('\n').length} líneas)</summary>`;
    html += `<div class="p-4 pt-0"><p class="text-sm text-blue-900 whitespace-pre-wrap">${userNotes.replace(/</g, '&lt;')}</p></div>`;
    html += `</details>`;

    // Secciones por concepto
    for (const section of sections) {
        const icon = section.conceptType === 'phrase' ? '💡' : '📌';

        html += `<div class="mb-8 pb-6 border-b-2 border-slate-100">`;
        html += `<h3 class="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2 bg-slate-50 px-3 py-2 rounded-lg">`;
        html += `<span class="text-xl">${icon}</span> ${section.concept}`;
        html += `</h3>`;

        for (const match of section.matches) {
            const simPercent = match.matchPercent;
            const wordsLabel = match.wordsFound === 3 ? '3/3 palabras ✅' : 
                             match.wordsFound === 2 ? '2/3 palabras' : `${match.wordsFound}/3`;
            const simColor = match.exactMatch ? 'text-emerald-700 bg-emerald-100 border-emerald-300' : 
                             simPercent >= 66 ? 'text-blue-700 bg-blue-100 border-blue-300' : 
                             'text-amber-700 bg-amber-100 border-amber-300';
            
            html += `<div class="bg-white rounded-xl border-2 border-slate-200 p-5 mb-4 shadow-md ml-6 hover:shadow-lg transition-shadow">`;
            html += `<div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-100">`;
            html += `<p class="text-xs text-slate-500 flex items-center gap-1"><i class="fas fa-book-open text-indigo-500"></i> ${match.source} · página ~${match.page}</p>`;
            html += `<span class="text-xs font-bold px-3 py-1.5 rounded-full border-2 ${simColor}">${wordsLabel}</span>`;
            html += `</div>`;
            
            // Limpiar y formatear el texto para mejor lectura
            let cleanText = match.text
                .replace(/\s+/g, ' ')  // Normalizar espacios
                .replace(/\n\s*\n/g, '\n')  // Párrafos dobles
                .trim();
            
            html += `<div class="prose prose-slate max-w-none">`;
            html += `<p class="text-slate-700 text-sm leading-relaxed text-justify">${cleanText}</p>`;
            html += `</div>`;
            html += `</div>`;
        }

        html += `</div>`;
    }

    html += '</div>';
    return html;
}

function buildDirectSummaryHTML(result) {
    const stats = result.stats;
    let html = '<div class="space-y-0">';

    // Header
    html += `<div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6 sticky top-0 z-10">`;
    html += `<h3 class="font-bold text-emerald-800 text-lg mb-1">📄 Resumen estructurado de PDFs</h3>`;
    html += `<p class="text-sm text-emerald-600"><strong>${stats.processed} archivo(s)</strong> · <strong>${stats.paragraphs} secciones</strong> · ~${Math.round(stats.totalChars / 4)} tokens</p>`;
    if (stats.truncated) {
        html += `<p class="text-xs text-amber-600 mt-1">📏 Resumen limitado a ~10-15 hojas. Usá fuentes IA seleccionadas para contenido específico.</p>`;
    }
    if (stats.errors && stats.errors.length > 0) {
        html += `<p class="text-xs text-amber-600 mt-2">⚠️ ${stats.errors.join(', ')}</p>`;
    }
    html += `<p class="text-[10px] text-slate-400 mt-1">Glosarios y abreviaturas filtrados automáticamente</p>`;
    html += `</div>`;

    // Parsear el texto estructurado
    const text = result.text;

    // Separar por capítulos (━━━━━━━━)
    const chapterParts = text.split(/\n\n━━━━━━━━{10,}\n/);

    for (let i = 0; i < chapterParts.length; i++) {
        const chapterText = chapterParts[i].trim();
        if (!chapterText) continue;

        // Detectar si es un capítulo con título
        const chapterTitleMatch = chapterText.match(/^📖 (.+?)\n━━━━━━━━{10,}\n/);

        if (chapterTitleMatch) {
            // Es un capítulo con título
            const title = chapterTitleMatch[1];
            const content = chapterText.slice(chapterTitleMatch[0].length);

            html += `<div class="mb-6 pb-4 border-b border-slate-100">`;
            html += `<h3 class="text-lg font-bold text-slate-800 mb-3 flex items-center gap-2"><i class="fas fa-book text-slate-500 text-sm"></i> ${title}</h3>`;

            // Parsear subtítulos dentro del capítulo
            const subSections = content.split(/\n## /);
            for (const sub of subSections) {
                const trimmed = sub.trim();
                if (!trimmed) continue;

                // Detectar si tiene subtítulo
                const subMatch = trimmed.match(/^([A-ZÁÉÍÓÚÑ\s]{3,50})\n\n(.*)/s);
                if (subMatch) {
                    html += `<h4 class="font-semibold text-slate-700 mt-4 mb-2 text-sm">${subMatch[1].trim()}</h4>`;
                    const paragraphs = subMatch[2].split(/\n\n/).filter(p => p.trim());
                    for (const para of paragraphs) {
                        html += `<p class="text-slate-700 text-sm leading-relaxed mb-3">${para.trim()}</p>`;
                    }
                } else {
                    // Párrafos sin subtítulo
                    const paragraphs = trimmed.split(/\n\n/).filter(p => p.trim());
                    for (const para of paragraphs) {
                        html += `<p class="text-slate-700 text-sm leading-relaxed mb-3">${para.trim()}</p>`;
                    }
                }
            }

            html += `</div>`;
        } else {
            // Texto sin título de capítulo (intro o contenido suelto)
            const subSections = chapterText.split(/\n## /);
            for (const sub of subSections) {
                const trimmed = sub.trim();
                if (!trimmed) continue;

                const subMatch = trimmed.match(/^([A-ZÁÉÍÓÚÑ\s]{3,50})\n\n(.*)/s);
                if (subMatch) {
                    html += `<h4 class="font-semibold text-slate-700 mt-4 mb-2 text-sm">${subMatch[1].trim()}</h4>`;
                    const paragraphs = subMatch[2].split(/\n\n/).filter(p => p.trim());
                    for (const para of paragraphs) {
                        html += `<p class="text-slate-700 text-sm leading-relaxed mb-3">${para.trim()}</p>`;
                    }
                } else {
                    const paragraphs = trimmed.split(/\n\n/).filter(p => p.trim());
                    for (const para of paragraphs) {
                        html += `<p class="text-slate-700 text-sm leading-relaxed mb-3">${para.trim()}</p>`;
                    }
                }
            }
        }
    }

    html += '</div>';
    return html;
}

function summarizeLocal() {
    const chat = document.getElementById('chat-messages');
    const typing = document.getElementById('typing-indicator');
    const notesEditor = document.getElementById('notes-editor');

    if (!chat || !notesEditor) return;

    const editorNotes = notesEditor.innerText;
    const subjectNotes = getCurrentSubjectNotes();
    const allNotes = (subjectNotes + '\n\n' + editorNotes).trim();

    if (!allNotes || allNotes.length < 20) {
        return showToast('📝 Escribí al menos algunos apuntes para guiar el resumen', 'error');
    }

    if (aiSourceFileIds.size === 0) {
        return showToast('📚 Seleccioná al menos una fuente en el panel de Fuentes IA', 'error');
    }

    chat.innerHTML += `<div class="msg-user p-3 shadow-sm text-sm self-end max-w-[85%] rounded-l-xl rounded-tr-xl bg-slate-600 text-white">Resumí mis fuentes basado en mis apuntes (sin IA).</div>`;
    if (typing) typing.classList.remove('hidden');
    chat.scrollTop = chat.scrollHeight;

    // Usar setTimeout para no bloquear la UI
    setTimeout(async () => {
        try {
            // Extraer chunks relevantes del RAG
            const filteredContext = await extractGuidedSources(allNotes, {
                maxChunks: 15,  // AUMENTADO: de 8 a 15
                maxTokens: 2000,  // AUMENTADO: de 1200 a 2000
                minRelevanceScore: 0.15  // REDUCIDO: de 0.25 a 0.15
            });

            if (!filteredContext) {
                chat.innerHTML += `<div class="msg-ai p-4 shadow-sm text-sm self-start max-w-[95%] rounded-r-xl rounded-tl-xl bg-amber-50 border border-amber-200 text-amber-700">⚠️ No se encontraron fragmentos relevantes en las fuentes seleccionadas. Agregá más contenido a tus apuntes o seleccioná otras fuentes.</div>`;
                if (typing) typing.classList.add('hidden');
                chat.scrollTop = chat.scrollHeight;
                return;
            }

            // Parsear los chunks y unirlos con frases conectoras
            const summaryHtml = buildLocalSummary(filteredContext, allNotes);

            // Abrir en pantalla completa (como los PDFs)
            openAIFullscreen(summaryHtml, '📖 Resumen de fuentes (sin IA)');

            showToast('✅ Resumen local generado — Abrí en pantalla completa para editar', 'success');

        } catch (e) {
            console.error('Error resumen local:', e);
            chat.innerHTML += `<div class="msg-ai border-red-200 bg-red-50 text-red-700 p-3 shadow-sm text-sm self-start rounded-xl"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
            showToast('⚠️ Error al generar resumen', 'error');
        } finally {
            if (typing) typing.classList.add('hidden');
            chat.scrollTop = chat.scrollHeight;
        }
    }, 50);
}

function buildLocalSummary(filteredContext, userNotes) {
    // Separar los chunks por fuente
    const chunkRegex = /--- 📌 (.+?) \(pág\. ~(\d+)\) \[score: ([\d.]+)\] ---\n([\s\S]*?)(?=--- 📌|$)/g;
    const chunks = [];
    let match;

    while ((match = chunkRegex.exec(filteredContext)) !== null) {
        chunks.push({
            source: match[1].trim(),
            page: match[2],
            score: parseFloat(match[3]),
            text: match[4].trim()
        });
    }

    if (chunks.length === 0) {
        // Si no se pudieron parsear chunks, devolver el texto crudo formateado
        return `<div class="space-y-2">${filteredContext.split('\n').filter(l => l.trim()).map(l => `<p class="text-slate-700">${l}</p>`).join('')}</div>`;
    }

    // Frases conectoras variadas
    const connectors = [
        'Además, se destaca que',
        'En relación con esto,',
        'Por otra parte,',
        'Asimismo,',
        'En este sentido,',
        'Complementariamente,',
        'También es relevante mencionar que',
        'En consecuencia,',
        'De igual manera,',
        'A su vez,',
        'Como punto adicional,',
        'En este contexto,',
        'Relacionado con lo anterior,',
        'Cabe agregar que',
        'Del mismo modo,'
    ];

    let html = '<div class="space-y-2">';

    // Título
    html += `<h3 class="font-bold text-slate-800 border-b border-slate-200 pb-1 mb-2">📖 Resumen de fuentes</h3>`;
    html += `<p class="text-xs text-slate-400 mb-3">Basado en ${chunks.length} fragmentos relevantes de tus fuentes seleccionadas</p>`;

    // Agrupar por fuente
    const bySource = {};
    for (const chunk of chunks) {
        if (!bySource[chunk.source]) bySource[chunk.source] = [];
        bySource[chunk.source].push(chunk);
    }

    let connectorIdx = 0;
    const sources = Object.keys(bySource);

    for (let si = 0; si < sources.length; si++) {
        const source = sources[si];
        const sourceChunks = bySource[source];

        // Encabezado de fuente
        html += `<h4 class="font-semibold text-indigo-700 text-xs mt-3 mb-1"><i class="fas fa-book mr-1"></i>${source}</h4>`;

        for (let ci = 0; ci < sourceChunks.length; ci++) {
            const chunk = sourceChunks[ci];

            // Conector (no usar en el primer chunk de la primera fuente)
            if (si > 0 || ci > 0) {
                const connector = connectors[connectorIdx % connectors.length];
                connectorIdx++;
                html += `<p class="text-indigo-400 text-xs italic my-1">${connector}</p>`;
            }

            // Texto del chunk con referencia de página
            html += `<p class="text-slate-700 text-sm leading-relaxed">${chunk.text}</p>`;
            html += `<p class="text-[10px] text-slate-400 mb-2">📄 pág. ${chunk.page} · relevancia: ${(chunk.score * 100).toFixed(0)}%</p>`;
        }
    }

    html += '</div>';
    return html;
}

function generateLocalQuiz() {
    const chat = document.getElementById('chat-messages');
    const typing = document.getElementById('typing-indicator');
    const notesEditor = document.getElementById('notes-editor');

    if (!chat || !notesEditor) return;

    const editorNotes = notesEditor.innerText;
    const subjectNotes = getCurrentSubjectNotes();
    const allNotes = (subjectNotes + '\n\n' + editorNotes).trim();

    if (!allNotes || allNotes.length < 80) {
        return showToast('📚 Necesitás al menos 80 caracteres de apuntes para generar preguntas', 'error');
    }

    chat.innerHTML += `<div class="msg-user p-3 shadow-sm text-sm self-end max-w-[85%] rounded-l-xl rounded-tr-xl bg-slate-600 text-white">Creame un quiz basado en mis apuntes (sin IA).</div>`;
    if (typing) typing.classList.remove('hidden');
    chat.scrollTop = chat.scrollHeight;

    setTimeout(() => {
        try {
            const quizHtml = buildLocalQuiz(allNotes);
            openAIFullscreen(quizHtml, '❓ Quiz de Autoevaluación (sin IA)');
            showToast('✅ Quiz local generado — Respondé las preguntas en pantalla completa', 'success');
        } catch (e) {
            console.error('Error quiz local:', e);
            chat.innerHTML += `<div class="msg-ai border-red-200 bg-red-50 text-red-700 p-3 shadow-sm text-sm self-start rounded-xl"><i class="fas fa-exclamation-triangle"></i> ${e.message}</div>`;
            showToast('⚠️ Error al generar quiz', 'error');
        } finally {
            if (typing) typing.classList.add('hidden');
            chat.scrollTop = chat.scrollHeight;
        }
    }, 50);
}

function buildLocalQuiz(text) {
    // Extraer oraciones significativas
    const sentences = text
        .split(/[.\n]+/)
        .map(s => s.trim())
        .filter(s => s.length > 20 && s.length < 200);

    if (sentences.length < 3) {
        return '<p class="text-amber-600">⚠️ No hay suficientes oraciones para generar preguntas. Escribí más apuntes.</p>';
    }

    // Extraer conceptos clave
    const concepts = extractKeyConceptsFromNotes(text, 10);

    let html = '<div class="space-y-3">';
    html += `<h3 class="font-bold text-slate-800 border-b border-slate-200 pb-1 mb-2">❓ Quiz de Autoevaluación</h3>`;
    html += `<p class="text-xs text-slate-400 mb-2">Generado a partir de tus apuntes · ${concepts.length} conceptos clave detectados</p>`;

    // Generar preguntas tipo "definí" o "explicá"
    const numQuestions = Math.min(5, sentences.length);
    const usedIndices = new Set();

    for (let i = 0; i < numQuestions; i++) {
        // Elegir oración no usada
        let idx;
        do { idx = Math.floor(Math.random() * sentences.length); } while (usedIndices.has(idx));
        usedIndices.add(idx);

        const sentence = sentences[idx];

        // Encontrar concepto clave en la oración
        let keyConcept = null;
        for (const concept of concepts) {
            if (sentence.toLowerCase().includes(concept)) {
                keyConcept = concept;
                break;
            }
        }

        // Tipo de pregunta
        const qTypes = ['defini', 'explicá', 'describí', 'mencioná'];
        const qType = qTypes[i % qTypes.length];

        if (keyConcept) {
            html += `<div class="bg-white rounded p-3 border border-slate-200">`;
            html += `<p class="font-medium text-slate-700 text-sm">${i + 1}. ${qType.charAt(0).toUpperCase() + qType.slice(1)}: <strong>${keyConcept}</strong></p>`;
            html += `<details class="mt-2"><summary class="text-xs text-indigo-500 cursor-pointer">Ver pista</summary><p class="text-xs text-slate-500 mt-1 italic">${sentence}</p></details>`;
            html += `</div>`;
        } else {
            html += `<div class="bg-white rounded p-3 border border-slate-200">`;
            html += `<p class="font-medium text-slate-700 text-sm">${i + 1}. ${qType.charAt(0).toUpperCase() + qType.slice(1)} el siguiente concepto:</p>`;
            html += `<p class="text-sm text-slate-600 mt-1 italic">"${sentence}"</p>`;
            html += `<p class="text-[10px] text-slate-400 mt-1">→ ¿De qué tema se trata?</p>`;
            html += `</div>`;
        }
    }

    html += '</div>';
    return html;
}

let aiFullscreenContent = '';

function openAIFullscreen(html, title) {
    const fs = document.getElementById('ai-fullscreen');
    const content = document.getElementById('ai-fullscreen-content');
    const titleEl = document.getElementById('ai-fullscreen-title');
    const timeEl = document.getElementById('ai-fullscreen-time');

    aiFullscreenContent = html;
    content.innerHTML = html;
    titleEl.textContent = title;
    timeEl.textContent = `Generado: ${new Date().toLocaleTimeString()}`;

    fs.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeAIFullscreen() {
    document.getElementById('ai-fullscreen').classList.add('hidden');
    document.body.style.overflow = '';
}

function toggleEditAIResult() {
    const content = document.getElementById('ai-fullscreen-content');
    const isEditable = content.contentEditable === 'true';
    content.contentEditable = !isEditable;
    content.classList.toggle('bg-yellow-50', !isEditable);

    const btn = document.getElementById('ai-edit-btn');
    btn.innerHTML = isEditable
        ? '<i class="fas fa-edit"></i> Editar'
        : '<i class="fas fa-lock"></i> Solo lectura';
    btn.classList.toggle('bg-green-600', !isEditable);
    btn.classList.toggle('bg-slate-600', isEditable);
}

function downloadAIResult() {
    const content = document.getElementById('ai-fullscreen-content');
    const title = document.getElementById('ai-fullscreen-title').textContent || 'Documento';

    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>${title}</title><style>body{font-family:Arial,sans-serif;line-height:1.6;color:#333;padding:20px}h3{color:#4F46E5;border-bottom:1px solid #E2E8F0;padding-bottom:4px;margin-top:16px}h4{color:#4338CA;margin-top:12px;margin-bottom:4px}strong{color:#1E293B}details{background:#F8FAFC;padding:8px;border-radius:6px;margin-top:6px}summary{color:#6366F1;cursor:pointer;font-size:.85em}.bg-white{background:#fff;border:1px solid #E2E8F0;border-radius:8px;padding:12px;margin:8px 0}</style></head><body>`;
    const footer = '</body></html>';
    const sourceHTML = header + content.innerHTML + footer;

    const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);

    const fileDownload = document.createElement('a');
    fileDownload.href = url;
    const fileName = `${title.replace(/[^a-zA-Z0-9áéíóúñÁÉÍÓÚÑ ]/g, '').trim() || 'Documento'}_${new Date().toISOString().slice(0, 10)}`;
    fileDownload.download = `${fileName}.doc`;
    document.body.appendChild(fileDownload);
    fileDownload.click();
    document.body.removeChild(fileDownload);
    URL.revokeObjectURL(url);

    showToast('📄 Documento descargado exitosamente', 'success');
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const fs = document.getElementById('ai-fullscreen');
        if (fs && !fs.classList.contains('hidden')) {
            closeAIFullscreen();
        }
    }
});