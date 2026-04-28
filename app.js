pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ==========================================
// SERVICE WORKER - Para funcionamiento offline
// ==========================================
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js')
            .then(registration => {
                console.log('ServiceWorker registrado:', registration.scope);
            })
            .catch(error => {
                console.log('Error al registrar ServiceWorker:', error);
            });
    });
}

// ==========================================
// 0. BASE DE DATOS INTERNA (IndexedDB)
// ==========================================
let screenshotState = {
    isCapturing: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    canvas: null
};

// Estado para la IA
let aiSourceFileIds = new Set();
let aiCorrectedNotes = {};

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
// 1. ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
let appData = {
    subjects: [], 
    notes: {}     
};

let currentState = {
    currentFileId: null,
    currentSubject: null,
    expandedSubjects: {},
    expandedAiSubjects: {},
    pdfDoc: null,
    pageNum: 1,
    zoom: 1.2,
    isRendering: false
};

let autoSaveTimer = null;

function loadData() {
    const saved = localStorage.getItem('studio_data_v2'); 
    if (saved) {
        try {
            appData = JSON.parse(saved);
            if (!appData.subjects) appData.subjects = [];
            if (!appData.notes) appData.notes = {};
        } catch(e) { console.error("Error loading data", e); }
    } else {
        appData = {
            subjects: [{ id: 'sub_' + Date.now(), name: 'Materia de Ejemplo', icon: 'fa-book', files: [] }],
            notes: {}
        };
        saveData();
    }
}

function saveData() {
    localStorage.setItem('studio_data_v2', JSON.stringify(appData));
}

function clearAllData() {
    if(confirm('¿Estás seguro de que deseas borrar TODOS tus documentos y materias? Esta acción no se puede deshacer.')) {
        localStorage.removeItem('studio_data_v2');
        appData = { subjects: [], notes: {} };
        currentState.currentFileId = null;
        currentState.currentSubject = null;
        renderSubjects();
        showEmptyState('¡Datos borrados!', 'Añade una materia nueva para comenzar.');
        document.getElementById('notes-editor').innerHTML = '';
        showToast('Todos los datos han sido borrados', 'success');
        
        if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            if (typeof saveToDrive === 'function') saveToDrive();
        }
    }
}

// ==========================================
// 3. INTERFAZ Y UTILIDADES
// ==========================================
function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('w-64');
    sidebar.classList.toggle('w-16');
    sidebar.classList.toggle('collapsed');
}

let readingFilterActive = false;
function toggleReadingFilter() {
    readingFilterActive = !readingFilterActive;
    document.body.classList.toggle('reading-filter-active', readingFilterActive);
    const btn = document.getElementById('reading-filter-btn');
    if (readingFilterActive) {
        btn.classList.remove('text-slate-400', 'hover:text-indigo-500');
        btn.classList.add('text-indigo-600');
        btn.querySelector('i').classList.remove('fa-eye');
        btn.querySelector('i').classList.add('fa-eye-slash');
        showToast('Filtro de lectura activado', 'info');
    } else {
        btn.classList.add('text-slate-400', 'hover:text-indigo-500');
        btn.classList.remove('text-indigo-600');
        btn.querySelector('i').classList.add('fa-eye');
        btn.querySelector('i').classList.remove('fa-eye-slash');
    }
}

function toggleNotesPanel() {
    const panel = document.getElementById('notes-panel');
    if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        panel.classList.add('flex');
    } else {
        panel.classList.remove('flex');
        panel.classList.add('hidden');
    }
}

function switchTab(tab) {
    document.getElementById('tab-btn-notes').className = `flex-1 py-2 text-sm font-semibold rounded-md transition-all ${tab === 'notes' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`;
    document.getElementById('tab-btn-ai').className = `flex-1 py-2 text-sm font-semibold rounded-md transition-all ${tab === 'ai' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`;
    
    document.getElementById('tab-content-notes').classList.toggle('hidden', tab !== 'notes');
    document.getElementById('tab-content-notes').classList.toggle('flex', tab === 'notes');
    
    document.getElementById('tab-content-ai').classList.toggle('hidden', tab !== 'ai');
    document.getElementById('tab-content-ai').classList.toggle('flex', tab === 'ai');
}

function openModal(id) { 
    document.getElementById(id).classList.remove('hidden'); 
    if (id === 'manage-subjects-modal') renderManageSubjects();
}
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const color = type === 'success' ? 'bg-emerald-500' : (type === 'error' ? 'bg-red-500' : (type === 'warning' ? 'bg-orange-500' : 'bg-slate-800'));
    toast.className = `${color} text-white px-4 py-2 rounded-lg shadow-lg text-sm flex items-center gap-2 transform transition-all duration-300 translate-y-10 opacity-0`;
    toast.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':(type==='error'?'fa-exclamation-circle':'fa-info-circle')}"></i> ${msg}`;

    container.appendChild(toast);
    
    setTimeout(() => { toast.classList.remove('translate-y-10', 'opacity-0'); }, 10);
    setTimeout(() => {
        toast.classList.add('opacity-0');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==========================================
// 4. GESTIÓN DE MATERIAS Y ARCHIVOS
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
            const icon = f.type === 'pdf' ? 'fa-file-pdf text-rose-400' : 'fa-play-circle text-sky-400';
            // Indicador visual si el archivo está en Drive
            const driveIcon = f.driveId ? '<i class="fas fa-cloud text-[8px] text-blue-300 absolute bottom-1 right-1"></i>' : '';
            return `
                <li class="group cursor-pointer rounded-lg flex items-center justify-between p-2 transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}" onclick="openFile('${sub.id}', '${f.id}')">
                    <div class="flex items-center gap-2 overflow-hidden relative">
                        <i class="fas ${icon} w-5 text-center text-xs relative">${driveIcon}</i>
                        <span class="text-xs truncate hide-on-collapse">${f.name}</span>
                    </div>
                    <button onclick="removeFile(event, '${sub.id}', '${f.id}')" class="opacity-0 group-hover:opacity-100 hover:text-red-400 px-1 hide-on-collapse">
                        <i class="fas fa-times text-[10px]"></i>
                    </button>
                </li>
            `;
        }).join('');

        const isGenActive = currentState.currentFileId === 'gen_' + sub.id;

        li.innerHTML = `
            <div class="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-800 rounded-lg transition-colors" onclick="toggleSubjectAccordion('${sub.id}')">
                <div class="flex items-center gap-3 overflow-hidden">
                    <i class="fas ${sub.icon || 'fa-book'} text-lg center-on-collapse w-6 text-center text-slate-400"></i>
                    <span class="text-sm font-medium truncate hide-on-collapse">${sub.name}</span>
                </div>
                <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} text-xs text-slate-500 hide-on-collapse"></i>
            </div>
            <ul class="${isExpanded ? 'block' : 'hidden'} ml-4 pl-2 border-l border-slate-700 mt-1 space-y-1 hide-on-collapse">
                <li class="group cursor-pointer rounded-lg flex items-center p-2 transition-colors ${isGenActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}" onclick="openGeneralNotes('${sub.id}')">
                    <i class="fas fa-pen-nib w-5 text-center text-xs opacity-70"></i>
                    <span class="text-xs truncate">Notas Generales</span>
                </li>
                ${filesHtml}
                <li class="cursor-pointer rounded-lg flex items-center p-2 text-indigo-400 hover:bg-slate-800 transition-colors" onclick="openAddFileModal('${sub.id}')">
                    <i class="fas fa-plus w-5 text-center text-xs"></i>
                    <span class="text-xs truncate">Añadir Recurso</span>
                </li>
            </ul>
        `;
        list.appendChild(li);
    });
}

