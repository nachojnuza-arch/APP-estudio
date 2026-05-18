// 4. INTERFAZ Y UTILIDADES
// ==========================================
function toggleSidebar() { 
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    
    if (window.innerWidth < 768) {
        sidebar.classList.toggle('-translate-x-full');
        if (overlay) overlay.classList.toggle('hidden');
    } else {
        sidebar.classList.toggle('md:hidden');
    }
    setTimeout(() => { if (currentState.pdfDoc) renderPage(); }, 300);
}

function toggleNotesPanel() { 
    const panel = document.getElementById('view-notes');
    if (!panel) return;
    
    if (panel.classList.contains('md:flex')) {
        // Actualmente visible en PC, lo ocultamos
        panel.classList.remove('md:flex');
        panel.classList.add('md:hidden');
    } else {
        // Actualmente oculto en PC, lo mostramos
        panel.classList.remove('md:hidden');
        panel.classList.add('md:flex');
    }
    setTimeout(() => { if (currentState.pdfDoc) renderPage(); }, 300);
}
function openModal(id) { 
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.querySelectorAll('#modal-overlay .modal-container').forEach(m => m.classList.add('hidden'));
    document.getElementById(id).classList.remove('hidden'); 
    if(id==='manage-subjects-modal') renderManageSubjects(); 
}
function closeModal(id) { 
    document.getElementById(id).classList.add('hidden'); 
    document.getElementById('modal-overlay').classList.add('hidden');
}
function showLoading(msg) { document.getElementById('loading').classList.remove('hidden'); document.getElementById('loading-msg').textContent = msg; }
function hideLoading() { document.getElementById('loading').classList.add('hidden'); }

function showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const color = type === 'success' ? 'bg-emerald-500' : (type === 'error' ? 'bg-red-500' : 'bg-slate-800');
    toast.className = `${color} text-white px-4 py-2 rounded-lg shadow-lg text-sm flex items-center gap-2 transform transition-all translate-y-10 opacity-0`;
    toast.innerHTML = `<i class="fas ${type==='success'?'fa-check-circle':(type==='error'?'fa-exclamation-circle':'fa-info-circle')}"></i> ${msg}`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.remove('translate-y-10', 'opacity-0'), 10);
    setTimeout(() => { toast.classList.add('opacity-0'); setTimeout(() => toast.remove(), 300); }, 3000);
}

function switchTab(tab) {
    document.getElementById('tab-btn-notes').className = `flex-1 py-2 text-sm font-semibold rounded-md transition-all ${tab === 'notes' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`;
    document.getElementById('tab-btn-ai').className = `flex-1 py-2 text-sm font-semibold rounded-md transition-all ${tab === 'ai' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:bg-slate-200/50'}`;
    document.getElementById('tab-content-notes').classList.toggle('hidden', tab !== 'notes');
    document.getElementById('tab-content-notes').classList.toggle('flex', tab === 'notes');
    document.getElementById('tab-content-ai').classList.toggle('hidden', tab !== 'ai');
    document.getElementById('tab-content-ai').classList.toggle('flex', tab === 'ai');
}

function toggleReadingFilter() {
    document.body.classList.toggle('reading-filter-active');
    document.getElementById('reading-filter-btn').classList.toggle('text-indigo-600');
}

function clearAllData() {
    if (confirm('¿Borrar TODO permanentemente? Esta acción no se puede deshacer.')) {
        idb.clearAllStores().finally(() => {
            try {
                localStorage.clear();
            } catch (e) { /* ignore */ }
            appData = { subjects: [], notes: {} };
            location.reload();
        });
    }
}

// ==========================================