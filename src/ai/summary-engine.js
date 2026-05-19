// MOTOR DE RESÚMENES HÍBRIDO
// ==========================================
class SummaryEngine {
    constructor() {
        this.tfidf = new FastTFIDF();
        this.vectors = new LightweightVectors();
        this.history = new SummaryHistory();
    }
    
    generateSummary(text, userNotes, mode = 'PRECISE') {
        const notesPlain = stripHtmlTags(userNotes).trim();
        const notesLength = notesPlain.length;

        const cleanedText = this.tfidf.cleanText(text);
        const translatedText = translateToSpanish(cleanedText);
        const translatedNotes = translateToSpanish(notesPlain);

        const paragraphObjs = this.tfidf.splitParagraphs(translatedText);
        if (paragraphObjs.length === 0) {
            return 'No se encontró texto suficiente en el PDF para armar un resumen.';
        }

        const adaptiveParagraphs = Math.max(2, Math.min(12, 1 + Math.floor(notesLength / 420)));

        const userKeywords = this.extractKeywordsFromNotes(translatedNotes);

        const tfidfScores = this.tfidf.scoreParagraphs(paragraphObjs, translatedNotes);
        const vectorScores = this.vectors.scoreParagraphs(paragraphObjs, translatedNotes);

        const weights = { tfidf: 0.72, vector: 0.28 };
        const combinedScores = this.combineScores(tfidfScores, vectorScores, weights, userKeywords);

        const minOverlap = notesLength > 500 ? 2 : 1;
        const poolSize = Math.min(combinedScores.length, adaptiveParagraphs + 10);
        const candidatePool = combinedScores.slice(0, poolSize);

        // SOLO incluir párrafos que tengan coincidencia fuerte y real con los apuntes del usuario
        let selected = candidatePool.filter(
            p => (p.noteTokenMatches >= minOverlap + 1) || (p.userBonus >= 3.0) || (p.vectorScore > 0.4)
        );
        
        // Si somos muy estrictos, relajamos un poco pero EXIGIENDO al menos 2 coincidencias claras
        // Esto evita que párrafos como la dedicatoria del libro se incluyan por tener 1 sola palabra en común ("diagnóstico")
        if (selected.length < 2) {
            selected = candidatePool.filter(p => p.noteTokenMatches >= 2 || (p.noteTokenMatches >= 1 && p.vectorScore > 0.25));
        }
        
        // Si no hay ninguna coincidencia real, retornamos un mensaje en vez de rellenar con basura
        if (selected.length === 0) {
            return 'No se encontraron párrafos completos en el documento que coincidan directamente con tus apuntes. Asegúrate de que tus notas traten sobre los temas del PDF principal.';
        }

        selected = selected.slice(0, adaptiveParagraphs).sort((a, b) => a.index - b.index);

        const summary = this.buildCleanSummary(selected);

        console.log('📊 Resumen local (párrafos):');
        console.log('   Apuntes (chars):', notesLength);
        console.log('   Párrafos candidatos en PDF:', paragraphObjs.length);
        console.log('   Párrafos incluidos:', selected.length);

        this.history.add({
            title: `Resumen ${new Date().toLocaleDateString()}`,
            content: summary,
            mode: mode,
            date: new Date().toISOString(),
            processingTime: Date.now()
        });

        return summary;
    }
    
    combineScores(tfidfScores, vectorScores, weights, userKeywords) {
        const combined = [];

        // Generar raíces (primeros 5 caracteres) para tolerancia a errores ortográficos e inflexiones
        const fuzzyKeywords = userKeywords.map(k => {
            const isBigram = k.includes(' ');
            return {
                full: k.toLowerCase(),
                stem: isBigram ? k.toLowerCase() : (k.length >= 6 ? k.substring(0, 5).toLowerCase() : k.toLowerCase()),
                weight: isBigram ? 25.0 : (k.length >= 7 ? 6.0 : 1.5) // Bigramas y palabras largas dominan el puntaje
            };
        });

        for (const tfidf of tfidfScores) {
            const vector = vectorScores.find(v => v.index === tfidf.index) || { score: 0 };

            let userMatchBonus = 0;
            const lowerSentence = tfidf.text.toLowerCase();
            let matchedHeavyTokens = 0;

            for (const kw of fuzzyKeywords) {
                if (lowerSentence.includes(kw.stem)) {
                    userMatchBonus += kw.weight;
                    if (kw.weight >= 6.0) matchedHeavyTokens++;
                }
            }

            // Multiplicador si el párrafo coincide con las palabras clave más fuertes
            const multiplier = matchedHeavyTokens > 0 ? (1 + (matchedHeavyTokens * 0.5)) : 1;

            combined.push({
                index: tfidf.index,
                text: tfidf.text,
                score: ((tfidf.score * weights.tfidf) + (vector.score * weights.vector) + userMatchBonus) * multiplier,
                tfidfScore: tfidf.score,
                vectorScore: vector.score,
                userBonus: userMatchBonus,
                noteTokenMatches: (tfidf.matchCount || 0) + matchedHeavyTokens
            });
        }

        return combined.sort((a, b) => b.score - a.score);
    }

