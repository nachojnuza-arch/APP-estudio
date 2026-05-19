// TF-IDF OPTIMIZADO PARA MÉDICINA
// ==========================================
class FastTFIDF {
    constructor() {
        this.stopwords = stopwordsES();
    }
    
    calculateTermFrequency(tokens) {
        const tf = {};
        const total = tokens.length;
        
        for (const token of tokens) {
            if (this.stopwords.has(token)) continue;
            tf[token] = (tf[token] || 0) + 1;
        }
        
        for (const token in tf) {
            tf[token] /= total;
        }
        
        return tf;
    }
    
    calculateIDF(documents) {
        const idf = {};
        const totalDocs = documents.length;
        
        for (const doc of documents) {
            const tokens = new Set(tokenize(doc));
            
            for (const token of tokens) {
                if (this.stopwords.has(token)) continue;
                idf[token] = (idf[token] || 0) + 1;
            }
        }
        
        for (const token in idf) {
            idf[token] = Math.log(totalDocs / (idf[token] + 1));
        }
        
        return idf;
    }
    
    scoreSentences(text, userNotes) {
        const sentences = this.splitSentences(text);
        const idf = this.calculateIDF(sentences.concat([userNotes]));
        const userTokens = new Set(tokenize(userNotes));
        
        const scores = [];
        
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const tokens = tokenize(sentence);
            const tf = this.calculateTermFrequency(tokens);
            
            let score = 0;
            let matchCount = 0;
            
            for (const token in tf) {
                if (userTokens.has(token)) {
                    score += tf[token] * (idf[token] || 1) * 3;
                    matchCount++;
                } else {
                    score += tf[token] * (idf[token] || 1);
                }
            }
            
            for (const [term, synonyms] of Object.entries(MEDICAL_DICTIONARY.synonyms)) {
                if (userTokens.has(term)) {
                    for (const syn of synonyms) {
                        if (tokens.includes(syn)) {
                            score += 2;
                            matchCount++;
                        }
                    }
                }
            }
            
            const lengthPenalty = Math.min(sentence.length / 200, 1.5);
            score *= lengthPenalty;
            
            scores.push({
                index: i,
                text: sentence,
                score: score,
                matchCount: matchCount
            });
        }
        
