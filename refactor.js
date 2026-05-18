const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, 'src');
if (!fs.existsSync(srcDir)) fs.mkdirSync(srcDir);
if (!fs.existsSync(path.join(srcDir, 'core'))) fs.mkdirSync(path.join(srcDir, 'core'));
if (!fs.existsSync(path.join(srcDir, 'ui'))) fs.mkdirSync(path.join(srcDir, 'ui'));

const appJs = fs.readFileSync('app.js', 'utf-8');

// We will extract functions and append "window.funcName = funcName;" to make them global for now.
function extractBlock(startRegex, endRegex) {
    const startIndex = appJs.search(startRegex);
    if (startIndex === -1) return '';
    // if endRegex is null, get to the end
    if (!endRegex) return appJs.slice(startIndex);
    
    // Find end regex starting from startIndex
    const remaining = appJs.slice(startIndex);
    const endMatch = remaining.match(endRegex);
    if (!endMatch) return remaining;
    
    return appJs.slice(startIndex, startIndex + endMatch.index);
}

// 1. core/state.js
const stateContent = extractBlock(/\/\/ 1\. CONFIGURACIÓN Y VARIABLES GLOBALES/, /\/\/ ==========================================\n\/\/ 2\. BASE DE DATOS INTERNA/);
const stateExports = `
window.appData = appData;
window.currentState = currentState;
window.autoSaveTimer = autoSaveTimer;
window.driveSyncTimer = driveSyncTimer;
window.screenshotState = screenshotState;
window.aiSourceFileIds = aiSourceFileIds;
window.aiCorrectedNotes = aiCorrectedNotes;
`;
fs.writeFileSync(path.join(srcDir, 'core', 'state.js'), stateContent + stateExports);

// 2. core/db.js
const dbContent = extractBlock(/\/\/ 2\. BASE DE DATOS INTERNA/, /\/\/ ==========================================\n\/\/ 3\. COMPONENTES UI BÁSICOS/);
const dbExports = `\nwindow.idb = idb;\n`;
fs.writeFileSync(path.join(srcDir, 'core', 'db.js'), dbContent + dbExports);

// 3. ui/toast.js
// We have to find showToast
const toastRegex = /function showToast.*?\n\}/s;
const toastMatch = appJs.match(toastRegex);
let toastContent = toastMatch ? toastMatch[0] : '';
toastContent += `\nwindow.showToast = showToast;\n`;
fs.writeFileSync(path.join(srcDir, 'ui', 'toast.js'), toastContent);

// And so on... This script is a proof of concept. Let's execute it to see if it works.
console.log("Extracción básica completada");
