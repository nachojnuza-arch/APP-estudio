// 6. VISOR DE PDF, NOTAS Y NAVEGACIÓN
// ==========================================
async function showEmptyState() {
    if (currentState.currentSubject) {
        await saveCurrentNotes(true);
    }
    document.getElementById('pdf-container').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('pdf-controls').classList.add('hidden');
    document.getElementById('header-title').textContent = 'Workspace';
    const headerIcon = document.getElementById('header-icon');
    if(headerIcon) headerIcon.className = 'fas fa-folder-open text-slate-400 shrink-0 group-hover:text-primary-500 transition-colors';
    document.getElementById('notes-editor').innerHTML = '';
    currentState.currentFileId = null;
    currentState.currentSubject = null;

    const dashboard = document.getElementById('subject-dashboard');
    if (dashboard && appData.subjects && appData.subjects.length > 0) {
        document.getElementById('empty-state').classList.add('hidden');
        dashboard.classList.remove('hidden');
        let html = `<div class="max-w-5xl mx-auto">`;
        html += `<h2 class="text-2xl md:text-3xl font-bold text-slate-800 mb-2">Mi Workspace</h2>`;
        html += `<p class="text-slate-500 mb-8">Selecciona una materia para ver sus recursos y apuntes.</p>`;
        html += `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">`;
        
        appData.subjects.forEach(sub => {
            html += `<div onclick="openGeneralNotes('${sub.id}')" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg hover:-translate-y-1 hover:border-primary-300 cursor-pointer transition-all duration-300 flex flex-col items-center text-center group"><div class="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"><i class="fas ${sub.icon || 'fa-book'} text-3xl text-primary-500"></i></div><span class="text-sm font-bold text-slate-700 line-clamp-3 leading-snug">${sub.name}</span><span class="text-[10px] font-medium text-slate-400 bg-slate-50 px-2 py-1 rounded mt-3">${sub.files.length} recursos</span></div>`;
        });
        
        html += `<div onclick="openModal('manage-subjects-modal')" class="bg-transparent p-5 rounded-2xl border-2 border-dashed border-slate-300 hover:border-primary-300 hover:bg-slate-50 cursor-pointer transition-all duration-300 flex flex-col items-center justify-center text-center group"><div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mb-3 group-hover:bg-primary-100 transition-colors"><i class="fas fa-plus text-slate-400 group-hover:text-primary-500"></i></div><span class="text-sm font-bold text-slate-500 group-hover:text-primary-600">Añadir Materia</span></div>`;
        html += `</div></div>`;
        dashboard.innerHTML = html;
    } else {
        document.getElementById('empty-state').classList.remove('hidden');
        if (dashboard) dashboard.classList.add('hidden');
    }
}

