// ==========================================
// MÓDULO DE SINCRONIZACIÓN CON GOOGLE DRIVE
// ==========================================
// Utiliza Google Identity Services y GAPI

// ⚠️ IMPORTANTE PARA WEB: Si subes esto a un hosting público, debes cambiar este ID
// por uno válido creado en Google Cloud Console (API de Drive activada).
const CLIENT_ID = '155926821940-m8mfuskn410j57sinnqi3dk2saremkdm.apps.googleusercontent.com'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.file'; 
const FOLDER_NAME = 'APP Estudio - Datos';
const DB_FILENAME = 'workspace_data.json';

window.GoogleDriveSync = {
    isLoggedIn: false, 
    token: null, 
    folderId: null,
    
    // 1. Inicializa la API de Google cuando carga la página
    init() {
        if(typeof gapi !== 'undefined') {
            gapi.load('client', () => {
                gapi.client.init({}).then(() => this.checkExistingToken());
            });
        } else {
            console.warn("La API de Google (GAPI) no se cargó correctamente.");
        }
    },
    
    // 2. Verifica si el usuario ya había iniciado sesión antes
    checkExistingToken() {
        const storedToken = localStorage.getItem('gdrive_token');
        if (storedToken) {
            this.token = storedToken;
            gapi.client.setToken({ access_token: storedToken });
            this.validateToken().then(isValid => {
                if (isValid) {
                    this.isLoggedIn = true;
                    this.updateUI();
                    this.initAppFolder(); // Conecta y descarga los datos
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
    
    // 3. Flujo principal de Login al hacer clic en el botón
    login() {
        if (CLIENT_ID === 'TU_CLIENT_ID_DE_GOOGLE_AQUI') {
            if(typeof showToast === 'function') {
                showToast('Aviso: Debes configurar un CLIENT_ID real de Google Cloud en el código para funcionar en la nube.', 'error');
            } else {
                alert('Aviso: Debes configurar un CLIENT_ID en google-drive-sync.js');
            }
            // Si quieres permitir pruebas locales ignorando el login real, descomenta la línea de abajo:
            // return; 
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
                if(typeof showToast === 'function') showToast('Iniciando Drive. Preparando tu carpeta...', 'success');
                
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
            statusEl.title = this.isLoggedIn ? "Conectado a Google Drive" : "Usando solo memoria local";
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
                // La carpeta existe, obtenemos su ID y descargamos datos
                this.folderId = response.result.files[0].id;
                console.log("Carpeta de Drive conectada.");
                await this.syncAppDataFromDrive();
            } else {
                // No existe, creamos la carpeta
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
                
                // Si ya teníamos datos locales (appData está definida en app.js), los subimos
                if(typeof appData !== 'undefined') await this.syncAppDataToDrive(appData);
            }
        } catch(e) { 
            console.error("Fallo al inicializar la carpeta de Drive", e); 
            if(typeof showToast === 'function') showToast('Problema de red con Drive', 'error');
        } finally {
            if(typeof hideLoading === 'function') hideLoading();
        }
    },
    
    // 5. Descarga el JSON con tus apuntes desde Drive
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
                    // Actualizamos las variables globales de app.js con lo que vino de Drive
                    const parsedData = JSON.parse(fileData.body);
                    appData = parsedData; 
                    localStorage.setItem('studio_data_v2', JSON.stringify(appData));
                    
                    // Renderizamos la interfaz
                    if(typeof renderSubjects === 'function') renderSubjects();
                    
                    // Si el usuario tenía una nota abierta, actualizamos el texto de pantalla
                    if (typeof currentState !== 'undefined' && currentState.currentSubject) {
                        const editor = document.getElementById('notes-editor');
                        if(editor) editor.innerHTML = appData.notes['sub_' + currentState.currentSubject] || '';
                    }
                    if(typeof showToast === 'function') showToast('Apuntes actualizados desde Drive', 'success');
                }
            }
        } catch(e) { 
            console.error('No se pudo traer JSON de Drive', e); 
        }
    },
    
    // 6. Sube tus apuntes (el JSON local) a Drive (Se activa desde app.js cuando dejas de escribir)
    async syncAppDataToDrive(dataObj) {
        if (!this.folderId) return;
        try {
            // Buscamos si el archivo JSON ya existe para actualizarlo o crearlo nuevo
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
                // Actualizar (PATCH)
                uploadUrl = `https://www.googleapis.com/upload/drive/v3/files/${search.result.files[0].id}?uploadType=multipart`;
                method = 'PATCH';
            } else {
                // Crear (POST) agregando parent ID
                metadata.parents = [this.folderId];
                form.set('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            }

            await fetch(uploadUrl, { 
                method, 
                headers: { 'Authorization': 'Bearer ' + this.token }, 
                body: form 
            });
            console.log("Copia de seguridad en Drive actualizada correctamente.");
            
        } catch(e) { 
            console.error('Error guardando JSON en Drive', e); 
        }
    },
    
    // 7. Sube el PDF a la carpeta de Drive y devuelve el ID
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
            return data.id; // Retorna el driveId para guardarlo en local
        } catch(e) { 
            console.error("Error subiendo PDF a Drive", e);
            return null; 
        }
    },
    
    // 8. Descarga un PDF desde Drive usando su ID (Solo pasa si no está en la caché IndexedDB)
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