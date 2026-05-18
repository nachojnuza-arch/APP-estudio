// 5.1 SELECCIÓN DE FUENTES PARA IA Y RAG
// ==========================================
function renderAiSources() {
    const list = document.getElementById('ai-sources-list');
    const countLabel = document.getElementById('ai-source-count');
    if (!list || !countLabel) return;

    list.innerHTML = '';
    let hasPdfs = false;

    appData.subjects.forEach(sub => {
        const pdfFiles = sub.files.filter(f => f.type === 'pdf');
        if (pdfFiles.length === 0) return;
        hasPdfs = true;

        const subDiv = document.createElement('div');
        subDiv.className = 'mb-2';
        subDiv.innerHTML = `<div class="text-[10px] font-bold text-slate-500 uppercase px-2 mb-1">${sub.name}</div>`;
        
        pdfFiles.forEach(f => {
            const isChecked = aiSourceFileIds.has(f.id);
            const fileItem = document.createElement('label');
            fileItem.className = 'flex items-center gap-2 px-2 py-1 hover:bg-slate-200 rounded cursor-pointer transition-colors';
            fileItem.innerHTML = `
                <input type="checkbox" title="Usar ${f.name} en IA" aria-label="Usar ${f.name} en IA" class="w-3 h-3 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500" 
                       ${isChecked ? 'checked' : ''} onchange="toggleAiSource('${f.id}')">
                <i class="fas fa-file-pdf text-rose-400 text-xs"></i>
                <span class="text-xs text-slate-600 truncate flex-1">${f.name}</span>
            `;
            subDiv.appendChild(fileItem);
        });
        list.appendChild(subDiv);
    });

    if (!hasPdfs) {
        list.innerHTML = '<p class="text-xs text-slate-400 italic p-1">Sube PDFs para usarlos como fuente.</p>';
    }
    
    countLabel.textContent = `${aiSourceFileIds.size} seleccionadas`;
}

function toggleAiSource(fileId) {
    if (aiSourceFileIds.has(fileId)) {
        aiSourceFileIds.delete(fileId);
    } else {
        aiSourceFileIds.add(fileId);
    }
    renderAiSources();
}

// ==========================================