// Una sola hoja de apuntes por materia (sub_ID)
async function openGeneralNotes(subId) {
    await saveCurrentNotes(true);

    const sub = appData.subjects.find(s => s.id === subId);
    currentState.currentSubject = subId;
    currentState.currentFileId = null;
    
    // Configurar la primera hoja por defecto si no hay ninguna
    if (!sub.sheets || sub.sheets.length === 0) {
        sub.sheets = [{ id: 'main', name: 'Hoja Principal' }];
    }
    currentState.currentSheetId = sub.sheets[0].id;

    document.getElementById('header-title').textContent = `Apuntes: ${sub.name}`;
    document.getElementById('notes-editor').innerHTML = getSubjectNotesHtml(subId, currentState.currentSheetId);
    renderSheetsTabs();
    
    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('pdf-container').classList.add('hidden');
    document.getElementById('video-container').classList.add('hidden');
    document.getElementById('pdf-controls').classList.add('hidden');
    
    // 🆕 Pre-cargar vectores en background
    if (window.TransformersEngine && window.TransformersEngine.prewarmAIFiles) {
        const fileIds = sub.files.filter(f => f.type === 'pdf').map(f => f.id);
        if (fileIds.length > 0) window.TransformersEngine.prewarmAIFiles(fileIds);
    }
    
    const dashboard = document.getElementById('subject-dashboard');
    if (dashboard) {
        dashboard.classList.remove('hidden');
        let html = `<div class="max-w-5xl mx-auto">`;
        html += `<h2 class="text-2xl md:text-3xl font-bold text-slate-800 mb-2">Recursos de ${sub.name}</h2>`;
        html += `<p class="text-slate-500 mb-8">Selecciona un documento para abrirlo. Los apuntes de la derecha son los mismos para toda la materia.</p>`;
        html += `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-6">`;
        
        if (sub.files.length === 0) {
            html += `<div class="col-span-full text-center py-16 bg-white rounded-2xl border border-dashed border-slate-300"><i class="fas fa-folder-open text-4xl text-slate-300 mb-3"></i><p class="text-slate-500 font-medium">No hay archivos en esta materia</p><button onclick="openAddFileModal('${sub.id}')" class="mt-4 px-4 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-sm font-bold hover:bg-indigo-100 transition-colors">Añadir recurso</button></div>`;
        } else {
            sub.files.forEach(f => {
                const icon = f.type === 'pdf' ? 'fa-file-pdf text-rose-500' : 'fa-play-circle text-sky-500';
                const bgIcon = f.type === 'pdf' ? 'bg-rose-50' : 'bg-sky-50';
                html += `<div onclick="openFile('${sub.id}', '${f.id}')" class="bg-white p-5 rounded-2xl shadow-sm border border-slate-200 hover:shadow-lg hover:-translate-y-1 hover:border-indigo-300 cursor-pointer transition-all duration-300 flex flex-col items-center text-center group"><div class="w-16 h-16 rounded-full ${bgIcon} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300"><i class="fas ${icon} text-3xl"></i></div><span class="text-sm font-bold text-slate-700 line-clamp-3 leading-snug">${f.name}</span></div>`;
            });
        }
        html += `</div></div>`;
        dashboard.innerHTML = html;
    }
    
    if (window.innerWidth < 768) {
        document.getElementById('sidebar').classList.add('-translate-x-full');
        document.getElementById('sidebar-overlay')?.classList.add('hidden');
    }
    renderSubjects();
}

async function openFile(subId, fileId) {
    await saveCurrentNotes(true);

    const sub = appData.subjects.find(s => s.id === subId);
    const file = sub.files.find(f => f.id === fileId);

    currentState.currentSubject = subId;
    currentState.currentFileId = fileId;
    
    if (!sub.sheets || sub.sheets.length === 0) {
        sub.sheets = [{ id: 'main', name: 'Hoja Principal' }];
    }
    // Mantener la hoja actual si es la misma materia, o cambiar a la primera
    if (!currentState.currentSheetId || !sub.sheets.find(s => s.id === currentState.currentSheetId)) {
        currentState.currentSheetId = sub.sheets[0].id;
    }

    document.getElementById('header-title').textContent = file.name;
    document.getElementById('notes-editor').innerHTML = getSubjectNotesHtml(subId, currentState.currentSheetId);
    renderSheetsTabs();
    
    const sidebar = document.getElementById('sidebar');
    if (window.innerWidth < 768) {
        sidebar.classList.add('-translate-x-full');
        document.getElementById('sidebar-overlay')?.classList.add('hidden');
    } else {
        sidebar.classList.add('md:hidden');
    }
    setTimeout(() => { if (currentState.pdfDoc) renderPage(); }, 300);
    
    renderSubjects();

    // 🆕 Pre-cargar vectores en background
    if (window.TransformersEngine && window.TransformersEngine.prewarmAIFiles) {
        const fileIds = sub.files.filter(f => f.type === 'pdf').map(f => f.id);
        if (fileIds.length > 0) window.TransformersEngine.prewarmAIFiles(fileIds);
    }

    document.getElementById('empty-state').classList.add('hidden');
    document.getElementById('subject-dashboard')?.classList.add('hidden');
    const pdfContainer = document.getElementById('pdf-container');
    const videoCont = document.getElementById('video-container');

    if (file.type === 'pdf') {
        videoCont.classList.add('hidden');
        currentState.rotation = 0;
        
        let blob = await idb.get(fileId);
        if (!blob && file.driveId && window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            showLoading('Descargando de Drive...');
            blob = await window.GoogleDriveSync.downloadPdfFromDrive(file.driveId);
            if (blob) { 
                await idb.save(fileId, blob); 
                saveData(false); 
            }
            hideLoading();
        }

        if (blob || file.url) {
            pdfContainer.classList.remove('hidden'); document.getElementById('pdf-controls').classList.remove('hidden');
            const url = blob ? URL.createObjectURL(blob) : file.url;
            currentState.pdfDoc = await pdfjsLib.getDocument(url).promise;
            currentState.pageNum = 1; renderPage();
        }
    } else {
        pdfContainer.classList.add('hidden'); document.getElementById('pdf-controls').classList.add('hidden');
        videoCont.classList.remove('hidden');
        videoCont.innerHTML = `<iframe src="${file.url}" class="w-full h-full border-0" allowfullscreen></iframe>`;
    }
}

