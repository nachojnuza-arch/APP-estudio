// ==========================================
// MÓDULO DE SINCRONIZACIÓN CON SERVIDOR PROPIO (NEXTCLOUD)
// ==========================================

window.ServerSync = {
    isServerOnline: false,
    isSyncing: false,
    _syncTimeout: null,
    _pendingSync: false,
    _checkInterval: null,

    getUserId() {
        let u = localStorage.getItem('app_sync_user');
        if (!u) {
            u = 'nacho'; // Usuario por defecto o personalizable
            localStorage.setItem('app_sync_user', u);
        }
        return u;
    },

    setUserId(newUserId) {
        if (!newUserId) return;
        const clean = String(newUserId).trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        localStorage.setItem('app_sync_user', clean);
        console.log(`[ServerSync] Usuario cambiado a: ${clean}`);
        this.pullWorkspaceIfNewer();
        this.updateUI();
    },

    async init() {
        console.log(`[ServerSync] Inicializando conector con Servidor para usuario [${this.getUserId()}]...`);
        
        // 1. Solicitar al navegador que proteja los datos locales contra borrado automático
        this.requestPersistentStorage();

        // 2. Revisar almacenamiento local
        this.checkStorageQuota();

        this.updateUI();
        await this.checkServerStatus();

        if (this.isServerOnline) {
            await this.pullWorkspaceIfNewer();
        }

        if (!this._checkInterval) {
            this._checkInterval = setInterval(() => this.checkServerStatus(), 60000);
        }
    },

    async requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            try {
                const isPersisted = await navigator.storage.persist();
                console.log(`[ServerSync] Almacenamiento persistente en navegador: ${isPersisted ? 'ACTIVADO' : 'ESTÁNDAR'}`);
            } catch (e) {
                // Ignore
            }
        }
    },

    async checkStorageQuota() {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const usedMB = ((estimate.usage || 0) / (1024 * 1024)).toFixed(1);
                const quotaMB = ((estimate.quota || 0) / (1024 * 1024)).toFixed(1);
                console.log(`[ServerSync] Espacio navegador: ${usedMB} MB usados de ${quotaMB} MB disponibles.`);
            } catch (e) {
                // Ignore
            }
        }
    },

    getHeaders() {
        return {
            'Content-Type': 'application/json',
            'X-User-Id': this.getUserId()
        };
    },

    async checkServerStatus() {
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 4000);
            const res = await fetch(`/api/sync?action=status&userId=${encodeURIComponent(this.getUserId())}`, {
                headers: this.getHeaders(),
                signal: controller.signal
            });
            clearTimeout(timeout);
            
            if (res.ok) {
                const data = await res.json();
                const wasOffline = !this.isServerOnline;
                this.isServerOnline = !!data.online;
                
                if (wasOffline && this.isServerOnline) {
                    console.log('[ServerSync] ¡Servidor detectado online! Sincronizando datos pendientes...');
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

        const user = this.getUserId();

        if (this.isSyncing) {
            statusEl.innerHTML = `<i class="fas fa-spinner fa-spin text-sky-400"></i> Sincronizando (${user})...`;
            statusEl.title = 'Guardando cambios en tu servidor...';
            return;
        }

        if (this.isServerOnline) {
            statusEl.innerHTML = `<i class="fas fa-server text-emerald-400"></i> Nube: ${user}`;
            statusEl.title = `Conectado a tu servidor Nextcloud (Usuario: ${user}). Datos sincronizados.`;
        } else {
            statusEl.innerHTML = `<i class="fas fa-hdd text-amber-400"></i> Modo Local (${user})`;
            statusEl.title = 'Servidor desconectado. Tus datos y PDFs se guardan 100% seguros en tu navegador.';
        }
    },

    // 1. SINCRONIZAR WORKSPACE
    async syncAppData(appData) {
        if (!appData) return;

        const rawJson = JSON.stringify(appData);
        try {
            if (window.idb && typeof window.idb.putWorkspace === 'function') {
                await window.idb.putWorkspace(rawJson);
            }
            localStorage.setItem('studio_data_v2', rawJson);
        } catch (e) {
            console.warn('[ServerSync] Error guardando localmente:', e);
        }

        if (!this.isServerOnline) {
            this._pendingSync = true;
            this.updateUI();
            return;
        }

        if (this._syncTimeout) clearTimeout(this._syncTimeout);
        this._syncTimeout = setTimeout(async () => {
            this.isSyncing = true;
            this.updateUI();
            try {
                const res = await fetch('/api/sync?action=putWorkspace', {
                    method: 'POST',
                    headers: this.getHeaders(),
                    body: JSON.stringify({ data: appData, userId: this.getUserId() })
                });
                if (res.ok) {
                    this._pendingSync = false;
                } else {
                    console.warn('[ServerSync] Error del servidor al guardar workspace');
                }
            } catch (err) {
                console.warn('[ServerSync] Error de red:', err);
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

    // 2. DESCARGAR WORKSPACE
    async pullWorkspaceIfNewer() {
        try {
            const res = await fetch(`/api/sync?action=getWorkspace&userId=${encodeURIComponent(this.getUserId())}`, {
                headers: this.getHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.exists && result.data) {
                    const serverData = result.data;
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

    // 3. SUBIR PDF
    async uploadPdf(fileBlob, fileName, subject) {
        if (!fileBlob || !fileName) return null;

        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';
        
        if (!this.isServerOnline) {
            console.log(`[ServerSync] Servidor offline. PDF "${fileName}" guardado en IndexedDB.`);
            return null;
        }

        try {
            this.isSyncing = true;
            this.updateUI();

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
                headers: this.getHeaders(),
                body: JSON.stringify({
                    filename: fileName,
                    subject: subName,
                    userId: this.getUserId(),
                    dataBase64: base64Data
                })
            });

            if (res.ok) {
                console.log(`[ServerSync] PDF "${fileName}" guardado en el servidor.`);
                if (typeof showToast === 'function') {
                    showToast(`PDF respaldado en tu servidor (${subName})`, 'success');
                }
                return fileName;
            }
        } catch (err) {
            console.warn('[ServerSync] Error subiendo PDF:', err);
        } finally {
            this.isSyncing = false;
            this.updateUI();
        }
        return null;
    },

    // 4. DESCARGAR PDF
    async downloadPdf(subject, fileName) {
        if (!fileName) return null;
        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';

        try {
            const url = `/api/sync?action=getPdf&userId=${encodeURIComponent(this.getUserId())}&subject=${encodeURIComponent(subName)}&filename=${encodeURIComponent(fileName)}`;
            const res = await fetch(url, { headers: this.getHeaders() });
            if (res.ok) {
                const blob = await res.blob();
                return blob;
            }
        } catch (err) {
            console.warn(`[ServerSync] Error descargando PDF "${fileName}":`, err);
        }
        return null;
    },

    // 5. ELIMINAR PDF DEL SERVIDOR
    async deletePdf(subject, fileName) {
        if (!fileName) return;
        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';

        if (!this.isServerOnline) return;

        try {
            await fetch('/api/sync?action=deletePdf', {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    filename: fileName,
                    subject: subName,
                    userId: this.getUserId()
                })
            });
            console.log(`[ServerSync] PDF "${fileName}" eliminado del servidor.`);
        } catch (e) {
            console.warn('[ServerSync] Error eliminando PDF del servidor:', e);
        }
    },

    async ensureSubjectFolder(subject) {
        return true;
    }
};

// Aliases para retrocompatibilidad
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
