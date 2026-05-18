// 7. CAPTURAS DE PANTALLA (HTML2CANVAS)
// ==========================================
const overlay = document.createElement('div');
overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;cursor:crosshair;display:none;background:rgba(0,0,0,0.3);';
const sBox = document.createElement('div');
sBox.style.cssText = 'position:absolute;border:2px dashed #fff;background:rgba(255,255,255,0.1);display:none;pointer-events:none;';
overlay.appendChild(sBox); document.body.appendChild(overlay);

document.getElementById('media-viewer').addEventListener('mousedown', (e) => {
    if (e.ctrlKey && currentState.pdfDoc) {
        e.preventDefault(); screenshotState = { active: true, startX: e.clientX, startY: e.clientY };
        overlay.style.display = 'block'; sBox.style.display = 'block'; sBox.style.width = '0';
    }
});

document.addEventListener('mousemove', (e) => {
    if (!screenshotState.active) return;
    sBox.style.left = Math.min(screenshotState.startX, e.clientX) + 'px';
    sBox.style.top = Math.min(screenshotState.startY, e.clientY) + 'px';
    sBox.style.width = Math.abs(e.clientX - screenshotState.startX) + 'px';
    sBox.style.height = Math.abs(e.clientY - screenshotState.startY) + 'px';
    screenshotState.endX = e.clientX; screenshotState.endY = e.clientY;
});

document.addEventListener('mouseup', async (e) => {
    if (!screenshotState.active) return;
    screenshotState.active = false; overlay.style.display = 'none'; sBox.style.display = 'none';
    const w = Math.abs(screenshotState.endX - screenshotState.startX);
    const h = Math.abs(screenshotState.endY - screenshotState.startY);
    if (w > 10 && h > 10) {
        try {
            const canvasRect = document.getElementById('pdf-canvas').getBoundingClientRect();
            const c = document.createElement('canvas'); c.width = w; c.height = h;
            c.getContext('2d').drawImage(document.getElementById('pdf-canvas'), Math.min(screenshotState.startX, screenshotState.endX) - canvasRect.left, Math.min(screenshotState.startY, screenshotState.endY) - canvasRect.top, w, h, 0, 0, w, h);
            
            const img = document.createElement('img'); 
            img.src = c.toDataURL(); 
            img.style.margin = '10px auto';
            img.style.display = 'block';
            
            const editor = document.getElementById('notes-editor');
            const sel = window.getSelection();
            if(sel.rangeCount > 0 && editor.contains(sel.anchorNode)) { 
                const range = sel.getRangeAt(0); range.insertNode(img); range.setStartAfter(img); sel.removeAllRanges(); sel.addRange(range); 
            } else { 
                editor.appendChild(img); 
            }
            saveCurrentNotes(); showToast('Captura añadida', 'success');
        } catch(err) { showToast('Error en captura', 'error'); }
    }
});

function alignImage(alignment) {
    const selectedImage = document.querySelector('#notes-editor img.selected');
    if (selectedImage) {
        selectedImage.style.display = 'block';
        selectedImage.style.float = 'none';
        selectedImage.style.marginLeft = 'auto';
        selectedImage.style.marginRight = 'auto';
        if (alignment === 'left') {
            selectedImage.style.float = 'left';
            selectedImage.style.margin = '10px';
        } else if (alignment === 'right') {
            selectedImage.style.float = 'right';
            selectedImage.style.margin = '10px';
        }
        saveCurrentNotes();
    } else {
        showToast('Haz clic en una imagen para seleccionarla', 'warning');
    }
}

function resizeImage(factor) {
    const selectedImage = document.querySelector('#notes-editor img.selected');
    if (selectedImage) {
        let currentWidth = selectedImage.clientWidth || selectedImage.width;
        selectedImage.style.width = (currentWidth * factor) + 'px';
        selectedImage.style.height = 'auto';
        saveCurrentNotes();
    } else {
        showToast('Haz clic en una imagen para seleccionarla', 'warning');
    }
}

// ==========================================