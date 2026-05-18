// INICIALIZACIÓN GLOBAL
// ==========================================
window.LocalSummary = {
    version: LOCAL_SUMMARY_VERSION,
    engine: new SummaryEngine(),
    config: SUMMARY_CONFIG,
    detectLanguage,
    translateToSpanish,
    exportToGoogleDocs,
    generate: function(text, notes, mode) {
        return this.engine.generateSummary(text, notes, mode);
    },
    getHistory: function() {
        return this.engine.history.get();
    }
};

console.log(`✅ Local Summary v${LOCAL_SUMMARY_VERSION} cargado correctamente`);
