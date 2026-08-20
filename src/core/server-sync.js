// ==========================================
// MÓDULO DE SINCRONIZACIÓN CON SERVIDOR PROPIO (NEXTCLOUD)
// ==========================================

window.ServerSync = {
    isServerOnline: false,
    isSyncing: false,
    _syncTimeout: null,
    _pendingSync: false,
    _checkInterval: null,
    _uploadConfig: null,
    activeTab: 'login',

    QUESTION_LABELS: {
        'mascota': '¿Cómo se llama tu primera mascota?',
        'ciudad': '¿En qué ciudad naciste?',
        'comida': '¿Cuál es tu comida favorita?',
        'escuela': '¿Nombre de tu escuela primaria?',
        'equipo': '¿Cuál es tu equipo o deporte favorito?',
        'amigo': '¿Nombre de tu mejor amigo/a de la infancia?'
    },

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
        console.log(`[ServerSync] Inicializando (Usuario: ${this.getUserId() || 'Modo Local'})...`);
        
        this.requestPersistentStorage();
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

    openAuthModal(tab = 'login') {
        const modal = document.getElementById('login-modal');
        if (!modal) return;

        const connCont = document.getElementById('auth-connected-container');
        const tabsCont = document.getElementById('auth-tabs-container');
        const connUser = document.getElementById('connected-username');

        if (this.isConnected()) {
            if (tabsCont) tabsCont.classList.add('hidden');
            if (connCont) connCont.classList.remove('hidden');
            if (connUser) connUser.textContent = this.getUserId();
        } else {
            if (tabsCont) tabsCont.classList.remove('hidden');
            if (connCont) connCont.classList.add('hidden');
            this.setAuthTab(tab);
        }

        if (typeof openModal === 'function') openModal('login-modal');
    },

    setAuthTab(tab) {
        this.activeTab = tab;
        const viewLogin = document.getElementById('auth-view-login');
        const viewRegister = document.getElementById('auth-view-register');
        const viewRecover = document.getElementById('auth-view-recover');

        const btnTabLogin = document.getElementById('tab-btn-auth-login');
        const btnTabRegister = document.getElementById('tab-btn-auth-register');

        if (viewLogin) viewLogin.classList.toggle('hidden', tab !== 'login');
        if (viewRegister) viewRegister.classList.toggle('hidden', tab !== 'register');
        if (viewRecover) viewRecover.classList.toggle('hidden', tab !== 'recover');

        if (btnTabLogin && btnTabRegister) {
            if (tab === 'login') {
                btnTabLogin.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-white shadow-sm text-indigo-600';
                btnTabRegister.className = 'flex-1 py-2 text-xs font-bold rounded-lg text-slate-500 hover:text-slate-700';
            } else if (tab === 'register') {
                btnTabLogin.className = 'flex-1 py-2 text-xs font-bold rounded-lg text-slate-500 hover:text-slate-700';
                btnTabRegister.className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-white shadow-sm text-indigo-600';
            } else {
                btnTabLogin.className = 'flex-1 py-2 text-xs font-bold rounded-lg text-slate-500';
                btnTabRegister.className = 'flex-1 py-2 text-xs font-bold rounded-lg text-slate-500';
            }
        }
    },

    // 1. INICIAR SESIÓN
    async loginFromModal() {
        const userInput = document.getElementById('login-username-input');
        const pinInput = document.getElementById('login-pin-input');

        const user = (userInput?.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const pin = (pinInput?.value || '').trim();

        if (!user || !pin) {
            if (typeof showToast === 'function') showToast('Ingresa usuario y contraseña', 'error');
            return;
        }

        try {
            if (typeof showToast === 'function') showToast('Iniciando sesión...', 'info');

            const res = await fetch(`/api/sync?action=login&userId=${encodeURIComponent(user)}&pin=${encodeURIComponent(pin)}`, {
                headers: { 'X-User-Id': user, 'X-User-Pin': pin }
            });

            const data = await res.json();
            if (res.ok && data.success) {
                localStorage.setItem('app_sync_user', user);
                localStorage.setItem('app_sync_pin', pin);
                this._uploadConfig = null;

                // Limpiar espacio anterior para cargar los apuntes del usuario que ingresa
                window.appData = { subjects: [], notes: {} };
                if (typeof renderSubjects === 'function') renderSubjects();

                if (typeof closeModal === 'function') closeModal('login-modal');
                if (typeof showToast === 'function') showToast(`¡Bienvenido ${user}! Cargando tus apuntes...`, 'success');
                this.isServerOnline = true;
                this.updateUI();
                await this.pullWorkspaceIfNewer(true);
            } else {
                if (typeof showToast === 'function') showToast(data.error || 'Usuario o contraseña incorrectos', 'error');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Error al conectar con el servidor', 'error');
        }
    },

    // 2. CREAR CUENTA
    async registerFromModal() {
        const userInput = document.getElementById('register-username-input');
        const pinInput = document.getElementById('register-pin-input');
        const pinConfirmInput = document.getElementById('register-pin-confirm-input');
        const questionSelect = document.getElementById('register-question-select');
        const answerInput = document.getElementById('register-answer-input');

        const user = (userInput?.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const pin = (pinInput?.value || '').trim();
        const pinConfirm = (pinConfirmInput?.value || '').trim();
        const question = questionSelect?.value || 'mascota';
        const answer = (answerInput?.value || '').trim();

        if (!user) {
            if (typeof showToast === 'function') showToast('Elige un nombre de usuario', 'error');
            return;
        }
        if (!pin || pin.length < 3) {
            if (typeof showToast === 'function') showToast('La contraseña debe tener al menos 3 caracteres', 'error');
            return;
        }
        if (pin !== pinConfirm) {
            if (typeof showToast === 'function') showToast('Las contraseñas no coinciden', 'error');
            return;
        }
        if (!answer) {
            if (typeof showToast === 'function') showToast('Responde a tu pregunta de seguridad', 'error');
            return;
        }

        try {
            if (typeof showToast === 'function') showToast('Creando tu cuenta...', 'info');

            const res = await fetch('/api/sync?action=register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user,
                    pin: pin,
                    securityQuestion: question,
                    securityAnswer: answer
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                localStorage.setItem('app_sync_user', user);
                localStorage.setItem('app_sync_pin', pin);
                this._uploadConfig = null;
                if (typeof closeModal === 'function') closeModal('login-modal');
                if (typeof showToast === 'function') showToast(`¡Cuenta "${user}" creada con éxito!`, 'success');
                this.isServerOnline = true;
                this.updateUI();
                await this.syncAppData(window.appData);
            } else {
                if (typeof showToast === 'function') showToast(data.error || 'No se pudo crear la cuenta', 'error');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Error al conectar con el servidor', 'error');
        }
    },

    // Cargar la pregunta de seguridad guardada del usuario en recuperación
    async fetchUserQuestionForRecovery() {
        const userInput = document.getElementById('recover-username-input');
        const questionLabel = document.getElementById('recover-question-label');
        const user = (userInput?.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');

        if (!user) return;

        try {
            const res = await fetch(`/api/sync?action=getSecurityQuestion&userId=${encodeURIComponent(user)}`);
            if (res.ok) {
                const data = await res.json();
                const qKey = data.securityQuestion || 'mascota';
                const labelText = this.QUESTION_LABELS[qKey] || 'Pregunta de seguridad:';
                if (questionLabel) {
                    questionLabel.textContent = labelText;
                    questionLabel.className = 'text-xs font-semibold text-indigo-700 mb-1 block';
                }
            } else {
                if (questionLabel) {
                    questionLabel.textContent = 'Tu respuesta de seguridad:';
                    questionLabel.className = 'text-xs font-semibold text-slate-600 mb-1 block';
                }
            }
        } catch (e) {
            // Ignore
        }
    },

    // 3. RECUPERAR CONTRASEÑA
    async recoverFromModal() {
        const userInput = document.getElementById('recover-username-input');
        const answerInput = document.getElementById('recover-answer-input');
        const newPinInput = document.getElementById('recover-new-pin-input');

        const user = (userInput?.value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
        const answer = (answerInput?.value || '').trim();
        const newPin = (newPinInput?.value || '').trim();

        if (!user || !answer || !newPin) {
            if (typeof showToast === 'function') showToast('Completa todos los campos para restablecer', 'error');
            return;
        }

        try {
            if (typeof showToast === 'function') showToast('Restableciendo contraseña...', 'info');

            const res = await fetch('/api/sync?action=recover', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: user,
                    securityAnswer: answer,
                    newPin: newPin
                })
            });

            const data = await res.json();
            if (res.ok && data.success) {
                if (typeof showToast === 'function') showToast('¡Contraseña restablecida! Ya puedes ingresar.', 'success');
                this.setAuthTab('login');
                const logUser = document.getElementById('login-username-input');
                const logPin = document.getElementById('login-pin-input');
                if (logUser) logUser.value = user;
                if (logPin) logPin.value = newPin;
            } else {
                if (typeof showToast === 'function') showToast(data.error || 'Respuesta de seguridad incorrecta', 'error');
            }
        } catch (e) {
            if (typeof showToast === 'function') showToast('Error al conectar con el servidor', 'error');
        }
    },

    logout() {
        localStorage.removeItem('app_sync_user');
        localStorage.removeItem('app_sync_pin');
        localStorage.removeItem('studio_data_v2');
        localStorage.removeItem('studio_data_v2_idb');
        this._uploadConfig = null;

        // 1. Limpiar completamente los datos del usuario anterior de la memoria y del almacenamiento local por privacidad
        if (typeof applyParsedAppData === 'function') {
            applyParsedAppData({ subjects: [], notes: {} }, false);
        } else {
            window.appData = { subjects: [], notes: {} };
        }

        if (window.idb && typeof window.idb.clearAllStores === 'function') {
            window.idb.clearAllStores().catch(() => {});
        }

        // 2. Limpiar editor de apuntes y visor de PDF
        const editor = document.getElementById('notes-editor');
        if (editor) editor.innerHTML = '';
        document.getElementById('pdf-container')?.classList.add('hidden');
        document.getElementById('pdf-controls')?.classList.add('hidden');
        document.getElementById('video-container')?.classList.add('hidden');
        document.getElementById('subject-dashboard')?.classList.add('hidden');
        document.getElementById('empty-state')?.classList.remove('hidden');

        if (window.currentState) {
            window.currentState.currentSubject = null;
            window.currentState.currentFile = null;
            window.currentState.currentSheetId = 'main';
            window.currentState.isDirty = false;
        }

        // 3. Re-renderizar lista de materias y fuentes IA (ahora limpias y vacías)
        if (typeof renderSubjects === 'function') renderSubjects();
        if (typeof renderManageSubjects === 'function') renderManageSubjects();
        if (typeof renderAiSources === 'function') renderAiSources();

        if (typeof closeModal === 'function') closeModal('login-modal');
        if (typeof showToast === 'function') showToast('Sesión cerrada. Espacio de trabajo limpio.', 'info');
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
                console.log(`[ServerSync] Espacio: ${usedMB} MB usados de ${quotaMB} MB.`);
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
        const user = this.getUserId();
        const btnLogin = document.getElementById('btn-login-trigger');
        const loggedCont = document.getElementById('logged-user-container');
        const loggedName = document.getElementById('logged-user-name');
        const avatarLetter = document.getElementById('user-avatar-letter');
        const syncIndicator = document.getElementById('sync-indicator-text');

        if (this.isConnected()) {
            if (btnLogin) btnLogin.classList.add('hidden');
            if (loggedCont) loggedCont.classList.remove('hidden');
            if (loggedName) loggedName.textContent = user;
            if (avatarLetter) avatarLetter.textContent = user.charAt(0).toUpperCase();

            if (syncIndicator) {
                if (this.isSyncing) {
                    syncIndicator.innerHTML = '<i class="fas fa-spinner fa-spin text-sky-500"></i> Sincronizando...';
                } else if (this.isServerOnline) {
                    syncIndicator.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span> Nube sincronizada';
                } else {
                    syncIndicator.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span> Servidor offline';
                }
            }
        } else {
            if (btnLogin) btnLogin.classList.remove('hidden');
            if (loggedCont) loggedCont.classList.add('hidden');
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
    async pullWorkspaceIfNewer(force = false) {
        if (!this.isConnected()) return;

        try {
            const res = await fetch(`/api/sync?action=getWorkspace&userId=${encodeURIComponent(this.getUserId())}&pin=${encodeURIComponent(this.getUserPin())}`, {
                headers: this.getHeaders()
            });
            if (res.ok) {
                const result = await res.json();
                const serverData = result.data;
                const hasServerContent = serverData && Array.isArray(serverData.subjects) && serverData.subjects.length > 0;
                const hasLocalContent = window.appData && Array.isArray(window.appData.subjects) && window.appData.subjects.length > 0;

                if (result.exists && hasServerContent) {
                    // Si force es true o localmente está vacío, restaurar de la nube y re-renderizar todo
                    if (force || !hasLocalContent) {
                        console.log(`[ServerSync] Restaurando datos del usuario ${this.getUserId()} desde el servidor...`);
                        if (typeof applyParsedAppData === 'function') {
                            applyParsedAppData(serverData, true);
                        }
                        if (typeof renderSubjects === 'function') renderSubjects();
                        if (typeof renderManageSubjects === 'function') renderManageSubjects();
                        if (typeof renderAiSources === 'function') renderAiSources();
                    }
                } else if (!hasServerContent && hasLocalContent) {
                    // Si la cuenta es nueva pero el usuario ya tenía apuntes/materias creadas en su pantalla, subirlas de inmediato a la nube
                    console.log(`[ServerSync] Usuario nuevo con contenido local. Respaldando a la nube...`);
                    await this.syncAppData(window.appData);
                }
            }
        } catch (e) {
            console.warn('[ServerSync] No se pudo descargar workspace remoto:', e);
        }
    },

    async getUploadConfig() {
        if (this._uploadConfig) return this._uploadConfig;
        try {
            const res = await fetch(`/api/sync?action=getUploadConfig&userId=${encodeURIComponent(this.getUserId())}&pin=${encodeURIComponent(this.getUserPin())}`, {
                headers: this.getHeaders()
            });
            if (res.ok) {
                this._uploadConfig = await res.json();
                return this._uploadConfig;
            }
        } catch (e) {}
        return null;
    },

    // 3. SUBIR PDF (Directo a WebDAV para soportar archivos de cualquier tamaño sin límites)
    async uploadPdf(fileBlob, fileName, subject) {
        if (!fileBlob || !fileName) return null;

        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';
        
        if (!this.isConnected() || !this.isServerOnline) {
            console.log(`[ServerSync] Guardado local en IndexedDB ("${fileName}").`);
            return null;
        }

        const sizeMB = (fileBlob.size / (1024 * 1024)).toFixed(1);

        try {
            this.isSyncing = true;
            this.updateUI();

            const config = await this.getUploadConfig();
            if (config && config.webdavRoot && config.authHeader) {
                const userFolder = `${config.webdavRoot}/users/${encodeURIComponent(this.getUserId())}`;
                const subjectFolder = `${userFolder}/${encodeURIComponent(subName)}`;

                // Asegurar carpetas en WebDAV
                try {
                    await fetch(userFolder, { method: 'MKCOL', headers: { 'Authorization': config.authHeader } });
                } catch(e) {}
                try {
                    await fetch(subjectFolder, { method: 'MKCOL', headers: { 'Authorization': config.authHeader } });
                } catch(e) {}

                // Subida directa de flujo binario (soporta 10MB, 50MB, 100MB, 500MB+)
                const fileUrl = `${subjectFolder}/${encodeURIComponent(fileName)}`;
                const uploadRes = await fetch(fileUrl, {
                    method: 'PUT',
                    headers: {
                        'Authorization': config.authHeader,
                        'Content-Type': 'application/pdf'
                    },
                    body: fileBlob
                });

                if (uploadRes.ok || uploadRes.status === 201 || uploadRes.status === 204) {
                    console.log(`[ServerSync] PDF "${fileName}" (${sizeMB}MB) respaldado en la nube.`);
                    if (typeof showToast === 'function') {
                        showToast(`PDF de ${sizeMB}MB respaldado en tu nube (${subName})`, 'success');
                    }
                    return fileName;
                }
            }
        } catch (err) {
            console.warn('[ServerSync] Error subiendo PDF a la nube:', err);
        } finally {
            this.isSyncing = false;
            this.updateUI();
        }
        return null;
    },

    // 4. DESCARGAR PDF (Directo desde WebDAV)
    async downloadPdf(subject, fileName) {
        if (!fileName || !this.isConnected()) return null;
        const subName = subject ? (typeof subject === 'string' ? subject : subject.name) : 'General';

        try {
            const config = await this.getUploadConfig();
            if (config && config.webdavRoot && config.authHeader) {
                const fileUrl = `${config.webdavRoot}/users/${encodeURIComponent(this.getUserId())}/${encodeURIComponent(subName)}/${encodeURIComponent(fileName)}`;
                const res = await fetch(fileUrl, {
                    headers: { 'Authorization': config.authHeader }
                });
                if (res.ok) {
                    return await res.blob();
                }
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
