/**
 * AgniSanket Central Configuration
 * 
 * Configure the deployed backend API URL here.
 * If BACKEND_URL is empty, AgniSanket will:
 * 1. Check for localStorage override ("agni_backend_url")
 * 2. Check for URL query parameter (?backend=https://...)
 * 3. Default to "http://127.0.0.1:8000" if running on localhost / 127.0.0.1
 * 4. Fall back to cached operational data with clear "Cached Data / Demo Data" badges on static hosts (e.g. Netlify)
 */
window.AGNI_CONFIG = {
    // Set your deployed backend URL here, e.g. "https://agni-sanket-api.onrender.com"
    // Leave as empty string "" for auto-detection and graceful fallback
    BACKEND_URL: "",

    // System identification
    APP_NAME: "AgniSanket",
    VERSION: "2.1.0",
    DEFAULT_AREA: "IND",

    // Fallback mode behavior
    FALLBACK_NOTICE: "Live API unavailable — showing cached data.",
    DEMO_LABEL: "Demo Data",
    CACHED_LABEL: "Cached Data"
};

// Global helper to read active backend URL
window.getAgniBackendUrl = function() {
    // 1. Direct explicit window override
    if (window.AGNI_BACKEND_URL && typeof window.AGNI_BACKEND_URL === "string" && window.AGNI_BACKEND_URL.trim() !== "") {
        return window.AGNI_BACKEND_URL.trim().replace(/\/+$/, '');
    }

    // 2. Config object override
    if (window.AGNI_CONFIG && window.AGNI_CONFIG.BACKEND_URL && window.AGNI_CONFIG.BACKEND_URL.trim() !== "") {
        return window.AGNI_CONFIG.BACKEND_URL.trim().replace(/\/+$/, '');
    }

    // 3. User-configured localStorage override
    try {
        const saved = localStorage.getItem("agni_backend_url");
        if (saved && saved.trim() !== "") {
            return saved.trim().replace(/\/+$/, '');
        }
    } catch (_) {}

    // 4. URL query parameter (?backend=https://...)
    try {
        if (window.location && window.location.search) {
            const params = new URLSearchParams(window.location.search);
            const b = params.get("backend");
            if (b && b.trim() !== "") {
                const clean = b.trim().replace(/\/+$/, '');
                try { localStorage.setItem("agni_backend_url", clean); } catch (_) {}
                return clean;
            }
        }
    } catch (_) {}

    // 5. If explicitly hosted by FastAPI backend server on port 8000
    if (window.location && window.location.port === "8000") {
        return window.location.origin.replace(/\/+$/, '');
    }

    // 6. On static hosts (e.g. Netlify, GitHub Pages, or local static server), default to "" (Cached Mode)
    return "";
};

window.openBackendConfigModal = function() {
    const modal = document.getElementById("backend-config-modal");
    if (modal) {
        const input = document.getElementById("backend-url-input");
        const current = window.getAgniBackendUrl();
        if (input) input.value = current;
        modal.style.display = "flex";
        modal.classList.remove("hidden");
    }
};

window.closeBackendConfigModal = function() {
    const modal = document.getElementById("backend-config-modal");
    if (modal) {
        modal.style.display = "none";
        modal.classList.add("hidden");
    }
};

window.saveBackendConfig = function() {
    const input = document.getElementById("backend-url-input");
    if (!input) return;
    const url = input.value.trim().replace(/\/+$/, '');
    try {
        if (url) {
            localStorage.setItem("agni_backend_url", url);
        } else {
            localStorage.removeItem("agni_backend_url");
        }
        window.location.reload();
    } catch (e) {
        alert("Error saving settings: " + e.message);
    }
};

window.resetBackendConfig = function() {
    try {
        localStorage.removeItem("agni_backend_url");
        window.location.reload();
    } catch (e) {
        alert("Error resetting settings: " + e.message);
    }
};