function toggleSubjectAccordion(subId) {
    currentState.expandedSubjects[subId] = !currentState.expandedSubjects[subId];
    renderSubjects();
}

function addSubject() {
    const nameInput = document.getElementById('new-subject-name');
    const name = nameInput.value.trim();
    if (!name) return showToast('Escribe un nombre para la materia', 'error');

    const subId = 'sub_' + Date.now().toString(36);
    appData.subjects.push({
        id: subId,
        name: name,
        icon: 'fa-book',
        files: []
    });
    saveData();
    nameInput.value = '';
    renderManageSubjects();
    renderSubjects();

    currentState.currentSubject = subId;
    const notesKey = 'sub_' + subId;
    document.getElementById('notes-editor').innerHTML = appData.notes[notesKey] || '';
    document.getElementById('header-title').textContent = `Notas de ${name}`;
    document.getElementById('header-icon').className = 'fas fa-pen-nib text-indigo-500';

    showToast('Materia creada', 'success');
    
    // Forzar guardado a Drive si existe sesión
    if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
        if (typeof saveToDrive === 'function') saveToDrive();
    }
}

function removeSubject(subId) {
    if (confirm('¿Eliminar esta materia y TODOS sus archivos y apuntes?')) {
        appData.subjects = appData.subjects.filter(s => s.id !== subId);
        delete appData.notes['sub_' + subId];

        saveData();

        if (currentState.currentSubject === subId) {
            currentState.currentSubject = null;
            currentState.currentFileId = null;
            showEmptyState();
        }

        renderManageSubjects();
        renderSubjects();
        if (typeof renderAiSources === 'function') renderAiSources();
        showToast('Materia eliminada', 'success');
        
        // Forzar guardado a Drive
        if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            if (typeof saveToDrive === 'function') saveToDrive();
        }
    }
}

function renderManageSubjects() {
    const list = document.getElementById('modal-subject-list');
    list.innerHTML = '';
    appData.subjects.forEach(sub => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between p-3 hover:bg-slate-50 transition-colors';
        li.innerHTML = `
            <span class="text-sm font-medium text-slate-700">${sub.name}</span>
            <button onclick="removeSubject('${sub.id}')" class="text-red-400 hover:text-red-600 p-1"><i class="fas fa-trash-alt"></i></button>
        `;
        list.appendChild(li);
    });
}

function openAddFileModal(subId = null) {
    if (appData.subjects.length === 0) {
        showToast('Primero debes crear una materia', 'error');
        return openModal('manage-subjects-modal');
    }

    const select = document.getElementById('file-target-subject');
    if (select) {
        select.innerHTML = appData.subjects.map(s => 
            `<option value="${s.id}" ${s.id === subId ? 'selected' : ''}>${s.name}</option>`
        ).join('');
    }
    
    openModal('add-file-modal');
}

function toggleFileInputs() {
    const type = document.getElementById('file-type').value;
    document.getElementById('input-local').classList.toggle('hidden', type !== 'pdf_local');
    document.getElementById('input-url').classList.toggle('hidden', type === 'pdf_local');
}

async function confirmAddFile() {
    const type = document.getElementById('file-type').value;
    const customName = document.getElementById('file-name').value;
    
    const targetSubId = document.getElementById('file-target-subject').value;
    const sub = appData.subjects.find(s => s.id === targetSubId);
    
    if (!sub) return showToast('Por favor selecciona una materia destino', 'error');

    let fileObj = {
        id: 'file_' + Date.now().toString(36),
        name: customName || 'Documento sin título',
        type: type.includes('pdf') ? 'pdf' : 'video',
        url: '',
        isLocal: type === 'pdf_local'
    };

    if (type === 'pdf_local') {
        const input = document.getElementById('file-upload');
        if (input.files.length === 0) return showToast('Por favor selecciona un archivo PDF', 'error');
        
        const file = input.files[0];
        fileObj.name = customName || file.name;
        
        // 🚀 LÓGICA DRIVE VS LOCAL
        if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            try {
                // Subir PDF a Google Drive si hay sesión activa
                const driveId = await uploadPdfToDrive(file, fileObj.name);
                fileObj.driveId = driveId;
                fileObj.isLocal = false; // Ya no lo marcamos como local en indexedDB
            } catch (error) {
                console.error("Fallo subida a Drive:", error);
                showToast('Fallo al subir a Drive. Se guardará localmente.', 'warning');
                await idb.save(fileObj.id, file); 
                fileObj.isLocal = true;
            }
        } else {
            // Guardamos el PDF en IndexedDB (local)
            await idb.save(fileObj.id, file); 
            fileObj.isLocal = true;
        }
        
        finalizeAddFile(sub, fileObj);
    } else {
        const url = document.getElementById('file-url').value;
        if (!url) return showToast('Ingresa un enlace válido', 'error');
        
        if (url.includes('drive.google.com')) {
            const match = url.match(/\/d\/([a-zA-Z0-9-_]+)/) || url.match(/id=([a-zA-Z0-9-_]+)/);
            if (match && match[1]) fileObj.url = `https://drive.google.com/file/d/${match[1]}/preview`;
            else fileObj.url = url;
        } else if (url.includes('youtube.com') || url.includes('youtu.be')) {
            const videoId = url.split('v=')[1]?.split('&')[0] || url.split('youtu.be/')[1];
            fileObj.url = `https://www.youtube.com/embed/${videoId}`;
        } else {
            fileObj.url = url;
        }
        
        if(!customName) fileObj.name = fileObj.type === 'video' ? 'Video Externo' : 'Documento Externo';
        finalizeAddFile(sub, fileObj);
    }
}

