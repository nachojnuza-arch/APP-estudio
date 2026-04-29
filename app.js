pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ==========================================
// 1. CONFIGURACIÓN Y VARIABLES GLOBALES
// ==========================================
let appData = { subjects: [], notes: {} };
let currentState = {
    currentFileId: null, // Identifica si estamos en una nota general o en un archivo específico
    currentSubject: null,
    expandedSubjects: {},
    expandedAiSubjects: {}, 
    pdfDoc: null,
    pageNum: 1,
    zoom: 1.2,
    isRendering: false
};

let autoSaveTimer = null;
let driveSyncTimer = null;
let screenshotState = { active: false, startX: 0, startY: 0, endX: 0, endY: 0 };

// Variables de estado para la IA (por si interactúan con los otros scripts)
let aiSourceFileIds = new Set();
let aiCorrectedNotes = {};

// ==========================================
// 2. BASE DE DATOS INTERNA (IndexedDB - Caché Rápida)
// ==========================================
const idb = {
    db: null,
    init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('StudyStudioDB', 1);
            req.onupgradeneeded = (e) => { e.target.result.createObjectStore('pdfs'); };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = () => reject('No se pudo abrir IndexedDB');
        });
    },
    async save(id, blob) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('pdfs', 'readwrite');
            tx.objectStore('pdfs').put(blob, id);
            tx.oncomplete = resolve;
        });
    },
    async get(id) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('pdfs', 'readonly');
            const req = tx.objectStore('pdfs').get(id);
            req.onsuccess = () => resolve(req.result);
        });
    },
    async delete(id) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('pdfs', 'readwrite');
            tx.objectStore('pdfs').delete(id);
            tx.oncomplete = resolve;
        });
    }
};

// ==========================================
// 3. FUNCIONES DE DATOS Y SINCRONIZACIÓN
// ==========================================
function loadData() {
    const saved = localStorage.getItem('studio_data_v2'); 
    if (saved) {
        try { appData = JSON.parse(saved); } catch(e) {}
    } else {
        appData = { subjects: [], notes: {} };
        saveData(false);
    }
}

function saveData(syncToDrive = true) {
    localStorage.setItem('studio_data_v2', JSON.stringify(appData));
    
    if (syncToDrive && window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
        const saveStatus = document.getElementById('save-status');
        if(saveStatus) saveStatus.innerHTML = '<i class="fas fa-sync fa-spin text-blue-500"></i> Sincronizando...';
        
        clearTimeout(driveSyncTimer);
        driveSyncTimer = setTimeout(() => {
            window.GoogleDriveSync.syncAppDataToDrive(appData).then(() => {
                if(saveStatus) {
                    saveStatus.innerHTML = '<i class="fas fa-cloud-check text-emerald-500"></i> Drive';
                    setTimeout(() => { saveStatus.innerHTML = '<i class="fas fa-check text-green-500"></i> Guardado'; }, 2000);
                }
            });
        }, 3000); 
    }
}

// CORRECCIÓN: Guardar notas usando el ID del archivo (currentFileId) para que sean independientes
function saveCurrentNotes() {
    const editor = document.getElementById('notes-editor');
    if (currentState.currentFileId && editor) { 
        appData.notes[currentState.currentFileId] = editor.innerHTML; 
        saveData(); 
    }
}

