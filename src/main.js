// 9. INICIALIZACIÓN
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
    try {
        await idb.init();
    } catch (e) {
        console.warn("⚠️ No se pudo inicializar IndexedDB (posible modo incógnito o restricción del navegador). Los PDFs podrían no guardarse localmente.", e);
    }
    
    try {
        await loadData();
    } catch (e) {
        console.warn("⚠️ Error al cargar datos guardados:", e);
    }
    
    showEmptyState();
    renderSubjects();
    
    // Re-renderizado del PDF responsivo (Debounced)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => { if (currentState.pdfDoc) renderPage(); }, 200);
    });

    if(window.GoogleDriveSync && typeof window.GoogleDriveSync.init === 'function') {
        window.GoogleDriveSync.init();
    }
    
    if(typeof renderAiSources === 'function') {
        renderAiSources();
    }

    document.getElementById('notes-editor').addEventListener('input', () => {
        currentState.isDirty = true;
        if (typeof updateSaveStatus === 'function') {
            updateSaveStatus('<i class="fas fa-exclamation-circle text-amber-500"></i> Sin guardar', 'amber');
        }
        
        const editor = document.getElementById('notes-editor');
        const selection = window.getSelection();
        if (!selection.rangeCount) return;
        const range = selection.getRangeAt(0);
        const rect = range.getBoundingClientRect();
        const editorRect = editor.getBoundingClientRect();
        const threshold = editorRect.top + editorRect.height * 0.6;
        if (rect.bottom > threshold) {
            editor.scrollBy({ top: rect.bottom - threshold + 24, behavior: 'smooth' });
        }
    });
    
    document.getElementById('notes-editor').addEventListener('click', (e) => {
        if (e.target.tagName === 'IMG') {
            document.querySelectorAll('#notes-editor img.selected').forEach(i => i.classList.remove('selected'));
            e.target.classList.add('selected');
        } else {
            document.querySelectorAll('#notes-editor img.selected').forEach(i => i.classList.remove('selected'));
        }
    });

    // Interceptar el pegado para evitar estilos indeseados (ej. color transparente desde el PDF)
    document.getElementById('notes-editor').addEventListener('paste', (e) => {
        e.preventDefault();
        
        // Obtener texto plano del portapapeles
        const text = (e.originalEvent || e).clipboardData.getData('text/plain');
        
        if (text) {
            document.execCommand('insertText', false, text);
        } else {
            // Si no hay texto plano pero hay imágenes
            const items = (e.originalEvent || e).clipboardData.items;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    const blob = items[i].getAsFile();
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const img = document.createElement('img');
                        img.src = event.target.result;
                        img.style.maxWidth = '100%';
                        img.style.borderRadius = '8px';
                        img.style.marginTop = '10px';
                        img.style.marginBottom = '10px';
                        
                        // Insertar imagen
                        const sel = window.getSelection();
                        if (sel.getRangeAt && sel.rangeCount) {
                            const range = sel.getRangeAt(0);
                            range.insertNode(img);
                            // Mover cursor después de la imagen
                            range.setStartAfter(img);
                            range.setEndAfter(img);
                            sel.removeAllRanges();
                            sel.addRange(range);
                        } else {
                            document.getElementById('notes-editor').appendChild(img);
                        }
                    };
                    reader.readAsDataURL(blob);
                }
            }
        }
    });

    document.addEventListener('visibilitychange', () => {
        // En móviles/pestañas ocultas, ya no auto-guardamos sin permiso, pero por si acaso podríamos forzar local.
        // Se desactiva el auto-guardado a pedido del usuario.
    });
    window.addEventListener('pagehide', () => {
        // Se desactiva el auto-guardado a pedido del usuario.
    });
    
    // Alerta al cerrar si hay cambios sin guardar
    window.addEventListener('beforeunload', (e) => {
        if (currentState.isDirty) {
            e.preventDefault();
            e.returnValue = ''; // Muestra el mensaje por defecto del navegador
        }
    });
});