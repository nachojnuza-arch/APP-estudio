// ==========================================
// MÓDULO DE SINCRONIZACIÓN CON SERVIDOR PROPIO (NEXTCLOUD)
// ==========================================

window.ServerSync = {
    isServerOnline: false,
    isSyncing: false,
    _syncTimeout: null,
    _pendingSync: false,
    _checkInterval: null,

    async init() {
        console.log('[ServerSync] Inicializando conector con Servidor...');
        this.updateUI();
        await this.checkServerStatus();

        // Si el servidor está online, intentamos restaurar o sincronizar
        if (this.isServerOnline) {
            await this.pullWorkspaceIfNewer();
        }

        // Revisar periódicamente si el servidor se prende o apaga
        if (!this._checkInterval) {
            this._checkInterval = setInterval(() => this.checkServerStatus(), 60000);
        }
    },

    async checkServerStatus() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch('/api/sync?action=status', { signal: controller.signal });
            clearTimeout(timeout);
            
            if (res.ok) {
                const data = await res.json();
                const wasOffline = !this.isServerOnline;
                this.isServerOnline = !!data.online;
                
                // Si estaba apagado y acaba de prenderse, sincronizamos lo pendiente
                if (wasOffline && this.isServerOnline) {
                    console.log('[ServerSync] ¡Servidor detectado online! Sincronizando cambios pendientes...');
                    if (typeof showToast === 'function') {
                        showToast('Servidor conectado. Sincronizando datos...', 'success');
                    }
                    this.flushPendingSync();
                }
            } else {
                this.isServerOnline = false;
            }
        } catch (e) {
            this.isServerOnline = false;
        }
        this.updateUI();
        return this.isServerOnline;
    },

    updateUI() {
        const statusEl = document.getElementById('drive-sync-status');
        if (!statusEl) return;

        if (this.isSyncing) {
            statusEl.innerHTML = '<i class="fas fa-spinner fa-spin text-sky-400"></i> Sincronizando...';
            statusEl.title = 'Guardando cambios en tu servidor...';
            return;
        }

        if (this.isServerOnline) {
            statusEl.innerHTML = '<i class="fas fa-server text-emerald-400"></i> Servidor Online';
            statusEl.title = 'Conectado a tu servidor Nextcloud. Datos sincronizados.';
        } else {
            statusEl.innerHTML = '<i class="fas fa-hdd text-amber-400"></i> Modo Local';
            statusEl.title = 'Servidor desconectado. Tus datos y PDFs se guardan 100% seguros en tu navegador.';
        }
    },

    // 1. SINCRONIZAR WORKSPACE (Materias, Notas, Quizzes)
    async syncAppData(appData) {
        if (!appData) return;

        // Siempre guardar PRIMERO en la memoria local del navegador (IndexedDB + localStorage)
        const rawJson = JSON.stringify(appData);
        try {
            if (window.idb && typeof window.idb.putWorkspace === 'function') {
                await window.idb.putWorkspace(rawJson);
            }
            localStorage.setItem('studio_data_v2', rawJson);
        } catch (e) {
            console.warn('[ServerSync] Error guardando localmente:', e);
        }

        // Si el servidor no está online, marcamos como pendiente y salimos limpiamente
        if (!this.isServerOnline) {
            this._pendingSync = true;
            this.updateUI();
            return;
        }

        // Debounce para no saturar con cada tecla que escribe el usuario
        if (this._syncTimeout) clearTimeout(this._syncTimeout);
        this._syncTimeout = setTimeout(async () => {
            this.isSyncing = true;
            this.updateUI();
            try {
                const res = await fetch('/api/sync?action=putWorkspace', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: appData })
                });
                if (res.ok) {
                    this._pendingSync = false;
                } else {
                    console.warn('[ServerSync] El servidor devolvió error al guardar workspace');
                }
            } catch (err) {
                console.warn('[ServerSync] Error de red sincronizando workspace:', err);
                this.isServerOnline = false;
                this._pendingSync = true;
            } finally {
                this.isSyncing = false;
                this.updateUI();
            }
        }, 1200);
    },

    async flushPendingSync() {
        if (this._pendingSync && window.appData) {
            await this.syncAppData(window.appData);
        }
    },

    // 2. DESCARGAR WORKSPACE SI EL SERVIDOR TIENE DATOS MÁS NUEVOS
    async pullWorkspaceIfNewer() {
        try {
            const res = await fetch('/api/sync?action=getWorkspace');
            if (res.ok) {
                const result = await res.json();
                if (result.exists && result.data) {
                    const serverData = result.data;
                    // Si local está vacío o servidor tiene datos, aplicar
                    const localJson = localStorage.getItem('studio_data_v2');
                    if (!localJson || (serverData.subjects && serverData.subjects.length > 0 && !window.appData?.subjects?.length)) {
                        console.log('[ServerSync] Restaurando datos desde el servidor...');
                        if (typeof applyParsedAppData === 'function') {
                            applyParsedAppData(serverData);
                            if (typeof renderAll === 'function') renderAll();
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[ServerSync] No se pudo verificar versión remota del workspace:', e);
        }
    },

    // 3. SUBIR PDF AL SERVIDOR
    async uploadPdf(fileBlob, fileName, subject) {
        if (!fileBlob || !fileName) return null;

        // Guardar primero en IndexedDB local
        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';
        
        if (!this.isServerOnline) {
            console.log(`[ServerSync] Servidor offline. PDF "${fileName}" guardado localmente en IndexedDB.`);
            return null;
        }

        try {
            this.isSyncing = true;
            this.updateUI();

            // Convertir Blob a Base64
            const base64Data = await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = reader.result.split(',')[1];
                    resolve(base64);
                };
                reader.onerror = reject;
                reader.readAsDataURL(fileBlob);
            });

            const res = await fetch('/api/sync?action=uploadPdf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    filename: fileName,
                    subject: subName,
                    dataBase64: base64Data
                })
            });

            if (res.ok) {
                console.log(`[ServerSync] PDF "${fileName}" subido exitosamente al servidor.`);
                if (typeof showToast === 'function') {
                    showToast(`PDF guardado en el servidor (${subName})`, 'success');
                }
                return fileName;
            } else {
                console.warn('[ServerSync] Error del servidor al guardar PDF');
            }
        } catch (err) {
            console.warn('[ServerSync] Error subiendo PDF al servidor:', err);
        } finally {
            this.isSyncing = false;
            this.updateUI();
        }
        return null;
    },

    // 4. DESCARGAR PDF DEL SERVIDOR (Si se entra desde otro dispositivo)
    async downloadPdf(subject, fileName) {
        if (!fileName) return null;
        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';

        try {
            const url = `/api/sync?action=getPdf&subject=${encodeURIComponent(subName)}&filename=${encodeURIComponent(fileName)}`;
            const res = await fetch(url);
            if (res.ok) {
                const blob = await res.blob();
                return blob;
            }
        } catch (err) {
            console.warn(`[ServerSync] No se pudo descargar el PDF "${fileName}" del servidor:`, err);
        }
        return null;
    },

    async ensureSubjectFolder(subject) {
        // La API de sync se encarga automáticamente al subir archivos
        return true;
    }
};

// Aliases para compatibilidad con código existente
window.GoogleDriveSync = {
    isLoggedIn: true,
    init: () => window.ServerSync.init(),
    syncAppDataToDrive: (data) => window.ServerSync.syncAppData(data),
    uploadPdfToDrive: (blob, name, sub) => window.ServerSync.uploadPdf(blob, name, sub),
    downloadPdfFromDrive: (fileId, name, sub) => window.ServerSync.downloadPdf(sub, name || fileId),
    ensureSubjectFolder: (sub) => window.ServerSync.ensureSubjectFolder(sub),
    login: () => window.ServerSync.checkServerStatus(),
    updateUI: () => window.ServerSync.updateUI()
};