function finalizeAddFile(sub, fileObj) {
    sub.files.push(fileObj);
    saveData();

    // Sincronizar instantáneamente con Drive el archivo de texto
    if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
        if (typeof saveToDrive === 'function') saveToDrive();
    }

    currentState.expandedSubjects[sub.id] = true;
    currentState.currentSubject = sub.id;

    renderSubjects();
    if (typeof renderAiSources === 'function') renderAiSources();
    closeModal('add-file-modal');

    document.getElementById('file-name').value = '';
    document.getElementById('file-url').value = '';
    document.getElementById('file-upload').value = '';

    showToast('Recurso añadido correctamente', 'success');
    openFile(sub.id, fileObj.id);
}

async function removeFile(e, subId, fileId) {
    e.stopPropagation();
    if(confirm('¿Eliminar este archivo y sus apuntes asociados?')) {
        const sub = appData.subjects.find(s => s.id === subId);
        const file = sub.files.find(f => f.id === fileId);
        
        // 🚀 LÓGICA DE BORRADO DRIVE VS LOCAL
        if (file && file.driveId) {
            // Borrar PDF pesado de Drive
            await deletePdfFromDrive(file.driveId);
        } else if (file && file.isLocal) {
            // Borrar de IndexedDB
            await idb.delete(fileId);
        }

        sub.files = sub.files.filter(f => f.id !== fileId);
        delete appData.notes[fileId];
        saveData();
        
        // Forzar sincronización de metadatos en la nube
        if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            if (typeof saveToDrive === 'function') saveToDrive();
        }

        renderSubjects();
        if(currentState.currentFileId === fileId) showEmptyState();
    }
}

// ==========================================
// 5. VISOR MULTIMEDIA
// ==========================================
function showEmptyState(title = 'Ningún archivo seleccionado', desc = 'Añade un PDF o Video desde el panel izquierdo.') {
    currentState.currentFileId = null;
    document.getElementById('empty-state').classList.remove('hidden');
    document.getElementById('pdf-canvas').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('pdf-controls').classList.add('hidden');
    
    document.getElementById('empty-state-icon').className = 'fas fa-folder-open text-indigo-300 text-3xl';
    document.getElementById('empty-state-title').textContent = title;
    document.getElementById('empty-state-desc').textContent = desc;

    document.getElementById('header-title').textContent = 'Workspace';
    document.getElementById('header-icon').className = 'fas fa-layer-group text-slate-400';
    document.getElementById('notes-editor').innerHTML = '';
}

function openGeneralNotes(subId) {
    const sub = appData.subjects.find(s => s.id === subId);
    if (!sub) return;

    saveCurrentNotes();

    currentState.currentSubject = subId;
    currentState.currentFileId = 'gen_' + subId;
    document.getElementById('header-title').textContent = `Notas de ${sub.name}`;
    document.getElementById('header-icon').className = `fas fa-pen-nib text-indigo-500`;

    const notesKey = 'sub_' + subId;
    document.getElementById('notes-editor').innerHTML = appData.notes[notesKey] || '';
    renderSubjects();

    document.getElementById('pdf-canvas').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('pdf-controls').classList.add('hidden');

    const emptyState = document.getElementById('empty-state');
    emptyState.classList.remove('hidden');
    document.getElementById('empty-state-icon').className = 'fas fa-book-open text-indigo-300 text-3xl';
    document.getElementById('empty-state-title').textContent = `Notas de ${sub.name}`;
    document.getElementById('empty-state-desc').textContent = `Utiliza el panel derecho para escribir apuntes de la materia.`;
}

