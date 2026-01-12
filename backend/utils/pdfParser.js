let parser = null;

async function ensureParser() {
    if (parser) return parser;

    // Try synchronous require first
    try {
        const mod = require('pdf-parse');
        parser = (typeof mod === 'function')
            ? mod
            : (mod && typeof mod.default === 'function'
                ? mod.default
                : (mod && typeof mod.PDFParse === 'function' ? mod.PDFParse : null));
        if (!parser) throw new Error('pdf-parse import shape not recognized');
        return parser;
    } catch (e) {
        // Fallback to dynamic import for environments that need it
        try {
            const mod = await import('pdf-parse');
            parser = (typeof mod === 'function')
                ? mod
                : (mod && typeof mod.default === 'function'
                    ? mod.default
                    : (mod && typeof mod.PDFParse === 'function' ? mod.PDFParse : null));
            if (!parser) throw new Error('pdf-parse import shape not recognized (dynamic)');
            return parser;
        } catch (err) {
            console.error('❌ pdf-parse not installed. Run: cd backend && npm install pdf-parse');
            throw err;
        }
    }
}

async function parsePdf(buffer) {
    const p = await ensureParser();
    if (!p) throw new Error('PDF parser unavailable');

    // Try calling as a function first
    try {
        return await p(buffer);
    } catch (callErr) {
        // If calling as function fails, try constructing with `new`
        try {
            // Some builds export a class that must be instantiated
            return await new p(buffer);
        } catch (newErr) {
            // Try a common alternate API `parse` if present
            if (p && typeof p.parse === 'function') {
                return await p.parse(buffer);
            }
            // If all strategies fail, throw the original call error for debugging
            throw callErr;
        }
    }
}

module.exports = { parsePdf };
