// ==========================================
// 🧠 Motor Vectorial 100% en el Navegador
// Utiliza WebAssembly y Transformers.js
// ==========================================

window.TransformersEngine = {
    pipeline: null,
    embedder: null,
    embeddingCache: new Map(), // fileId -> { chunks: [], embeddings: [] }
    isModelLoading: false,
    
    async initModel() {
        if (this.embedder) return this.embedder;
        if (this.isModelLoading) {
            // Esperar a que cargue si ya está en proceso
            while (this.isModelLoading) {
                await new Promise(r => setTimeout(r, 500));
            }
            return this.embedder;
        }

        this.isModelLoading = true;
        try {
            if (typeof showToast !== 'undefined') {
                showToast('Descargando modelo de IA (esto tomará unos segundos la primera vez)...', 'info');
            }
            
            // Usar la API global expuesta en index.html
            const { pipeline, env } = window.TransformersAPI;
            
            // Configuraciones recomendadas para browser
            env.allowLocalModels = false;
            
            // Cargar el pipeline de feature-extraction
            // all-MiniLM-L6-v2 es muy rápido y preciso para oraciones
            this.embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                progress_callback: x => {
                    if (x.status === 'downloading') {
                        const loader = document.getElementById('loading-msg');
                        if (loader) {
                            loader.innerText = `Descargando IA... ${Math.round(x.progress)}%`;
                        }
                    }
                }
            });
            
            if (typeof showToast !== 'undefined') {
                showToast('¡Modelo de IA listo para usar!', 'success');
            }
        } catch (e) {
            console.error('Error al inicializar el modelo de HuggingFace:', e);
            if (typeof showToast !== 'undefined') {
                showToast('Error al cargar el modelo de IA', 'error');
            }
            throw e;
        } finally {
            this.isModelLoading = false;
            const loader = document.getElementById('loading-msg');
            if (loader) loader.innerText = `Procesando...`;
        }
        return this.embedder;
    },

    async embedText(text) {
        const embedder = await this.initModel();
        // El pooling "mean" y "normalize" es crucial para obtener el vector de similitud coseno
        const result = await embedder(text, { pooling: 'mean', normalize: true });
        return result.data; // Devuelve el Float32Array de 384 dimensiones
    },

    cosineSimilarity(vecA, vecB) {
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    },

    async processAndCacheChunks(fileId, textChunks) {
        if (this.embeddingCache.has(fileId)) {
            return this.embeddingCache.get(fileId);
        }
        
        // 🆕 NUEVO: Intentar recuperar desde IndexedDB
        if (typeof idb !== 'undefined') {
            const cachedData = await idb.getEmbedding(fileId);
            if (cachedData && cachedData.chunks && cachedData.embeddings && Math.abs(cachedData.chunks.length - textChunks.length) < 5) {
                console.log(`🧠 Memoria IA: Vectores recuperados del disco para ${fileId} (${cachedData.chunks.length} chunks)`);
                this.embeddingCache.set(fileId, cachedData);
                return cachedData;
            } else if (cachedData) {
                console.log(`⚠️ Memoria IA: Cache invalidado para ${fileId} (Chunks difieren: guardado ${cachedData.chunks?.length || 0} vs actual ${textChunks.length}). Recalculando...`);
            }
            
            // Si no está en disco, intentar descargarlo de Drive si la sesión está iniciada
            if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
                console.log(`☁️ Buscando vectores en Drive para ${fileId}...`);
                const driveData = await window.GoogleDriveSync.syncEmbeddingsFromDrive(fileId);
                if (driveData && driveData.chunks && driveData.embeddings && Math.abs(driveData.chunks.length - textChunks.length) < 5) {
                    console.log(`🧠 Memoria IA: Vectores recuperados de Google Drive para ${fileId} (${driveData.chunks.length} chunks)`);
                    // Transformar de array normal a Float32Array
                    driveData.embeddings = driveData.embeddings.map(arr => new Float32Array(Object.values(arr)));
                    this.embeddingCache.set(fileId, driveData);
                    await idb.saveEmbedding(fileId, driveData); // Guardar en local para la próxima
                    return driveData;
                } else if (driveData) {
                    console.log(`⚠️ Memoria IA: Cache de Drive invalidado para ${fileId} (Chunks difieren)`);
                }
            }
        }
        
        const embeddings = [];
        // Procesamos por baches para no bloquear la UI completamente
        const embedder = await this.initModel();
        
        for (let i = 0; i < textChunks.length; i++) {
            const chunk = textChunks[i];
            const result = await embedder(chunk.text, { pooling: 'mean', normalize: true });
            embeddings.push(result.data);
            
            // Ceder el hilo cada 3 chunks para que el navegador no se congele
            if (i % 3 === 0) await new Promise(r => setTimeout(r, 0));
        }
        
        const cacheData = { chunks: textChunks, embeddings };
        this.embeddingCache.set(fileId, cacheData);
        
        // 🆕 NUEVO: Guardar en IndexedDB y Drive (Background)
        if (typeof idb !== 'undefined') {
            await idb.saveEmbedding(fileId, cacheData);
            console.log(`🧠 Memoria IA: Nuevos vectores guardados en disco local para ${fileId}`);
            
            if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
                // Subir a Drive de forma asincrónica (no frena la ejecución actual)
                window.GoogleDriveSync.syncEmbeddingsToDrive(fileId, cacheData).catch(e => console.error('Error subiendo vectores', e));
            }
        }
        
        return cacheData;
    },

    async searchRelevantChunks(userNotes, allTextChunksWithFileId, topK = 5) {
        if (!userNotes || userNotes.trim() === '') return [];
        
        // 1. Obtener el embedding semántico de las notas del usuario (nuestra query)
        const queryEmbedding = await this.embedText(userNotes);
        
        const results = [];
        
        // 2. Agrupar chunks por fileId para procesar y aprovechar la caché
        const chunksByFile = {};
        for (const chunk of allTextChunksWithFileId) {
            if (!chunksByFile[chunk.fileId]) chunksByFile[chunk.fileId] = [];
            chunksByFile[chunk.fileId].push(chunk);
        }
        
        // 3. Procesar embeddings de todos los chunks y buscar similitud
        for (const [fileId, chunks] of Object.entries(chunksByFile)) {
            const cacheData = await this.processAndCacheChunks(fileId, chunks);
            
            for (let i = 0; i < cacheData.chunks.length; i++) {
                const similarity = this.cosineSimilarity(queryEmbedding, cacheData.embeddings[i]);
                results.push({
                    chunk: cacheData.chunks[i],
                    score: similarity
                });
            }
        }
        
        // 4. Ordenar por relevancia (mayor a menor score)
        results.sort((a, b) => b.score - a.score);
        
        // Retornar los topK más relevantes que superen un mínimo de similitud (ej: 0.2)
        return results.filter(r => r.score > 0.2).slice(0, topK);
    },

    _prewarmingFiles: new Set(),
    
    async prewarmAIFiles(fileIds) {
        // Ejecutamos en background con setTimeout para no bloquear
        setTimeout(async () => {
            console.log(`[Background] Iniciando precalentamiento de ${fileIds.length} PDFs...`);
            
            for (const fileId of fileIds) {
                if (this._prewarmingFiles.has(fileId)) continue;
                this._prewarmingFiles.add(fileId);
                
                try {
                    // Verificar si ya está en local
                    if (typeof idb !== 'undefined') {
                        const cached = await idb.getEmbedding(fileId);
                        if (cached && cached.chunks) {
                            console.log(`[Background] PDF ${fileId} ya está en caché local. (saltando)`);
                            continue;
                        }
                        
                        // Verificar en Drive
                        if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
                            const driveData = await window.GoogleDriveSync.syncEmbeddingsFromDrive(fileId);
                            if (driveData && driveData.chunks) {
                                console.log(`[Background] PDF ${fileId} descargado de Drive.`);
                                driveData.embeddings = driveData.embeddings.map(arr => new Float32Array(Object.values(arr)));
                                this.embeddingCache.set(fileId, driveData);
                                await idb.saveEmbedding(fileId, driveData);
                                continue;
                            }
                        }
                    }

                    console.log(`[Background] Procesando texto de PDF ${fileId}...`);
                    // Procesar localmente (Extracción + Chunking + Embedding)
                    if (typeof idb !== 'undefined') {
                        const blob = await idb.get(fileId);
                        if (!blob) continue;

                        if (typeof extractTextFromBlob === 'function') {
                            const result = await extractTextFromBlob(blob, '', true);
                            if (result && result.text) {
                                const chunks = result.text.split(/\n\n/).map(c => c.trim()).filter(c => c.length > 50);
                                const textChunks = chunks.map(chunk => ({ fileId, text: chunk }));
                                await this.processAndCacheChunks(fileId, textChunks);
                                console.log(`[Background] PDF ${fileId} pre-indexado con éxito.`);
                            }
                        }
                    }
                } catch (e) {
                    console.warn(`[Background] Error precalentando PDF ${fileId}:`, e);
                }
                
                // Pausa entre archivos para no quemar la CPU
                await new Promise(r => setTimeout(r, 2000));
            }
        }, 5000); // Esperar 5 segundos antes de iniciar el trabajo de fondo para no trabar la carga inicial
    }
};
