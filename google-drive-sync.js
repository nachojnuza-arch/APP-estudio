/**
 * Sincronización con Google Drive
 * Login OAuth 2.0 + Almacenamiento en la nube del usuario
 */

// Estado global de Google Drive Sync
window.GoogleDriveSync = {
    isLoggedIn: false,
    user: null,
    accessToken: null,
    tokenExpiry: null,
    syncInterval: null,
    lastSyncTime: null
};

// 🔑 CONFIGURA TU CLIENT ID AQUI
const GOOGLE_CLIENT_ID = "155926821940-m8mfuskn410j57sinnqi3dk2saremkdm.apps.googleusercontent.com";

let tokenClient = null;


 /**
 * ✅ METODO CORRECTO OFICIAL PARA LOGIN Y ACCESO A DRIVE API
 */
function initGoogleAuth() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        // 👇 AQUÍ ESTÁ EL CAMBIO: agregamos 'profile email' al final
        scope: "https://www.googleapis.com/auth/drive.appdata https://www.googleapis.com/auth/drive.file profile email",
        callback: (tokenResponse) => {
            if (tokenResponse.error) {
                console.error("❌ Error login", tokenResponse);
                showToast("Error al iniciar sesión con Google", "error");
                return;
            }
// ... resto del código igual ...

            // ✅ AQUI SI TENEMOS UN ACCESS_TOKEN VALIDO PARA DRIVE API
            GoogleDriveSync.isLoggedIn = true;
            GoogleDriveSync.accessToken = tokenResponse.access_token;
            GoogleDriveSync.tokenExpiry = Date.now() + (tokenResponse.expires_in * 1000);
            
            // Obtener datos del usuario
            fetchGoogleUserInfo();
            
            saveGoogleSession();
            showToast("✅ Conectado correctamente con Google Drive", "success");
            
            // Si el modal está abierto, cerrarlo
            const loginModal = document.getElementById('login-modal');
            if(loginModal) loginModal.classList.add('hidden');
            
            updateUIForLoggedInUser();
            startAutoSync();
            loadFromDrive();
        },
        error_callback: (err) => {
            console.error("❌ OAuth Error", err);
            showToast("Error de autorización Google", "error");
        }
    });
}

/**
 * Iniciar flujo de login cuando el usuario clickea el boton
 */
function loginWithGoogle() {
    if (!tokenClient) initGoogleAuth();
    tokenClient.requestAccessToken({ prompt: "consent" });
}

/**
 * Obtener datos del perfil del usuario logueado
 */
async function fetchGoogleUserInfo() {
    try {
        const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
            headers: { Authorization: `Bearer ${GoogleDriveSync.accessToken}` }
        });
        GoogleDriveSync.user = await res.json();
        saveGoogleSession();
    } catch(e) {
        console.warn("No se pudo obtener info de usuario", e);
    }
}

/**
 * Guardar sesión de Google en almacenamiento local
 */
function saveGoogleSession() {
    localStorage.setItem('google_session', JSON.stringify({
        user: GoogleDriveSync.user,
        accessToken: GoogleDriveSync.accessToken,
        tokenExpiry: GoogleDriveSync.tokenExpiry,
        loggedIn: GoogleDriveSync.isLoggedIn
    }));
}

/**
 * Cargar sesión guardada al iniciar la aplicación
 */
function loadGoogleSession() {
    const savedSession = localStorage.getItem('google_session');
    
    if (savedSession) {
        const session = JSON.parse(savedSession);
        
        if (session.loggedIn && session.tokenExpiry > Date.now()) {
            GoogleDriveSync.isLoggedIn = true;
            GoogleDriveSync.user = session.user;
            GoogleDriveSync.accessToken = session.accessToken;
            GoogleDriveSync.tokenExpiry = session.tokenExpiry;
            
            updateUIForLoggedInUser();
            startAutoSync();
            
            console.log("✅ Sesión de Google restaurada automáticamente");
            return true;
        }
    }
    
    return false;
}

/**
 * Actualizar interfaz cuando usuario está logueado
 */
