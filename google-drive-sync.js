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
    
    // 1. Inicializa la API de Google cuando carga la página
    init(retries = 10) {
        if(typeof gapi !== 'undefined') {
            gapi.load('client', () => {
                gapi.client.init({}).then(() => this.checkExistingToken());
            });
        } else if (retries > 0) {
            setTimeout(() => this.init(retries - 1), 500);
        } else {
            console.warn("La API de Google (GAPI) no se cargó correctamente.");
        }
    },
    
    // 2. Verifica si el usuario ya tenía una sesión activa
    checkExistingToken() {
        const storedToken = localStorage.getItem('gdrive_token');
        if (storedToken) {
            this.token = storedToken;
            gapi.client.setToken({ access_token: storedToken });
            this.validateToken().then(isValid => {
                if (isValid) {
                    this.isLoggedIn = true;
                    this.updateUI();
                    this.initAppFolder(); // Conecta a la carpeta y descarga datos
                } else {
                    localStorage.removeItem('gdrive_token');
                }
            });
        }
    },
    
    async validateToken() {
        try {
            const res = await fetch(`https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${this.token}`);
            return res.ok;
        } catch(e) { return false; }
    },
    
    // 3. Flujo principal de Login (Botón del Modal)
    login() {
        if (CLIENT_ID === 'TU_CLIENT_ID_DE_GOOGLE_AQUI') {
            if(typeof showToast === 'function') {
                showToast('Aviso: Configura tu CLIENT_ID real de Google Cloud en google-drive-sync.js para habilitar la nube.', 'error');
            }
            // Si quieres permitir pruebas locales ignorando el login real, comenta el return y el showToast.
            return; 
        }

        const client = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID, 
            scope: SCOPES,
            callback: (response) => {
                if (response.error) {
                    console.error("Error en login:", response.error);
                    if(typeof showToast === 'function') showToast('Error al iniciar sesión', 'error');
                    return;
                }
                
                this.token = response.access_token;
                gapi.client.setToken({ access_token: this.token });
                localStorage.setItem('gdrive_token', this.token);
                this.isLoggedIn = true;
                
                this.updateUI();
                if(typeof closeModal === 'function') closeModal('login-modal');
                if(typeof showToast === 'function') showToast('Conectando a Drive. Preparando tu carpeta...', 'success');
                
                this.initAppFolder();
            }
        });
        client.requestAccessToken();
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
        const modalDesc = document.getElementById('drive-modal-desc');
        
        if (btnLogin && btnLogout && modalDesc) {
            if (this.isLoggedIn) {
                btnLogin.classList.add('hidden');
                btnLogout.classList.remove('hidden');
                modalDesc.textContent = 'Estás conectado a Google Drive. Los cambios se guardan y sincronizan automáticamente.';
            } else {
                btnLogin.classList.remove('hidden');
                btnLogout.classList.add('hidden');
                modalDesc.textContent = 'Inicia sesión para guardar y sincronizar PDFs y notas en "APP Estudio - Datos".';
            }
        }
    },

    logout() {
        this.isLoggedIn = false;
        this.token = null;
        this.folderId = null;
        localStorage.removeItem('gdrive_token');
        if (typeof gapi !== 'undefined' && gapi.client) {
            gapi.client.setToken(null);
        }
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
                if(typeof appData !== 'undefined') await this.syncAppDataToDrive(appData);
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
                    
                    // Sobrescribe el objeto global de app.js con lo que había en la nube
                    appData = parsedData; 
                    localStorage.setItem('studio_data_v2', JSON.stringify(appData));
                    
                    if(typeof renderSubjects === 'function') renderSubjects();
                    
                    // Si el usuario tenía una nota u hoja en pantalla, actualiza el texto
                    if (typeof currentState !== 'undefined' && currentState.currentFileId) {
                        const editor = document.getElementById('notes-editor');
                        if(editor) editor.innerHTML = appData.notes[currentState.currentFileId] || '';
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
                console.warn("Token de Google expirado (401).");
                this.isLoggedIn = false;
                localStorage.removeItem('gdrive_token');
                this.updateUI();
                if(typeof showToast === 'function') showToast('Sesión de Drive expirada. Vuelve a conectar.', 'error');
            }
            console.error('Error guardando JSON en Drive', e); 
        }
    },
    
    // 7. Sube el PDF a la carpeta de Drive (Se ejecuta al añadir un archivo)
    async uploadPdfToDrive(fileBlob, fileName) {
        if (!this.folderId) return null;
        try {
            const metadata = { 
                name: fileName + '.pdf', 
                mimeType: 'application/pdf', 
                parents: [this.folderId] 
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