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
const AUTO_SAVE_IDLE_MS = 60_000;
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
            const req = indexedDB.open('StudyStudioDB', 2);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('pdfs')) {
                    db.createObjectStore('pdfs');
                }
                if (!db.objectStoreNames.contains('workspace')) {
                    db.createObjectStore('workspace');
                }
            };
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
    },
    /** Copia completa del workspace (JSON string); localStorage tiene ~5 MB y se llena con notas/imágenes. */
    async putWorkspace(jsonString) {
        return new Promise((resolve, reject) => {
            if (!this.db.objectStoreNames.contains('workspace')) {
                reject(new Error('workspace store missing'));
                return;
            }
            const tx = this.db.transaction('workspace', 'readwrite');
            tx.objectStore('workspace').put(jsonString, 'studio_data_v2');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    async getWorkspace() {
        return new Promise((resolve) => {
            if (!this.db.objectStoreNames.contains('workspace')) {
                resolve(null);
                return;
            }
            const tx = this.db.transaction('workspace', 'readonly');
            const req = tx.objectStore('workspace').get('studio_data_v2');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    },
    async clearAllStores() {
        return new Promise((resolve) => {
            if (!this.db) {
                resolve();
                return;
            }
            const names = ['workspace', 'pdfs'];
            let i = 0;
            const step = () => {
                if (i >= names.length) {
                    resolve();
                    return;
                }
                const name = names[i++];
                if (!this.db.objectStoreNames.contains(name)) {
                    step();
                    return;
                }
                const tx = this.db.transaction(name, 'readwrite');
                tx.objectStore(name).clear();
                tx.oncomplete = step;
                tx.onerror = step;
            };
            step();
        });
    }
};

// ==========================================
// 3. FUNCIONES DE DATOS Y SINCRONIZACIÓN
// ==========================================
const LS_WORKSPACE_KEY = 'studio_data_v2';
const LS_WORKSPACE_IDB_FLAG = 'studio_data_v2_idb';
let _workspaceQuotaToastShown = false;

function getSubjectNotesKey(subId) {
    return 'sub_' + subId;
}

function getSubjectNotesHtml(subId) {
    return appData.notes[getSubjectNotesKey(subId)] || '';
}

/** Une apuntes viejos (por archivo / gen_) en una sola hoja por materia. */
function migrateNotesToPerSubject() {
    if (!appData.notes) appData.notes = {};
    appData.subjects.forEach(sub => {
        const key = getSubjectNotesKey(sub.id);
        if (appData.notes[key]) return;

        let merged = '';
        const genKey = 'gen_' + sub.id;
        if (appData.notes[genKey]) merged = appData.notes[genKey];

        sub.files.forEach(f => {
            const part = appData.notes[f.id];
            if (!part) return;
            if (merged && merged.trim()) {
                merged += '<hr><p><br></p>' + part;
            } else {
                merged = part;
            }
            delete appData.notes[f.id];
        });

        if (merged) appData.notes[key] = merged;
        delete appData.notes[genKey];
    });
}

function applyParsedAppData(parsed) {
    appData = parsed;
    if (!appData.subjects) appData.subjects = [];
    appData.subjects.forEach(sub => {
        if (!sub.files) sub.files = [];
    });
    if (!appData.notes) appData.notes = {};
    migrateNotesToPerSubject();
}

async function loadData() {
    if (localStorage.getItem(LS_WORKSPACE_IDB_FLAG) === '1') {
        const raw = await idb.getWorkspace();
        if (raw) {
            try {
                applyParsedAppData(JSON.parse(raw));
                return;
            } catch (e) {
                console.warn('Workspace en IndexedDB corrupto o ilegible', e);
            }
        }
    }

    const saved = localStorage.getItem(LS_WORKSPACE_KEY);
    if (saved) {
        try {
            applyParsedAppData(JSON.parse(saved));
            idb.putWorkspace(saved).catch(() => {});
            return;
        } catch (e) {
            console.warn('studio_data_v2 en localStorage ilegible', e);
        }
    }

    const idbRaw = await idb.getWorkspace();
    if (idbRaw) {
        try {
            applyParsedAppData(JSON.parse(idbRaw));
            try {
                localStorage.setItem(LS_WORKSPACE_IDB_FLAG, '1');
            } catch (e) { /* ignore */ }
            return;
        } catch (e) {
            console.warn('Fallback IndexedDB falló', e);
        }
    }

    appData = { subjects: [], notes: {} };
    await saveData(false);
}

async function flushDriveSync() {
    if (!window.GoogleDriveSync || !window.GoogleDriveSync.isLoggedIn || !window.GoogleDriveSync.folderId) {
        return;
    }
    clearTimeout(driveSyncTimer);
    const saveStatus = document.getElementById('save-status');
    if (saveStatus) saveStatus.innerHTML = '<i class="fas fa-sync fa-spin text-blue-500"></i> Sincronizando...';
    try {
        await window.GoogleDriveSync.syncAppDataToDrive(appData);
        if (saveStatus) {
            saveStatus.innerHTML = '<i class="fas fa-cloud-check text-emerald-500"></i> Drive';
            setTimeout(() => { saveStatus.innerHTML = '<i class="fas fa-check text-green-500"></i> Guardado'; }, 2000);
        }
    } catch (err) {
        console.error('flushDriveSync', err);
    }
}

async function saveData(syncToDrive = true, options = {}) {
    const { forceDrive = false } = options;
    const serialized = JSON.stringify(appData);
    try {
        await idb.putWorkspace(serialized);
    } catch (e) {
        console.error('No se pudo guardar el workspace en IndexedDB', e);
        if (typeof showToast === 'function') {
            showToast('No se pudo guardar: falló IndexedDB. Revisá espacio en disco del navegador.', 'error');
        }
        return;
    }

    try {
        localStorage.setItem(LS_WORKSPACE_KEY, serialized);
        try {
            localStorage.removeItem(LS_WORKSPACE_IDB_FLAG);
        } catch (e) { /* ignore */ }
    } catch (e) {
        const quota = e && (e.name === 'QuotaExceededError' || e.code === 22);
        if (quota) {
            try {
                localStorage.removeItem(LS_WORKSPACE_KEY);
                localStorage.setItem(LS_WORKSPACE_IDB_FLAG, '1');
            } catch (e2) { /* ignore */ }
            if (!_workspaceQuotaToastShown && typeof showToast === 'function') {
                _workspaceQuotaToastShown = true;
                showToast('Memoria del navegador llena (~5 MB): tus datos siguen guardados en almacenamiento extendido y en Drive si está conectado.', 'info');
            }
        } else {
            console.error('localStorage:', e);
        }
    }

    if (syncToDrive && window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
        if (forceDrive) {
            await flushDriveSync();
        } else {
            const saveStatus = document.getElementById('save-status');
            if (saveStatus) saveStatus.innerHTML = '<i class="fas fa-sync fa-spin text-blue-500"></i> Sincronizando...';

            clearTimeout(driveSyncTimer);
            driveSyncTimer = setTimeout(() => {
                window.GoogleDriveSync.syncAppDataToDrive(appData).then(() => {
                    if (saveStatus) {
                        saveStatus.innerHTML = '<i class="fas fa-cloud-check text-emerald-500"></i> Drive';
                        setTimeout(() => { saveStatus.innerHTML = '<i class="fas fa-check text-green-500"></i> Guardado'; }, 2000);
                    }
                });
            }, 3000);
        }
    }
}

/** Una hoja de apuntes por materia (clave sub_ID). forceDrive: subida inmediata a Drive. */
async function saveCurrentNotes(forceDrive = false) {
    const editor = document.getElementById('notes-editor');
    if (!currentState.currentSubject || !editor) return;
    appData.notes[getSubjectNotesKey(currentState.currentSubject)] = editor.innerHTML;
    try {
        await saveData(true, { forceDrive });
    } catch (err) {
        console.error('saveData', err);
    }
}

function execCmd(command) {
    document.execCommand(command, false, null);
    const editor = document.getElementById('notes-editor');
    if (editor) editor.focus();
}

// ==========================================
// 4. INTERFAZ Y UTILIDADES
// ==========================================
function toggleSidebar() { 
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (window.innerWidth < 768) {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) overlay.classList.toggle('hidden');
    } else {
        sidebar.classList.toggle('md:hidden');
    }
    setTimeout(() => { if (currentState.pdfDoc) renderPage(); }, 300);
}

function toggleNotesPanel() { 
    const panel = document.getElementById('view-notes');
    if (!panel) return;
    
    if (panel.classList.contains('md:flex')) {
        // Actualmente visible en PC, lo ocultamos
        panel.classList.remove('md:flex');
        panel.classList.add('md:hidden');
    } else {
        // Actualmente oculto en PC, lo mostramos
        panel.classList.remove('md:hidden');
        panel.classList.add('md:flex');
    }
    setTimeout(() => { if (currentState.pdfDoc) renderPage(); }, 300);
}
function openModal(id) { 
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.querySelectorAll('#modal-overlay .modal-container').forEach(m => m.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden'); 
    if(id==='manage-subjects-modal') renderManageSubjects(); 
}
function closeModal(id) { 
    document.getElementById(id).classList.add('hidden'); 
    document.getElementById('modal-overlay').classList.add('hidden');
}
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
    if (confirm('¿Borrar TODO permanentemente? Esta acción no se puede deshacer.')) {
        idb.clearAllStores().finally(() => {
            try {
                localStorage.clear();
            } catch (e) { /* ignore */ }
            appData = { subjects: [], notes: {} };
            location.reload();
        });
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
        
        // Actualizar también la lista de fuentes IA si no hay materias
        if (typeof renderAiSources === 'function') renderAiSources();
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
                <button type="button" title="Eliminar archivo" onclick="removeFile(event, '${sub.id}', '${f.id}')" class="opacity-0 group-hover:opacity-100 hover:text-red-400 px-1 hide-on-collapse"><i class="fas fa-times text-[10px]"></i></button>
            </li>`
        }).join('');

        const isSubjectNotesActive = currentState.currentSubject === sub.id && !currentState.currentFileId;

        li.innerHTML = `
            <div class="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-800 rounded-lg transition-colors" onclick="toggleSubjectAccordion('${sub.id}')">
                <div class="flex items-center gap-3 overflow-hidden"><i class="fas ${sub.icon || 'fa-book'} text-lg center-on-collapse w-6 text-center text-slate-400 flex-shrink-0"></i><span class="text-sm font-medium hide-on-collapse truncate">${sub.name}</span></div>
                <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} text-xs text-slate-500 hide-on-collapse"></i>
            </div>
            <ul class="${isExpanded ? 'block' : 'hidden'} ml-4 pl-2 border-l border-slate-700 mt-1 space-y-1 hide-on-collapse">
                <li class="group cursor-pointer rounded-lg flex items-center p-2 transition-colors ${isSubjectNotesActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}" onclick="openGeneralNotes('${sub.id}')"><i class="fas fa-pen-nib w-5 text-center text-xs opacity-70 flex-shrink-0"></i><span class="text-xs truncate">Apuntes</span></li>
                ${filesHtml}
            </ul>`;
        list.appendChild(li);
    });

    // Añadir esto para que el panel de Fuentes IA se actualice al mismo tiempo
    if (typeof renderAiSources === 'function') {
        renderAiSources();
    }
}

function toggleSubjectAccordion(subId) { currentState.expandedSubjects[subId] = !currentState.expandedSubjects[subId]; renderSubjects(); }

async function addSubject() {
    const name = document.getElementById('new-subject-name').value.trim();
    if (!name) return;
    const subId = 'sub_' + Date.now().toString(36);
    const newSub = { id: subId, name, icon: 'fa-book', files: [], driveFolderId: null };
    appData.subjects.push(newSub);
    if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
        await window.GoogleDriveSync.ensureSubjectFolder(newSub);
    }
    await saveData();
    document.getElementById('new-subject-name').value = '';
    renderManageSubjects();
    renderSubjects();
    openGeneralNotes(subId);
    showToast('Materia añadida', 'success');
}

async function removeSubject(subId) {
    if (confirm('¿Eliminar materia y todos sus apuntes?')) {
        if (currentState.currentSubject === subId) {
            await saveCurrentNotes(true);
        }
        delete appData.notes[getSubjectNotesKey(subId)];
        delete appData.notes['gen_' + subId];

        appData.subjects = appData.subjects.filter(s => s.id !== subId);
        await saveData();
        renderManageSubjects();
        renderSubjects();
        if (currentState.currentSubject === subId) showEmptyState();
    }
}

function renderManageSubjects() {
    const list = document.getElementById('modal-subject-list');
    list.innerHTML = appData.subjects.map(sub => `<li class="flex items-center justify-between p-3 hover:bg-slate-50"><span class="text-sm">${sub.name}</span><button type="button" title="Eliminar materia" onclick="removeSubject('${sub.id}')" class="text-red-400"><i class="fas fa-trash-alt"></i></button></li>`).join('');
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
            window.GoogleDriveSync.uploadPdfToDrive(file, fileObj.name, sub).then(dId => {
                if (dId) { fileObj.driveId = dId; saveData(); renderSubjects(); }
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
    if (confirm('¿Eliminar este archivo? Los apuntes de la materia se conservan.')) {
        await idb.delete(fileId);
        const sub = appData.subjects.find(s => s.id === subId);
        sub.files = sub.files.filter(f => f.id !== fileId);

        if (aiSourceFileIds.has(fileId)) aiSourceFileIds.delete(fileId);

        await saveData();
        renderSubjects();
        if (currentState.currentFileId === fileId) showEmptyState();
    }
}

// ==========================================
// 5.1 SELECCIÓN DE FUENTES PARA IA Y RAG
// ==========================================
function renderAiSources() {
    const list = document.getElementById('ai-sources-list');
    const countLabel = document.getElementById('ai-source-count');
    if (!list || !countLabel) return;

    list.innerHTML = '';
    let hasPdfs = false;

    appData.subjects.forEach(sub => {
        const pdfFiles = sub.files.filter(f => f.type === 'pdf');
        if (pdfFiles.length === 0) return;
        hasPdfs = true;

        const subDiv = document.createElement('div');
        subDiv.className = 'mb-2';
        subDiv.innerHTML = `<div class="text-[10px] font-bold text-slate-500 uppercase px-2 mb-1">${sub.name}</div>`;
        
        pdfFiles.forEach(f => {
            const isChecked = aiSourceFileIds.has(f.id);
            const fileItem = document.createElement('label');
            fileItem.className = 'flex items-center gap-2 px-2 py-1 hover:bg-slate-200 rounded cursor-pointer transition-colors';
            fileItem.innerHTML = `
                <input type="checkbox" title="Usar ${f.name} en IA" aria-label="Usar ${f.name} en IA" class="w-3 h-3 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500" 
                       ${isChecked ? 'checked' : ''} onchange="toggleAiSource('${f.id}')">
                <i class="fas fa-file-pdf text-rose-400 text-xs"></i>
                <span class="text-xs text-slate-600 truncate flex-1">${f.name}</span>
            `;
            subDiv.appendChild(fileItem);
        });
        list.appendChild(subDiv);
    });

    if (!hasPdfs) {
        list.innerHTML = '<p class="text-xs text-slate-400 italic p-1">Sube PDFs para usarlos como fuente.</p>';
    }
    
    countLabel.textContent = `${aiSourceFileIds.size} seleccionadas`;
}

function toggleAiSource(fileId) {
    if (aiSourceFileIds.has(fileId)) {
        aiSourceFileIds.delete(fileId);
    } else {
        aiSourceFileIds.add(fileId);
    }
    renderAiSources();
}

// ==========================================
// 6. VISOR DE PDF, NOTAS Y NAVEGACIÓN
// ==========================================
async function showEmptyState() {
    if (currentState.currentSubject) {
        await saveCurrentNotes(true);
    }
    document.getElementById('pdf-container').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('pdf-controls').classList.add('hidden');
    document.getElementById('header-title').textContent = 'Workspace';
    const headerIcon = document.getElementById('header-icon');
    if(headerIcon) headerIcon.className = 'fas fa-folder-open text-slate-400 shrink-0 group-hover:text-primary-500 transition-colors';
    document.getElementById('notes-editor').innerHTML = '';
    currentState.currentFileId = null;
    currentState.currentSubject = null;

    const dashboard = document.getElementById('subject-dashboard');
    if (dashboard && appData.subjects && appData.subjects.length > 0) {
        document.getElementById('empty-state').classList.add('hidden');
        dashboard.classList.remove('hidden');
        let html = `<div class="max-w-5xl mx-auto">`;
        html += `<h2 class="text-2xl md:text-3xl font-bold text-slate-800 mb-2">Mi Workspace</h2>`;
        html += `<p class="text-slate-500 mb-8">Selecciona una materia para ver sus recursos y apuntes.</p>`;
        html += `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">`;
        
        appData.subjects.forEach(sub => {
            html += `<div onclick="openGeneralNotes('${sub.id}')" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg hover:-translate-y-1 hover:border-primary-300 cursor-pointer transition-all duration-300 flex flex-col items-center text-center group"><div class="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"><i class="fas ${sub.icon || 'fa-book'} text-3xl text-primary-500"></i></div><span class="text-sm font-bold text-slate-700 line-clamp-3 leading-snug">${sub.name}</span><span class="text-[10px] font-medium text-slate-400 bg-slate-50 px-2 py-1 rounded mt-3">${sub.files.length} recursos</span></div>`;
        });
        
        html += `<div onclick="openModal('manage-subjects-modal')" class="bg-transparent p-5 rounded-2xl border-2 border-dashed border-slate-300 hover:border-primary-300 hover:bg-slate-50 cursor-pointer transition-all duration-300 flex flex-col items-center justify-center text-center group"><div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 group-hover:bg-primary-100 transition-colors"><i class="fas fa-plus text-slate-400 group-hover:text-primary-500"></i></div><span class="text-sm font-bold text-slate-500 group-hover:text-primary-600">Añadir Materia</span></div>`;
        html += `</div></div>`;
        dashboard.innerHTML = html;
    } else {
        document.getElementById('empty-state').classList.remove('hidden');
        if (dashboard) dashboard.classList.add('hidden');
    }
}

// Una sola hoja de apuntes por materia (sub_ID)
async function openGeneralNotes(subId) {
    await saveCurrentNotes(true);

    const sub = appData.subjects.find(s => s.id === subId);
    currentState.currentSubject = subId;
    currentState.currentFileId = null;

    document.getElementById('header-title').textContent = `Apuntes: ${sub.name}`;
    document.getElementById('notes-editor').innerHTML = getSubjectNotesHtml(subId);
    
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('pdf-container').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('pdf-controls').classList.add('hidden');
    
    const dashboard = document.getElementById('subject-dashboard');
    if (dashboard) {
        dashboard.classList.remove('hidden');
        let html = `<div class="max-w-5xl mx-auto">`;
        html += `<h2 class="text-2xl md:text-3xl font-bold text-slate-800 mb-2">Recursos de ${sub.name}</h2>`;
        html += `<p class="text-slate-500 mb-8">Selecciona un documento para abrirlo. Los apuntes de la derecha son los mismos para toda la materia.</p>`;
        html += `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">`;
        
        if (sub.files.length === 0) {
            html += `<div class="col-span-full text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300"><i class="fas fa-folder-open text-4xl text-slate-300 mb-3"></i><p class="text-slate-500 font-medium">No hay archivos en esta materia</p><button onclick="openAddFileModal('${sub.id}')" class="mt-4 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-bold hover:bg-indigo-100 transition-colors">Añadir recurso</button></div>`;
        } else {
            sub.files.forEach(f => {
                const icon = f.type === 'pdf' ? 'fa-file-pdf text-rose-500' : 'fa-play-circle text-sky-500';
                const bgIcon = f.type === 'pdf' ? 'bg-rose-50' : 'bg-sky-50';
                html += `<div onclick="openFile('${sub.id}', '${f.id}')" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg hover:-translate-y-1 hover:border-indigo-300 cursor-pointer transition-all duration-300 flex flex-col items-center text-center group"><div class="w-16 h-16 rounded-full ${bgIcon} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"><i class="fas ${icon} text-3xl"></i></div><span class="text-sm font-bold text-slate-700 line-clamp-3 leading-snug">${f.name}</span></div>`;
            });
        }
        html += `</div></div>`;
        dashboard.innerHTML = html;
    }
    
    if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.add('-translate-x-full');
        document.getElementById('sidebar-overlay')?.classList.add('hidden');
    }
    renderSubjects();
}

async function openFile(subId, fileId) {
    await saveCurrentNotes(true);

    const sub = appData.subjects.find(s => s.id === subId);
    const file = sub.files.find(f => f.id === fileId);

    currentState.currentSubject = subId;
    currentState.currentFileId = fileId;

    document.getElementById('header-title').textContent = file.name;
    document.getElementById('notes-editor').innerHTML = getSubjectNotesHtml(subId);
    
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth < 768) {
        sidebar.classList.add('-translate-x-full');
        document.getElementById('sidebar-overlay')?.classList.add('hidden');
    } else {
        sidebar.classList.add('md:hidden');
    }
    setTimeout(() => { if (currentState.pdfDoc) renderPage(); }, 300);
    
    renderSubjects();

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('subject-dashboard')?.classList.add('hidden');
    const pdfContainer = document.getElementById('pdf-container');
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
            pdfContainer.classList.remove('hidden'); document.getElementById('pdf-controls').classList.remove('hidden');
            const url = blob ? URL.createObjectURL(blob) : file.url;
            currentState.pdfDoc = await pdfjsLib.getDocument(url).promise;
            currentState.pageNum = 1; renderPage();
        }
    } else {
        pdfContainer.classList.add('hidden'); document.getElementById('pdf-controls').classList.add('hidden');
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
        
        const container = document.getElementById('pdf-container');
        container.style.width = viewport.width + 'px';
        container.style.height = viewport.height + 'px';

        canvas.height = viewport.height; 
        canvas.width = viewport.width;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        
        // Capa de texto para selección
        const textLayerDiv = document.getElementById('text-layer');
        textLayerDiv.innerHTML = ''; 
        textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
        
        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });

        document.getElementById('page-input').value = currentState.pageNum;
        document.getElementById('page-total').textContent = currentState.pdfDoc.numPages;
        document.getElementById('zoom-info').textContent = `${Math.round(currentState.zoom * 100)}%`;
    } catch(e) {
        console.error("Error renderizando PDF:", e);
    }
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

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); if (currentState.pdfDoc) changePage(e.key === 'ArrowRight' ? 1 : -1); }
    if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); if (currentState.pdfDoc) changeZoom(e.key === 'ArrowUp' ? 0.1 : -0.1); }
});

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
            
            const img = document.createElement('img'); 
            img.src = c.toDataURL(); 
            img.style.margin = '10px auto';
            img.style.display = 'block';
            
            const editor = document.getElementById('notes-editor');
            const sel = window.getSelection();
            if(sel.rangeCount > 0 && editor.contains(sel.anchorNode)) { 
                const range = sel.getRangeAt(0); range.insertNode(img); range.setStartAfter(img); sel.removeAllRanges(); sel.addRange(range); 
            } else { 
                editor.appendChild(img); 
            }
            saveCurrentNotes(); showToast('Captura añadida', 'success');
        } catch(err) { showToast('Error en captura', 'error'); }
    }
});