async function openFile(subId, fileId) {
    const sub = appData.subjects.find(s => s.id === subId);
    const file = sub.files.find(f => f.id === fileId);
    if (!file) return;

    saveCurrentNotes();

    currentState.currentSubject = subId;
    currentState.currentFileId = fileId;
    document.getElementById('header-title').textContent = `${sub.name} - ${file.name}`;
    document.getElementById('header-icon').className = `fas ${file.type === 'pdf' ? 'fa-file-pdf text-rose-500' : 'fa-play-circle text-sky-500'}`;

    const notesKey = 'sub_' + subId;
    document.getElementById('notes-editor').innerHTML = appData.notes[notesKey] || '';
    renderSubjects();

    document.getElementById('empty-state').classList.add('hidden');
    const pdfCanvas = document.getElementById('pdf-canvas');
    const videoCont = document.getElementById('video-container');
    const pdfControls = document.getElementById('pdf-controls');

    if (file.type === 'pdf') {
        videoCont.classList.add('hidden');
        videoCont.innerHTML = '';
        
        // 🚀 LÓGICA LECTURA DRIVE VS LOCAL
        if (file.driveId) {
            try {
                showToast('Descargando PDF desde la nube de Drive...', 'info');
                pdfCanvas.classList.remove('hidden');
                pdfControls.classList.remove('hidden');
                
                const blob = await downloadPdfFromDrive(file.driveId);
                const url = URL.createObjectURL(blob);
                
                const loadingTask = pdfjsLib.getDocument(url);
                currentState.pdfDoc = await loadingTask.promise;
                currentState.pageNum = 1;
                renderPage();
            } catch (error) {
                console.error(error);
                showToast('Error descargando el PDF desde Drive.', 'error');
            }
        } 
        else if (file.isLocal) {
            const blob = await idb.get(fileId);
            if (!blob) {
                showEmptyState('Error de lectura', 'El PDF local ya no existe en este dispositivo.');
                return;
            }
            const url = URL.createObjectURL(blob);
            pdfCanvas.classList.remove('hidden');
            pdfControls.classList.remove('hidden');
            try {
                const loadingTask = pdfjsLib.getDocument(url);
                currentState.pdfDoc = await loadingTask.promise;
                currentState.pageNum = 1;
                renderPage();
            } catch (error) {
                showToast('Error al leer el PDF.', 'error');
            }
        } 
        else if (file.url && file.url.includes('drive.google.com')) {
            pdfCanvas.classList.add('hidden');
            pdfControls.classList.add('hidden');
            videoCont.classList.remove('hidden');
            videoCont.innerHTML = `<iframe src="${file.url}" class="w-full h-full border-0"></iframe>`;
        } 
        else {
            pdfCanvas.classList.remove('hidden');
            pdfControls.classList.remove('hidden');
            try {
                const loadingTask = pdfjsLib.getDocument(file.url);
                currentState.pdfDoc = await loadingTask.promise;
                currentState.pageNum = 1;
                renderPage();
            } catch (error) {
                showToast('El servidor del PDF bloqueó el acceso (CORS).', 'error');
            }
        }
    } else if (file.type === 'video') {
        pdfCanvas.classList.add('hidden');
        pdfControls.classList.add('hidden');
        videoCont.classList.remove('hidden');
        videoCont.innerHTML = `<iframe src="${file.url}" class="w-full h-full border-0" allowfullscreen allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
    }
}

async function renderPage() {
    if (!currentState.pdfDoc || currentState.isRendering) return;
    currentState.isRendering = true;

    try {
        const page = await currentState.pdfDoc.getPage(currentState.pageNum);
        const canvas = document.getElementById('pdf-canvas');
        const ctx = canvas.getContext('2d');
        
        const viewport = page.getViewport({ scale: currentState.zoom });
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        const renderContext = { canvasContext: ctx, viewport: viewport };
        await page.render(renderContext).promise;

        document.getElementById('page-info').textContent = `${currentState.pageNum} / ${currentState.pdfDoc.numPages}`;
        document.getElementById('zoom-info').textContent = `${Math.round(currentState.zoom * 100)}%`;
    } catch (error) {
        console.error('Error renderizando página', error);
    }
    currentState.isRendering = false;
}

function changePage(delta) {
    if (!currentState.pdfDoc) return;
    const newPage = currentState.pageNum + delta;
    if (newPage >= 1 && newPage <= currentState.pdfDoc.numPages) {
        currentState.pageNum = newPage;
        renderPage();
        showToast(`Página ${currentState.pageNum}`, 'info');
    }
}

function changeZoom(delta) {
    const newZoom = currentState.zoom + delta;
    if (newZoom >= 0.5 && newZoom <= 3.0) {
        currentState.zoom = newZoom;
        renderPage();
        showToast(`Zoom: ${Math.round(currentState.zoom * 100)}%`, 'info');
    }
}

// ==========================================
// 8. NAVEGACIÓN CON TECLADO
// ==========================================
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
        e.preventDefault();
        if (currentState.pdfDoc) changePage(e.key === 'ArrowRight' ? 1 : -1);
    }
    if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (currentState.pdfDoc) changeZoom(e.key === 'ArrowUp' ? 0.2 : -0.2);
    }
});

// ==========================================
// 9. CAPTURAS DE PANTALLA CON Ctrl + ARRASTRAR
// ==========================================
let screenshotSelection = {
    active: false,
    startX: 0,
    startY: 0,
    endX: 0,
    endY: 0,
    element: null
};

const screenshotOverlay = document.createElement('div');
screenshotOverlay.id = 'screenshot-overlay';
screenshotOverlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:crosshair;display:none;';
screenshotOverlay.style.background = 'rgba(0,0,0,0.3)';
document.body.appendChild(screenshotOverlay);

const selectionBox = document.createElement('div');
selectionBox.id = 'screenshot-selection';
selectionBox.style.cssText = 'position:absolute;border:2px dashed #fff;background:rgba(255,255,255,0.1);display:none;pointer-events:none;';
screenshotOverlay.appendChild(selectionBox);

document.getElementById('media-viewer').addEventListener('mousedown', (e) => {
    if (e.ctrlKey && currentState.pdfDoc) {
        e.preventDefault();
        startScreenshotCapture(e);
    }
});

function startScreenshotCapture(e) {
    screenshotSelection.active = true;
    screenshotSelection.startX = e.clientX;
    screenshotSelection.startY = e.clientY;
    
    screenshotOverlay.style.display = 'block';
    selectionBox.style.display = 'block';
    selectionBox.style.left = e.clientX + 'px';
    selectionBox.style.top = e.clientY + 'px';
    selectionBox.style.width = '0';
    selectionBox.style.height = '0';
    
    document.addEventListener('mousemove', updateScreenshotSelection);
    document.addEventListener('mouseup', finishScreenshotCapture);
}

function updateScreenshotSelection(e) {
    if (!screenshotSelection.active) return;
    const currentX = e.clientX;
    const currentY = e.clientY;
    const left = Math.min(screenshotSelection.startX, currentX);
    const top = Math.min(screenshotSelection.startY, currentY);
    const width = Math.abs(currentX - screenshotSelection.startX);
    const height = Math.abs(currentY - screenshotSelection.startY);
    
    selectionBox.style.left = left + 'px';
    selectionBox.style.top = top + 'px';
    selectionBox.style.width = width + 'px';
    selectionBox.style.height = height + 'px';
    
    screenshotSelection.endX = currentX;
    screenshotSelection.endY = currentY;
}

async function finishScreenshotCapture(e) {
    if (!screenshotSelection.active) return;
    
    document.removeEventListener('mousemove', updateScreenshotSelection);
    document.removeEventListener('mouseup', finishScreenshotCapture);
    
    const width = Math.abs(screenshotSelection.endX - screenshotSelection.startX);
    const height = Math.abs(screenshotSelection.endY - screenshotSelection.startY);
    
    if (width > 10 && height > 10) {
        try {
            const startX = Math.min(screenshotSelection.startX, screenshotSelection.endX);
            const startY = Math.min(screenshotSelection.startY, screenshotSelection.endY);
            
            const pdfCanvas = document.getElementById('pdf-canvas');
            let imgData;
            
            if (!pdfCanvas.classList.contains('hidden') && currentState.pdfDoc) {
                const canvasRect = pdfCanvas.getBoundingClientRect();
                const relX = startX - canvasRect.left;
                const relY = startY - canvasRect.top;
                const relWidth = Math.min(width, canvasRect.width - relX);
                const relHeight = Math.min(height, canvasRect.height - relY);
                
                if (relX >= 0 && relY >= 0 && relWidth > 0 && relHeight > 0) {
                    const captureCanvas = document.createElement('canvas');
                    captureCanvas.width = relWidth;
                    captureCanvas.height = relHeight;
                    const ctx = captureCanvas.getContext('2d');
                    
                    ctx.drawImage(
                        pdfCanvas,
                        relX, relY, relWidth, relHeight,
                        0, 0, relWidth, relHeight
                    );
                    imgData = captureCanvas.toDataURL('image/png');
                } else {
                    imgData = await captureWithHtml2Canvas(startX, startY, width, height);
                }
            } else {
                imgData = await captureWithHtml2Canvas(startX, startY, width, height);
            }
            
            insertImageInEditor(imgData);
            showToast('Captura insertada en los apuntes', 'success');
        } catch (error) {
            console.error('Error capturando pantalla:', error);
            showToast('Error al capturar pantalla: ' + error.message, 'error');
        }
    }
    
    screenshotOverlay.style.display = 'none';
    selectionBox.style.display = 'none';
    screenshotSelection.active = false;
}

async function captureWithHtml2Canvas(startX, startY, width, height) {
    const captureCanvas = await html2canvas(document.body, {
        x: startX,
        y: startY,
        width: width,
        height: height,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        scale: 1
    });
    return captureCanvas.toDataURL('image/png');
}

function insertImageInEditor(dataUrl) {
    const editor = document.getElementById('notes-editor');
    editor.focus();
    
    const img = document.createElement('img');
    img.src = dataUrl;
    img.style.cssText = 'max-width:200px;height:auto;display:inline;float:left;margin:0 10px 10px 0;border-radius:4px;cursor:move;';
    img.contentEditable = 'false';
    
    img.addEventListener('click', (e) => {
        e.preventDefault();
        showImageControls(img);
    });
    
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.insertNode(img);
        range.setStartAfter(img);
        range.setEndAfter(img);
        selection.removeAllRanges();
        selection.addRange(range);
    } else {
        editor.appendChild(img);
    }
    
    clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
        if (currentState.currentSubject) {
            const notesKey = 'sub_' + currentState.currentSubject;
            appData.notes[notesKey] = editor.innerHTML;
            saveData();
        }
    }, 1000);
}

// ==========================================
// 10. CONTROLES DE EDICIÓN DE IMÁGENES
// ==========================================
let imageControls = null;
let selectedImage = null;

function showImageControls(img) {
    selectedImage = img;
    
    if (imageControls) imageControls.remove();
    
    imageControls = document.createElement('div');
    imageControls.style.cssText = 'position:fixed;z-index:1000;background:white;border:1px solid #e2e8f0;border-radius:8px;padding:8px;box-shadow:0 4px 6px rgba(0,0,0,0.1);display:flex;gap:8px;align-items:center;';
    
    const alignLeft = document.createElement('button');
    alignLeft.innerHTML = '<i class="fas fa-align-left"></i>';
    alignLeft.className = 'px-2 py-1 hover:bg-slate-100 rounded';
    alignLeft.onclick = () => { alignImage('left'); };
    
    const alignCenter = document.createElement('button');
    alignCenter.innerHTML = '<i class="fas fa-align-center"></i>';
    alignCenter.className = 'px-2 py-1 hover:bg-slate-100 rounded';
    alignCenter.onclick = () => { alignImage('center'); };
    
    const alignRight = document.createElement('button');
    alignRight.innerHTML = '<i class="fas fa-align-right"></i>';
    alignRight.className = 'px-2 py-1 hover:bg-slate-100 rounded';
    alignRight.onclick = () => { alignImage('right'); };
    
    const sizeSlider = document.createElement('input');
    sizeSlider.type = 'range';
    sizeSlider.min = '50';
    sizeSlider.max = '400';
    sizeSlider.value = img.width || 200;
    sizeSlider.className = 'w-24';
    sizeSlider.oninput = (e) => { resizeImage(parseInt(e.target.value)); };
    
    const deleteBtn = document.createElement('button');
    deleteBtn.innerHTML = '<i class="fas fa-trash text-red-500"></i>';
    deleteBtn.className = 'px-2 py-1 hover:bg-red-50 rounded';
    deleteBtn.onclick = () => { deleteImage(); };
    
    imageControls.appendChild(alignLeft);
    imageControls.appendChild(alignCenter);
    imageControls.appendChild(alignRight);
    imageControls.appendChild(sizeSlider);
    imageControls.appendChild(deleteBtn);
    
    const rect = img.getBoundingClientRect();
    imageControls.style.left = rect.left + 'px';
    imageControls.style.top = (rect.top - 40) + 'px';
    
    document.body.appendChild(imageControls);
    
    setTimeout(() => {
        document.addEventListener('click', closeImageControls);
    }, 100);
}

function closeImageControls(e) {
    if (imageControls && !imageControls.contains(e.target) && e.target !== selectedImage) {
        imageControls.remove();
        imageControls = null;
        selectedImage = null;
        document.removeEventListener('click', closeImageControls);
    }
}

function resizeImage(width) {
    if (selectedImage) {
        selectedImage.style.width = width + 'px';
        selectedImage.style.height = 'auto';
    }
}

function alignImage(alignment) {
    if (selectedImage) {
        selectedImage.style.float = alignment === 'center' ? 'none' : alignment;
        if (alignment === 'center') {
            selectedImage.style.display = 'block';
            selectedImage.style.margin = '0 auto';
        } else {
            selectedImage.style.display = 'inline';
            selectedImage.style.margin = '0 10px 10px 0';
        }
    }
}

function deleteImage() {
    if (selectedImage) {
        selectedImage.remove();
        if (imageControls) {
            imageControls.remove();
            imageControls = null;
        }
        selectedImage = null;
        
        clearTimeout(autoSaveTimer);
        autoSaveTimer = setTimeout(() => {
            if (currentState.currentSubject) {
                const notesKey = 'sub_' + currentState.currentSubject;
                appData.notes[notesKey] = document.getElementById('notes-editor').innerHTML;
                saveData();
            }
        }, 1000);
    }
}

// ==========================================
// 11. ESTILOS CSS PARA IMÁGENES
// ==========================================
const style = document.createElement('style');
style.textContent = `
    #notes-editor img {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        transition: box-shadow 0.2s;
    }
    #notes-editor img:hover {
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
        cursor: pointer;
    }
    #notes-editor img.selected {
        outline: 2px solid #4f46e5;
        outline-offset: 2px;
    }
