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
        return localStorage.getItem('app_sync_user') || '';
    },

    getUserPin() {
        return localStorage.getItem('app_sync_pin') || '';
    },

    isConnected() {
        return !!this.getUserId();
    },

    async init() {
        console.log(`[ServerSync] Inicializando (Usuario actual: ${this.getUserId() || 'Modo Local'})...`);
        
        // 1. Proteger almacenamiento local contra borrado automático
        this.requestPersistentStorage();

        // 2. Comprobar espacio
        this.checkStorageQuota();

        this.updateUI();
        await this.checkServerStatus();

        if (this.isServerOnline && this.isConnected()) {
            await this.pullWorkspaceIfNewer();
        }

        if (!this._checkInterval) {
            this._checkInterval = setInterval(() => this.checkServerStatus(), 60000);
        }
    },

    openAuthModal() {
        const modal = document.getElementById('login-modal');
        if (!modal) return;

        const formCont = document.getElementById('auth-form-container');
        const connCont = document.getElementById('auth-connected-container');
        const connUser = document.getElementById('connected-username');
        const userInput = document.getElementById('sync-username-input');
        const pinInput = document.getElementById('sync-pin-input');

        if (this.isConnected()) {
            if (formCont) formCont.classList.add('hidden');
            if (connCont) connCont.classList.remove('hidden');
            if (connUser) connUser.textContent = this.getUserId();
        } else {
            if (formCont) formCont.classList.remove('hidden');
            if (connCont) connCont.classList.add('hidden');
            if (userInput) userInput.value = '';
            if (pinInput) pinInput.value = '';
        }

        if (typeof openModal === 'function') openModal('login-modal');
    },

    async loginFromModal() {
        const userInput = document.getElementById('sync-username-input');
        const pinInput = document.getElementById('sync-pin-input');

        const user = (userInput?.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const pin = (pinInput?.value || '').trim();

        if (!user) {
            if (typeof showToast === 'function') showToast('Ingresa un nombre de usuario', 'error');
            return;
        }

        try {
            if (typeof showToast === 'function') showToast('Validando conexión...', 'info');

            const res = await fetch(`/api/sync?action=auth&userId=${encodeURIComponent(user)}&pin=${encodeURIComponent(pin)}`, {
                headers: {
                    'X-User-Id': user,
                    'X-User-Pin': pin
                }
            });

            if (res.ok) {
                localStorage.setItem('app_sync_user', user);
                localStorage.setItem('app_sync_pin', pin);
                if (typeof closeModal === 'function') closeModal('login-modal');
                if (typeof showToast === 'function') showToast(`¡Conectado como ${user}! Sincronizando...`, 'success');
                this.isServerOnline = true;
                this.updateUI();
                await this.pullWorkspaceIfNewer();
                await this.syncAppData(window.appData);
            } else {
                const err = await res.json();
                if (typeof showToast === 'function') showToast(err.error || 'PIN o usuario incorrecto', 'error');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('No se pudo conectar al servidor', 'error');
        }
    },

    logout() {
        localStorage.removeItem('app_sync_user');
        localStorage.removeItem('app_sync_pin');
        if (typeof closeModal === 'function') closeModal('login-modal');
        if (typeof showToast === 'function') showToast('Desconectado de la nube. Modo local activo.', 'info');
        this.updateUI();
    },

    async requestPersistentStorage() {
        if (navigator.storage && navigator.storage.persist) {
            try {
                await navigator.storage.persist();
            } catch (e) {}
        }
    },

    async checkStorageQuota() {
        if (navigator.storage && navigator.storage.estimate) {
            try {
                const estimate = await navigator.storage.estimate();
                const usedMB = ((estimate.usage || 0) / (1024 * 1024)).toFixed(1);
                const quotaMB = ((estimate.quota || 0) / (1024 * 1024)).toFixed(1);
                console.log(`[ServerSync] Espacio navegador: ${usedMB} MB usados de ${quotaMB} MB disponibles.`);
            } catch (e) {}
        }
    },

    getHeaders() {
        const headers = { 'Content-Type': 'application/json' };
        if (this.isConnected()) {
            headers['X-User-Id'] = this.getUserId();
            headers['X-User-Pin'] = this.getUserPin();
        }
        return headers;
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
                
                if (wasOffline && this.isServerOnline && this.isConnected()) {
                    console.log('[ServerSync] Servidor conectado. Sincronizando...');
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
        const iconEl = document.getElementById('drive-icon');
        if (!statusEl) return;

        const user = this.getUserId();

        if (this.isSyncing) {
            statusEl.textContent = user ? `Sincronizando (${user})...` : 'Sincronizando...';
            if (iconEl) iconEl.className = 'fas fa-spinner fa-spin text-sky-400';
            return;
        }

        if (this.isConnected() && this.isServerOnline) {
            statusEl.textContent = `Nube: ${user}`;
            if (iconEl) iconEl.className = 'fas fa-cloud text-emerald-400';
            statusEl.title = `Conectado como ${user}. Datos respaldados en el servidor.`;
        } else if (this.isConnected() && !this.isServerOnline) {
            statusEl.textContent = `Nube (${user}) [Offline]`;
            if (iconEl) iconEl.className = 'fas fa-cloud text-amber-400';
            statusEl.title = 'Servidor apagado. Guardando copia local segura.';
        } else {
            statusEl.textContent = 'Modo Local';
            if (iconEl) iconEl.className = 'fas fa-hdd text-slate-400';
            statusEl.title = 'Usando memoria del navegador. Pulsa para conectar a tu nube.';
        }
    },

    // 1. SINCRONIZAR WORKSPACE
    async syncAppData(appData) {
        if (!appData) return;

        // Guardar SIEMPRE primero en IndexedDB y localStorage local
        const rawJson = JSON.stringify(appData);
        try {
            if (window.idb && typeof window.idb.putWorkspace === 'function') {
                await window.idb.putWorkspace(rawJson);
            }
            localStorage.setItem('studio_data_v2', rawJson);
        } catch (e) {
            console.warn('[ServerSync] Error guardando local:', e);
        }

        if (!this.isConnected() || !this.isServerOnline) {
            this._pendingSync = this.isConnected();
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
                    body: JSON.stringify({ data: appData, userId: this.getUserId(), pin: this.getUserPin() })
                });
                if (res.ok) {
                    this._pendingSync = false;
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
        if (this._pendingSync && window.appData && this.isConnected()) {
            await this.syncAppData(window.appData);
        }
    },

    // 2. DESCARGAR WORKSPACE
    async pullWorkspaceIfNewer() {
        if (!this.isConnected()) return;

        try {
            const res = await fetch(`/api/sync?action=getWorkspace&userId=${encodeURIComponent(this.getUserId())}&pin=${encodeURIComponent(this.getUserPin())}`, {
                headers: this.getHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                if (result.exists && result.data) {
                    const serverData = result.data;
                    const localJson = localStorage.getItem('studio_data_v2');
                    if (!localJson || (serverData.subjects && serverData.subjects.length > 0 && !window.appData?.subjects?.length)) {
                        console.log(`[ServerSync] Restaurando datos del usuario ${this.getUserId()} desde el servidor...`);
                        if (typeof applyParsedAppData === 'function') {
                            applyParsedAppData(serverData);
                            if (typeof renderAll === 'function') renderAll();
                        }
                    }
                }
            }
        } catch (e) {
            console.warn('[ServerSync] No se pudo descargar workspace remoto:', e);
        }
    },

    // 3. SUBIR PDF
    async uploadPdf(fileBlob, fileName, subject) {
        if (!fileBlob || !fileName) return null;

        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';
        
        if (!this.isConnected() || !this.isServerOnline) {
            console.log(`[ServerSync] Guardado local en IndexedDB ("${fileName}").`);
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
                    pin: this.getUserPin(),
                    dataBase64: base64Data
                })
            });

            if (res.ok) {
                console.log(`[ServerSync] PDF "${fileName}" respaldado en el servidor.`);
                if (typeof showToast === 'function') {
                    showToast(`PDF respaldado en tu nube (${subName})`, 'success');
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
        if (!fileName || !this.isConnected()) return null;
        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';

        try {
            const url = `/api/sync?action=getPdf&userId=${encodeURIComponent(this.getUserId())}&pin=${encodeURIComponent(this.getUserPin())}&subject=${encodeURIComponent(subName)}&filename=${encodeURIComponent(fileName)}`;
            const res = await fetch(url, { headers: this.getHeaders() });
            if (res.ok) {
                return await res.blob();
            }
        } catch (err) {
            console.warn(`[ServerSync] Error descargando PDF "${fileName}":`, err);
        }
        return null;
    },

    // 5. ELIMINAR PDF DEL SERVIDOR
    async deletePdf(subject, fileName) {
        if (!fileName || !this.isConnected() || !this.isServerOnline) return;
        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';

        try {
            await fetch('/api/sync?action=deletePdf', {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    filename: fileName,
                    subject: subName,
                    userId: this.getUserId(),
                    pin: this.getUserPin()
                })
            });
        } catch (e) {
            console.warn('[ServerSync] Error eliminando PDF del servidor:', e);
        }
    },

    async ensureSubjectFolder() {
        return true;
    }
};

// Retrocompatibilidad
window.GoogleDriveSync = {
    isLoggedIn: () => window.ServerSync.isConnected(),
    init: () => window.ServerSync.init(),
    syncAppDataToDrive: (data) => window.ServerSync.syncAppData(data),
    uploadPdfToDrive: (blob, name, sub) => window.ServerSync.uploadPdf(blob, name, sub),
    downloadPdfFromDrive: (fileId, name, sub) => window.ServerSync.downloadPdf(sub, name || fileId),
    ensureSubjectFolder: (sub) => window.ServerSync.ensureSubjectFolder(sub),
    login: () => window.ServerSync.openAuthModal(),
    logout: () => window.ServerSync.logout(),
    updateUI: () => window.ServerSync.updateUI()
};
