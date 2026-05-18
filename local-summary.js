/**
 * Sistema de Resúmenes Locales sin IA
 * Basado en TF-IDF + Vectores Semánticos (100 dimensiones)
 * Optimizado para Intel i5 2da generación sin GPU dedicada
 * 
 * Maneja:
 * - Vocabulario médico y bioquímico
 * - Traducción inglés → español
 * - Modos Rápido/Preciso
 * - Historial FIFO de 3 resúmenes
 * - Exportación a Google Docs
 */

const LOCAL_SUMMARY_VERSION = '1.1.0';

// ==========================================
// CONFIGURACIÓN GLOBAL
// ==========================================
const SUMMARY_CONFIG = {
    maxHistoryItems: 3,
    maxProcessingTime: {
        FAST: 120,   // 2 minutos
        PRECISE: 300 // 5 minutos
    },
    vectorDimensions: 100,
    maxSentences: {
        FAST: 15,
        PRECISE: 25
    },
    weights: {
        FAST: { tfidf: 0.8, vector: 0.2 },
        PRECISE: { tfidf: 0.5, vector: 0.5 }
    }
};

// ==========================================
// DICCIONARIO MÉDICO ESPECIALIZADO
// ==========================================
const MEDICAL_DICTIONARY = {
    synonyms: {
        'cardíaco': ['cardiovascular', 'cardiológico', 'del corazón'],
        'presión': ['tensión arterial', 'hipertensión', 'tensión'],
        'azúcar': ['glucosa', 'carbohidrato', 'endulzante'],
        'corazón': ['miocardio', 'órgano cardíaco', 'ventrículo'],
        'sangre': ['plasma', 'sangre arterial', 'sangre venosa'],
        'cerebro': ['encéfalo', 'cerebral', 'sistema nervioso central'],
        'hígado': ['hepático', 'órgano hepático', 'parénquima hepático'],
        'riñón': ['renal', 'nefronas', 'sistema renal'],
        'glucosa': ['azúcar en sangre', 'glucemia', 'dextrosa'],
        'insulina': ['hormona pancreática', 'hormona glucémica'],
        'colesterol': ['lípidos', 'grasas sanguíneas', 'perfil lipídico'],
        'presión arterial': ['tensión arterial', 'TA', 'PA'],
        'frecuencia cardíaca': ['pulso', 'FC', 'latidos por minuto'],
        'respiración': ['ventilación', 'frecuencia respiratoria', 'FR'],
        'temperatura': ['fiebre', 'hipotermia', 'temperatura corporal'],
        'oxígeno': ['saturación de oxígeno', 'SpO2', 'oxigenación'],
        'diabetes': ['diabetes mellitus', 'DM', 'glucemia alterada'],
        'hipertensión': ['HTA', 'presión alta', 'hipertenso'],
        'infarto': ['infarto de miocardio', 'ataque cardíaco', 'IAM'],
        'ictus': ['accidente cerebrovascular', 'ACV', 'derrame cerebral'],
        'cáncer': ['neoplasia', 'tumor', 'carcinoma']
    },

    translations: {
        'heart': 'corazón',
        'blood': 'sangre',
        'pressure': 'presión',
        'diabetes': 'diabetes',
        'cancer': 'cáncer',
        'brain': 'cerebro',
        'liver': 'hígado',
        'kidney': 'riñón',
        'glucose': 'glucosa',
        'insulin': 'insulina',
        'cholesterol': 'colesterol',
        'blood pressure': 'presión arterial',
        'heart rate': 'frecuencia cardíaca',
        'respiration': 'respiración',
        'temperature': 'temperatura',
        'oxygen': 'oxígeno',
        'hypertension': 'hipertensión',
        'infarction': 'infarto',
        'stroke': 'ictus',
        'tumor': 'tumor',
        'enzyme': 'enzima',
        'protein': 'proteína',
        'DNA': 'ADN',
        'RNA': 'ARN',
        'metabolism': 'metabolismo',
        'hormone': 'hormona',
        'cell': 'célula',
        'tissue': 'tejido',
        'organ': 'órgano',
        'system': 'sistema',
        'disease': 'enfermedad',
        'treatment': 'tratamiento',
        'diagnosis': 'diagnóstico',
        'symptom': 'síntoma',
        'sign': 'signo',
        'patient': 'paciente',
        'clinical': 'clínico',
        'laboratory': 'laboratorio',
        'analysis': 'análisis',
        'result': 'resultado',
        'value': 'valor',
        'normal': 'normal',
        'abnormal': 'anormal',
        'high': 'alto',
        'low': 'bajo',
        'increase': 'aumento',
        'decrease': 'disminución',
        'level': 'nivel',
        'concentration': 'concentración',
        'dose': 'dosis',
        'drug': 'medicamento',
        'medication': 'medicación',
        'therapy': 'terapia',
        'surgery': 'cirugía',
        'prognosis': 'pronóstico',
        'recovery': 'recuperación',
        'acute': 'agudo',
        'chronic': 'crónico',
        'benign': 'benigno',
        'malignant': 'maligno',
        'primary': 'primario',
        'secondary': 'secundario',
        'complication': 'complicación',
        'risk': 'riesgo',
        'factor': 'factor',
        'prevention': 'prevención',
        'screening': 'tamizaje',
        'test': 'prueba',
        'exam': 'examen',
        'imaging': 'imágenes',
        'ultrasound': 'ecografía',
        'CT': 'tomografía computada',
        'MRI': 'resonancia magnética',
        'X-ray': 'radiografía',
        'ECG': 'electrocardiograma',
        'EEG': 'electroencefalograma',
        'blood test': 'análisis de sangre',
        'urine test': 'análisis de orina',
        'biopsy': 'biopsia',
        'culture': 'cultivo',
        'antibiotic': 'antibiótico',
        'antiviral': 'antiviral',
        'anti-inflammatory': 'antiinflamatorio',
        'analgesic': 'analgésico',
        'vaccine': 'vacuna',
        'immunization': 'inmunización',
        'infection': 'infección',
        'virus': 'virus',
        'bacteria': 'bacteria',
        'fungus': 'hongo',
        'parasite': 'parásito',
        'immune': 'inmune',
        'antibody': 'anticuerpo',
        'antigen': 'antígeno',
        'allergy': 'alergia',
        'inflammation': 'inflamación',
        'edema': 'edema',
        'pain': 'dolor',
        'fever': 'fiebre',
        'cough': 'tos',
        'dyspnea': 'disnea',
        'fatigue': 'fatiga',
        'weakness': 'debilidad',
        'nausea': 'náuseas',
        'vomiting': 'vómitos',
        'diarrhea': 'diarrea',
        'constipation': 'estreñimiento',
        'headache': 'dolor de cabeza',
        'dizziness': 'mareo',
        'confusion': 'confusión',
        'seizure': 'convulsión',
        'coma': 'coma',
        'shock': 'shock',
        'hypotension': 'hipotensión',
        'hypertension': 'hipertensión',
        'tachycardia': 'taquicardia',
        'bradycardia': 'bradicardia',
        'arrhythmia': 'arritmia',
        'heart failure': 'insuficiencia cardíaca',
        'myocardial infarction': 'infarto de miocardio',
        'angina': 'angina de pecho',
        'atherosclerosis': 'aterosclerosis',
        'stroke': 'ictus',
        'transient ischemic attack': 'ataque isquémico transitorio',
        'dementia': 'demencia',
        'alzheimer': 'alzheimer',
        'parkinson': 'parkinson',
        'epilepsy': 'epilepsia',
        'migraine': 'migraña',
        'asthma': 'asma',
        'COPD': 'EPOC',
        'pneumonia': 'neumonía',
        'bronchitis': 'bronquitis',
        'tuberculosis': 'tuberculosis',
        'peptic ulcer': 'úlcera péptica',
        'gastritis': 'gastritis',
        'hepatitis': 'hepatitis',
        'cirrhosis': 'cirrosis',
        'pancreatitis': 'pancreatitis',
        'cholecystitis': 'colecistitis',
        'nephritis': 'nefritis',
        'renal failure': 'insuficiencia renal',
        'urinary tract infection': 'infección urinaria',
        'arthritis': 'artritis',
        'osteoarthritis': 'osteoartritis',
        'rheumatoid arthritis': 'artritis reumatoide',
        'gout': 'gota',
        'osteoporosis': 'osteoporosis',
        'diabetes mellitus': 'diabetes mellitus',
        'thyroid': 'tiroides',
        'hyperthyroidism': 'hipertiroidismo',
        'hypothyroidism': 'hipotiroidismo',
        'anemia': 'anemia',
        'leukemia': 'leucemia',
        'lymphoma': 'linfoma',
        'HIV': 'VIH',
        'AIDS': 'SIDA',
        'pregnancy': 'embarazo',
        'delivery': 'parto',
        'birth': 'nacimiento',
        'child': 'niño',
        'adult': 'adulto',
        'elderly': 'anciano',
        'male': 'masculino',
        'female': 'femenino',
        'age': 'edad',
        'weight': 'peso',
        'height': 'altura',
        'BMI': 'IMC',
        'body mass index': 'índice de masa corporal'
    }
};