`;
document.head.appendChild(style);

// ==========================================
// 6. EXPORTACIÓN
// ==========================================
function exportNotesAsDocx() {
    let content = document.getElementById('notes-editor').innerHTML;
    if(!content.trim() && !document.getElementById('notes-editor').innerText.trim()) {
        return showToast('El documento está vacío', 'error');
    }

    content = content
        .replace(/<h1[^>]*>/gi, '<h1 style="font-family: Arial, sans-serif; font-size: 24pt; font-weight: bold; color: #3730a3; margin-top: 24pt; margin-bottom: 12pt; border-bottom: 2pt solid #c7d2fe; padding-bottom: 6pt;">')
        .replace(/<h2[^>]*>/gi, '<h2 style="font-family: Arial, sans-serif; font-size: 18pt; font-weight: bold; color: #4338ca; margin-top: 18pt; margin-bottom: 8pt; border-bottom: 1pt solid #e0e7ff; padding-bottom: 4pt;">')
        .replace(/<h3[^>]*>/gi, '<h3 style="font-family: Arial, sans-serif; font-size: 14pt; font-weight: bold; color: #1e293b; margin-top: 14pt; margin-bottom: 6pt;">')
        .replace(/<ul[^>]*>/gi, '<ul style="margin-top: 6pt; margin-bottom: 6pt; padding-left: 20pt; list-style-type: disc;">')
        .replace(/<ol[^>]*>/gi, '<ol style="margin-top: 6pt; margin-bottom: 6pt; padding-left: 20pt; list-style-type: decimal;">')
        .replace(/<li[^>]*>/gi, '<li style="margin-bottom: 3pt;">')
        .replace(/<p[^>]*>/gi, '<p style="margin-top: 6pt; margin-bottom: 6pt; line-height: 1.5;">')
        .replace(/<strong[^>]*>/gi, '<strong style="font-weight: bold;">')
        .replace(/<b\b[^>]*>/gi, '<b style="font-weight: bold;">')
        .replace(/<em[^>]*>/gi, '<em style="font-style: italic;">')
        .replace(/<i\b[^>]*>/gi, '<i style="font-style: italic;">')
        .replace(/<br\s*\/?>/gi, '<br style="mso-data-placement:same-cell;" />');

    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' " +
        "xmlns:w='urn:schemas-microsoft-com:office:word' " +
        "xmlns='http://www.w3.org/TR/REC-html40'>" +
        "<head><meta charset='utf-8'><title>Apuntes</title>" +
        "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->" +
        "<style>body{font-family: Arial, sans-serif; line-height: 1.5; color: #333333; font-size: 11pt;} p{margin:0 0 10pt 0;} </style>" +
        "</head><body>";
    const footer = "</body></html>";
    const sourceHTML = header + content + footer;
    
    const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    
    const fileDownload = document.createElement("a");
    fileDownload.href = url;
    const fileName = document.getElementById('header-title').textContent || 'Apuntes';
    const safeFileName = fileName.replace(/[<>:"/\\|?*]/g, '');
    fileDownload.download = `Apuntes_${safeFileName}.doc`;
    document.body.appendChild(fileDownload);
    fileDownload.click();
    document.body.removeChild(fileDownload);
    URL.revokeObjectURL(url);
    
    showToast('Documento Word descargado exitosamente', 'success');
}

// ==========================================
// 6bis. UTILIDADES IA
// ==========================================
function toggleAiSource(fileId) {
    if (aiSourceFileIds.has(fileId)) {
        aiSourceFileIds.delete(fileId);
    } else {
        aiSourceFileIds.add(fileId);
    }
    if (typeof renderAiSources === 'function') renderAiSources();
}

function renderAiSources() {
    const container = document.getElementById('ai-sources-list');
    if (!container) return;

    if (appData.subjects.length === 0) {
        container.innerHTML = '<p class="text-xs text-slate-400 italic p-2">No hay materias. Creá una primero.</p>';
        const countEl = document.getElementById('ai-source-count');
        if (countEl) countEl.textContent = '0 seleccionadas';
        return;
    }

    let html = '';
    let totalCount = 0;

    for (const sub of appData.subjects) {
        const pdfFiles = sub.files.filter(f => f.type === 'pdf');
        if (pdfFiles.length === 0) continue;

        const isExpanded = currentState.expandedAiSubjects?.[sub.id] || false;
        const selectedCount = pdfFiles.filter(f => aiSourceFileIds.has(f.id)).length;

        html += `
            <div class="mb-1">
                <div class="flex items-center justify-between px-2 py-1 rounded hover:bg-slate-200/50 cursor-pointer text-[11px] font-semibold text-slate-600"
                     onclick="toggleAiSubjectAccordion('${sub.id}')">
                    <span><i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} text-[8px] mr-1"></i>${sub.name} (${selectedCount}/${pdfFiles.length})</span>
                </div>
                <div class="${isExpanded ? 'block' : 'hidden'} ml-2 mt-0.5 space-y-0.5">
        `;

        for (const f of pdfFiles) {
            totalCount++;
            const checked = aiSourceFileIds.has(f.id);
            // Mostrar un indicativo si es Drive o Local
            const sourceIcon = f.driveId ? '<i class="fas fa-cloud text-blue-400 text-[10px]"></i>' : '<i class="fas fa-hdd text-slate-400 text-[10px]"></i>';
            
            html += `
                <label class="flex items-center gap-1.5 px-2 py-1 rounded hover:bg-slate-100 cursor-pointer text-[11px]">
                    <input type="checkbox" ${checked ? 'checked' : ''} onchange="toggleAiSource('${f.id}')" class="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3 h-3">
                    <span class="truncate text-slate-600 flex-1">${f.name}</span>
                    ${sourceIcon}
                </label>
            `;
        }
        html += `</div></div>`;
    }

    if (!html) {
        html = '<p class="text-xs text-slate-400 italic p-2">No hay archivos PDF.</p>';
    }

    container.innerHTML = html;
    const countEl = document.getElementById('ai-source-count');
    if (countEl) countEl.textContent = `${aiSourceFileIds.size} seleccionada${aiSourceFileIds.size !== 1 ? 's' : ''}`;
}

function toggleAiSubjectAccordion(subId) {
    if (!currentState.expandedAiSubjects) currentState.expandedAiSubjects = {};
    currentState.expandedAiSubjects[subId] = !currentState.expandedAiSubjects[subId];
    renderAiSources();
}

function showLoading(msg = 'Procesando...') {
    const el = document.getElementById('loading');
    const msgEl = document.getElementById('loading-msg');
    if (el) el.classList.remove('hidden');
    if (msgEl) msgEl.textContent = msg;
}

function hideLoading() {
    const el = document.getElementById('loading');
    if (el) el.classList.add('hidden');
}

function saveCurrentNotes() {
    const editor = document.getElementById('notes-editor');
    if (!editor || !currentState.currentSubject) return;
    clearTimeout(autoSaveTimer);
    const notesKey = 'sub_' + currentState.currentSubject;
    appData.notes[notesKey] = editor.innerHTML;
    saveData();
}

// ==========================================
// RESUMEN LOCAL SIN IA (Llamada al script aparte)
// ==========================================
async function generarResumenDirecto() {
    try {
        const userNotes = document.getElementById('notes-editor').innerText;
        
        if (!userNotes || userNotes.trim().length < 20) {
            showToast('Por favor escribe algunas notas primero', 'warning');
            return;
        }
        if (!currentState.pdfDoc) {
            showToast('Por favor abre un PDF primero', 'warning');
            return;
        }
        
        showLoading('🔍 Analizando PDF...');
        
        let fullText = '';
        const numPages = currentState.pdfDoc.numPages;
        
        for (let pageNum = 1; pageNum <= Math.min(numPages, 80); pageNum++) {
            const page = await currentState.pdfDoc.getPage(pageNum);
            const textContent = await page.getTextContent();
            
            let lastY = -1;
            let pageText = '';
            
            for (const item of textContent.items) {
                if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 10) {
                    pageText += '\n\n';
                }
                pageText += item.str + ' ';
                lastY = item.transform[5];
            }
            fullText += pageText + '\n\n';
        }
        
        hideLoading();
        
        const summary = LocalSummary.generate(fullText, userNotes, 'PRECISE');
        
        document.getElementById('ai-fullscreen-title').textContent = '✅ Resumen Generado';
        document.getElementById('ai-fullscreen-content').textContent = summary;
        document.getElementById('ai-fullscreen').classList.remove('hidden');
        
        document.getElementById('ai-fullscreen-footer').innerHTML = 
            `<span>✅ Listo - Resumen generado completamente localmente sin IA</span>`;
        showToast('✅ Resumen listo', 'success');
        
    } catch (error) {
        hideLoading();
        console.error('Error generando resumen:', error);
        showToast('Error al generar el resumen: ' + error.message, 'error');
    }
}

// ==========================================
// UI PANTALLA COMPLETA
// ==========================================
function openAIFullscreen(content, title) {
    document.getElementById('ai-fullscreen-title').textContent = title;
    document.getElementById('ai-fullscreen-content').textContent = content;
    document.getElementById('ai-fullscreen').classList.remove('hidden');
}

function closeAIFullscreen() {
    document.getElementById('ai-fullscreen').classList.add('hidden');
}

let isEditingAiResult = false;
function toggleEditAIResult() {
    const btn = document.getElementById('ai-edit-btn');
    const content = document.getElementById('ai-fullscreen-content');
    isEditingAiResult = !isEditingAiResult;
    
    if (isEditingAiResult) {
        content.classList.add('ring-2', 'ring-indigo-500', 'ring-inset', 'bg-slate-50', 'rounded-lg');
        btn.innerHTML = '<i class="fas fa-save"></i> Dejar de editar';
        btn.classList.replace('bg-slate-600', 'bg-indigo-600');
        btn.classList.replace('hover:bg-slate-700', 'hover:bg-indigo-700');
        content.focus();
    } else {
        content.classList.remove('ring-2', 'ring-indigo-500', 'ring-inset', 'bg-slate-50', 'rounded-lg');
        btn.innerHTML = '<i class="fas fa-edit"></i> Editar';
        btn.classList.replace('bg-indigo-600', 'bg-slate-600');
        btn.classList.replace('hover:bg-indigo-700', 'hover:bg-slate-700');
    }
}

function downloadAIResult() {
    const rawText = document.getElementById('ai-fullscreen-content').innerText;
    if(!rawText.trim()) return showToast('El contenido está vacío', 'error');

    const htmlContent = rawText
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") 
        .split('\n\n').map(p => `<p style="margin-top: 6pt; margin-bottom: 6pt; line-height: 1.5;">${p.replace(/\n/g, '<br style="mso-data-placement:same-cell;" />')}</p>`)
        .join('');

    const header = "<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'><head><meta charset='utf-8'><title>Resultado IA</title><style>body{font-family: Arial, sans-serif; line-height: 1.5; color: #333333; font-size: 11pt;} p{margin:0 0 10pt 0;} </style></head><body>";
    const footer = "</body></html>";
    const sourceHTML = header + htmlContent + footer;
    
    const blob = new Blob(['\ufeff', sourceHTML], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    
    const fileDownload = document.createElement("a");
    fileDownload.href = url;
    fileDownload.download = `Resultado_IA.doc`;
    document.body.appendChild(fileDownload);
    fileDownload.click();
    document.body.removeChild(fileDownload);
    URL.revokeObjectURL(url);
    
    showToast('Documento Word descargado exitosamente', 'success');
}

// ==========================================
// INICIALIZACIÓN DE LA APP
// ==========================================
document.addEventListener('DOMContentLoaded', async () => {
    loadData();
    await idb.init();
    renderSubjects();
    if (typeof renderAiSources === 'function') renderAiSources();

    if (currentState.currentSubject && appData.subjects.find(s => s.id === currentState.currentSubject)) {
        const sub = appData.subjects.find(s => s.id === currentState.currentSubject);
        const notesKey = 'sub_' + currentState.currentSubject;
        document.getElementById('notes-editor').innerHTML = appData.notes[notesKey] || '';
        document.getElementById('header-title').textContent = `Notas de ${sub.name}`;
        document.getElementById('header-icon').className = `fas fa-pen-nib text-indigo-500`;
    } else {
        showEmptyState('Seleccioná una materia', 'Tus notas y archivos aparecerán aquí.');
    }

    const editor = document.getElementById('notes-editor');
    if (editor) {
        editor.addEventListener('input', () => {
            clearTimeout(autoSaveTimer);
            autoSaveTimer = setTimeout(() => {
                if (currentState.currentSubject) {
                    const notesKey = 'sub_' + currentState.currentSubject;
                    appData.notes[notesKey] = editor.innerHTML;
                    saveData();
                }
            }, 1500); 
        });

        window.addEventListener('beforeunload', () => {
            if (currentState.currentSubject) {
                const notesKey = 'sub_' + currentState.currentSubject;
                appData.notes[notesKey] = editor.innerHTML;
                saveData();
            }
        });
    }
});

// ==========================================
// INTEGRACIÓN CON IA (GEMINI)
// ==========================================
let pendingAIFunction = null;

function requireApiKey(callback) {
    const key = localStorage.getItem('gemini_api_key');
    if (key && key.length > 10) {
        callback(key);
    } else {
        pendingAIFunction = callback;
        document.getElementById('api-modal').classList.remove('hidden');
    }
}

function saveApiKey() {
    const key = document.getElementById('api-key-input').value.trim();
    if (key) {
        localStorage.setItem('gemini_api_key', key);
        document.getElementById('api-modal').classList.add('hidden');
        if (pendingAIFunction) {
            const cb = pendingAIFunction;
            pendingAIFunction = null;
            cb(key);
        }
    } else {
        showToast('Ingresa una API Key válida', 'error');
    }
}

function openApiModal() {
    document.getElementById('api-modal').classList.remove('hidden');
}

async function summarizeWithAI() {
    requireApiKey(async (apiKey) => {
        try {
            const userNotes = document.getElementById('notes-editor').innerText;
            
            if (!userNotes || userNotes.trim().length < 20) {
                showToast('Por favor escribe algunas notas primero para que la IA sepa qué completar.', 'warning');
                return;
            }
            if (!currentState.pdfDoc) {
                showToast('Por favor abre un PDF primero', 'warning');
                return;
            }
            
            showLoading('🤖 IA analizando y completando tus apuntes...');
            
            let fullText = '';
            const numPages = currentState.pdfDoc.numPages;
            for (let pageNum = 1; pageNum <= Math.min(numPages, 80); pageNum++) {
                const page = await currentState.pdfDoc.getPage(pageNum);
                const textContent = await page.getTextContent();
                let lastY = -1;
                let pageText = '';
                for (const item of textContent.items) {
                    if (lastY !== -1 && Math.abs(item.transform[5] - lastY) > 10) {
                        pageText += '\n\n';
                    }
                    pageText += item.str + ' ';
                    lastY = item.transform[5];
                }
                fullText += pageText + '\n\n';
            }
            
            const extractedContext = LocalSummary.generate(fullText, userNotes, 'PRECISE');
            
            const prompt = `Actúa como un profesor experto y creador de material de estudio universitario.
