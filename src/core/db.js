// 2. BASE DE DATOS INTERNA (IndexedDB - Caché Rápida)
// ==========================================
const idb = {
    db: null,
    init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('StudyStudioDB', 3);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('pdfs')) {
                    db.createObjectStore('pdfs');
                }
                if (!db.objectStoreNames.contains('workspace')) {
                    db.createObjectStore('workspace');
                }
                if (!db.objectStoreNames.contains('embeddings')) {
                    db.createObjectStore('embeddings');
                }
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = () => reject('No se pudo abrir IndexedDB');
        });
    },
    async save(id, blob) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('pdfs', 'readwrite');
            tx.objectStore('pdfs').put(blob, id);
            tx.oncomplete = resolve;
        });
    },
    async get(id) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('pdfs', 'readonly');
            const req = tx.objectStore('pdfs').get(id);
            req.onsuccess = () => resolve(req.result);
        });
    },
    async delete(id) {
        return new Promise((resolve) => {
            const tx = this.db.transaction('pdfs', 'readwrite');
            tx.objectStore('pdfs').delete(id);
            tx.oncomplete = resolve;
        });
    },
    /** Copia completa del workspace (JSON string); localStorage tiene ~5 MB y se llena con notas/imágenes. */
    async putWorkspace(jsonString) {
        return new Promise((resolve, reject) => {
            if (!this.db.objectStoreNames.contains('workspace')) {
                reject(new Error('workspace store missing'));
                return;
            }
            const tx = this.db.transaction('workspace', 'readwrite');
            tx.objectStore('workspace').put(jsonString, 'studio_data_v2');
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },
    async getWorkspace() {
        return new Promise((resolve) => {
            if (!this.db.objectStoreNames.contains('workspace')) {
                resolve(null);
                return;
            }
            const tx = this.db.transaction('workspace', 'readonly');
            const req = tx.objectStore('workspace').get('studio_data_v2');
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    },
    async saveEmbedding(id, data) {
        return new Promise((resolve, reject) => {
            if (!this.db.objectStoreNames.contains('embeddings')) return resolve();
            const tx = this.db.transaction('embeddings', 'readwrite');
            tx.objectStore('embeddings').put(data, id);
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error);
        });
    },
    async getEmbedding(id) {
        return new Promise((resolve) => {
            if (!this.db.objectStoreNames.contains('embeddings')) return resolve(null);
            const tx = this.db.transaction('embeddings', 'readonly');
            const req = tx.objectStore('embeddings').get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => resolve(null);
        });
    },
    async clearAllStores() {
        return new Promise((resolve) => {
            if (!this.db) {
                resolve();
                return;
            }
            const names = ['workspace', 'pdfs', 'embeddings'];
            let i = 0;
            const step = () => {
                if (i >= names.length) {
                    resolve();
                    return;
                }
                const name = names[i++];
                if (!this.db.objectStoreNames.contains(name)) {
                    step();
                    return;
                }
                const tx = this.db.transaction(name, 'readwrite');
                tx.objectStore(name).clear();
                tx.oncomplete = step;
                tx.onerror = step;
            };
            step();
        });
    }
};

// ==========================================