// ==========================================
// UTILIDADES BÁSICAS
// ==========================================
function tokenize(text) {
    return text.toLowerCase()
        .replace(/[^\wáéíóúüñ\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 2);
}

/** Apuntes a veces llegan con HTML residual; normalizamos a texto para coincidencias. */
function stripHtmlTags(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const tmp = raw.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    return tmp.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function stopwordsES() {
    return new Set([
        'el','la','los','las','un','una','de','del','al','en','con','por','para','que','y','o',
        'pero','si','no','es','son','ser','estar','esta','esto','como','mas','muy','tan','tanto',
        'tambien','aqui','alli','donde','cuando','quien','este','esta','estos','estas','ese','esa',
        'me','te','se','nos','os','les','mi','mis','tu','tus','su','sus','lo','la','le','hay',
        'tiene','tener','hacer','ir','venir','dar','ver','poder','deber','querer','saber','llegar',
        'pasar','quedar','poner','parecer','decir','hablar','mirar','seguir','encontrar','llamar',
        'volver','creer','buscar','vivir','sentir','esperar','comenzar','terminar','entrar','salir'
    ]);
}

// ==========================================
// DETECCIÓN DE IDIOMA
// ==========================================
function detectLanguage(text) {
    const spanishKeywords = ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'a', 'un', 'por', 'con', 'para', 'se', 'lo'];
    const englishKeywords = ['the', 'of', 'and', 'to', 'a', 'in', 'is', 'it', 'you', 'that', 'for', 'on', 'are', 'with', 'as'];
    
    let spanishCount = 0;
    let englishCount = 0;
    
    const words = text.toLowerCase().split(/\s+/);
    
    for (const word of words) {
        if (spanishKeywords.includes(word)) spanishCount++;
        if (englishKeywords.includes(word)) englishCount++;
    }
    
    return spanishCount > englishCount ? 'es' : 'en';
}

// ==========================================
// TRADUCCIÓN MÉDICA INGLÉS → ESPAÑOL
// ==========================================
function translateToSpanish(text) {
    const lang = detectLanguage(text);
    
    if (lang === 'es') {
        return text;
    }
    
    let translated = text;
    const translations = MEDICAL_DICTIONARY.translations;
    
    const sortedKeys = Object.keys(translations).sort((a, b) => b.length - a.length);
    
    for (const eng of sortedKeys) {
        const esp = translations[eng];
        const regex = new RegExp(`\\b${eng}\\b`, 'gi');
        translated = translated.replace(regex, esp);
    }
    
    return translated;
}

// ==========================================
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
        // ✅ DIVIDIR POR ORACIONES (separados por puntuación o saltos de línea grandes)
        const sentences = text.split(/[.!?]+|\n\s*\n/);

        return sentences
            .map(p => p.trim())
            .filter(p => p.length > 40 && p.length < 3000); // Oraciones válidas
    }

    /**
     * Párrafos lógicos del PDF: bloques separados por línea en blanco o, si el texto es denso,
     * ventanas de varias oraciones para mantener contexto alineable con tus apuntes.
     */
    splitParagraphs(text) {
        const normalized = text.replace(/\s+/g, ' ').trim();
        let blocks = text.split(/\n\s*\n+/).map(p => p.replace(/\s+/g, ' ').trim())
            .filter(p => {
                if (p.length < 150 || p.length > 14000) return false;
                
                // Excluir glosarios, índices, tablas de contenido o bibliografía
                const glossaryPatterns = /(?:ABREVIATURAS|GLOSARIO|SIGLAS|CUADRO|TABLA|REFERENCIAS|BIBLIOGRAFÍA|ÍNDICE|APÉNDICE|CONTENIDO|ÍNDICE TEMÁTICO)/i;
                if (glossaryPatterns.test(p)) return false;

                // Excluir líneas de índice típicas (ej. "Tema ...... 12")
                const indexLines = (p.match(/\.{3,}\s*\d+/g) || []).length;
                if (indexLines > 2) return false;

                // Excluir si no tiene oraciones desarrolladas
                const sentenceCount = (p.match(/[.!?]+/g) || []).length;
                if (sentenceCount < 2) return false; // Un párrafo completo suele tener al menos 2 oraciones
                
                return true;
            });
            
        if (blocks.length < 3) {
            const sentences = this.splitSentences(text);
            blocks = [];
            const step = 5;
            for (let i = 0; i < sentences.length; i += step) {
                const chunk = sentences.slice(i, i + step).join(' ');
                if (chunk.length >= 150) {
                    const sentenceCount = (chunk.match(/[.!?]+/g) || []).length;
                    if (sentenceCount >= 2 && !(chunk.match(/\.{3,}\s*\d+/g) || []).length) {
                        blocks.push(chunk);
                    }
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
                    score += tf[token] * (idf[token] || 1) * 4;
                    matchCount++;
                } else {
                    score += tf[token] * (idf[token] || 1) * 0.14;
                }
            }

            for (const [term, synonyms] of Object.entries(MEDICAL_DICTIONARY.synonyms)) {
                if (userTokens.has(term)) {
                    for (const syn of synonyms) {
                        if (tokens.includes(syn)) {
                            score += 2.5;
                            matchCount++;
                        }
                    }
                }
            }

            score /= Math.sqrt(tokens.length + 2);

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
            // Eliminar referencias a figuras y tablas
            .replace(/FIGURA\s*\d+[-\d]*.*$/gm, '')
            .replace(/TABLA\s*\d+.*$/gm, '')
            // Eliminar líneas que son solo números o códigos
            .replace(/^\s*\d+\s*$/gm, '')
            // Eliminar un solo salto de línea (unir líneas dentro del mismo párrafo), preservando los dobles
            .replace(/([^\n])\n([^\n])/g, '$1 $2')
            // Eliminar múltiples espacios
            .replace(/\s{2,}/g, ' ')
            // Eliminar paréntesis vacíos o con poco contenido
            .replace(/\([^)]{0,3}\)/g, '')
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

        // SOLO incluir párrafos que tengan coincidencia real con los apuntes del usuario
        let selected = candidatePool.filter(
            p => (p.noteTokenMatches >= minOverlap) || (p.userBonus >= 1.6)
        );
        
        // Si somos muy estrictos, relajamos un poco pero EXIGIENDO al menos 1 coincidencia
        if (selected.length < 2) {
            selected = candidatePool.filter(p => p.noteTokenMatches >= 1 || p.userBonus > 0);
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

        for (const tfidf of tfidfScores) {
            const vector = vectorScores.find(v => v.index === tfidf.index) || { score: 0 };

            let userMatchBonus = 0;
            const lowerSentence = tfidf.text.toLowerCase();

            for (const keyword of userKeywords) {
                if (lowerSentence.includes(keyword.toLowerCase())) {
                    userMatchBonus += 1.8;
                }
            }

            combined.push({
                index: tfidf.index,
                text: tfidf.text,
                score: (tfidf.score * weights.tfidf) + (vector.score * weights.vector) + userMatchBonus,
                tfidfScore: tfidf.score,
                vectorScore: vector.score,
                userBonus: userMatchBonus,
                noteTokenMatches: tfidf.matchCount || 0
            });
        }

        return combined.sort((a, b) => b.score - a.score);
    }

    extractKeywordsFromNotes(notes) {
        const plain = stripHtmlTags(notes);
        const tokens = tokenize(plain);
        const stopwords = stopwordsES();
        const keywords = tokens.filter(w => !stopwords.has(w) && w.length > 3);

        return [...new Set(keywords)].slice(0, 35);
    }

    buildCleanSummary(items) {
        if (!items || items.length === 0) return '';
        const sorted = [...items].sort((a, b) => a.index - b.index);
        return sorted.map(s => s.text.trim()).join('\n\n').trim();
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
// INICIALIZACIÓN GLOBAL
// ==========================================
window.LocalSummary = {
    version: LOCAL_SUMMARY_VERSION,
    engine: new SummaryEngine(),
    config: SUMMARY_CONFIG,
    detectLanguage,
    translateToSpanish,
    exportToGoogleDocs,
    generate: function(text, notes, mode) {
        return this.engine.generateSummary(text, notes, mode);
    },
    getHistory: function() {
        return this.engine.history.get();
    }
};

console.log(`✅ Local Summary v${LOCAL_SUMMARY_VERSION} cargado correctamente`);
