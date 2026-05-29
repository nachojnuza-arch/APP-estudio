pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// ==========================================
// 1. CONFIGURACIÓN Y VARIABLES GLOBALES
// ==========================================
let appData = { subjects: [], notes: {} };
let currentState = {
    currentFileId: null, // Identifica si estamos en una nota general o en un archivo específico
    currentSubject: null,
    currentSheetId: null,
    isDirty: false,
    expandedSubjects: {},
    expandedAiSubjects: {}, 
    pdfDoc: null,
    pageNum: 1,
    zoom: 1.2,
    isRendering: false
};

let autoSaveTimer = null;
let driveSyncTimer = null;
const AUTO_SAVE_IDLE_MS = 60_000;
let screenshotState = { active: false, startX: 0, startY: 0, endX: 0, endY: 0 };

// Variables de estado para la IA (por si interactúan con los otros scripts)
let aiSourceFileIds = new Set();
let aiCorrectedNotes = {};

// ==========================================