function updateUIForLoggedInUser() {
    // Agregar indicador de sincronización en la barra superior
    const headerRight = document.querySelector('header .flex.items-center.gap-2');
    if (!headerRight) return;
    
    // Eliminar botón anterior si existe
    const existingSyncBtn = document.getElementById('sync-status-btn');
    if (existingSyncBtn) existingSyncBtn.remove();
    
    // Crear botón de estado sincronización
    const syncButton = document.createElement('button');
    syncButton.id = 'sync-status-btn';
    syncButton.className = 'text-green-500 p-2 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium';
    syncButton.title = `Conectado como ${GoogleDriveSync.user?.email || 'Usuario'}`;
    syncButton.innerHTML = `<i class="fas fa-cloud"></i> <span class="hidden sm:inline">Sincronizado</span>`;
    syncButton.onclick = () => saveToDrive(); // Permitir guardado manual al hacer clic
    
    // Insertar antes del resto de botones
    headerRight.insertBefore(syncButton, headerRight.firstChild);
}

/**
 * Guardar todos los datos de texto de la aplicación en Google Drive
 */
async function saveToDrive() {
    if (!GoogleDriveSync.isLoggedIn) return false;
    
    try {
        const saveStatus = document.getElementById('save-status');
        if (saveStatus) saveStatus.innerHTML = '<i class="fas fa-sync fa-spin text-indigo-500"></i> Sincronizando...';
        
        // 🆕 CORRECCIÓN: Leer exactamente la estructura que usa app.js
        let appData = JSON.parse(localStorage.getItem('studio_data_v2') || '{"subjects":[],"notes":{}}');
        appData.syncTimestamp = new Date().toISOString();
        
        const existingFile = await findDriveFile('studio_app_backup.json');
        
        if (existingFile) {
            await updateDriveFile(existingFile.id, appData);
        } else {
            await createDriveFile('studio_app_backup.json', appData);
        }
        
        GoogleDriveSync.lastSyncTime = Date.now();
        if (saveStatus) saveStatus.innerHTML = '<i class="fas fa-check text-green-500"></i> Sincronizado con Drive';
        
        console.log("✅ Datos base guardados correctamente en Google Drive");
        return true;
        
    } catch (error) {
        console.error("❌ Error guardando en Drive:", error);
        const saveStatus = document.getElementById('save-status');
        if (saveStatus) saveStatus.innerHTML = '<i class="fas fa-exclamation-triangle text-orange-500"></i> Error sincronización';
        return false;
    }
}

/**
 * Cargar datos de texto desde Google Drive
 */
async function loadFromDrive() {
    if (!GoogleDriveSync.isLoggedIn) return false;
    
    try {
        showToast("Cargando datos desde Google Drive...", "info");
        
        const backupFile = await findDriveFile('studio_app_backup.json');
        
        if (backupFile) {
            const data = await getDriveFileContent(backupFile.id);
            
            if (data && data.subjects) {
                // 🆕 CORRECCIÓN: Guardar en la llave correcta de app.js
                localStorage.setItem('studio_data_v2', JSON.stringify(data));
                
                // Actualizar variables en memoria
                if (typeof window.appData !== 'undefined') {
                    window.appData = data;
                }
                
                // Refrescar UI
                if (typeof renderSubjects === 'function') {
                    renderSubjects();
                }
                if (typeof renderAiSources === 'function') {
                    renderAiSources();
                }
                
                showToast("Datos restaurados correctamente desde Drive", "success");
                return true;
            }
        }
        
        return false;
        
    } catch (error) {
        console.error("❌ Error cargando desde Drive:", error);
        showToast("No se pudieron cargar los datos desde Drive", "error");
        return false;
    }
}

// ==============================================================
// 🆕 NUEVAS FUNCIONES PARA MANEJAR PDFs PESADOS EN GOOGLE DRIVE
// ==============================================================

/**
 * Sube un archivo (PDF) a la carpeta de datos de la app en Google Drive.
 * Se hace en 2 pasos: primero se crea la metadata y luego se sube el contenido binario.
 * @returns {string} El ID del archivo en Google Drive.
 */