async function renderPage() {
    if (!currentState.pdfDoc || currentState.isRendering) return;
    currentState.isRendering = true;
    try {
        const page = await currentState.pdfDoc.getPage(currentState.pageNum);
        const canvas = document.getElementById('pdf-canvas');
        const pageRotate = page.rotate || 0;
        const totalRotation = (pageRotate + (currentState.rotation || 0)) % 360;
        const viewport = page.getViewport({ scale: currentState.zoom, rotation: totalRotation });
        
        const container = document.getElementById('pdf-container');
        container.style.width = viewport.width + 'px';
        container.style.height = viewport.height + 'px';

        canvas.height = viewport.height; 
        canvas.width = viewport.width;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        
        // Capa de texto para selección
        const textLayerDiv = document.getElementById('text-layer');
        textLayerDiv.innerHTML = ''; 
        textLayerDiv.style.setProperty('--scale-factor', viewport.scale);
        
        const textContent = await page.getTextContent();
        pdfjsLib.renderTextLayer({
            textContentSource: textContent,
            container: textLayerDiv,
            viewport: viewport,
            textDivs: []
        });

        document.getElementById('page-input').value = currentState.pageNum;
        document.getElementById('page-total').textContent = currentState.pdfDoc.numPages;
        document.getElementById('zoom-info').textContent = `${Math.round(currentState.zoom * 100)}%`;
    } catch(e) {
        console.error("Error renderizando PDF:", e);
    }
    currentState.isRendering = false;
}

function changePage(delta) { goToPage(currentState.pageNum + delta); }

function goToPage(num) {
    num = parseInt(num);
    if(num >= 1 && num <= currentState.pdfDoc?.numPages) { 
        currentState.pageNum = num; 
        renderPage(); 
    } else {
        document.getElementById('page-input').value = currentState.pageNum;
    }
}

function changeZoom(delta) { currentState.zoom = Math.max(0.5, Math.min(3.0, currentState.zoom + delta)); renderPage(); }

function rotatePdf(delta = 90) {
    if (!currentState.pdfDoc) return;
    if (typeof currentState.rotation !== 'number') currentState.rotation = 0;
    currentState.rotation = (currentState.rotation + delta) % 360;
    if (currentState.rotation < 0) currentState.rotation += 360;
    renderPage();
}

document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); if (currentState.pdfDoc) changePage(e.key === 'ArrowRight' ? 1 : -1); }
    if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); if (currentState.pdfDoc) changeZoom(e.key === 'ArrowUp' ? 0.1 : -0.1); }
    if ((e.key === 'r' || e.key === 'R') && !e.ctrlKey && !e.altKey && !e.metaKey && !['INPUT', 'TEXTAREA'].includes(e.target.tagName) && !e.target.isContentEditable) {
        if (currentState.pdfDoc) {
            e.preventDefault();
            rotatePdf(e.shiftKey ? -90 : 90);
        }
    }
});

// ==========================================
// FUNCIONES DE HOJAS (SHEETS)
// ==========================================

