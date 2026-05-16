// ==========================================
// MÓDULO DE SINCRONIZACIÓN CON GOOGLE DRIVE
// ==========================================
// Utiliza Google Identity Services y GAPI

// ⚠️ IMPORTANTE PARA WEB: Si publicas tu app en un hosting (como GitHub Pages o Vercel),
// DEBES cambiar este ID por el tuyo creado en Google Cloud Console.
const CLIENT_ID = '155926821940-m8mfuskn410j57sinnqi3dk2saremkdm.apps.googleusercontent.com'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.file'; 
const FOLDER_NAME = 'APP Estudio - Datos';
const DB_FILENAME = 'workspace_data.json';

window.GoogleDriveSync = {
    isLoggedIn: false, 
    token: null, 
    folderId: null,
    tokenClient: null,
    _silentRefreshAttempt: false,

    persistTokenResponse(response) {
        this.token = response.access_token;
        gapi.client.setToken({ access_token: this.token });
        localStorage.setItem('gdrive_token', this.token);
        if (response.expires_in) {
            localStorage.setItem('gdrive_token_expiry', String(Date.now() + Number(response.expires_in) * 1000));
        }
    },

    clearStoredCredentials() {
        this.token = null;
        this.folderId = null;
        this.isLoggedIn = false;
        localStorage.removeItem('gdrive_token');
        localStorage.removeItem('gdrive_token_expiry');
        if (typeof gapi !== 'undefined' && gapi.client) {
            gapi.client.setToken(null);
        }
    },

    onTokenClientResponse(response) {
        if (response.error) {
            console.warn('Google OAuth:', response.error, response.error_description || '');
            const wasSilent = this._silentRefreshAttempt;
            this._silentRefreshAttempt = false;
            if (wasSilent || this.isLoggedIn) {
                this.clearStoredCredentials();
                this.updateUI();
                if (typeof showToast === 'function') {
                    showToast('Sesión de Drive caducada. Iniciá sesión de nuevo para seguir sincronizando.', 'error');
                }
            } else if (typeof showToast === 'function') {
                showToast('No se pudo iniciar sesión en Drive', 'error');
            }
            this.maybeOpenDriveLoginModal();
            return;
        }
        const wasSilent = this._silentRefreshAttempt;
        this._silentRefreshAttempt = false;
        this.persistTokenResponse(response);
        this.isLoggedIn = true;
        this.updateUI();
        if (typeof closeModal === 'function') closeModal('login-modal');
        if (!wasSilent && typeof showToast === 'function') {
            showToast('Conectando a Drive. Preparando tu carpeta…', 'success');
        }
        this.initAppFolder();
    },

    ensureTokenClient() {
        if (this.tokenClient || typeof google === 'undefined') return;
        this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: (r) => this.onTokenClientResponse(r)
        });
    },

    // 1. Inicializa la API de Google cuando carga la página
    init(retries = 10) {
        if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
            this.ensureTokenClient();
            gapi.load('client', () => {
                gapi.client.init({}).then(() => this.restoreDriveSession());
            });
        } else if (retries > 0) {
            setTimeout(() => this.init(retries - 1), 500);
        } else {
            console.warn('La API de Google (GAPI) no se cargó correctamente.');
            this.maybeOpenDriveLoginModal();
        }
    },

    /** Seguir solo con datos locales en esta sesión del navegador (no mostrar de nuevo el aviso hasta cerrar pestaña/navegador). */
    skipDriveThisSession() {
        try {
            sessionStorage.setItem('drive_skip_login_prompt', '1');
        } catch (e) { /* ignore */ }
        if (typeof closeModal === 'function') closeModal('login-modal');
    },

    maybeOpenDriveLoginModal() {
        if (this.isLoggedIn) return;
        let dismissed = false;
        try {
            dismissed = sessionStorage.getItem('drive_skip_login_prompt') === '1';
        } catch (e) { /* ignore */ }
        if (dismissed) return;
        setTimeout(() => {
            if (this.isLoggedIn) return;
            if (typeof openModal === 'function') openModal('login-modal');
        }, 600);
    },

    async restoreDriveSession() {
        const storedToken = localStorage.getItem('gdrive_token');
        if (!storedToken) {
            this.isLoggedIn = false;
            this.updateUI();
            this.maybeOpenDriveLoginModal();
            return;
        }
        this.token = storedToken;
        gapi.client.setToken({ access_token: storedToken });

        const expiry = parseInt(localStorage.getItem('gdrive_token_expiry') || '0', 10);
        const freshEnough = expiry && Date.now() < expiry - 90_000;

        if (freshEnough) {
            const ok = await this.validateToken();
            if (ok) {
                this.isLoggedIn = true;
                this.updateUI();
                await this.initAppFolder();
                return;
            }
        }

        const ok = await this.validateToken();
        if (ok) {
            this.isLoggedIn = true;
            this.updateUI();
            await this.initAppFolder();
            return;
        }

        console.warn('Token de Drive inválido o vencido. Intentando renovación silenciosa…');
        this.isLoggedIn = false;
        this.updateUI();
        if (this.tokenClient) {
            this._silentRefreshAttempt = true;
            try {
                this.tokenClient.requestAccessToken({ prompt: '' });
            } catch (e) {
                this._silentRefreshAttempt = false;
                this.clearStoredCredentials();
                this.updateUI();
                this.maybeOpenDriveLoginModal();
            }
        } else {
            this.clearStoredCredentials();
            this.updateUI();
            this.maybeOpenDriveLoginModal();
        }
    },

    async validateToken() {
        if (!this.token) return false;
        try {
            const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
                headers: { Authorization: 'Bearer ' + this.token }
            });
            if (res.status === 401 || res.status === 403) return false;
            return true;
        } catch (e) {
            return true;
        }
    },

    // 3. Flujo principal de Login (Botón del Modal)
    login() {
        if (CLIENT_ID === 'TU_CLIENT_ID_DE_GOOGLE_AQUI') {
            if (typeof showToast === 'function') {
                showToast('Aviso: Configura tu CLIENT_ID real de Google Cloud en google-drive-sync.js para habilitar la nube.', 'error');
            }
            return;
        }
        this.ensureTokenClient();
        if (!this.tokenClient) {
            if (typeof showToast === 'function') {
                showToast('Google Identity no está listo. Probá de nuevo en unos segundos.', 'error');
            }
            return;
        }
        this.tokenClient.requestAccessToken({ prompt: 'select_account' });
    },
    
    updateUI() {
        const statusEl = document.getElementById('drive-sync-status');
        if (statusEl) {
            statusEl.innerHTML = this.isLoggedIn 
                ? '<i class="fas fa-cloud text-emerald-400"></i> En línea' 
                : '<i class="fas fa-cloud-upload-alt text-slate-500"></i> Local';
            statusEl.title = this.isLoggedIn ? "Guardado automático en Drive activado" : "Usando solo memoria local";
        }

        const btnLogin = document.getElementById('btn-login-drive');
        const btnLogout = document.getElementById('btn-logout-drive');
        const btnSkip = document.getElementById('btn-skip-drive-session');
        const modalDesc = document.getElementById('drive-modal-desc');
        
        if (btnLogin && btnLogout && modalDesc) {
            if (this.isLoggedIn) {
                btnLogin.classList.add('hidden');
                btnLogout.classList.remove('hidden');
                modalDesc.textContent = 'Estás conectado a Google Drive. Los cambios se guardan y sincronizan automáticamente.';
                if (btnSkip) btnSkip.classList.add('hidden');
            } else {
                btnLogin.classList.remove('hidden');
                btnLogout.classList.add('hidden');
                modalDesc.textContent = 'Al iniciar la app te pedimos conectar Drive para no perder PDFs y apuntes. Podés usar solo local, pero el respaldo es en la nube.';
                if (btnSkip) btnSkip.classList.remove('hidden');
            }
        }
    },

    escapeDriveQuery(value) {
        return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    },

    async findFolderInParent(parentId, name) {
        const safeName = this.escapeDriveQuery(name);
        const response = await gapi.client.request({
            path: 'https://www.googleapis.com/drive/v3/files',
            params: {
                q: `name='${safeName}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
                fields: 'files(id, name)',
                pageSize: 1
            }
        });
        const files = response.result.files || [];
        return files.length > 0 ? files[0].id : null;
    },

    /** Carpeta en Drive con el nombre de la materia (dentro de APP Estudio - Datos). */
    async ensureSubjectFolder(subject) {
        if (!this.folderId || !subject) return null;
        if (subject.driveFolderId) return subject.driveFolderId;

        const existingId = await this.findFolderInParent(this.folderId, subject.name);
        if (existingId) {
            subject.driveFolderId = existingId;
            return existingId;
        }

        const createRes = await gapi.client.request({
            path: 'https://www.googleapis.com/drive/v3/files',
            method: 'POST',
            body: {
                name: subject.name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [this.folderId]
            }
        });
        subject.driveFolderId = createRes.result.id;
        return subject.driveFolderId;
    },

    async ensureAllSubjectFolders() {
        if (!this.folderId || typeof appData === 'undefined' || !appData.subjects) return;
        for (const sub of appData.subjects) {
            await this.ensureSubjectFolder(sub);
        }
        if (typeof saveData === 'function') {
            await saveData(false);
        }
    },

    logout() {
        this.clearStoredCredentials();
        this.updateUI();
        if (typeof showToast === 'function') {
            showToast('Sesión de Drive cerrada. Ahora usas almacenamiento local.', 'info');
        }
        if (typeof closeModal === 'function') {
            closeModal('login-modal');
        }
    },
    
    // 4. Busca la carpeta "APP Estudio - Datos" o la crea si no existe
    async initAppFolder() {
        if(typeof showLoading === 'function') showLoading('Sincronizando Workspace...');
        try {
            let response = await gapi.client.request({
                path: 'https://www.googleapis.com/drive/v3/files',
                params: { 
                    q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`, 
                    fields: 'files(id, name)' 
                }
            });

            if (response.result.files && response.result.files.length > 0) {
                // Existe la carpeta: guardamos su ID y traemos la base de datos
                this.folderId = response.result.files[0].id;
                console.log("Carpeta de Drive conectada.");
                await this.syncAppDataFromDrive();
                await this.ensureAllSubjectFolders();
            } else {
                // No existe: creamos la carpeta
                let createRes = await gapi.client.request({
                    path: 'https://www.googleapis.com/drive/v3/files', 
                    method: 'POST', 
                    body: { 
                        name: FOLDER_NAME, 
                        mimeType: 'application/vnd.google-apps.folder' 
                    }
                });
                this.folderId = createRes.result.id;
                console.log("Carpeta de Drive creada.");
                
                // Si la app local ya tenía datos (materias/apuntes), hacemos la primera copia de seguridad
                if (typeof appData !== 'undefined') {
                    await this.syncAppDataToDrive(appData);
                    await this.ensureAllSubjectFolders();
                }
            }
        } catch(e) { 
            console.error("Fallo al inicializar la carpeta de Drive", e); 
            if(typeof showToast === 'function') showToast('Problema de red con Google Drive', 'error');
        } finally {
            if(typeof hideLoading === 'function') hideLoading();
        }
    },
    
    // 5. Descarga la base de datos (JSON) desde tu Drive y actualiza la App
    async syncAppDataFromDrive() {
        try {
            let response = await gapi.client.request({
                path: 'https://www.googleapis.com/drive/v3/files',
                params: { 
                    q: `name='${DB_FILENAME}' and '${this.folderId}' in parents and trashed=false`, 
                    fields: 'files(id)' 
                }
            });

            if (response.result.files && response.result.files.length > 0) {
                const fileId = response.result.files[0].id;
                const fileData = await gapi.client.request({ 
                    path: `https://www.googleapis.com/drive/v3/files/${fileId}`, 
                    params: { alt: 'media' } 
                });
                
                if (fileData.body) {
                    const parsedData = JSON.parse(fileData.body);

                    appData = parsedData;
                    if (typeof saveData === 'function') {
                        await saveData(false);
                    } else {
                        try {
                            localStorage.setItem('studio_data_v2', JSON.stringify(appData));
                        } catch (err) {
                            console.error('No se pudo guardar workspace tras sync Drive', err);
                        }
                    }

                    if(typeof renderSubjects === 'function') renderSubjects();
                    
                    // Si el usuario tenía una nota u hoja en pantalla, actualiza el texto
                    if (typeof currentState !== 'undefined' && currentState.currentSubject) {
                        const editor = document.getElementById('notes-editor');
                        const key = typeof getSubjectNotesKey === 'function'
                            ? getSubjectNotesKey(currentState.currentSubject)
                            : ('sub_' + currentState.currentSubject);
                        if (editor) editor.innerHTML = appData.notes[key] || '';
                    }
                    if(typeof showToast === 'function') showToast('Apuntes sincronizados desde la nube', 'success');
                }
            }
        } catch(e) { 
            console.error('No se pudo traer JSON de Drive', e); 
        }
    },
    
    // 6. Sube tus apuntes locales a Drive (Se ejecuta silenciosamente al dejar de teclear)
    async syncAppDataToDrive(dataObj) {
        if (!this.folderId) return;
        try {
            let search = await gapi.client.request({
                path: 'https://www.googleapis.com/drive/v3/files',
                params: { 
                    q: `name='${DB_FILENAME}' and '${this.folderId}' in parents and trashed=false`, 
                    fields: 'files(id)' 
                }
            });

            const content = JSON.stringify(dataObj);
            const metadata = { name: DB_FILENAME, mimeType: 'application/json' };
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([content], { type: 'application/json' }));
            
            let uploadUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
            let method = 'POST';
            
            if (search.result.files && search.result.files.length > 0) {
                // El archivo JSON ya existe en Drive -> lo actualizamos (PATCH)
                uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${search.result.files[0].id}?uploadType=multipart`;
                method = 'PATCH';
            } else {
                // El archivo JSON no existe -> lo creamos (POST) dentro de la carpeta
                metadata.parents = [this.folderId];
                form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            }

            const res = await fetch(uploadUrl, { 
                method, 
                headers: { 'Authorization': 'Bearer ' + this.token }, 
                body: form 
            });
            if (res.status === 401) throw { status: 401, message: 'Unauthorized' };
            console.log("Copia de seguridad del Workspace actualizada en Drive.");
            
        } catch(e) { 
            if (e && e.status === 401) {
                console.warn("Token de Google expirado (401). Intentando renovar...");
                if (this.tokenClient) {
                    this._silentRefreshAttempt = true;
                    this.tokenClient.requestAccessToken({ prompt: '' });
                }
            } else {
                console.error('Error guardando JSON en Drive', e); 
            }
        }
    },
    
    // 7. Sube el PDF a la carpeta de la materia en Drive
    async uploadPdfToDrive(fileBlob, fileName, subject) {
        if (!this.folderId) return null;
        try {
            const parentId = subject ? await this.ensureSubjectFolder(subject) : this.folderId;
            if (!parentId) return null;

            const metadata = { 
                name: fileName + '.pdf', 
                mimeType: 'application/pdf', 
                parents: [parentId] 
            };
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', fileBlob);
            
            const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST', 
                headers: { 'Authorization': 'Bearer ' + this.token }, 
                body: form
            });
            
            const data = await response.json();
            return data.id; // Retorna el driveId para guardarlo y no tener que subirlo 2 veces
        } catch(e) { 
            console.error("Error subiendo PDF a Drive", e);
            return null; 
        }
    },
    
    // 8. Descarga un PDF desde Drive usando su ID (Pasa la primera vez o si borras caché local)
    async downloadPdfFromDrive(fileId) {
        try {
            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { 
                headers: { 'Authorization': 'Bearer ' + this.token } 
            });
            return response.ok ? await response.blob() : null;
        } catch(e) { 
            console.error("Error descargando PDF de Drive", e);
            return null; 
        }
    }
};