        return scores.sort((a, b) => b.score - a.score);
    }
    
    splitSentences(text) {
        // ✅ DIVIDIR POR ORACIONES conservando la puntuación (usamos match)
        const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];

        return sentences
            .map(p => p.replace(/\s+/g, ' ').trim())
            .filter(p => p.length > 30 && p.length < 3000); // Oraciones válidas
    }

    /**
     * Párrafos lógicos del PDF: bloques separados por línea en blanco o, si el texto es denso,
     * ventanas de varias oraciones para mantener contexto alineable con tus apuntes.
     */
    splitParagraphs(text) {
        const normalized = text.replace(/\s+/g, ' ').trim();
        let blocks = text.split(/\n\s*\n+/).map(p => p.replace(/\s+/g, ' ').trim())
            .filter(p => {
                if (p.length < 60 || p.length > 20000) return false;
                
                // Excluir glosarios, índices, tablas de contenido, bibliografía, dedicatorias
                const glossaryPatterns = /(?:ABREVIATURAS|GLOSARIO|SIGLAS|CUADRO|TABLA|REFERENCIAS|BIBLIOGRAFÍA|ÍNDICE|APÉNDICE|CONTENIDO|ÍNDICE TEMÁTICO|DEDICATORIA|AGRADECIMIENTO)/i;
                if (glossaryPatterns.test(p)) return false;

                // 🆕 NUEVO: Excluir párrafos que parecen captions de figuras/tablas enteras
                if (/^(?:Fig\.|Figura|Tabla|Cuadro|Gráfico)\s*\d+[\.\-:]/i.test(p)) return false;

                // 🆕 NUEVO: Excluir tablas rotas o llenas de números y códigos (ej. "3.5  12.1  A+  5")
                const numbersMatch = p.match(/\d+/g);
                if (numbersMatch && numbersMatch.length > 10 && p.length < 300) return false;

                // Excluir referencias bibliográficas sueltas
                if (p.includes('doi: 10.') || /(?:et al\.,?\s*\d{4}|Curr Opin|J Microbiol)/i.test(p)) return false;

                // Excluir dedicatorias o textos introductorios típicos
                const introPatterns = /(?:dedicamos a|nuestras familias|nuestros alumnos|agradecemos|este libro es producto|este libro se lo dedicamos|práctica docente)/i;
                if (introPatterns.test(p)) return false;

                // Excluir líneas de índice típicas (ej. "Tema ...... 12" o "Tema ______ 12")
                const indexLines = (p.match(/(\.{3,}|_{3,})\s*\d+/g) || []).length;
                if (indexLines > 2) return false;

                // Excluir si no tiene oraciones desarrolladas
                const sentenceCount = (p.match(/[.!?]+/g) || []).length;
                if (sentenceCount < 2) return false; // Un párrafo completo suele tener al menos 2 oraciones
                
                return true;
            });
            
        if (blocks.length < 3) {
            // Fallback si no hay suficientes saltos de párrafo claros
            const sentences = this.splitSentences(text);
            blocks = [];
            const step = 4;
            for (let i = 0; i < sentences.length; i += step) {
                const chunk = sentences.slice(i, i + step).join(' ');
                if (chunk.length >= 80) {
                    blocks.push(chunk);
                }
            }
        }
        if (blocks.length === 0 && normalized.length >= 100) {
            blocks = [normalized];
        }
        return blocks.map((t, index) => ({ index, text: t }));
    }

    /** TF-IDF por párrafo (misma lógica que oraciones, sin favorecer bloques enormes irrelevantes). */
    scoreParagraphs(paragraphObjs, userNotes) {
        const texts = paragraphObjs.map(o => o.text);
        const idf = this.calculateIDF(texts.concat([userNotes]));
        const userTokens = new Set(tokenize(userNotes));
        const scores = [];

        for (let i = 0; i < paragraphObjs.length; i++) {
            const paragraph = paragraphObjs[i].text;
            const tokens = tokenize(paragraph);
            const tf = this.calculateTermFrequency(tokens);

            let score = 0;
            let matchCount = 0;

            for (const token in tf) {
                if (userTokens.has(token)) {
                    // Usar logaritmo para la frecuencia y sumar 1 asegura que la mera presencia de la palabra sume mucho, 
                    // sin importar cuán largo sea el párrafo.
                    const tokenScore = (1 + Math.log(tokens.length * tf[token] + 1)) * (idf[token] || 1);
                    score += tokenScore * 5;
                    matchCount++;
                } else {
                    score += tf[token] * (idf[token] || 1) * 0.1;
                }
            }

            for (const [term, synonyms] of Object.entries(MEDICAL_DICTIONARY.synonyms)) {
                if (userTokens.has(term)) {
                    for (const syn of synonyms) {
                        if (tokens.includes(syn)) {
                            score += 3;
                            matchCount++;
                        }
                    }
                }
            }

            // Penalización por longitud MUY suave, solo para evitar que un capítulo entero gane siempre
            score /= Math.log(tokens.length + 10);

            scores.push({
                index: paragraphObjs[i].index,
                text: paragraph,
                score,
                matchCount
            });
        }

        return scores.sort((a, b) => b.score - a.score);
    }
    
    cleanText(text) {
        // ✅ ELIMINAR BASURA: guiones de salto de línea, números de página, figuras, etc.
        let cleaned = text
            // Eliminar guiones de división de palabras al final de línea
            .replace(/(\w+)-\s*\n\s*(\w+)/g, '$1$2')
            // Eliminar números de página (ej: "350 CAPÍTULO 11")
            .replace(/^\d+\s+(CAPÍTULO|FIGURA|TABLA)\s*\d*/gm, '')
            // Eliminar referencias a figuras y tablas intralínea
            .replace(/FIGURA\s*\d+[-\d]*.*$/gm, '')
            .replace(/TABLA\s*\d+.*$/gm, '')
            // 🆕 NUEVO: Filtros agresivos para captions y pies de página
            .replace(/^(?:Fig\.|Figura|Tabla|Cuadro|Gráfico|Ilustración)\s*\d+[\.\-:].*$/gmi, '')
            .replace(/^(?:Fuente|Source):\s*.*$/gmi, '')
            // Eliminar líneas que son solo números o códigos con guiones
            .replace(/^\s*[\d\.\-\*\,]+\s*$/gm, '')
            // Eliminar líneas de índice con puntos o guiones bajos (ej. "Tema _____ 12")
            .replace(/^.*?(?:\.{3,}|_{3,})\s*\d+.*$/gm, '')
            // Eliminar un solo salto de línea (unir líneas dentro del mismo párrafo), preservando los dobles
            .replace(/([^\n])\n([^\n])/g, '$1 $2')
            // Eliminar múltiples espacios (solo espacios y tabs, para preservar los saltos de línea vitales)
            .replace(/[ \t]{2,}/g, ' ')
            // Eliminar paréntesis vacíos o con poco contenido (como citas rotas)
            .replace(/\([^)]{0,4}\)/g, '')
            .trim();
        
        return cleaned;
    }
}

