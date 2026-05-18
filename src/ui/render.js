// 5. GESTIÓN DE MATERIAS Y RECURSOS
// ==========================================
function renderSubjects() {
    const list = document.getElementById('subject-list');
    list.innerHTML = '';
    
    if (appData.subjects.length === 0) {
        list.innerHTML = '<li class="text-xs text-slate-500 text-center py-4 italic hide-on-collapse">No hay materias.</li>';
        
        // Actualizar también la lista de fuentes IA si no hay materias
        if (typeof renderAiSources === 'function') renderAiSources();
        return;
    }

    appData.subjects.forEach(sub => {
        const isExpanded = currentState.expandedSubjects[sub.id];
        const li = document.createElement('li');
        li.className = 'flex flex-col';
        let filesHtml = sub.files.map(f => {
            const isActive = currentState.currentFileId === f.id;
            return `
            <li class="group cursor-pointer rounded-lg flex items-center justify-between p-2 transition-colors ${isActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}" onclick="openFile('${sub.id}', '${f.id}')">
                <div class="flex items-center gap-2 overflow-hidden"><i class="fas ${f.type === 'pdf' ? 'fa-file-pdf text-rose-400' : 'fa-play-circle text-sky-400'} w-5 text-center text-xs flex-shrink-0"></i><span class="text-xs truncate hide-on-collapse">${f.name}</span>${f.driveId ? '<i class="fas fa-cloud text-blue-400 text-[10px]" title="Drive"></i>' : ''}</div>
                <button type="button" title="Eliminar archivo" onclick="removeFile(event, '${sub.id}', '${f.id}')" class="opacity-0 group-hover:opacity-100 hover:text-red-400 px-1 hide-on-collapse"><i class="fas fa-times text-[10px]"></i></button>
            </li>`
        }).join('');

        const isSubjectNotesActive = currentState.currentSubject === sub.id && !currentState.currentFileId;

        li.innerHTML = `
            <div class="flex items-center justify-between p-2 cursor-pointer hover:bg-slate-800 rounded-lg transition-colors" onclick="toggleSubjectAccordion('${sub.id}')">
                <div class="flex items-center gap-3 overflow-hidden"><i class="fas ${sub.icon || 'fa-book'} text-lg center-on-collapse w-6 text-center text-slate-400 flex-shrink-0"></i><span class="text-sm font-medium hide-on-collapse truncate">${sub.name}</span></div>
                <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'} text-xs text-slate-500 hide-on-collapse"></i>
            </div>
            <ul class="${isExpanded ? 'block' : 'hidden'} ml-4 pl-2 border-l border-slate-700 mt-1 space-y-1 hide-on-collapse">
                <li class="group cursor-pointer rounded-lg flex items-center p-2 transition-colors ${isSubjectNotesActive ? 'bg-indigo-600 text-white' : 'hover:bg-slate-800 text-slate-300'}" onclick="openGeneralNotes('${sub.id}')"><i class="fas fa-pen-nib w-5 text-center text-xs opacity-70 flex-shrink-0"></i><span class="text-xs truncate">Apuntes</span></li>
                ${filesHtml}
            </ul>`;
        list.appendChild(li);
    });

    // Añadir esto para que el panel de Fuentes IA se actualice al mismo tiempo
    if (typeof renderAiSources === 'function') {
        renderAiSources();
    }
}

function toggleSubjectAccordion(subId) { currentState.expandedSubjects[subId] = !currentState.expandedSubjects[subId]; renderSubjects(); }

async function addSubject() {
    const name = document.getElementById('new-subject-name').value.trim();
    if (!name) return;
    const subId = 'sub_' + Date.now().toString(36);
    const newSub = { id: subId, name, icon: 'fa-book', files: [], driveFolderId: null };
    appData.subjects.push(newSub);
    if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
        await window.GoogleDriveSync.ensureSubjectFolder(newSub);
    }
    await saveData();
    document.getElementById('new-subject-name').value = '';
    renderManageSubjects();
    renderSubjects();
    openGeneralNotes(subId);
    showToast('Materia añadida', 'success');
}

async function removeSubject(subId) {
    if (confirm('¿Eliminar materia y todos sus apuntes?')) {
        if (currentState.currentSubject === subId) {
            await saveCurrentNotes(true);
        }
        delete appData.notes[getSubjectNotesKey(subId)];
        delete appData.notes['gen_' + subId];

        appData.subjects = appData.subjects.filter(s => s.id !== subId);
        await saveData();
        renderManageSubjects();
        renderSubjects();
        if (currentState.currentSubject === subId) showEmptyState();
    }
}

function renderManageSubjects() {
    const list = document.getElementById('modal-subject-list');
    list.innerHTML = appData.subjects.map(sub => `<li class="flex items-center justify-between p-3 hover:bg-slate-50"><span class="text-sm">${sub.name}</span><button type="button" title="Eliminar materia" onclick="removeSubject('${sub.id}')" class="text-red-400"><i class="fas fa-trash-alt"></i></button></li>`).join('');
}

function openAddFileModal(subId = null) {
    if (appData.subjects.length === 0) return openModal('manage-subjects-modal');
    document.getElementById('file-target-subject').innerHTML = appData.subjects.map(s => `<option value="${s.id}" ${s.id === subId ? 'selected' : ''}>${s.name}</option>`).join('');
    openModal('add-file-modal');
}

// CORRECCIÓN: Respetar el nombre original del PDF
async function confirmAddFile() {
    const type = document.getElementById('file-type').value;
    const customName = document.getElementById('file-name').value.trim();
    const sub = appData.subjects.find(s => s.id === document.getElementById('file-target-subject').value);
    
    let fileObj = { id: 'file_' + Date.now(), name: '', type: type.includes('pdf') ? 'pdf' : 'video', url: '', isLocal: type === 'pdf_local', driveId: null };

    if (type === 'pdf_local') {
        const file = document.getElementById('file-upload').files[0];
        if (!file) return showToast('Selecciona un PDF', 'error');
        
        // Si no se puso nombre, toma el original y le quita la extensión
        fileObj.name = customName || file.name.replace(/\.[^/.]+$/, "");
        
        await idb.save(fileObj.id, file); 
        
        if (window.GoogleDriveSync && window.GoogleDriveSync.isLoggedIn) {
            showToast('Subiendo respaldo a Drive...', 'info');
            window.GoogleDriveSync.uploadPdfToDrive(file, fileObj.name, sub).then(dId => {
                if (dId) { fileObj.driveId = dId; saveData(); renderSubjects(); }
            });
        }
    } else {
        fileObj.name = customName || 'Documento o Video Web';
        fileObj.url = document.getElementById('file-url').value;
    }
    
    sub.files.push(fileObj); saveData();
    currentState.expandedSubjects[sub.id] = true;
    closeModal('add-file-modal'); renderSubjects(); openFile(sub.id, fileObj.id);
    document.getElementById('file-name').value = '';
    document.getElementById('file-upload').value = '';
}

async function removeFile(e, subId, fileId) {
    e.stopPropagation();
    if (confirm('¿Eliminar este archivo? Los apuntes de la materia se conservan.')) {
        await idb.delete(fileId);
        const sub = appData.subjects.find(s => s.id === subId);
        sub.files = sub.files.filter(f => f.id !== fileId);

        if (aiSourceFileIds.has(fileId)) aiSourceFileIds.delete(fileId);

        await saveData();
        renderSubjects();
        if (currentState.currentFileId === fileId) showEmptyState();
    }
}

// ==========================================