function alignImage(alignment) {
    const selectedImage = document.querySelector('#notes-editor img.selected');
    if (selectedImage) {
        selectedImage.style.display = 'block';
        selectedImage.style.float = 'none';
        selectedImage.style.marginLeft = 'auto';
        selectedImage.style.marginRight = 'auto';
        if (alignment === 'left') {
            selectedImage.style.float = 'left';
            selectedImage.style.margin = '10px';
        } else if (alignment === 'right') {
            selectedImage.style.float = 'right';
            selectedImage.style.margin = '10px';
        }
        saveCurrentNotes();
    } else {
        showToast('Haz clic en una imagen para seleccionarla', 'warning');
    }
}

function resizeImage(factor) {
    const selectedImage = document.querySelector('#notes-editor img.selected');
    if (selectedImage) {
        let currentWidth = selectedImage.clientWidth || selectedImage.width;
        selectedImage.style.width = (currentWidth * factor) + 'px';
        selectedImage.style.height = 'auto';
        saveCurrentNotes();
    } else {
        showToast('Haz clic en una imagen para seleccionarla', 'warning');
    }
}

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
    try {
        await idb.init();
    } catch (e) {
        console.warn("⚠️ No se pudo inicializar IndexedDB (posible modo incógnito o restricción del navegador). Los PDFs podrían no guardarse localmente.", e);
    }
    
    try {
        await loadData();
    } catch (e) {
        console.warn("⚠️ Error al cargar datos guardados:", e);
    }
    
    showEmptyState();
    renderSubjects();
    
    // Re-renderizado del PDF responsivo (Debounced)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (currentState.pdfDoc) renderPage(); }, 200);
    });

    if(window.GoogleDriveSync && typeof window.GoogleDriveSync.init === 'function') {
        window.GoogleDriveSync.init();
    }
    
    if(typeof renderAiSources === 'function') {
        renderAiSources();
    }

    document.getElementById('notes-editor').addEventListener('input', () => {
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => saveCurrentNotes(false), AUTO_SAVE_IDLE_MS);
        
        const editor = document.getElementById('notes-editor');
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        const threshold = editorRect.top + editorRect.height * 0.6;
        if (rect.bottom > threshold) {
            editor.scrollBy({ top: rect.bottom - threshold + 24, behavior: 'smooth' });
        }
    });
    
    document.getElementById('notes-editor').addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') {
            document.querySelectorAll('#notes-editor img.selected').forEach(i => i.classList.remove('selected'));
            e.target.classList.add('selected');
        } else {
            document.querySelectorAll('#notes-editor img.selected').forEach(i => i.classList.remove('selected'));
        }
    });

    // Interceptar el pegado para evitar estilos indeseados (ej. color transparente desde el PDF)
    document.getElementById('notes-editor').addEventListener('paste', (e) => {
        e.preventDefault();
        
        // Obtener texto plano del portapapeles
        const text = (e.originalEvent || e).clipboardData.getData('text/plain');
        
        if (text) {
            document.execCommand('insertText', false, text);
        } else {
            // Si no hay texto plano pero hay imágenes
            const items = (e.originalEvent || e).clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const img = document.createElement('img');
                        img.src = event.target.result;
                        img.style.maxWidth = '100%';
                        img.style.borderRadius = '8px';
                        img.style.marginTop = '10px';
                        img.style.marginBottom = '10px';
                        
                        // Insertar imagen
                        const sel = window.getSelection();
                        if (sel.getRangeAt && sel.rangeCount) {
                            const range = sel.getRangeAt(0);
                            range.insertNode(img);
                            // Mover cursor después de la imagen
                            range.setStartAfter(img);
                            range.setEndAfter(img);
                            sel.removeAllRanges();
                            sel.addRange(range);
                        } else {
                            document.getElementById('notes-editor').appendChild(img);
                        }
                    };
                    reader.readAsDataURL(blob);
                }
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            saveCurrentNotes(true);
        }
    });
    window.addEventListener('pagehide', () => {
        saveCurrentNotes(true);
    });
});