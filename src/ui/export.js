// 8. FUNCIONES BÁSICAS DE IA Y EXPORTACIÓN
// ==========================================
function saveApiKey() {
    const k = document.getElementById('api-key-input').value;
    if(k) { localStorage.setItem('gemini_api_key', k); closeModal('api-modal'); showToast('API Key guardada', 'success'); }
}

function exportNotesAsDocx() {
    const content = document.getElementById('notes-editor').innerHTML;
    if(!content.trim()) return showToast('El documento está vacío', 'error');

    const header = `<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>Apuntes</title><style>body{font-family:Arial;}</style></head><body>`;
    const footer = '</body></html>';
    const blob = new Blob(['\ufeff', header + content + footer], { type: 'application/msword' });
    
    const a = document.createElement('a'); 
    a.href = URL.createObjectURL(blob);
    a.download = (document.getElementById('header-title').textContent || 'Apuntes').replace(/[^a-zA-Z0-9 ]/g,'') + '.doc';
    a.click(); 
    showToast('Documento Word descargado', 'success');
}

// Las funciones generarResumenDirecto(), summarizeWithAI() y generateQuiz()
// se encuentran en los archivos ai-original.js y local-summary.js.
// Aquí solo mantenemos exportaciones y utilidades compartidas.

// ==========================================