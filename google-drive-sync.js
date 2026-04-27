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

/**
 * Callback que se ejecuta cuando el usuario se loguea correctamente con Google
 */
function handleGoogleLogin(response) {
    console.log("✅ Login con Google exitoso", response);
    
    if (response.credential) {
        // Decodificar token JWT para obtener datos del usuario
        const userData = parseJwt(response.credential);
        
        GoogleDriveSync.isLoggedIn = true;
        GoogleDriveSync.user = userData;
        GoogleDriveSync.accessToken = response.credential;
        GoogleDriveSync.tokenExpiry = Date.now() + (3600 * 1000); // 1 hora validez
        
        // Guardar sesión en localStorage
        saveGoogleSession();
        
        // Mostrar notificación exitosa
        showToast("Sesión iniciada correctamente con Google Drive", "success");
        
        // Cerrar modal de login
        closeModal('login-modal');
        
        // Actualizar interfaz con datos del usuario
        updateUIForLoggedInUser();
        
        // Iniciar sincronización automática
        startAutoSync();
        
        // Cargar datos existentes desde Drive
        loadFromDrive();
    }
}

/**
 * Decodificar token JWT sin necesidad de librerías
 */
function parseJwt(token) {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));

    return JSON.parse(jsonPayload);
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
    
    // Eliminar botón anterior si existe
    const existingSyncBtn = document.getElementById('sync-status-btn');
    if (existingSyncBtn) existingSyncBtn.remove();
    
    // Crear botón de estado sincronización
    const syncButton = document.createElement('button');
    syncButton.id = 'sync-status-btn';
    syncButton.className = 'text-green-500 p-2 rounded-lg transition-colors flex items-center gap-1 text-xs font-medium';
    syncButton.title = `Conectado como ${GoogleDriveSync.user.email}`;
    syncButton.innerHTML = `<i class="fas fa-cloud"></i> <span class="hidden sm:inline">Sincronizado</span>`;
    
    // Insertar antes del resto de botones
    headerRight.insertBefore(syncButton, headerRight.firstChild);
}

/**
 * Guardar todos los datos de la aplicación en Google Drive
 */
async function saveToDrive() {
    if (!GoogleDriveSync.isLoggedIn) return false;
    
    try {
        document.getElementById('save-status').innerHTML = '<i class="fas fa-sync fa-spin text-indigo-500"></i> Sincronizando...';
        
        // Obtener todos los datos locales actuales
        const appData = {
            subjects: JSON.parse(localStorage.getItem('subjects') || '[]'),
            files: JSON.parse(localStorage.getItem('files') || '[]'),
            notes: JSON.parse(localStorage.getItem('notes') || '{}'),
            settings: JSON.parse(localStorage.getItem('settings') || '{}'),
            syncTimestamp: new Date().toISOString()
        };
        
        // Primero buscar si ya existe el archivo de backup
        const existingFile = await findDriveFile('studio_app_backup.json');
        
        if (existingFile) {
            // Actualizar archivo existente
            await updateDriveFile(existingFile.id, appData);
        } else {
            // Crear nuevo archivo
            await createDriveFile('studio_app_backup.json', appData);
        }
        
        GoogleDriveSync.lastSyncTime = Date.now();
        document.getElementById('save-status').innerHTML = '<i class="fas fa-check text-green-500"></i> Sincronizado con Drive';
        
        console.log("✅ Datos guardados correctamente en Google Drive");
        return true;
        
    } catch (error) {
        console.error("❌ Error guardando en Drive:", error);
        document.getElementById('save-status').innerHTML = '<i class="fas fa-exclamation-triangle text-orange-500"></i> Error sincronización';
        return false;
    }
}

/**
 * Cargar datos desde Google Drive
 */
async function loadFromDrive() {
    if (!GoogleDriveSync.isLoggedIn) return false;
    
    try {
        showToast("Cargando datos desde Google Drive...", "info");
        
        const backupFile = await findDriveFile('studio_app_backup.json');
        
        if (backupFile) {
            const data = await getDriveFileContent(backupFile.id);
            
            if (data && data.subjects) {
                // Restaurar datos en localStorage
                localStorage.setItem('subjects', JSON.stringify(data.subjects));
                localStorage.setItem('files', JSON.stringify(data.files));
                localStorage.setItem('notes', JSON.stringify(data.notes));
                localStorage.setItem('settings', JSON.stringify(data.settings));
                
                // Recargar la interfaz
                if (typeof loadSubjects === 'function') loadSubjects();
                
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

/**
 * Buscar archivo en Google Drive por nombre
 */
async function findDriveFile(fileName) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=name='${fileName}'&spaces=appDataFolder`, {
        headers: {
            'Authorization': `Bearer ${GoogleDriveSync.accessToken}`
        }
    });
    
    const result = await response.json();
    
    if (result.files && result.files.length > 0) {
        return result.files[0];
    }
    
    return null;
}

/**
 * Crear nuevo archivo en Google Drive (carpeta oculta appData)
 */
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

/**
 * Actualizar archivo existente en Drive
 */
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

/**
 * Obtener contenido de un archivo desde Drive
 */
async function getDriveFileContent(fileId) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: {
            'Authorization': `Bearer ${GoogleDriveSync.accessToken}`
        }
    });
    
    return await response.json();
}

/**
 * Iniciar sincronización automática cada 60 segundos
 */
function startAutoSync() {
    if (GoogleDriveSync.syncInterval) clearInterval(GoogleDriveSync.syncInterval);
    
    GoogleDriveSync.syncInterval = setInterval(() => {
        saveToDrive();
    }, 60000); // 1 minuto
}

/**
 * Cerrar sesión de Google
 */
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

/**
 * Inicializar módulo al cargar la página
 */
document.addEventListener('DOMContentLoaded', () => {
    // Intentar restaurar sesión existente
    const sessionRestored = loadGoogleSession();
    
    // Si no hay sesión activa, mostrar modal de login después de 2 segundos
    if (!sessionRestored) {
        setTimeout(() => {
            // Solo mostrar si el usuario no lo cerró anteriormente
            if (!localStorage.getItem('login_modal_closed')) {
                document.getElementById('login-modal').classList.remove('hidden');
            }
        }, 2000);
    }
});

// Agregar opción para guardar manualmente
document.addEventListener('keydown', (e) => {
    // Ctrl + S para sincronizar manualmente
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (GoogleDriveSync.isLoggedIn) {
            saveToDrive();
        }
    }
});

console.log("✅ Módulo Google Drive Sync cargado correctamente");