Tu tarea es tomar los apuntes iniciales del alumno y transformarlos en un APUNTE COMPLETO, DETALLADO y EXTENSO utilizando la información extraída del libro/documento como base principal de conocimiento.

📚 CONTEXTO EXTRAÍDO DEL DOCUMENTO:
${extractedContext.substring(0, 20000)}

📝 APUNTES INICIALES DEL ALUMNO:
${userNotes}

INSTRUCCIONES CRÍTICAS:
1. El resultado debe ser una GUÍA DE ESTUDIO MUY EXTENSA Y DETALLADA. Redacta párrafos completos.
2. Expande cada tema mencionado usando TODO el detalle anatómico, fisiológico y clínico disponible en el contexto.
3. Estructura el texto claramente usando TÍTULOS EN MAYÚSCULAS y doble salto de línea (Enter).
4. NO uses formato Markdown con asteriscos (**) ni numerales (#). 
5. Mantén un tono académico y explicativo. Escribe de manera fluida y narrativa.
6. Devuelve ÚNICAMENTE el texto de los apuntes mejorados.`;

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.3 }
                })
            });

            hideLoading();

            if (!res.ok) {
                if (res.status === 429) throw new Error('Demasiadas solicitudes. Espera un momento.');
                if (res.status === 403 || res.status === 400) {
                    localStorage.removeItem('gemini_api_key');
                    throw new Error('API Key inválida. Por favor, reconfigúrala.');
                }
                throw new Error('Error en la respuesta de la IA: ' + res.status);
            }

            const data = await res.json();
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!aiText) throw new Error('La IA no devolvió contenido válido.');

            document.getElementById('ai-fullscreen-title').innerHTML = '<i class="fas fa-magic text-indigo-500"></i> Apuntes Mejorados por IA';
            document.getElementById('ai-fullscreen-content').textContent = aiText;
            document.getElementById('ai-fullscreen-footer').innerHTML = 
                `<button onclick="replaceNotesWithAI()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors shadow-sm flex items-center gap-2"><i class="fas fa-check"></i> Reemplazar mis apuntes con esta versión</button>
                 <span class="text-slate-500 text-sm ml-4">Puedes editar el texto arriba antes de guardar.</span>`;
            document.getElementById('ai-fullscreen').classList.remove('hidden');
            
            window.lastAiGeneratedNotes = aiText;
            showToast('✅ Apuntes mejorados por IA', 'success');

        } catch (error) {
            hideLoading();
            console.error('Error con IA:', error);
            showToast('Error: ' + error.message, 'error');
            if (error.message.includes('API Key inválida')) openApiModal();
        }
    });
}

function replaceNotesWithAI() {
    const editor = document.getElementById('notes-editor');
    const finalContent = document.getElementById('ai-fullscreen-content').textContent || document.getElementById('ai-fullscreen-content').innerText;
    
    if (editor && finalContent) {
        let htmlText = finalContent;
        htmlText = htmlText.replace(/\n\n/g, '[[DBL_NEWLINE]]');
        htmlText = htmlText.replace(/\n/g, '[[NEWLINE]]');
        
        htmlText = htmlText.replace(/^([A-ZÁÉÍÓÚÑ0-9\s.,:\-()]{5,})(?=\[\[NEWLINE\]\]|\[\[DBL_NEWLINE\]\]|$)/gm, '<h2 class="font-bold text-xl mt-5 mb-2 text-indigo-700 border-b border-indigo-100 pb-1">$1</h2>');
        
        htmlText = htmlText
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/^### (.*$)/gim, '<h3 class="font-bold text-lg mt-3 mb-1 text-slate-800">$1</h3>')
            .replace(/^## (.*$)/gim, '<h2 class="font-bold text-xl mt-5 mb-2 text-indigo-700 border-b border-indigo-100 pb-1">$1</h2>')
            .replace(/^# (.*$)/gim, '<h1 class="font-bold text-2xl mt-6 mb-3 text-indigo-800 border-b-2 border-indigo-200 pb-2">$1</h1>')
            .replace(/^- (.*$)/gim, '<li class="ml-5 list-disc mb-1">$1</li>')
            .replace(/^\d+\. (.*$)/gim, '<li class="ml-5 list-decimal mb-1">$1</li>');
            
        htmlText = htmlText.replace(/\[\[DBL_NEWLINE\]\]/g, '<br><br>');
        htmlText = htmlText.replace(/\[\[NEWLINE\]\](?!<li|<h|<br)/g, '<br>');
        htmlText = htmlText.replace(/\[\[NEWLINE\]\]/g, ''); 
            
        editor.innerHTML = htmlText;
        showToast('✅ Apuntes actualizados', 'success');
        closeAIFullscreen();
        
        const event = new Event('input');
        editor.dispatchEvent(event);
    }
}

async function generateQuiz() {
    requireApiKey(async (apiKey) => {
        try {
            const userNotes = document.getElementById('notes-editor').innerText;
            if (!userNotes || userNotes.trim().length < 20) {
                showToast('Escribe más apuntes para generar un quiz', 'warning');
                return;
            }
            
            showLoading('🤖 Generando Cuestionario...');
            
            const prompt = `Crea un cuestionario de 5 preguntas de opción múltiple (con 4 opciones cada una) para evaluar el conocimiento del alumno sobre los siguientes apuntes. Al final, indica cuáles son las respuestas correctas de forma clara.\n\n📝 APUNTES:\n${userNotes}`;

            const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { temperature: 0.5 }
                })
            });

            hideLoading();
            if (!res.ok) throw new Error('Error en la API de Gemini');

            const data = await res.json();
            const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            
            if (!aiText) throw new Error('Error al generar el cuestionario');

            document.getElementById('ai-fullscreen-title').innerHTML = '<i class="fas fa-question-circle text-indigo-500"></i> Cuestionario de Repaso';
            document.getElementById('ai-fullscreen-content').textContent = aiText;
            document.getElementById('ai-fullscreen-footer').innerHTML = `<span>📝 ¡Ponte a prueba!</span>`;
            document.getElementById('ai-fullscreen').classList.remove('hidden');
            showToast('✅ Quiz generado', 'success');
            
        } catch (error) {
            hideLoading();
            showToast('Error: ' + error.message, 'error');
        }
    });
}