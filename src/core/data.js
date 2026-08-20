// 3. FUNCIONES DE DATOS Y SINCRONIZACIÓN
// ==========================================
const LS_WORKSPACE_KEY = 'studio_data_v2';
const LS_WORKSPACE_IDB_FLAG = 'studio_data_v2_idb';
let _workspaceQuotaToastShown = false;

function getSubjectNotesKey(subId, sheetId) {
    if (!sheetId) return 'sub_' + subId; // Por seguridad si falta
    return 'sub_' + subId + '_sheet_' + sheetId;
}

function getSubjectNotesHtml(subId, sheetId) {
    return appData.notes[getSubjectNotesKey(subId, sheetId)] || '';
}

/** Une apuntes viejos y crea la estructura de hojas. */
function migrateNotesToPerSubject() {
    if (!appData.notes) appData.notes = {};
    appData.subjects.forEach(sub => {
        if (!sub.sheets || !Array.isArray(sub.sheets)) {
            sub.sheets = [{ id: 'main', name: 'Hoja Principal' }];
        }
        if (sub.sheets.length === 0) {
            sub.sheets.push({ id: 'main', name: 'Hoja Principal' });
        }

        const oldKey = 'sub_' + sub.id;
        const newKey = getSubjectNotesKey(sub.id, sub.sheets[0].id);

        let merged = appData.notes[newKey] || appData.notes[oldKey] || '';

        const genKey = 'gen_' + sub.id;
        if (appData.notes[genKey]) {
            merged += (merged ? '<hr><p><br></p>' : '') + appData.notes[genKey];
            delete appData.notes[genKey];
        }

        if (sub.files) {
            sub.files.forEach(f => {
                const part = appData.notes[f.id];
                if (!part) return;
                merged += (merged ? '<hr><p><br></p>' : '') + part;
                delete appData.notes[f.id];
            });
        }

        if (merged) appData.notes[newKey] = merged;
        delete appData.notes[oldKey];
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
    
    // PERSISTIR ESTADO MIGRADO INMEDIATAMENTE PARA EVITAR DUPLICADOS INFINITOS
    setTimeout(() => {
        saveData(false).catch(console.error);
    }, 1000);
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
            idb.putWorkspace(JSON.stringify(appData)).catch(() => {});
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

/** Guarda la hoja de apuntes actual. forceDrive: subida inmediata a Drive. */
async function saveCurrentNotes(forceDrive = false) {
    const editor = document.getElementById('notes-editor');
    if (!currentState.currentSubject || !currentState.currentSheetId || !editor) return;
    appData.notes[getSubjectNotesKey(currentState.currentSubject, currentState.currentSheetId)] = editor.innerHTML;
    currentState.isDirty = false;
    updateSaveStatus('Guardado localmente', 'emerald');
    try {
        await saveData(true, { forceDrive });
    } catch (err) {
        console.error('saveData', err);
    }
}

/** Guardado incondicional manual, sube a Drive saltando validaciones previas */
async function forceManualSave() {
    const editor = document.getElementById('notes-editor');
    if (!currentState.currentSubject || !currentState.currentSheetId || !editor) return;
    
    updateSaveStatus('<i class="fas fa-spinner fa-spin"></i> Guardando en la nube...', 'blue');
    
    appData.notes[getSubjectNotesKey(currentState.currentSubject, currentState.currentSheetId)] = editor.innerHTML;
    currentState.isDirty = false;
    
    try {
        await saveData(true, { forceDrive: false }); // Guarda en IndexedDB/LocalStorage primero
        
        if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            // Fuerzo subida directa sin leer la nube para no perder lo que tengo
            await window.GoogleDriveSync.syncAppDataToDrive(appData);
            updateSaveStatus('<i class="fas fa-cloud-check text-emerald-500"></i> Guardado en la nube', 'emerald');
            setTimeout(() => { updateSaveStatus('<i class="fas fa-check text-emerald-500"></i> Guardado', 'slate'); }, 3000);
            if(typeof showToast === 'function') showToast('Progreso guardado a salvo en la nube', 'success');
        } else {
            updateSaveStatus('<i class="fas fa-check text-emerald-500"></i> Guardado local', 'slate');
            if(typeof showToast === 'function') showToast('Progreso guardado localmente (sin conexión a Drive)', 'info');
        }
    } catch (err) {
        console.error('forceManualSave', err);
        updateSaveStatus('<i class="fas fa-times text-red-500"></i> Error', 'red');
        if(typeof showToast === 'function') showToast('Error al guardar', 'error');
    }
}

function updateSaveStatus(html, colorColor = 'slate') {
    const saveStatus = document.getElementById('save-status');
    if (saveStatus) {
        saveStatus.innerHTML = html;
        saveStatus.className = `text-[10px] text-${colorColor}-500 uppercase font-bold tracking-widest whitespace-nowrap`;
    }
}

function execCmd(command) {
    document.execCommand(command, false, null);
    const editor = document.getElementById('notes-editor');
    if (editor) editor.focus();
}

// ==========================================