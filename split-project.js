const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);
['core', 'ui', 'features', 'ai'].forEach(d => {
    if (!fs.existsSync(path.join(srcDir, d))) fs.mkdirSync(path.join(srcDir, d));
});

const appLines = fs.readFileSync('app.js', 'utf-8').split('\n');

function extractBlock(lines, startLine, endLine) {
    return lines.slice(startLine - 1, endLine ? endLine - 1 : undefined).join('\n');
}

// === Splitting app.js ===
fs.writeFileSync(path.join(srcDir, 'core', 'state.js'), extractBlock(appLines, 1, 28));
fs.writeFileSync(path.join(srcDir, 'core', 'db.js'), extractBlock(appLines, 28, 123));
fs.writeFileSync(path.join(srcDir, 'core', 'data.js'), extractBlock(appLines, 123, 306));
fs.writeFileSync(path.join(srcDir, 'ui', 'utils.js'), extractBlock(appLines, 306, 387));
fs.writeFileSync(path.join(srcDir, 'ui', 'render.js'), extractBlock(appLines, 387, 531));
fs.writeFileSync(path.join(srcDir, 'ui', 'ai-sources.js'), extractBlock(appLines, 531, 582));
fs.writeFileSync(path.join(srcDir, 'features', 'pdf-viewer.js'), extractBlock(appLines, 582, 777));
fs.writeFileSync(path.join(srcDir, 'features', 'screenshot.js'), extractBlock(appLines, 777, 862));
fs.writeFileSync(path.join(srcDir, 'ui', 'export.js'), extractBlock(appLines, 862, 889));
fs.writeFileSync(path.join(srcDir, 'main.js'), extractBlock(appLines, 889));


// === Splitting local-summary.js ===
const locLines = fs.readFileSync('local-summary.js', 'utf-8').split('\n');
fs.writeFileSync(path.join(srcDir, 'ai', 'config-dict.js'), extractBlock(locLines, 1, 239));
fs.writeFileSync(path.join(srcDir, 'ai', 'utils-translate.js'), extractBlock(locLines, 239, 312));
fs.writeFileSync(path.join(srcDir, 'ai', 'tfidf-vectors.js'), extractBlock(locLines, 312, 655));
fs.writeFileSync(path.join(srcDir, 'ai', 'summary-engine.js'), extractBlock(locLines, 655, 908));
fs.writeFileSync(path.join(srcDir, 'ai', 'local-init.js'), extractBlock(locLines, 908));


// Generar los nuevos scripts para index.html
const scriptsHTML = `
    <!-- Librerías Externas -->
    <script src="js/pdf.min.js"></script>

    <!-- CORE: Estado y Datos -->
    <script src="src/core/state.js"></script>
    <script src="src/core/db.js"></script>
    <script src="src/core/data.js"></script>

    <!-- INTERFAZ: Utilidades y Renderizado -->
    <script src="src/ui/utils.js"></script>
    <script src="src/ui/render.js"></script>
    <script src="src/ui/ai-sources.js"></script>
    <script src="src/ui/export.js"></script>

    <!-- FUNCIONES ESPECIALES -->
    <script src="src/features/pdf-viewer.js"></script>
    <script src="src/features/screenshot.js"></script>
    <script src="google-drive-sync.js"></script>

    <!-- IA: Motor Local (local-summary.js modularizado) -->
    <script src="src/ai/config-dict.js"></script>
    <script src="src/ai/utils-translate.js"></script>
    <script src="src/ai/tfidf-vectors.js"></script>
    <script src="src/ai/summary-engine.js"></script>
    <script src="src/ai/local-init.js"></script>

    <!-- IA: Motor Principal (Pendiente a particionar después si se desea) -->
    <script src="ai-original.js"></script>

    <!-- INICIALIZACIÓN -->
    <script src="src/main.js"></script>
`;

console.log("¡Archivos separados exitosamente en la carpeta src/!");
console.log("Copia y pega esto en tu index.html:");
console.log(scriptsHTML);
