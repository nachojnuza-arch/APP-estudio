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