function renderSheetsTabs() {
    const container = document.getElementById('sheets-tabs-container');
    if (!container || !currentState.currentSubject) return;

    const sub = appData.subjects.find(s => s.id === currentState.currentSubject);
    if (!sub || !sub.sheets) return;

    container.classList.remove('hidden');
    let html = '';

    sub.sheets.forEach(sheet => {
        const isActive = sheet.id === currentState.currentSheetId;
        const baseClass = "px-3 py-1.5 text-xs font-bold rounded-t-lg transition-colors flex items-center gap-2 cursor-pointer border-t border-l border-r border-transparent";
        const activeClass = isActive 
            ? "bg-white text-primary-600 border-slate-200 border-b-white z-10 -mb-px shadow-[0_-2px_4px_rgba(0,0,0,0.02)]" 
            : "bg-slate-100 text-slate-500 hover:bg-slate-200 border-transparent -mb-px";
            
        html += `<div class="${baseClass} ${activeClass}" onclick="switchSheet('${sheet.id}')" ondblclick="renameSheet('${sheet.id}')">
            <span>${sheet.name}</span>
            ${sub.sheets.length > 1 ? `<i class="fas fa-times text-[10px] text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-full w-4 h-4 flex items-center justify-center transition-colors" onclick="event.stopPropagation(); deleteSheet('${sheet.id}')"></i>` : ''}
        </div>`;
    });

    // Botón de nueva hoja
    html += `<div class="px-3 py-1.5 text-xs font-bold rounded-t-lg bg-transparent text-slate-400 hover:text-primary-500 hover:bg-primary-50 transition-colors flex items-center cursor-pointer mb-0.5" onclick="addNewSheet()">
        <i class="fas fa-plus"></i>
    </div>`;

    container.innerHTML = html;
}

async function switchSheet(sheetId) {
    if (currentState.currentSheetId === sheetId) return;
    
    // Guardar la hoja actual antes de cambiar
    await saveCurrentNotes(false);
    
    currentState.currentSheetId = sheetId;
    document.getElementById('notes-editor').innerHTML = getSubjectNotesHtml(currentState.currentSubject, sheetId);
    
    renderSheetsTabs();
}

async function addNewSheet() {
    if (!currentState.currentSubject) return;
    const sub = appData.subjects.find(s => s.id === currentState.currentSubject);
    if (!sub) return;

    const sheetId = 'sheet_' + Math.random().toString(36).substring(2, 9);
    sub.sheets.push({ id: sheetId, name: 'Hoja ' + (sub.sheets.length + 1) });
    
    await saveData(true); // guardamos los datos de estructura
    await switchSheet(sheetId); // switchSheet ya guarda y renderiza
}

async function renameSheet(sheetId) {
    if (!currentState.currentSubject) return;
    const sub = appData.subjects.find(s => s.id === currentState.currentSubject);
    if (!sub) return;
    
    const sheet = sub.sheets.find(s => s.id === sheetId);
    if (!sheet) return;

    const newName = prompt('Nuevo nombre para la hoja:', sheet.name);
    if (newName && newName.trim() !== '') {
        sheet.name = newName.trim();
        await saveData(true);
        renderSheetsTabs();
    }
}

async function deleteSheet(sheetId) {
    if (!currentState.currentSubject) return;
    const sub = appData.subjects.find(s => s.id === currentState.currentSubject);
    if (!sub || sub.sheets.length <= 1) return;

    if (!confirm('¿Seguro que quieres eliminar esta hoja? Se borrarán sus apuntes.')) return;

    sub.sheets = sub.sheets.filter(s => s.id !== sheetId);
    delete appData.notes[getSubjectNotesKey(sub.id, sheetId)];

    if (currentState.currentSheetId === sheetId) {
        currentState.currentSheetId = sub.sheets[0].id;
        document.getElementById('notes-editor').innerHTML = getSubjectNotesHtml(sub.id, currentState.currentSheetId);
    }
    
    await saveData(true);
    renderSheetsTabs();
}