// ==========================================
// VECTORES SEMÁNTICOS LIGEROS (100D)
// ==========================================
class LightweightVectors {
    constructor() {
        this.dimensions = SUMMARY_CONFIG.vectorDimensions;
        this.vectors = this.loadMedicalVectors();
    }
    
    loadMedicalVectors() {
        const vectors = {};
        const medicalTerms = Object.keys(MEDICAL_DICTIONARY.translations)
            .concat(Object.keys(MEDICAL_DICTIONARY.synonyms));
        
        for (const term of medicalTerms) {
            vectors[term] = this.generateVector(term);
        }
        
        return vectors;
    }
    
    generateVector(term) {
        const vector = new Array(this.dimensions).fill(0);
        let hash = 0;
        
        for (let i = 0; i < term.length; i++) {
            hash = ((hash << 5) - hash) + term.charCodeAt(i);
            hash |= 0;
        }
        
        for (let i = 0; i < this.dimensions; i++) {
            const seed = hash * (i + 1);
            vector[i] = Math.sin(seed) * Math.cos(seed * 0.5);
        }
        
        return this.normalize(vector);
    }
    
    normalize(vector) {
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        return vector.map(v => v / magnitude);
    }
    
    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        for (let i = 0; i < this.dimensions; i++) {
            dotProduct += vecA[i] * vecB[i];
        }
        return dotProduct;
    }
    
    sentenceVector(sentence) {
        const tokens = tokenize(sentence);
        const vector = new Array(this.dimensions).fill(0);
        let count = 0;
        
        for (const token of tokens) {
            if (this.vectors[token]) {
                for (let i = 0; i < this.dimensions; i++) {
                    vector[i] += this.vectors[token][i];
                }
                count++;
            }
        }
        
        if (count === 0) return null;
        
        return this.normalize(vector.map(v => v / count));
    }
    
    scoreSentences(text, userNotes) {
        const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 30);
        const userVector = this.sentenceVector(userNotes);
        
        if (!userVector) {
            return sentences.map((s, i) => ({ index: i, text: s, score: 1 }));
        }
        
        const scores = [];
        
        for (let i = 0; i < sentences.length; i++) {
            const sentence = sentences[i];
            const sentVector = this.sentenceVector(sentence);
            
            let score = 0;
            if (sentVector) {
                score = this.cosineSimilarity(userVector, sentVector);
            }
            
            scores.push({
                index: i,
                text: sentence,
                score: Math.max(score, 0.1)
            });
        }
        
        return scores.sort((a, b) => b.score - a.score);
    }

    /** Misma unidad (párrafo) que TF-IDF para que los índices coincidan. */
    scoreParagraphs(paragraphObjs, userNotes) {
        const userVector = this.sentenceVector(userNotes);
        if (!userVector) {
            return paragraphObjs.map(o => ({ index: o.index, text: o.text, score: 0.5 }));
        }

        const scores = [];
        for (const p of paragraphObjs) {
            const sentVector = this.sentenceVector(p.text);
            let score = 0.06;
            if (sentVector) {
                score = Math.max(this.cosineSimilarity(userVector, sentVector), 0.06);
            }
            scores.push({
                index: p.index,
                text: p.text,
                score
            });
        }

        return scores.sort((a, b) => b.score - a.score);
    }
}

// ==========================================