async function uploadPdfToDrive(file, fileName) {
    if (!GoogleDriveSync.isLoggedIn) throw new Error("No hay sesión en Google Drive");

    showToast(`Subiendo ${fileName} a la nube... Esto puede tardar unos segundos.`, "info");

    // Paso 1: Crear metadatos en Drive (archivo vacío)
    const metadata = {
        name: fileName,
        mimeType: 'application/pdf',
        parents: ['appDataFolder'] // Lo guardamos en la carpeta oculta de la app
    };

    const resMetadata = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GoogleDriveSync.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
    });

    if (!resMetadata.ok) throw new Error("Error creando archivo en Drive");
    const fileInfo = await resMetadata.json();
    const driveFileId = fileInfo.id;

    // Paso 2: Subir el contenido binario (Blob/File) usando el ID generado
    const resUpload = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${driveFileId}?uploadType=media`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${GoogleDriveSync.accessToken}`,
            'Content-Type': 'application/pdf'
        },
        body: file
    });

    if (!resUpload.ok) throw new Error("Error subiendo el contenido del PDF");
    
    console.log(`✅ PDF ${fileName} subido a Drive con ID: ${driveFileId}`);
    return driveFileId;
}

/**
 * Descarga el contenido binario de un PDF desde Google Drive
 * @returns {Blob} El archivo PDF listo para usarse
 */
async function downloadPdfFromDrive(driveFileId) {
    if (!GoogleDriveSync.isLoggedIn) throw new Error("No hay sesión en Google Drive");

    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`, {
        headers: {
            'Authorization': `Bearer ${GoogleDriveSync.accessToken}`
        }
    });

    if (!response.ok) {
        throw new Error("No se pudo descargar el PDF de la nube");
    }

    return await response.blob();
}

/**
 * Elimina un archivo permanentemente de la carpeta de la app en Drive
 */
async function deletePdfFromDrive(driveFileId) {
    if (!GoogleDriveSync.isLoggedIn) return; // Si no hay sesión, no podemos borrarlo

    try {
        await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${GoogleDriveSync.accessToken}`
            }
        });
        console.log(`🗑️ PDF eliminado de Drive: ${driveFileId}`);
    } catch (e) {
        console.warn("Error borrando el archivo de Drive, tal vez ya no existía.", e);
    }
}

// ==============================================================
// FUNCIONES AUXILIARES DRIVE API (JSON y REST)
// ==============================================================

async function findDriveFile(fileName) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${fileName}'&spaces=appDataFolder`, {
        headers: { 'Authorization': `Bearer ${GoogleDriveSync.accessToken}` }
    });
    const result = await response.json();
    if (result.files && result.files.length > 0) return result.files[0];
    return null;
}

async function createDriveFile(fileName, content) {
    const boundary = '-------314159265358979323846';
    const delimiter = "\r\n--" + boundary + "\r\n";
    const close_delim = "\r\n--" + boundary + "--";
    
    const metadata = {
        'name': fileName,
        'mimeType': 'application/json',
        'parents': ['appDataFolder']
    };
    
    const multipartRequestBody =
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(metadata) +
        delimiter +
        'Content-Type: application/json\r\n\r\n' +
        JSON.stringify(content) +
        close_delim;
    
    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${GoogleDriveSync.accessToken}`,
            'Content-Type': 'multipart/related; boundary="' + boundary + '"'
        },
        body: multipartRequestBody
    });
    
    return await response.json();
}

async function updateDriveFile(fileId, content) {
    const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${GoogleDriveSync.accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(content)
    });
    return await response.json();
}

async function getDriveFileContent(fileId) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { 'Authorization': `Bearer ${GoogleDriveSync.accessToken}` }
    });
    return await response.json();
}

function startAutoSync() {
    if (GoogleDriveSync.syncInterval) clearInterval(GoogleDriveSync.syncInterval);
    GoogleDriveSync.syncInterval = setInterval(() => {
        saveToDrive();
    }, 60000); // 1 minuto
}

function logoutGoogle() {
    GoogleDriveSync.isLoggedIn = false;
    GoogleDriveSync.user = null;
    GoogleDriveSync.accessToken = null;
    localStorage.removeItem('google_session');
    if (GoogleDriveSync.syncInterval) {
        clearInterval(GoogleDriveSync.syncInterval);
        GoogleDriveSync.syncInterval = null;
    }
    const syncBtn = document.getElementById('sync-status-btn');
    if (syncBtn) syncBtn.remove();
    showToast("Sesión de Google cerrada", "info");
}

document.addEventListener('DOMContentLoaded', () => {
    const sessionRestored = loadGoogleSession();
    if (!sessionRestored) {
        setTimeout(() => {
            const loginModal = document.getElementById('login-modal');
            if (loginModal && !localStorage.getItem('login_modal_closed')) {
                loginModal.classList.remove('hidden');
            }
        }, 2000);
    }
});

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (GoogleDriveSync.isLoggedIn) saveToDrive();
    }
});