// ==========================================
// 4. INTERFAZ Y UTILIDADES
// ==========================================
function toggleSidebar() { document.getElementById('sidebar').classList.toggle('collapsed'); document.getElementById('sidebar').classList.toggle('w-16'); }
function toggleNotesPanel() { document.getElementById('notes-panel').classList.toggle('hidden'); document.getElementById('notes-panel').classList.toggle('flex'); }
function openModal(id) { document.getElementById(id).classList.remove('hidden'); if(id==='manage-subjects-modal') renderManageSubjects(); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }
function showLoading(msg) { document.getElementById('loading').classList.remove('hidden'); document.getElementById('loading-msg').textContent = msg; }
function hideLoading() { document.getElementById('loading').classList.add('hidden'); }

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const color = type === 'success' ? 'bg-emerald-500' : (type === 'error' ? 'bg-red-500' : 'bg-slate-800');
    toast.className = `${color} text-white px-4 py-2 rounded-lg shadow-lg text-sm flex items-center gap-2 transform transition-all translate-y-10 opacity-0`;
    toast.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':(type==='error'?'fa-exclamation-circle':'fa-info-circle')}"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-10', 'opacity-0'), 10);
    setTimeout(() => { toast.classList.add('opacity-0'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function switchTab(tab) {
    document.getElementById('tab-btn-notes').className = `flex-1 py-2 text-sm font-semibold rounded-md transition-all ${tab === 'notes' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`;
    document.getElementById('tab-btn-ai').className = `flex-1 py-2 text-sm font-semibold rounded-md transition-all ${tab === 'ai' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`;
    document.getElementById('tab-content-notes').classList.toggle('hidden', tab !== 'notes');
    document.getElementById('tab-content-notes').classList.toggle('flex', tab === 'notes');
    document.getElementById('tab-content-ai').classList.toggle('hidden', tab !== 'ai');
    document.getElementById('tab-content-ai').classList.toggle('flex', tab === 'ai');
}

function toggleReadingFilter() {
    document.body.classList.toggle('reading-filter-active');
    document.getElementById('reading-filter-btn').classList.toggle('text-indigo-600');
}

function clearAllData() {
    if(confirm('¿Borrar TODO permanentemente? Esta acción no se puede deshacer.')) {
        localStorage.clear();
        appData = { subjects: [], notes: {} };
        location.reload();
    }
}

// ==========================================
// 5. GESTIÓN DE MATERIAS Y RECURSOS
// ==========================================
function renderSubjects() {
    const list = document.getElementById('subject-list');
    list.innerHTML = '';
    
    if (appData.subjects.length === 0) {
        list.innerHTML = '<li class="text-xs text-slate-500 text-center py-4 italic hide-on-collapse">No hay materias.</li>';
        return;
    }

    appData.subjects.forEach(sub => {
        const isExpanded = currentState.expandedSubjects[sub.id];
        const li = document.createElement('li');
        li.className = 'flex flex-col';
        let filesHtml = sub.files.map(f => {
            const isActive = currentState.currentFileId === f.id;
            return `
            <li class="group cursor-pointer rounded-lg flex items-center justify-between p-2 transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}" onclick="openFile('${sub.id}', '${f.id}')">
                <div class="flex items-center gap-2 overflow-hidden"><i class="fas ${f.type === 'pdf' ? 'fa-file-pdf text-rose-400' : 'fa-play-circle text-sky-400'} w-5 text-center text-xs flex-shrink-0"></i><span class="text-xs truncate hide-on-collapse">${f.name}</span>${f.driveId ? '<i class="fas fa-cloud text-blue-400 text-[10px]" title="Drive"></i>' : ''}</div>
                <button onclick="removeFile(event, '${sub.id}', '${f.id}')" class="opacity-0 group-hover:opacity-100 hover:text-red-400 px-1 hide-on-collapse"><i class="fas fa-times text-[10px]"></i></button>
            </li>`
        }).join('');

        const isGenActive = currentState.currentFileId === ('gen_' + sub.id);

        li.innerHTML = `
            <div class="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-800 rounded-lg transition-colors" onclick="toggleSubjectAccordion('${sub.id}')">
                <div class="flex items-center gap-3 overflow-hidden"><i class="fas ${sub.icon || 'fa-book'} text-lg center-on-collapse w-6 text-center text-slate-400 flex-shrink-0"></i><span class="text-sm font-medium hide-on-collapse truncate">${sub.name}</span></div>
                <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} text-xs text-slate-500 hide-on-collapse"></i>
            </div>
            <ul class="${isExpanded ? 'block' : 'hidden'} ml-4 pl-2 border-l border-slate-700 mt-1 space-y-1 hide-on-collapse">
                <li class="group cursor-pointer rounded-lg flex items-center p-2 transition-colors ${isGenActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}" onclick="openGeneralNotes('${sub.id}')"><i class="fas fa-pen-nib w-5 text-center text-xs opacity-70 flex-shrink-0"></i><span class="text-xs truncate">Apuntes Generales</span></li>
                ${filesHtml}
            </ul>`;
        list.appendChild(li);
    });
}

function toggleSubjectAccordion(subId) { currentState.expandedSubjects[subId] = !currentState.expandedSubjects[subId]; renderSubjects(); }

function addSubject() {
    const name = document.getElementById('new-subject-name').value.trim();
    if (!name) return;
    const subId = 'sub_' + Date.now().toString(36);
    appData.subjects.push({ id: subId, name, icon: 'fa-book', files: [] });
    saveData(); document.getElementById('new-subject-name').value = '';
    renderManageSubjects(); renderSubjects(); openGeneralNotes(subId);
    showToast('Materia añadida', 'success');
}

function removeSubject(subId) {
    if(confirm('¿Eliminar materia y todos sus apuntes?')) {
        const sub = appData.subjects.find(s => s.id === subId);
        
        // Limpiar todas las notas asociadas
        if (sub) {
            sub.files.forEach(f => delete appData.notes[f.id]);
        }
        delete appData.notes['gen_' + subId];
        
        appData.subjects = appData.subjects.filter(s => s.id !== subId);
        saveData(); renderManageSubjects(); renderSubjects();
        if(currentState.currentSubject === subId) showEmptyState();
    }
}

function renderManageSubjects() {
    const list = document.getElementById('modal-subject-list');
    list.innerHTML = appData.subjects.map(sub => `<li class="flex items-center justify-between p-3 hover:bg-slate-50"><span class="text-sm">${sub.name}</span><button onclick="removeSubject('${sub.id}')" class="text-red-400"><i class="fas fa-trash-alt"></i></button></li>`).join('');
}

function openAddFileModal(subId = null) {
    if (appData.subjects.length === 0) return openModal('manage-subjects-modal');
    document.getElementById('file-target-subject').innerHTML = appData.subjects.map(s => `<option value="${s.id}" ${s.id === subId ? 'selected' : ''}>${s.name}</option>`).join('');
    openModal('add-file-modal');
}

// CORRECCIÓN: Respetar el nombre original del PDF
async function confirmAddFile() {
    const type = document.getElementById('file-type').value;
    const customName = document.getElementById('file-name').value.trim();
    const sub = appData.subjects.find(s => s.id === document.getElementById('file-target-subject').value);
    
    let fileObj = { id: 'file_' + Date.now(), name: '', type: type.includes('pdf') ? 'pdf' : 'video', url: '', isLocal: type === 'pdf_local', driveId: null };

    if (type === 'pdf_local') {
        const file = document.getElementById('file-upload').files[0];
        if (!file) return showToast('Selecciona un PDF', 'error');
        
        // Si no se puso nombre, toma el original y le quita la extensión
        fileObj.name = customName || file.name.replace(/\.[^/.]+$/, "");
        
        await idb.save(fileObj.id, file); 
        
        if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            showToast('Subiendo respaldo a Drive...', 'info');
            window.GoogleDriveSync.uploadPdfToDrive(file, fileObj.name).then(dId => {
                if(dId) { fileObj.driveId = dId; saveData(); renderSubjects(); }
            });
        }
    } else {
        fileObj.name = customName || 'Documento o Video Web';
        fileObj.url = document.getElementById('file-url').value;
    }
    
    sub.files.push(fileObj); saveData();
    currentState.expandedSubjects[sub.id] = true;
    closeModal('add-file-modal'); renderSubjects(); openFile(sub.id, fileObj.id);
    document.getElementById('file-name').value = '';
    document.getElementById('file-upload').value = '';
}

async function removeFile(e, subId, fileId) {
    e.stopPropagation();
    if(confirm('¿Eliminar archivo y sus apuntes asociados?')) {
        await idb.delete(fileId);
        const sub = appData.subjects.find(s => s.id === subId);
        sub.files = sub.files.filter(f => f.id !== fileId);
        delete appData.notes[fileId]; // Limpiar notas del archivo
        saveData(); renderSubjects();
        if(currentState.currentFileId === fileId) showEmptyState();
    }
}

// ==========================================
// 6. VISOR DE PDF, NOTAS Y NAVEGACIÓN
// ==========================================
function showEmptyState() {
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('pdf-canvas').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('pdf-controls').classList.add('hidden');
    document.getElementById('header-title').textContent = 'Workspace';
    document.getElementById('notes-editor').innerHTML = '';
    currentState.currentFileId = null;
    currentState.currentSubject = null;
}

// CORRECCIÓN: Las notas generales cargan mediante el ID 'gen_IDMATERIA'
function openGeneralNotes(subId) {
    saveCurrentNotes(); 
    
    const sub = appData.subjects.find(s => s.id === subId);
    currentState.currentSubject = subId; 
    currentState.currentFileId = 'gen_' + subId; 
    
    document.getElementById('header-title').textContent = `Apuntes: ${sub.name}`;
    document.getElementById('notes-editor').innerHTML = appData.notes[currentState.currentFileId] || '';
    
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('pdf-canvas').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('pdf-controls').classList.add('hidden');
    document.getElementById('empty-state-title').textContent = `Apuntes Generales de ${sub.name}`;
    
    renderSubjects();
}

// CORRECCIÓN: Los apuntes de PDF cargan usando el ID del archivo
async function openFile(subId, fileId) {
    saveCurrentNotes(); 
    
    const sub = appData.subjects.find(s => s.id === subId);
    const file = sub.files.find(f => f.id === fileId);
    
    currentState.currentSubject = subId; 
    currentState.currentFileId = fileId; 
    
    document.getElementById('header-title').textContent = file.name;
    document.getElementById('notes-editor').innerHTML = appData.notes[fileId] || '';
    renderSubjects();

    document.getElementById('empty-state').classList.add('hidden');
    const pdfCanvas = document.getElementById('pdf-canvas');
    const videoCont = document.getElementById('video-container');

    if (file.type === 'pdf') {
        videoCont.classList.add('hidden');
        
        let blob = await idb.get(fileId);
        if (!blob && file.driveId && window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            showLoading('Descargando de Drive...');
            blob = await window.GoogleDriveSync.downloadPdfFromDrive(file.driveId);
            if (blob) { 
                await idb.save(fileId, blob); 
                saveData(false); 
            }
            hideLoading();
        }

        if (blob || file.url) {
            pdfCanvas.classList.remove('hidden'); document.getElementById('pdf-controls').classList.remove('hidden');
            const url = blob ? URL.createObjectURL(blob) : file.url;
            currentState.pdfDoc = await pdfjsLib.getDocument(url).promise;
            currentState.pageNum = 1; renderPage();
        }
    } else {
        pdfCanvas.classList.add('hidden'); document.getElementById('pdf-controls').classList.add('hidden');
        videoCont.classList.remove('hidden');
        videoCont.innerHTML = `<iframe src="${file.url}" class="w-full h-full border-0" allowfullscreen></iframe>`;
    }
}

async function renderPage() {
    if (!currentState.pdfDoc || currentState.isRendering) return;
    currentState.isRendering = true;
    try {
        const page = await currentState.pdfDoc.getPage(currentState.pageNum);
        const canvas = document.getElementById('pdf-canvas');
        const viewport = page.getViewport({ scale: currentState.zoom });
        canvas.height = viewport.height; canvas.width = viewport.width;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        
        document.getElementById('page-input').value = currentState.pageNum;
        document.getElementById('page-total').textContent = currentState.pdfDoc.numPages;
        document.getElementById('zoom-info').textContent = `${Math.round(currentState.zoom * 100)}%`;
    } catch(e) {}
    currentState.isRendering = false;
}

function changePage(delta) { goToPage(currentState.pageNum + delta); }

function goToPage(num) {
    num = parseInt(num);
    if(num >= 1 && num <= currentState.pdfDoc?.numPages) { 
        currentState.pageNum = num; 
        renderPage(); 
    } else {
        document.getElementById('page-input').value = currentState.pageNum;
    }
}

function changeZoom(delta) { currentState.zoom = Math.max(0.5, Math.min(3.0, currentState.zoom + delta)); renderPage(); }

// ==========================================
// 7. CAPTURAS DE PANTALLA (HTML2CANVAS)
// ==========================================
const overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:crosshair;display:none;background:rgba(0,0,0,0.3);';
const sBox = document.createElement('div');
sBox.style.cssText = 'position:absolute;border:2px dashed #fff;background:rgba(255,255,255,0.1);display:none;pointer-events:none;';
overlay.appendChild(sBox); document.body.appendChild(overlay);

document.getElementById('media-viewer').addEventListener('mousedown', (e) => {
    if (e.ctrlKey && currentState.pdfDoc) {
        e.preventDefault(); screenshotState = { active: true, startX: e.clientX, startY: e.clientY };
        overlay.style.display = 'block'; sBox.style.display = 'block'; sBox.style.width = '0';
    }
});

document.addEventListener('mousemove', (e) => {
    if (!screenshotState.active) return;
    sBox.style.left = Math.min(screenshotState.startX, e.clientX) + 'px';
    sBox.style.top = Math.min(screenshotState.startY, e.clientY) + 'px';
    sBox.style.width = Math.abs(e.clientX - screenshotState.startX) + 'px';
    sBox.style.height = Math.abs(e.clientY - screenshotState.startY) + 'px';
    screenshotState.endX = e.clientX; screenshotState.endY = e.clientY;
});

document.addEventListener('mouseup', async (e) => {
    if (!screenshotState.active) return;
    screenshotState.active = false; overlay.style.display = 'none'; sBox.style.display = 'none';
    const w = Math.abs(screenshotState.endX - screenshotState.startX);
    const h = Math.abs(screenshotState.endY - screenshotState.startY);
    if (w > 10 && h > 10) {
        try {
            const canvasRect = document.getElementById('pdf-canvas').getBoundingClientRect();
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            c.getContext('2d').drawImage(document.getElementById('pdf-canvas'), Math.min(screenshotState.startX, screenshotState.endX) - canvasRect.left, Math.min(screenshotState.startY, screenshotState.endY) - canvasRect.top, w, h, 0, 0, w, h);
            
            const img = document.createElement('img'); img.src = c.toDataURL(); img.style.margin = '10px';
            document.getElementById('notes-editor').appendChild(img);
            saveCurrentNotes(); showToast('Captura añadida', 'success');
        } catch(err) { showToast('Error en captura', 'error'); }
    }
});

// ==========================================
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
// 9. INICIALIZACIÓN
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    await idb.init();
    loadData();
    
    showEmptyState();
    renderSubjects();
    
    if(window.GoogleDriveSync && typeof window.GoogleDriveSync.init === 'function') {
        window.GoogleDriveSync.init();
    }
    
    if(typeof renderAiSources === 'function') {
        renderAiSources();
    }

    document.getElementById('notes-editor').addEventListener('input', () => {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(saveCurrentNotes, 1500);
    });
});