    extractKeywordsFromNotes(notes) {
        const plain = stripHtmlTags(notes);
        const tokens = tokenize(plain);
        const stopwords = stopwordsES();
        const keywords = tokens.filter(w => !stopwords.has(w) && w.length > 3);
        
        // Agregar bigramas para atrapar conceptos compuestos ("giardia lamblia")
        for (let i = 0; i < tokens.length - 1; i++) {
            if (!stopwords.has(tokens[i]) && !stopwords.has(tokens[i+1]) && tokens[i].length > 3) {
                keywords.push(tokens[i] + ' ' + tokens[i+1]);
            }
        }

        return [...new Set(keywords)].slice(0, 50);
    }

    buildCleanSummary(items) {
        if (!items || items.length === 0) return '';
        const sorted = [...items].sort((a, b) => a.index - b.index);
        return sorted.map(s => `🔹 ${s.text.trim()}`).join('\n\n').trim();
    }
    
}

// ==========================================
// HISTORIAL FIFO DE RESÚMENES
// ==========================================
class SummaryHistory {
    constructor() {
        this.storageKey = 'local_summary_history';
        this.maxItems = SUMMARY_CONFIG.maxHistoryItems;
        this.items = this.load();
    }
    
    add(item) {
        this.items.unshift(item);
        
        if (this.items.length > this.maxItems) {
            this.items = this.items.slice(0, this.maxItems);
        }
        
        this.save();
    }
    
    load() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            return [];
        }
    }
    
    save() {
        localStorage.setItem(this.storageKey, JSON.stringify(this.items));
    }
    
    get() {
        return this.items;
    }
}

// ==========================================
// IA PARA REORDENAR Y HACER LEGIBLE EL RESUMEN
// ==========================================
async function callAIForSummary(extractedText, userNotes) {
    // Usamos nuestra API de Vercel (protege la API Key)
    const API_URL = `/api/gemini?path=models/gemini-2.0-flash:generateContent`;
    
    const prompt = `Eres un asistente médico experto en crear resúmenes de estudio.

Tengo estos APUNTES PERSONALES que escribí de clase:
---
${userNotes}
---

Y este es el TEXTO EXTRAÍDO de un libro de medicina:
---
${extractedText}
---

Por favor, CREÁ UN RESUMEN DE ESTUDIO que:
1. Use MIS APUNTES como estructura principal
2. Complete la información con el texto del libro
3. Sea claro, legible y bien organizado
4. Use lenguaje médico pero comprensible
5. Incluya los conceptos clave que menciono en mis apuntes
6. NO incluyas números de página, figuras, ni referencias bibliográficas

El resumen debe estar en español y ser útil para estudiar.`;

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.3,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 4096,
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Error API: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.candidates && data.candidates[0] && data.candidates[0].content) {
            return {
                success: true,
                text: data.candidates[0].content.parts[0].text
            };
        } else {
            throw new Error('Respuesta inválida de la API');
        }
    } catch (error) {
        console.error('Error calling AI:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// ==========================================
// EXPORTACIÓN A GOOGLE DOCS
// ==========================================
async function exportToGoogleDocs(summary, title) {
    try {
        const blob = new Blob([summary], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `${title || 'resumen'}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('Resumen descargado correctamente', 'success');
        return { success: true };
    } catch (error) {
        showToast('Error al exportar el resumen', 'error');
        return { success: false, error: error.message };
    }
}

// ==========================================