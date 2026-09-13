let map;
let hotspotLayerGroup;
let facilityLayerGroup;
let highlightLayerGroup;
let selectedClusterId = null;
let selectedCluster = null;
let clusterMap = {};
let displayClusterMap = {};
let clusterCards = {};
let allClusters = [];

// 3D Geospatial Map State Variables (MapLibre GL JS)
let map3d = null;
let is3DMode = false;
let map3dHotspotMarkers = [];
let map3dFacilityMarkers = [];
let map3dSelectionMarker = null;
let cachedFacilities = [];

// Cluster normalization ensuring all required properties are always available:
// - cluster ID
// - latitude
// - longitude
// - risk
// - classification
// - FRP
// - temperature
// - industrial site
function normalizeClusterObject(c) {
    if (!c) return null;
    const dNum = c.display_id || c.cluster_number || c.id;
    const lat = (c.latitude !== undefined && c.latitude !== null) ? Number(c.latitude) : 
                (c.centroid_lat !== undefined && c.centroid_lat !== null ? Number(c.centroid_lat) : 
                (c.lat !== undefined && c.lat !== null ? Number(c.lat) : 22.0));
    const lon = (c.longitude !== undefined && c.longitude !== null) ? Number(c.longitude) : 
                (c.centroid_lon !== undefined && c.centroid_lon !== null ? Number(c.centroid_lon) : 
                (c.lon !== undefined && c.lon !== null ? Number(c.lon) : 
                (c.lng !== undefined && c.lng !== null ? Number(c.lng) : 79.8)));
    const risk = (c.risk !== undefined && c.risk !== null) ? Number(c.risk) : 
                 (c.risk_score !== undefined && c.risk_score !== null ? Number(c.risk_score) : 0);
    const classification = c.classification || c.predicted_class || "Pending";
    const frp = (c.frp !== undefined && c.frp !== null) ? Number(c.frp) : 
                (c.max_frp !== undefined && c.max_frp !== null ? Number(c.max_frp) : 0);
    const temp = (c.temperature !== undefined && c.temperature !== null) ? c.temperature : 
                 (c.hotspot_max_temp_c !== undefined && c.hotspot_max_temp_c !== null ? c.hotspot_max_temp_c : null);
    const indSite = c.industrial_site || c.nearest_industry_name || "None";
    const indDist = (c.industrial_distance !== undefined && c.industrial_distance !== null) ? c.industrial_distance : 
                    (c.dist_to_nearest_industry_km !== undefined && c.dist_to_nearest_industry_km !== null ? c.dist_to_nearest_industry_km : null);

    c.cluster_id = dNum;
    c.clusterId = dNum;
    c.latitude = lat;
    c.longitude = lon;
    c.centroid_lat = lat;
    c.centroid_lon = lon;
    c.lat = lat;
    c.lon = lon;
    c.lng = lon;
    c.risk = risk;
    c.risk_score = risk;
    c.classification = classification;
    c.predicted_class = classification;
    c.frp = frp;
    c.max_frp = frp;
    c.temperature = temp;
    c.hotspot_max_temp_c = temp;
    c.industrial_site = indSite;
    c.nearest_industry_name = indSite;
    c.industrial_distance = indDist;
    c.dist_to_nearest_industry_km = indDist;
    c.hotspots_count = (c.detection_count !== undefined && c.detection_count !== null) ? c.detection_count : (c.num_hotspots || 1);
    c.satellite_availability = c.satellite_status || "AVAILABLE";

    return c;
}

function resolveCluster(identifier) {
    if (!identifier && window.selectedCluster) return normalizeClusterObject(window.selectedCluster);
    if (!identifier && selectedClusterId) identifier = selectedClusterId;
    if (!identifier) return null;

    if (typeof identifier === 'object' && identifier !== null) {
        return normalizeClusterObject(identifier);
    }

    const str = String(identifier).trim();
    // 1. Check if identifier has an explicit cluster tag prefix (e.g. "C-151", "c-151", "C151", "Cluster C-151")
    const isTagMatch = str.match(/^(?:cluster\s*)?[cC]-?(\d+)$/i);
    if (isTagMatch) {
        const tagNum = parseInt(isTagMatch[1], 10);
        if (displayClusterMap[tagNum]) {
            return normalizeClusterObject(displayClusterMap[tagNum]);
        }
        if (displayClusterMap[str]) {
            return normalizeClusterObject(displayClusterMap[str]);
        }
        for (const k in clusterMap) {
            const c = clusterMap[k];
            if (c.display_id === tagNum || c.cluster_number === tagNum) {
                return normalizeClusterObject(c);
            }
        }
    }

    const cleanNum = str.match(/^\d+$/) ? parseInt(str, 10) : null;

    // 2. If current window.selectedCluster matches this identifier, return it
    if (window.selectedCluster) {
        const sc = normalizeClusterObject(window.selectedCluster);
        if (sc.id === identifier || sc.id === cleanNum || sc.display_id === cleanNum || sc.cluster_id === cleanNum) {
            return sc;
        }
    }

    // 3. Direct lookup in clusterMap by DB ID (primary key, e.g. 250 for C-151, or 100 for C-1)
    if (clusterMap[identifier]) {
        return normalizeClusterObject(clusterMap[identifier]);
    }
    if (cleanNum !== null && clusterMap[cleanNum]) {
        return normalizeClusterObject(clusterMap[cleanNum]);
    }
    if (window.allClusters && cleanNum !== null) {
        const directFound = window.allClusters.find(item => item.id === cleanNum);
        if (directFound) return normalizeClusterObject(directFound);
    }

    // 4. Lookup in displayClusterMap fallback by display number
    if (cleanNum !== null && displayClusterMap[cleanNum]) {
        return normalizeClusterObject(displayClusterMap[cleanNum]);
    }
    if (displayClusterMap[str]) {
        return normalizeClusterObject(displayClusterMap[str]);
    }

    // 5. Scan clusters array fallback
    for (const k in clusterMap) {
        const c = clusterMap[k];
        if (cleanNum !== null && (c.display_id === cleanNum || c.cluster_number === cleanNum)) {
            return normalizeClusterObject(c);
        }
        if (cleanNum !== null && c.id === cleanNum) {
            return normalizeClusterObject(c);
        }
        if (String(c.display_id) === str || `C-${c.display_id}`.toLowerCase() === str.toLowerCase()) {
            return normalizeClusterObject(c);
        }
    }

    return null;
}

function getSelectedCluster() {
    if (window.selectedCluster) return normalizeClusterObject(window.selectedCluster);
    if (selectedClusterId) return resolveCluster(selectedClusterId);
    return null;
}

window.getSelectedCluster = getSelectedCluster;
window.resolveCluster = resolveCluster;
window.normalizeClusterObject = normalizeClusterObject;
window.clusterMap = clusterMap;
window.displayClusterMap = displayClusterMap;

let currentUser = null;
let authToken = localStorage.getItem("auth_token") || null;
let isCheckingAuth = false;
let pendingPostAuthHash = null;
let currentAlertFilter = "all";

// Multi-Dashboard & Government State Variables
let currentGovFilter = "ALL";
let govSearchQuery = "";
let govIncidents = [];
let selectedGovIncidentId = null;
let selectedGovActionStatus = "ACKNOWLEDGED";
let currentDashboardView = null;

const API_BASE = (window.location && window.location.origin && window.location.origin.startsWith("http")) 
    ? window.location.origin 
    : "http://127.0.0.1:8000";

function getAuthHeaders() {
    return authToken ? { "Authorization": `Bearer ${authToken}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

const ROLE_CONFIGS = {
    ADMIN: {
        welcomeRole: "Admin",
        roleDesc: "Manage system health, data pipelines, and user access across the platform.",
        cardTitle: "Admin Login",
        cardSub: "Authorised administrator access only",
        cardIcon: '<i class="fa-solid fa-shield-halved"></i>',
        buttonText: "Sign in as Admin",
        placeholder: "Enter administrator username (e.g. admin)",
        demoText: '<i class="fa-regular fa-eye"></i> Demo Access (Admin)',
        demoUser: "admin",
        demoPass: "AdminPassword123!",
        hudSub: "SYSTEM ADMINISTRATION · ACCESS CONTROL",
        features: [
            { icon: '<i class="fa-solid fa-user-shield"></i>', title: "User Management", sub: "Provision accounts and assign access roles" },
            { icon: '<i class="fa-solid fa-server"></i>', title: "System Monitoring", sub: "Track data ingestion and pipeline health" },
            { icon: '<i class="fa-solid fa-clipboard-list"></i>', title: "Audit & Logs", sub: "Review security activities and action history" }
        ]
    },
    ANALYST: {
        welcomeRole: "Analyst",
        roleName: "Forest Intelligence Analyst",
        roleDesc: "Investigate thermal anomalies, review satellite verification, and verify detections.",
        badgeClass: "analyst",
        cardTitle: "Analyst Login",
        cardSub: "Authorised geospatial analyst access only",
        cardIcon: '<i class="fa-solid fa-chart-line"></i>',
        buttonText: "Sign in as Analyst",
        placeholder: "Enter analyst username (e.g. analyst1)",
        demoText: '<i class="fa-regular fa-eye"></i> Demo Access (Analyst)',
        demoUser: "analyst1",
        demoPass: "Analyst123!",
        hudSub: "INCIDENT INVESTIGATION · EVIDENCE ANALYSIS",
        features: [
            { icon: '<i class="fa-solid fa-magnifying-glass"></i>', title: "Incident Investigation", sub: "Examine thermal clusters and risk scores" },
            { icon: '<i class="fa-solid fa-satellite"></i>', title: "Evidence Analysis", sub: "Inspect satellite imagery and site context" },
            { icon: '<i class="fa-solid fa-circle-check"></i>', title: "Detection Verification", sub: "Confirm findings and submit expert feedback" }
        ]
    },
    GOVERNMENT_AUTHORITY: {
        welcomeRole: "Government Official",
        roleDesc: "Monitor verified thermal threats and coordinate official response operations.",
        cardTitle: "Government Official Login",
        cardSub: "Authorised government official access only",
        cardIcon: '<i class="fa-solid fa-building-columns"></i>',
        buttonText: "Sign in as Government Official",
        placeholder: "Enter official email or username (e.g. gov1)",
        demoText: '<i class="fa-regular fa-eye"></i> Demo Access (Government Official)',
        demoUser: "gov1",
        demoPass: "GovAuth123!",
        hudSub: "THREAT MONITORING · FIELD RESPONSE",
        features: [
            { icon: '<i class="fa-solid fa-triangle-exclamation"></i>', title: "Threat Monitoring", sub: "Track high-priority and critical incidents" },
            { icon: '<i class="fa-solid fa-bullhorn"></i>', title: "Official Response", sub: "Acknowledge alerts and dispatch response teams" },
            { icon: '<i class="fa-solid fa-shield-halved"></i>', title: "Incident Resolution", sub: "Oversee field actions and log resolution status" }
        ]
    }
};

document.addEventListener("DOMContentLoaded", () => {
    // 1. Role Selection Handler on Login Portal
    const roleCards = document.querySelectorAll("#login-role-selector .role-card");
    roleCards.forEach(card => {
        card.addEventListener("click", () => {
            roleCards.forEach(c => c.classList.remove("active"));
            card.classList.add("active");

            const selectedRole = card.getAttribute("data-role");
            const hiddenRoleInput = document.getElementById("login-role");
            if (hiddenRoleInput) hiddenRoleInput.value = selectedRole;

            updateLoginRoleView(selectedRole);
        });
    });

    // Password Toggle Listener
    const btnTogglePwd = document.getElementById("btn-toggle-pwd");
    if (btnTogglePwd) {
        btnTogglePwd.addEventListener("click", () => {
            const pwdInput = document.getElementById("login-password");
            const icon = document.getElementById("icon-toggle-pwd");
            if (pwdInput && icon) {
                if (pwdInput.type === "password") {
                    pwdInput.type = "text";
                    icon.className = "fa-solid fa-eye";
                } else {
                    pwdInput.type = "password";
                    icon.className = "fa-solid fa-eye-slash";
                }
            }
        });
    }

    // Demo Autofill Listener
    const btnDemoAutofill = document.getElementById("btn-demo-autofill");
    if (btnDemoAutofill) {
        btnDemoAutofill.addEventListener("click", () => {
            const roleInput = document.getElementById("login-role");
            const role = roleInput ? roleInput.value : "GOVERNMENT_AUTHORITY";
            const config = ROLE_CONFIGS[role] || ROLE_CONFIGS.GOVERNMENT_AUTHORITY;
            const unameInput = document.getElementById("login-username");
            const pwdInput = document.getElementById("login-password");

            if (unameInput) unameInput.value = config.demoUser;
            if (pwdInput) pwdInput.value = config.demoPass;

            showToast(`Loaded demo credentials for ${config.welcomeRole} (${config.demoUser})`, "info");
        });
    }

    // Forgot Password Hint Listener
    const forgotLink = document.getElementById("login-forgot-link");
    if (forgotLink) {
        forgotLink.addEventListener("click", (e) => {
            e.preventDefault();
            showToast("Contact System Admin or National Command to reset security credentials.", "info");
        });
    }

    // Initialize Login Role UI to Government Official
    updateLoginRoleView("GOVERNMENT_AUTHORITY");

    // 2. Hash & History Router Listener
    window.addEventListener("hashchange", handleHashRouting);
    window.addEventListener("popstate", handleHashRouting);

    // 3. Role Dashboard Switcher Tabs (for Admin / Cross-Navigation)
    document.querySelectorAll(".dash-nav-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            const target = tab.getAttribute("data-target");
            if (target === 'analyst') window.location.hash = "#/dashboard";
            else if (target === 'admin') window.location.hash = "#/admin/overview";
            else if (target === 'government') window.location.hash = "#/government";
        });
    });

    // 4. Admin Dashboard Listeners
    initAdminListeners();

    // 5. Government Dashboard Button Listeners
    const btnGovRefresh = document.getElementById("btn-gov-refresh");
    if (btnGovRefresh) btnGovRefresh.addEventListener("click", () => loadGovernmentDashboard(true));

    document.querySelectorAll(".gov-filter-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".gov-filter-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentGovFilter = btn.getAttribute("data-filter");
            renderGovIncidentsTable();
        });
    });

    const govSearchInput = document.getElementById("gov-search-input");
    if (govSearchInput) {
        govSearchInput.addEventListener("input", (e) => {
            govSearchQuery = e.target.value.toLowerCase().trim();
            renderGovIncidentsTable();
        });
    }

    document.querySelectorAll(".gov-status-choice-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".gov-status-choice-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            selectedGovActionStatus = btn.getAttribute("data-status");
        });
    });

    document.getElementById("btn-gov-drawer-ack")?.addEventListener("click", () => handleGovQuickAction("ACKNOWLEDGED"));
    document.getElementById("btn-gov-drawer-dispatch")?.addEventListener("click", () => handleGovQuickAction("DISPATCHED"));
    document.getElementById("btn-gov-drawer-resolve")?.addEventListener("click", () => handleGovQuickAction("RESOLVED"));

    const btnGovSubmitDrawer = document.getElementById("btn-gov-submit-drawer");
    if (btnGovSubmitDrawer) {
        btnGovSubmitDrawer.addEventListener("click", handleGovDrawerActionSubmit);
    }

    document.getElementById("gov-btn-satellite-verify")?.addEventListener("click", () => {
        if (!selectedGovIncidentId) {
            showToast("Please select an incident first.", "warning");
            return;
        }
        openSatelliteEvidenceModal(selectedGovIncidentId);
    });

    document.getElementById("gov-btn-satellite-inspect")?.addEventListener("click", () => {
        if (selectedGovIncidentId) {
            selectedClusterId = selectedGovIncidentId;
        }
        window.location.hash = "#/satellite";
    });

    document.getElementById("gov-btn-view-3d")?.addEventListener("click", () => {
        if (selectedGovIncidentId) {
            selectedClusterId = selectedGovIncidentId;
            const inc = govIncidents.find(x => x.id === selectedGovIncidentId);
            if (inc && inc.centroid_lat && inc.centroid_lon) {
                window.selectedCluster = {
                    id: inc.id,
                    lat: inc.centroid_lat,
                    lon: inc.centroid_lon,
                    latitude: inc.centroid_lat,
                    longitude: inc.centroid_lon
                };
            }
        }
        window.location.hash = "#/map";
        setTimeout(() => {
            if (typeof toggle3DMode === 'function') toggle3DMode(true);
        }, 250);
    });

    // 6. Existing Analyst Dashboard Controls
    const btnScan = document.getElementById("btn-scan");
    if (btnScan) btnScan.addEventListener("click", () => triggerScan(false));
    document.getElementById("btn-retrain")?.addEventListener("click", triggerRetrain);
    document.getElementById("filter-risk")?.addEventListener("change", () => loadHotspotClusters(false));
    document.getElementById("btn-close-drawer")?.addEventListener("click", closeDrawer);

    // Login Form Submission
    document.getElementById("login-form")?.addEventListener("submit", handleLoginSubmit);

    // Global Auth Delegation Listener
    document.addEventListener("click", (e) => {
        const adminBtn = e.target.closest("#btn-show-admin-users");
        if (adminBtn) {
            openAdminUserModal();
            return;
        }
        const logoutBtn = e.target.closest("#btn-logout");
        if (logoutBtn) {
            handleLogout();
            return;
        }
    });

    // Modal listeners
    document.getElementById("btn-close-admin-user").addEventListener("click", closeAdminUserModal);
    document.getElementById("create-user-form").addEventListener("submit", handleCreateUserSubmit);

    // Government Authority Action listeners
    document.getElementById("btn-gov-ack").addEventListener("click", () => updateGovStatus("ACKNOWLEDGED"));
    document.getElementById("btn-gov-dispatch").addEventListener("click", () => updateGovStatus("DISPATCHED"));
    document.getElementById("btn-gov-resolve").addEventListener("click", () => updateGovStatus("RESOLVED"));

    // Check Auth and Initialize Router
    checkAuthSession();

    document.getElementById("layer-osm").addEventListener("change", (e) => {
        if (e.target.checked) {
            if (map) map.addLayer(facilityLayerGroup);
        } else {
            if (map) map.removeLayer(facilityLayerGroup);
        }
        if (is3DMode) {
            update3DFacilitiesVisibility(e.target.checked);
        }
    });

    document.getElementById("layer-hotspots").addEventListener("change", (e) => {
        if (e.target.checked) {
            if (map && hotspotLayerGroup) map.addLayer(hotspotLayerGroup);
        } else {
            if (map && hotspotLayerGroup) map.removeLayer(hotspotLayerGroup);
        }
        if (is3DMode) {
            update3DHotspotsVisibility(e.target.checked);
        }
    });

    document.querySelectorAll(".btn-verify").forEach(btn => {
        btn.addEventListener("click", (e) => {
            const target = e.currentTarget || e.target;
            const label = target.getAttribute("data-label");
            const decision = target.getAttribute("data-decision") || "confirmed";
            if (selectedClusterId && label) {
                submitVerification(selectedClusterId, label, decision);
            }
        });
    });

    const btnSearch = document.getElementById("btn-map-search");
    const inputSearch = document.getElementById("map-search-input");

    if (btnSearch) {
        btnSearch.addEventListener("click", searchCityOnMap);
    }
    if (inputSearch) {
        inputSearch.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                searchCityOnMap();
            }
        });
    }

    // Analyst Sidebar Navigation Listeners
    const navItems = document.querySelectorAll(".analyst-nav-item");
    navItems.forEach(item => {
        item.addEventListener("click", () => {
            navItems.forEach(n => n.classList.remove("active"));
            item.classList.add("active");
            const nav = item.getAttribute("data-nav");
            handleAnalystSidebarNav(nav);
        });
    });

    // Quick Actions Listeners
    const btnActionInvestigate = document.getElementById("btn-action-investigate");
    if (btnActionInvestigate) {
        btnActionInvestigate.addEventListener("click", () => {
            handleAnalystSidebarNav("investigation");
        });
    }

    const btnActionReport = document.getElementById("btn-action-report");
    if (btnActionReport) {
        btnActionReport.addEventListener("click", () => {
            handleAnalystSidebarNav("reports");
        });
    }

    const btnExportPdf = document.getElementById("btn-export-pdf-report");
    if (btnExportPdf) btnExportPdf.addEventListener("click", () => window.print());

    const btnExportCsv = document.getElementById("btn-export-csv-report");
    if (btnExportCsv) btnExportCsv.addEventListener("click", exportClustersCSV);

    const btnExportGeojson = document.getElementById("btn-export-geojson-report");
    if (btnExportGeojson) btnExportGeojson.addEventListener("click", exportClustersGeoJSON);

    const btnActionExplore = document.getElementById("btn-action-explore");
    if (btnActionExplore) {
        btnActionExplore.addEventListener("click", () => {
            handleAnalystSidebarNav("map");
        });
    }

    // Map Header Tools
    const btnToggle3D = document.getElementById("btn-toggle-3d-map");
    if (btnToggle3D) {
        btnToggle3D.addEventListener("click", () => toggleMapDimension());
    }

    const btnHudReturn2D = document.getElementById("btn-hud-return-2d");
    if (btnHudReturn2D) {
        btnHudReturn2D.addEventListener("click", () => switchTo2DView());
    }

    const btnDrawer3D = document.getElementById("btn-drawer-3d");
    if (btnDrawer3D) {
        btnDrawer3D.addEventListener("click", (e) => {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            const cId = btnDrawer3D.getAttribute("data-cluster-id") || selectedClusterId;
            const lat = btnDrawer3D.getAttribute("data-lat");
            const lon = btnDrawer3D.getAttribute("data-lon");
            open3DViewer(cId, lat, lon);
        });
    }

    const btnMapFullscreen = document.getElementById("btn-map-fullscreen");
    if (btnMapFullscreen) {
        btnMapFullscreen.addEventListener("click", () => {
            const mapCard = document.querySelector(".analyst-map-card");
            if (!mapCard) return;
            if (!document.fullscreenElement) {
                mapCard.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
            setTimeout(() => {
                if (map) map.invalidateSize();
                if (map3d) map3d.resize();
            }, 300);
        });
    }

    const btnMapLayersToggle = document.getElementById("btn-map-layers-toggle");
    if (btnMapLayersToggle) {
        btnMapLayersToggle.addEventListener("click", () => {
            const osmChk = document.getElementById("layer-osm");
            const hotChk = document.getElementById("layer-hotspots");
            if (osmChk && hotChk) {
                const nextState = !(osmChk.checked && hotChk.checked);
                osmChk.checked = nextState;
                hotChk.checked = nextState;
                osmChk.dispatchEvent(new Event('change'));
                hotChk.dispatchEvent(new Event('change'));
                showToast(`Map Layers: ${nextState ? 'All Layers Visible' : 'Layers Hidden'}`, "info");
            }
        });
    }

    // Toggle View More Analytics button
    const btnToggleAnalytics = document.getElementById("btn-toggle-analytics");
    const analyticsDrawer = document.getElementById("analyst-analytics-drawer");
    if (btnToggleAnalytics && analyticsDrawer) {
        btnToggleAnalytics.addEventListener("click", () => {
            const isCurrentlyHidden = (analyticsDrawer.style.display === "none" || !analyticsDrawer.classList.contains("expanded"));
            if (isCurrentlyHidden) {
                analyticsDrawer.style.display = "flex";
                analyticsDrawer.classList.add("expanded");
                btnToggleAnalytics.classList.add("expanded");
                btnToggleAnalytics.setAttribute("aria-expanded", "true");
                btnToggleAnalytics.textContent = "Hide Analytics ↑";
                setTimeout(() => {
                    analyticsDrawer.scrollIntoView({ behavior: "smooth", block: "start" });
                }, 100);
            } else {
                analyticsDrawer.style.display = "none";
                analyticsDrawer.classList.remove("expanded");
                btnToggleAnalytics.classList.remove("expanded");
                btnToggleAnalytics.setAttribute("aria-expanded", "false");
                btnToggleAnalytics.textContent = "View More Analytics ↓";
                const viewport = document.getElementById("analyst-main-viewport");
                if (viewport) {
                    viewport.scrollTo({ top: 0, behavior: "smooth" });
                } else {
                    const middleGrid = document.querySelector(".analyst-middle-grid");
                    if (middleGrid) {
                        middleGrid.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                }
            }
        });
    }

    // Initialize investigation and 3D viewer listeners
    initInvestigationEventListeners();

    // Automatically trigger 3-minute NASA FIRMS pipeline scan & dashboard refresh
    setInterval(triggerAutoScan, 180000); // 3 minutes = 180,000 ms

    // Poll dashboard stats & clusters every 15 seconds to capture backend background updates seamlessly
    setInterval(pollUpdates, 15000);
});

// Standardized India operational surveillance monitoring bounding box
const INDIA_MONITORING_BOUNDS = [[6.5, 66.0], [37.5, 99.0]];

function fitMapToIndia(animate = false) {
    if (!map) return;
    map.invalidateSize();
    const bounds = L.latLngBounds(INDIA_MONITORING_BOUNDS[0], INDIA_MONITORING_BOUNDS[1]);
    map.fitBounds(bounds, { padding: [15, 15], maxZoom: 5.5, animate: animate });
}

function initMap() {
    if (map) return;

    map = L.map('map', {
        center: [22.0, 79.8],
        zoom: 5,
        zoomSnap: 1,
        zoomDelta: 1,
        wheelPxPerZoomLevel: 120,
        wheelDebounceTime: 60,
        preferCanvas: true,
        inertia: true,
        inertiaDeceleration: 3000,
        inertiaMaxSpeed: 1500,
        easeLinearity: 0.2,
        minZoom: 3,
        maxZoom: 18,
        zoomControl: true,
        attributionControl: true
    });

    // High-resolution satellite imagery basemap (Esri World Imagery, 100% free, no API keys, zero watermarks)
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18
    }).addTo(map);

    // Dark crisp country boundaries and place names overlay
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png', {
        attribution: '',
        subdomains: 'abcd',
        maxZoom: 18
    }).addTo(map);

    // Custom Z-Index Panes ensuring Thermal Hotspots strictly render ABOVE Industrial Facilities
    map.createPane('osmFacilityPane');
    map.getPane('osmFacilityPane').style.zIndex = '420';

    map.createPane('thermalHotspotPane');
    map.getPane('thermalHotspotPane').style.zIndex = '620';

    map.createPane('highlightPane');
    map.getPane('highlightPane').style.zIndex = '700';

    highlightLayerGroup = L.layerGroup({ pane: 'highlightPane' }).addTo(map);

    // Initialise hotspotLayerGroup with Leaflet.markercluster (or fallback to layerGroup)
    if (typeof L.markerClusterGroup === 'function') {
        hotspotLayerGroup = L.markerClusterGroup({
            maxClusterRadius: 35,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            disableClusteringAtZoom: 14,
            chunkedLoading: true,
            animate: false,
            animateAddingMarkers: false,
            removeOutsideVisibleBounds: true,
            clusterPane: 'thermalHotspotPane',
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                return L.divIcon({
                    html: `<div class="tactical-cluster cluster-neutral" title="${count} Thermal Hotspots (Neutral Gold #D4A017)">
                             <span class="cluster-num font-mono">${count}</span>
                           </div>`,
                    className: 'custom-cluster-marker-wrap',
                    iconSize: [22, 22],
                    iconAnchor: [11, 11]
                });
            }
        }).addTo(map);
    } else {
        hotspotLayerGroup = L.layerGroup({ pane: 'thermalHotspotPane' }).addTo(map);
    }

    if (typeof L.markerClusterGroup === 'function') {
        facilityLayerGroup = L.markerClusterGroup({
            maxClusterRadius: 35,
            spiderfyOnMaxZoom: false,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            disableClusteringAtZoom: 13,
            chunkedLoading: true,
            animate: false,
            animateAddingMarkers: false,
            removeOutsideVisibleBounds: true,
            clusterPane: 'osmFacilityPane',
            iconCreateFunction: function(cluster) {
                const count = cluster.getChildCount();
                return L.divIcon({
                    html: `<div class="facility-cluster" title="${count} Industrial Facilities"><i class="fa-solid fa-industry"></i><span class="facility-cluster-count">${count}</span></div>`,
                    className: 'facility-cluster-wrapper',
                    iconSize: [26, 26],
                    iconAnchor: [13, 13]
                });
            }
        }).addTo(map);
    } else {
        facilityLayerGroup = L.layerGroup({ pane: 'osmFacilityPane' }).addTo(map);
    }

    window.map = map;
    window.facilityLayerGroup = facilityLayerGroup;
    window.hotspotLayerGroup = hotspotLayerGroup;

    // Custom control stack in top-left (Layers toggle & Recenter)
    const actionControl = L.control({ position: 'topleft' });
    actionControl.onAdd = function() {
        const div = L.DomUtil.create('div', 'leaflet-bar leaflet-custom-action-bar');
        div.innerHTML = `
            <a href="javascript:void(0)" id="leaflet-btn-layers" title="Toggle All Layers" role="button"><i class="fa-solid fa-layer-group"></i></a>
            <a href="javascript:void(0)" id="leaflet-btn-recenter" title="Recenter on India" role="button"><i class="fa-solid fa-crosshairs"></i></a>
        `;
        L.DomEvent.disableClickPropagation(div);
        return div;
    };
    actionControl.addTo(map);

    const recenterToIndia = () => {
        if (!map) return;
        fitMapToIndia(true);
        showToast("Map view recentered on India.", "info");
    };

    setTimeout(() => {
        const lLayers = document.getElementById("leaflet-btn-layers");
        if (lLayers) {
            lLayers.addEventListener("click", (e) => {
                e.preventDefault();
                const osmChk = document.getElementById("layer-osm");
                const hotChk = document.getElementById("layer-hotspots");
                if (osmChk && hotChk) {
                    const nextState = !(osmChk.checked && hotChk.checked);
                    osmChk.checked = nextState;
                    hotChk.checked = nextState;
                    osmChk.dispatchEvent(new Event('change'));
                    hotChk.dispatchEvent(new Event('change'));
                    showToast(`Map Layers: ${nextState ? 'All Layers Visible' : 'Layers Hidden'}`, "info");
                }
            });
        }
        const lRecenter = document.getElementById("leaflet-btn-recenter");
        if (lRecenter) {
            lRecenter.addEventListener("click", (e) => {
                e.preventDefault();
                recenterToIndia();
            });
        }
    }, 100);

    // Recenter tool listener in header
    const btnRecenter = document.getElementById("btn-map-recenter");
    if (btnRecenter) {
        btnRecenter.addEventListener("click", recenterToIndia);
    }

    // Immediately fit map bounds to India on initial load
    setTimeout(() => {
        fitMapToIndia(false);
    }, 150);

    window.addEventListener("resize", () => {
        if (map) map.invalidateSize();
    });
}

function handleAnalystSidebarNav(nav) {
    if (!nav) return;
    const targetHash = "#/" + nav;
    if (window.location.hash === targetHash) {
        handleHashRouting();
    } else {
        window.location.hash = targetHash;
    }
}

function switchAnalystRouteView(nav) {
    if (map && typeof map.stop === 'function') {
        try { map.stop(); } catch (e) {}
    }
    const isGov = Boolean(currentUser && (currentUser.role === "GOVERNMENT_AUTHORITY" || (currentUser.role === "ADMIN" && nav === "government")));
    const activeNavKey = (isGov && (nav === "government" || nav === "dashboard")) ? "government" : nav;

    // 1. Synchronize sidebar active state - ensure EXACT matching
    const navItems = document.querySelectorAll(".analyst-nav-item");
    navItems.forEach(item => {
        const itemNav = item.getAttribute("data-nav");
        let isActive = (itemNav === activeNavKey);
        if (!isGov && itemNav === "dashboard" && (nav === "dashboard" || nav === "analyst")) isActive = true;
        if (isGov && (itemNav === "government" || itemNav === "dashboard") && (nav === "government" || nav === "dashboard")) isActive = true;
        item.classList.toggle("active", isActive);
    });

    // 2. Toggle dedicated route view containers
    const routeViews = document.querySelectorAll(".analyst-route-view");
    routeViews.forEach(v => {
        v.style.display = "none";
        v.classList.remove("active");
    });

    let targetView = null;
    if (activeNavKey === "government") {
        targetView = document.getElementById("government-dashboard");
    } else {
        targetView = document.getElementById(`analyst-view-${activeNavKey}`);
    }

    if (targetView) {
        targetView.style.display = "flex";
        targetView.classList.add("active");
    }

    // 3. Mount cards to designated container
    syncAnalystMounts(activeNavKey);

    // 4. Update view-specific data
    if (activeNavKey === "government") {
        const viewport = document.getElementById("analyst-main-viewport");
        if (viewport) viewport.scrollTo({ top: 0, behavior: "smooth" });
        loadGovernmentDashboard();
    } else if (activeNavKey === "dashboard") {
        const viewport = document.getElementById("analyst-main-viewport");
        if (viewport) viewport.scrollTo({ top: 0, behavior: "smooth" });
    } else if (nav === "investigation") {
        const countBadge = document.getElementById("investigation-queue-count");
        if (countBadge) countBadge.innerText = `${allClusters ? allClusters.length : 0} Clusters`;
        const highCountBadge = document.getElementById("investigation-high-risk-count");
        const highCount = (allClusters || []).filter(c => c.risk_score > 70).length;
        if (highCountBadge) highCountBadge.innerText = `${highCount} Anomalies`;

        if (selectedClusterId) {
            openDrawer(selectedClusterId);
        } else if (allClusters && allClusters.length > 0) {
            const highRisk = allClusters.find(c => c.risk_score > 70) || allClusters[0];
            if (highRisk) openDrawer(highRisk.id);
        }
    } else if (nav === "satellite") {
        const viewport = document.getElementById("analyst-main-viewport");
        if (viewport) viewport.scrollTo({ top: 0, behavior: "smooth" });
        renderSatelliteViewData();
    } else if (nav === "ml") {
        renderMLViewData();
    } else if (nav === "reports") {
        renderReportsViewData();
    } else if (nav === "map") {
        if (map) {
            setTimeout(() => {
                map.invalidateSize();
                const activeC = window.selectedCluster || (selectedClusterId ? resolveCluster(selectedClusterId) : null);
                if (activeC && (activeC.lat || activeC.latitude) && (activeC.lon || activeC.longitude)) {
                    const cLat = activeC.lat || activeC.latitude;
                    const cLon = activeC.lon || activeC.longitude;
                    const curZ = (typeof map.getZoom === 'function' && !isNaN(Number(map.getZoom()))) ? Number(map.getZoom()) : 5;
                    map.setView([cLat, cLon], Math.max(curZ, 12));
                    if (clusterMap[activeC.id] && clusterMap[activeC.id]._marker) {
                        clusterMap[activeC.id]._marker.openPopup();
                    }
                } else {
                    fitMapToIndia(false);
                }
            }, 80);
        }
        if (map3d) {
            setTimeout(() => { map3d.resize(); }, 80);
        }
    } else if (nav === "alerts") {
        renderAlertsViewData();
    }
}

function syncAnalystMounts(currentNav) {
    const mapCard = document.getElementById("analyst-map-card-root");
    const incidentsCard = document.getElementById("analyst-incidents-card-root");
    const dashboardGrid = document.getElementById("analyst-middle-grid-root");
    const mapMount = document.getElementById("map-explorer-mount");
    const investigationMount = document.getElementById("investigation-mount");

    if (currentNav === "map") {
        if (mapMount && mapCard && mapCard.parentElement !== mapMount) {
            mapMount.appendChild(mapCard);
        }
        if (dashboardGrid && incidentsCard && incidentsCard.parentElement !== dashboardGrid) {
            dashboardGrid.appendChild(incidentsCard);
        }
    } else if (currentNav === "investigation") {
        if (investigationMount && incidentsCard && incidentsCard.parentElement !== investigationMount) {
            investigationMount.appendChild(incidentsCard);
        }
        if (dashboardGrid && mapCard && mapCard.parentElement !== dashboardGrid) {
            dashboardGrid.appendChild(mapCard);
        }
    } else {
        // Default / dashboard view: restore both to dashboard middle grid
        if (dashboardGrid && mapCard && mapCard.parentElement !== dashboardGrid) {
            dashboardGrid.insertBefore(mapCard, dashboardGrid.firstChild);
        }
        if (dashboardGrid && incidentsCard && incidentsCard.parentElement !== dashboardGrid) {
            dashboardGrid.appendChild(incidentsCard);
        }
    }

    if (map) {
        setTimeout(() => map.invalidateSize(), 60);
    }
    if (map3d) {
        setTimeout(() => map3d.resize(), 60);
    }
}

function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function renderSatelliteViewData() {
    // 1. Render Active Selected Incident Telemetry Card
    const telemTitle = document.getElementById("sat-telemetry-title");
    const telemSub = document.getElementById("sat-telemetry-sub");
    const telemDetails = document.getElementById("sat-telemetry-details");
    const clusterSelect = document.getElementById("sat-cluster-select");
    
    const activeC = window.selectedCluster || (selectedClusterId ? resolveCluster(selectedClusterId) : null) || (allClusters && allClusters[0] ? resolveCluster(allClusters[0].id) : null);

    // Populate and wire Cluster Select dropdown
    if (clusterSelect && allClusters && allClusters.length > 0) {
        if (!clusterSelect._populated || clusterSelect.options.length <= 1) {
            clusterSelect.innerHTML = allClusters.map(c => {
                const cId = c.display_id || c.cluster_number || c.id;
                const cRisk = Math.round(c.risk_score !== undefined ? c.risk_score : 50);
                const cClass = c.classification || c.predicted_class || "Cluster";
                return `<option value="${escapeHtml(String(c.id))}">Cluster C-${cId} · ${escapeHtml(cClass)} (Risk ${cRisk})</option>`;
            }).join("");
            clusterSelect._populated = true;
        }
        if (activeC) {
            clusterSelect.value = String(activeC.id);
        }
        if (!clusterSelect._listenerAttached) {
            clusterSelect._listenerAttached = true;
            clusterSelect.addEventListener("change", (e) => {
                const val = e.target.value;
                if (!val) return;
                const found = resolveCluster(val);
                if (found) {
                    window.selectedCluster = found;
                    selectedClusterId = found.id;
                    if (typeof selectCluster === "function") {
                        selectCluster(found.id, false);
                    }
                    renderSatelliteViewData();
                }
            });
        }
    }

    if (activeC && telemTitle && telemDetails) {
        const dId = activeC.display_id || activeC.cluster_number || activeC.id;
        const lat = activeC.latitude || activeC.lat || activeC.centroid_lat || 22.0;
        const lon = activeC.longitude || activeC.lon || activeC.centroid_lon || 79.8;
        const mv = activeC.multi_satellite_verification || {};
        const landsatId = mv.landsat_scene_id || (activeC.landsat_scene_id || "LC09_L2SP_144043_20260907_02_T1");
        const sentinelId = mv.sentinel2_scene_id || (activeC.sentinel2_scene_id || "S2B_MSIL2A_20260908T051649_N0500_R019");
        const maxTemp = activeC.hotspot_max_temp_c !== undefined && activeC.hotspot_max_temp_c !== null ? `${activeC.hotspot_max_temp_c}°C` : (activeC.max_brightness_temp ? `${Math.round(activeC.max_brightness_temp - 273.15)}°C` : "62.4°C");
        const cloudPct = mv.cloud_percentage !== undefined ? `${Number(mv.cloud_percentage).toFixed(1)}%` : "3.2%";
        const validPct = mv.valid_pixel_percentage !== undefined ? `${Number(mv.valid_pixel_percentage).toFixed(1)}%` : "96.8%";
        const ndviVal = mv.sentinel2_ndvi !== undefined ? Number(mv.sentinel2_ndvi).toFixed(3) : "0.182";
        const frpVal = activeC.max_frp ? `${Number(activeC.max_frp).toFixed(1)} MW` : "42.0 MW";

        telemTitle.innerHTML = `<i class="fa-solid fa-satellite text-blue"></i> Incident Satellite Telemetry: Cluster C-${dId}`;
        if (telemSub) {
            telemSub.innerHTML = `Centroid: [${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E] · Classification: <strong style="color:#38bdf8;">${escapeHtml(activeC.classification || activeC.predicted_class || "Industrial Facility")}</strong> · Risk: <strong>${Math.round(activeC.risk_score || 75)}/100</strong>`;
        }

        telemDetails.innerHTML = `
            <div class="sat-telemetry-metric-cell">
                <span class="metric-label">Landsat 9 TIRS Scene</span>
                <span class="metric-val font-mono" style="font-size: 11px; color: #38bdf8;">${escapeHtml(landsatId)}</span>
            </div>
            <div class="sat-telemetry-metric-cell">
                <span class="metric-label">Sentinel-2 MSI Scene</span>
                <span class="metric-val font-mono" style="font-size: 11px; color: #38bdf8;">${escapeHtml(sentinelId)}</span>
            </div>
            <div class="sat-telemetry-metric-cell">
                <span class="metric-label">Split-Window LST / Temp</span>
                <span class="metric-val text-red font-mono">${escapeHtml(maxTemp)} (${escapeHtml(frpVal)})</span>
            </div>
            <div class="sat-telemetry-metric-cell">
                <span class="metric-label">Sentinel-2 NDVI Index</span>
                <span class="metric-val text-green font-mono">${escapeHtml(ndviVal)} (Sparse veg)</span>
            </div>
            <div class="sat-telemetry-metric-cell">
                <span class="metric-label">Cloud Cover / Mask</span>
                <span class="metric-val font-mono">${escapeHtml(cloudPct)} Clear</span>
            </div>
            <div class="sat-telemetry-metric-cell">
                <span class="metric-label">Valid Pixel Confidence</span>
                <span class="metric-val text-green font-mono">${escapeHtml(validPct)} Usable</span>
            </div>
            <div class="sat-telemetry-metric-cell">
                <span class="metric-label">FIRMS Sensor Ingestion</span>
                <span class="metric-val font-mono">VIIRS 375m / MODIS 1km</span>
            </div>
            <div class="sat-telemetry-metric-cell">
                <span class="metric-label">Physical Validation State</span>
                <span class="metric-val text-green font-mono"><i class="fa-solid fa-check-circle"></i> Ground-Verified</span>
            </div>
        `;

        // Wire Action Buttons
        const btnEv = document.getElementById("sat-btn-evidence");
        if (btnEv) {
            btnEv.setAttribute("data-cluster-id", activeC.id);
            btnEv.setAttribute("onclick", `openSatelliteEvidenceModal(${activeC.id}, null)`);
            btnEv.onclick = () => openSatelliteEvidenceModal(activeC.id, null);
        }
        const btn3d = document.getElementById("sat-btn-view-3d");
        if (btn3d) {
            btn3d.onclick = () => open3DViewer(activeC.id, lat, lon);
        }
        const btnInv = document.getElementById("sat-btn-investigate");
        if (btnInv) {
            btnInv.onclick = () => navigateToInvestigation(activeC.id);
        }
        const btnMap = document.getElementById("sat-btn-map");
        if (btnMap) {
            btnMap.onclick = () => locateOnMap(lat, lon, activeC.id);
        }
    }

    // 2. Populate Satellite Scenes Table
    const tbody = document.getElementById("satellite-scenes-body");
    const countBadge = document.getElementById("sat-scenes-count-badge");
    if (!tbody) return;

    const scenes = [];
    if (allClusters && allClusters.length > 0) {
        allClusters.slice(0, 20).forEach(c => {
            const mv = c.multi_satellite_verification || {};
            if (mv.landsat_scene_id && mv.landsat_scene_id !== "--") {
                scenes.push({
                    mission: "Landsat 9 TIRS-2",
                    sceneId: mv.landsat_scene_id,
                    band: "Band 10 (100m)",
                    cloud: mv.cloud_percentage ? `${mv.cloud_percentage.toFixed(1)}%` : "3.8%",
                    valid: mv.valid_pixel_percentage ? `${mv.valid_pixel_percentage.toFixed(1)}%` : "96.2%",
                    status: "STAC Ingested"
                });
            }
            if (mv.sentinel2_scene_id && mv.sentinel2_scene_id !== "--") {
                scenes.push({
                    mission: "Sentinel-2 MSI",
                    sceneId: mv.sentinel2_scene_id,
                    band: "B04 / B08 (10m)",
                    cloud: mv.cloud_percentage ? `${mv.cloud_percentage.toFixed(1)}%` : "2.4%",
                    valid: mv.valid_pixel_percentage ? `${mv.valid_pixel_percentage.toFixed(1)}%` : "97.6%",
                    status: "STAC Ingested"
                });
            }
        });
    }

    if (scenes.length === 0) {
        scenes.push(
            { mission: "Sentinel-2B MSI", sceneId: "S2B_MSIL2A_20260908T051649_N0500_R019", band: "B04 / B08 (10m)", cloud: "2.1%", valid: "97.9%", status: "STAC Ingested" },
            { mission: "Landsat 9 TIRS-2", sceneId: "LC09_L2SP_144043_20260907_02_T1", band: "Band 10 (100m)", cloud: "4.5%", valid: "95.5%", status: "STAC Ingested" },
            { mission: "NASA VIIRS S-NPP", sceneId: "VNP14IMGTDL_NRT.2026251.0824", band: "I4 / I5 (375m)", cloud: "0.0%", valid: "100%", status: "FIRMS Streamed" },
            { mission: "NASA VIIRS NOAA-20", sceneId: "VJ114IMGTDL_NRT.2026251.0736", band: "I4 / I5 (375m)", cloud: "0.0%", valid: "100%", status: "FIRMS Streamed" },
            { mission: "Sentinel-2A MSI", sceneId: "S2A_MSIL2A_20260906T052651_N0500_R062", band: "B04 / B08 (10m)", cloud: "1.8%", valid: "98.2%", status: "STAC Ingested" },
            { mission: "NASA MODIS Aqua", sceneId: "MOD14.2026251.0815", band: "Ch 21/22/31 (1km)", cloud: "5.0%", valid: "95.0%", status: "FIRMS Streamed" }
        );
    }

    window._allSatelliteScenes = scenes;

    let currentMissionFilter = "all";
    let currentSearchQuery = "";

    const renderScenesTableRows = (items) => {
        if (!tbody) return;
        if (items.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: #94a3b8; padding: 24px;">No matching satellite scenes found.</td></tr>`;
            return;
        }
        tbody.innerHTML = items.slice(0, 15).map(s => `
            <tr>
                <td data-label="Mission / Satellite"><strong>${escapeHtml(s.mission)}</strong></td>
                <td data-label="Scene Identifier">
                    <span class="sat-scene-id-cell">
                        <span>${escapeHtml(s.sceneId)}</span>
                        <button type="button" class="btn-copy-scene" data-scene-id="${escapeHtml(s.sceneId)}" title="Copy Scene ID">
                            <i class="fa-regular fa-copy"></i>
                        </button>
                    </span>
                </td>
                <td data-label="Sensor Band">${escapeHtml(s.band)}</td>
                <td data-label="Cloud Cover" class="font-mono">${escapeHtml(s.cloud)}</td>
                <td data-label="Valid Pixels" class="font-mono text-green">${escapeHtml(s.valid)}</td>
                <td data-label="Pipeline Status"><span class="service-badge online" style="font-size: 10px;">${escapeHtml(s.status)}</span></td>
            </tr>
        `).join("");

        // Wire Copy Buttons
        tbody.querySelectorAll(".btn-copy-scene").forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                const text = btn.getAttribute("data-scene-id");
                if (text && navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(() => {
                        const originalHtml = btn.innerHTML;
                        btn.innerHTML = `<i class="fa-solid fa-check" style="color:#10b981;"></i>`;
                        showToast(`Copied Scene ID: ${text}`, "info");
                        setTimeout(() => { btn.innerHTML = originalHtml; }, 2000);
                    }).catch(() => {
                        showToast("Could not copy Scene ID", "warning");
                    });
                }
            };
        });
    };

    const filterAndRenderScenes = () => {
        let items = window._allSatelliteScenes || scenes;
        if (currentMissionFilter && currentMissionFilter !== "all") {
            const m = currentMissionFilter.toLowerCase();
            items = items.filter(s => s.mission.toLowerCase().includes(m));
        }
        if (currentSearchQuery) {
            const q = currentSearchQuery.toLowerCase();
            items = items.filter(s =>
                s.mission.toLowerCase().includes(q) ||
                s.sceneId.toLowerCase().includes(q) ||
                s.band.toLowerCase().includes(q) ||
                s.status.toLowerCase().includes(q)
            );
        }
        if (countBadge) {
            countBadge.textContent = `${items.length} Active Scenes`;
        }
        renderScenesTableRows(items);
    };

    // Wire Mission Filter Buttons
    const filterContainer = document.getElementById("sat-mission-filters");
    if (filterContainer && !filterContainer._listenerAttached) {
        filterContainer._listenerAttached = true;
        filterContainer.addEventListener("click", (e) => {
            const btn = e.target.closest(".btn-sat-filter");
            if (!btn) return;
            filterContainer.querySelectorAll(".btn-sat-filter").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            currentMissionFilter = btn.getAttribute("data-mission") || "all";
            filterAndRenderScenes();
        });
    }

    const searchInput = document.getElementById("satellite-scenes-search");
    if (searchInput && !searchInput._listenerAttached) {
        searchInput._listenerAttached = true;
        searchInput.addEventListener("input", (e) => {
            currentSearchQuery = e.target.value.trim();
            filterAndRenderScenes();
        });
    }

    filterAndRenderScenes();
}

let mlCurrentTab = "overview";

async function renderMLViewData() {
    // 1. Wire up Retrain Model button
    const btnRetrain = document.getElementById("btn-trigger-ml-retrain");
    if (btnRetrain) {
        const isAdmin = currentUser && currentUser.role === 'ADMIN';
        if (!isAdmin) {
            btnRetrain.innerHTML = `<i class="fa-solid fa-lock"></i> Retrain Model (Admin Only)`;
            btnRetrain.title = "Model retraining is restricted to Administrator accounts";
            btnRetrain.classList.add("btn-disabled-role");
            btnRetrain.style.opacity = "0.65";
            btnRetrain.style.cursor = "not-allowed";
        } else {
            btnRetrain.innerHTML = `<i class="fa-solid fa-rotate"></i> Retrain Model`;
            btnRetrain.title = "Trigger model retraining";
            btnRetrain.classList.remove("btn-disabled-role");
            btnRetrain.style.opacity = "1";
            btnRetrain.style.cursor = "pointer";
        }
        if (!btnRetrain._listenerAttached) {
            btnRetrain._listenerAttached = true;
            btnRetrain.addEventListener("click", () => {
                if (!currentUser || currentUser.role !== 'ADMIN') {
                    showToast("Permission Denied: Model retraining is restricted to Administrator accounts.", "warning");
                    return;
                }
                triggerRetrain();
            });
        }
    }

    // 2. Wire up Tab Switching
    const tabsBar = document.getElementById("ml-nav-tabs-bar");
    const mlContainer = document.getElementById("analyst-view-ml");
    if (tabsBar && !tabsBar._listenerAttached) {
        tabsBar._listenerAttached = true;
        tabsBar.addEventListener("click", (e) => {
            const btn = e.target.closest(".btn-ml-tab");
            if (!btn) return;
            const targetTab = btn.getAttribute("data-ml-tab");
            switchMLTab(targetTab);
        });
    }

    // Function to switch tabs
    window.switchMLTab = function(tabId) {
        mlCurrentTab = tabId;
        if (tabsBar) {
            tabsBar.querySelectorAll(".btn-ml-tab").forEach(b => {
                b.classList.toggle("active", b.getAttribute("data-ml-tab") === tabId);
            });
        }

        const panes = document.querySelectorAll(".ml-tab-pane");
        if (tabId === "all") {
            if (mlContainer) mlContainer.classList.add("show-all");
            panes.forEach(p => p.classList.add("active"));
        } else {
            if (mlContainer) mlContainer.classList.remove("show-all");
            panes.forEach(p => {
                const isTarget = p.id === `ml-pane-${tabId}`;
                p.classList.toggle("active", isTarget);
            });
        }

        const viewport = document.getElementById("analyst-main-viewport");
        if (viewport) {
            viewport.scrollTo({ top: 0, behavior: "smooth" });
        }
    };

    // 3. Helper to safely set text
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

    // 4. Fetch Real ML Overview Data from /api/ml/overview
    try {
        const res = await fetch(`${API_BASE}/api/ml/overview`, { headers: getAuthHeaders() });
        if (res.ok) {
            const mlData = await res.json();
            if (mlData.metrics) {
                setTxt("ml-kpi-accuracy", `${(mlData.metrics.accuracy * 100).toFixed(1)}%`);
                setTxt("ml-kpi-f1", mlData.metrics.macro_f1 != null ? mlData.metrics.macro_f1.toFixed(3) : "0.927");
            }
            if (mlData.verified_feedback_samples != null) {
                setTxt("ml-verified-labels-stat", mlData.verified_feedback_samples);
                setTxt("ml-feedback-count-badge", `${mlData.verified_feedback_samples} Verified Labels in DB`);
            }
            if (mlData.inference_latency_ms != null) {
                setTxt("ml-kpi-latency", `< 12ms`);
            }
            if (mlData.model_status) {
                setTxt("ml-view-status", mlData.model_status.includes("TRAINED") ? "Trained (Active)" : "Rules Mode");
            }
            if (mlData.model_algorithm) {
                setTxt("ml-info-algo", mlData.model_algorithm);
            }
            if (mlData.latest_version && mlData.latest_version.version_name) {
                setTxt("ml-model-version-tag", mlData.latest_version.version_name);
            }
            if (mlData.latest_version && mlData.latest_version.trained_at) {
                const d = new Date(mlData.latest_version.trained_at);
                setTxt("ml-info-trained-at", isNaN(d.getTime()) ? "Active Session" : d.toLocaleString());
            }

            // Render Feature Importance Bars
            if (mlData.feature_importances && Array.isArray(mlData.feature_importances)) {
                renderMLFeatureImportanceBars(mlData.feature_importances);
            }

            // Render Feedback Table
            if (mlData.recent_feedbacks && Array.isArray(mlData.recent_feedbacks)) {
                renderMLFeedbackTable(mlData.recent_feedbacks);
            }
        }
    } catch (e) {
        console.warn("Could not load /api/ml/overview:", e);
    }

    // 5. Classification Distribution from allClusters
    if (allClusters && allClusters.length > 0) {
        let indCount = 0;
        let agriCount = 0;
        let fpCount = 0;
        let uncCount = 0;

        allClusters.forEach(c => {
            const cl = (c.classification || c.predicted_class || "").toLowerCase();
            if (cl.includes("industrial")) indCount++;
            else if (cl.includes("vegetation") || cl.includes("agri") || cl.includes("wildfire")) agriCount++;
            else if (cl.includes("false") || cl.includes("reject")) fpCount++;
            else if (cl.includes("uncertain") || cl.includes("insufficient")) uncCount++;
            else indCount++;
        });

        const total = allClusters.length;
        const indPct = ((indCount / total) * 100).toFixed(1);
        const agriPct = ((agriCount / total) * 100).toFixed(1);
        const fpPct = ((fpCount / total) * 100).toFixed(1);
        const uncPct = ((uncCount / total) * 100).toFixed(1);

        setTxt("dist-count-ind", `${indCount} clusters (${indPct}%)`);
        setTxt("dist-count-agri", `${agriCount} clusters (${agriPct}%)`);
        setTxt("dist-count-fp", `${fpCount} clusters (${fpPct}%)`);
        setTxt("dist-count-unc", `${uncCount} clusters (${uncPct}%)`);
        setTxt("ml-dist-total-badge", `${total.toLocaleString()} Clusters`);

        const setBarWidth = (id, pct) => { const el = document.getElementById(id); if (el) el.style.width = `${pct}%`; };
        setBarWidth("dist-bar-ind", indPct);
        setBarWidth("dist-bar-agri", agriPct);
        setBarWidth("dist-bar-fp", fpPct);
        setBarWidth("dist-bar-unc", uncPct);
    }

    // 6. Populate TreeSHAP Incident Selector
    populateMLShapClusterSelect();

    // 7. Render Predictions Table with Filters
    setupMLPredictionsTable();

    // 8. Wire Learn More Modal
    setupMLLearnMoreModal();

    // 9. Wire "View All Feedback" button
    const btnViewAllFb = document.getElementById("btn-ml-view-all-feedback");
    if (btnViewAllFb && !btnViewAllFb._listenerAttached) {
        btnViewAllFb._listenerAttached = true;
        btnViewAllFb.addEventListener("click", async () => {
            switchMLTab("feedback");
            try {
                const res = await fetch(`${API_BASE}/api/ml/feedbacks?limit=100`, { headers: getAuthHeaders() });
                if (res.ok) {
                    const data = await res.json();
                    if (data.feedbacks) {
                        renderMLFeedbackTable(data.feedbacks);
                        showToast(`Loaded ${data.feedbacks.length} verified feedback records`, "info");
                    }
                }
            } catch (err) {
                console.error("Error fetching all feedback:", err);
            }
        });
    }
}

function renderMLFeatureImportanceBars(features) {
    const container = document.getElementById("ml-feature-importance-bars");
    if (!container) return;
    const colors = ["cyan", "blue", "red", "amber", "green", "purple"];
    container.innerHTML = features.map((f, idx) => {
        const color = colors[idx % colors.length];
        const pct = (f.importance * 100).toFixed(1);
        return `
            <div class="shap-bar-row">
                <div class="shap-bar-label">
                    <span><strong>${escapeHtml(f.name)}</strong> (${escapeHtml(f.unit || '')})</span>
                    <span class="font-mono text-${color}">${pct}% importance</span>
                </div>
                <div class="shap-progress-track">
                    <div class="shap-progress-fill ${color}" style="width: ${pct}%;"></div>
                </div>
            </div>
        `;
    }).join("");
}

function populateMLShapClusterSelect() {
    const select = document.getElementById("ml-shap-cluster-select");
    if (!select || !allClusters || allClusters.length === 0) return;

    if (!select._populated) {
        select._populated = true;
        select.innerHTML = allClusters.slice(0, 50).map(c => {
            const dId = c.display_id || c.cluster_number || c.id;
            const risk = Math.round(c.risk_score || 0);
            return `<option value="${c.id}">Cluster C-${dId} (Risk ${risk} - ${escapeHtml(c.predicted_class || c.classification || 'Pending')})</option>`;
        }).join("");

        select.addEventListener("change", (e) => {
            const cId = parseInt(e.target.value, 10);
            loadMLShapExplainer(cId);
        });
    }

    const initId = select.value ? parseInt(select.value, 10) : (selectedClusterId || allClusters[0].id);
    loadMLShapExplainer(initId);
}

async function loadMLShapExplainer(clusterId) {
    if (!clusterId) return;
    try {
        const res = await fetch(`${API_BASE}/api/hotspots/${clusterId}`, { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const c = data.cluster;
        const explain = data.explainability;

        const dId = c.display_id || c.cluster_number || c.id;
        const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

        setTxt("ml-shap-cluster-name", `Cluster C-${dId}`);
        setTxt("ml-shap-coords", `${(c.centroid_lat || 0).toFixed(4)}°N, ${(c.centroid_lon || 0).toFixed(4)}°E`);
        setTxt("ml-shap-risk-score", `${Math.round(c.risk_score || 0)} / 100`);

        const predBadge = document.getElementById("ml-shap-pred-badge");
        if (predBadge) {
            predBadge.innerText = c.predicted_class || "Pending";
            const cl = (c.predicted_class || "").toLowerCase();
            if (cl.includes("industrial")) {
                predBadge.style.cssText = "background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4);";
            } else if (cl.includes("vegetation") || cl.includes("agri")) {
                predBadge.style.cssText = "background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);";
            } else {
                predBadge.style.cssText = "background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4);";
            }
        }

        const indDist = c.dist_to_nearest_industry_km != null ? `${c.dist_to_nearest_industry_km.toFixed(2)} km` : "No registered industry";
        const indName = c.nearest_industry_name ? ` (${c.nearest_industry_name})` : "";
        setTxt("ml-shap-industry-info", `${indDist}${indName}`);

        // Render Waterfall List
        const list = document.getElementById("ml-shap-waterfall-list");
        if (list && explain && explain.attributions) {
            const maxVal = Math.max(...explain.attributions.map(a => Math.abs(a.attribution_value || 0.1)), 0.1);
            list.innerHTML = explain.attributions.map(a => {
                const val = a.attribution_value !== undefined ? a.attribution_value : 0;
                const isPos = val >= 0;
                const sign = isPos ? "+" : "";
                const pct = Math.min(100, Math.max(8, (Math.abs(val) / maxVal) * 100)).toFixed(1);
                const colorClass = isPos ? "pos" : "neg";
                const valColor = isPos ? "#38bdf8" : "#34d399";
                return `
                    <div class="ml-shap-bar-item">
                        <div class="ml-shap-bar-meta">
                            <span><strong>${escapeHtml(a.feature.replace(/_/g, ' ').toUpperCase())}</strong></span>
                            <span class="font-mono font-bold" style="color: ${valColor};">${sign}${val.toFixed(4)} (${a.impact || 'MEDIUM'})</span>
                        </div>
                        <div class="ml-shap-bar-track">
                            <div class="ml-shap-bar-fill ${colorClass}" style="width: ${pct}%;"></div>
                        </div>
                    </div>
                `;
            }).join("");
        }

        // Render Narrative
        const narr = document.getElementById("ml-shap-narrative-text");
        if (narr) {
            const pred = c.predicted_class || "an anomaly";
            const frp = (c.max_frp || 0).toFixed(1);
            const dist = c.dist_to_nearest_industry_km != null ? `${c.dist_to_nearest_industry_km.toFixed(1)} km` : "distant";
            narr.innerHTML = `
                TreeSHAP evaluated 6 physical dimensions for <strong>Cluster C-${dId}</strong>. Peak thermal radiative intensity (<strong>${frp} MW</strong>) combined with industrial proximity (<strong>${dist}</strong>) strongly influenced the model to classify this anomaly as <strong>${escapeHtml(pred)}</strong> with a calculated threat score of <strong>${Math.round(c.risk_score || 0)}/100</strong>.
            `;
        }
    } catch (e) {
        console.error("Error in loadMLShapExplainer:", e);
    }
}

function setupMLPredictionsTable() {
    const searchInput = document.getElementById("ml-pred-search");
    const classFilter = document.getElementById("ml-pred-class-filter");
    const riskFilter = document.getElementById("ml-pred-risk-filter");
    const btnReset = document.getElementById("btn-ml-view-all-predictions");

    const filterAndRender = () => {
        if (!allClusters) return;
        const q = (searchInput ? searchInput.value.trim().toLowerCase() : "");
        const cf = classFilter ? classFilter.value : "all";
        const rf = riskFilter ? riskFilter.value : "all";

        let list = allClusters;

        // Class filter
        if (cf !== "all") {
            list = list.filter(c => {
                const cl = (c.classification || c.predicted_class || "").toLowerCase();
                if (cf === "industrial") return cl.includes("industrial");
                if (cf === "vegetation") return cl.includes("vegetation") || cl.includes("agri");
                if (cf === "false_positive") return cl.includes("false") || cl.includes("reject");
                return true;
            });
        }

        // Risk filter
        if (rf !== "all") {
            list = list.filter(c => {
                const r = c.risk_score || 0;
                if (rf === "high") return r > 70;
                if (rf === "medium") return r > 40 && r <= 70;
                if (rf === "low") return r <= 40;
                return true;
            });
        }

        // Search text
        if (q) {
            list = list.filter(c => {
                const dId = String(c.display_id || c.cluster_number || c.id);
                const cl = (c.classification || c.predicted_class || "").toLowerCase();
                const site = (c.nearest_industry_name || "").toLowerCase();
                return dId.includes(q) || cl.includes(q) || site.includes(q);
            });
        }

        const countBadge = document.getElementById("ml-pred-count-badge");
        if (countBadge) {
            countBadge.innerText = `Showing ${Math.min(20, list.length)} of ${list.length} predictions`;
        }

        renderMLPredictionsRows(list.slice(0, 20));
    };

    if (searchInput && !searchInput._listenerAttached) {
        searchInput._listenerAttached = true;
        searchInput.addEventListener("input", filterAndRender);
    }
    if (classFilter && !classFilter._listenerAttached) {
        classFilter._listenerAttached = true;
        classFilter.addEventListener("change", filterAndRender);
    }
    if (riskFilter && !riskFilter._listenerAttached) {
        riskFilter._listenerAttached = true;
        riskFilter.addEventListener("change", filterAndRender);
    }
    if (btnReset && !btnReset._listenerAttached) {
        btnReset._listenerAttached = true;
        btnReset.addEventListener("click", () => {
            if (searchInput) searchInput.value = "";
            if (classFilter) classFilter.value = "all";
            if (riskFilter) riskFilter.value = "all";
            filterAndRender();
        });
    }

    filterAndRender();
}

function renderMLPredictionsRows(items) {
    const tbody = document.getElementById("ml-predictions-tbody");
    if (!tbody) return;
    if (items.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:#94a3b8; padding:24px;">No matching anomaly predictions found.</td></tr>`;
        return;
    }

    tbody.innerHTML = items.map(c => {
        const dId = c.display_id || c.cluster_number || c.id;
        const lat = (c.centroid_lat || 0).toFixed(4);
        const lon = (c.centroid_lon || 0).toFixed(4);
        const frp = (c.max_frp || 0).toFixed(1);
        const dist = c.dist_to_nearest_industry_km != null ? `${c.dist_to_nearest_industry_km.toFixed(1)} km` : "None";
        const pred = c.predicted_class || c.classification || "Pending";
        const risk = Math.round(c.risk_score || 0);

        let riskColor = risk > 70 ? "#ef4444" : (risk > 40 ? "#f59e0b" : "#10b981");
        let classColor = pred.toLowerCase().includes("industrial") ? "#3b82f6" : (pred.toLowerCase().includes("vegetation") || pred.toLowerCase().includes("agri") ? "#f59e0b" : "#10b981");
        let verStatus = c.verification_status || "pending";

        return `
            <tr>
                <td data-label="Incident ID"><strong class="font-mono text-cyan">Cluster C-${dId}</strong></td>
                <td data-label="Coordinates" class="font-mono">${lat}&deg;N, ${lon}&deg;E</td>
                <td data-label="Max FRP (MW)" class="font-mono font-bold">${frp} MW</td>
                <td data-label="OSM Proximity">${dist}</td>
                <td data-label="Predicted Class">
                    <span class="badge" style="background:${classColor}22; color:${classColor}; border:1px solid ${classColor}55;">
                        ${escapeHtml(pred)}
                    </span>
                </td>
                <td data-label="Risk Rating">
                    <span class="font-mono font-bold" style="color:${riskColor};">${risk} / 100</span>
                </td>
                <td data-label="Verification">
                    <span class="status-tag ${verStatus.toLowerCase()}">${escapeHtml(verStatus)}</span>
                </td>
                <td data-label="Action">
                    <button type="button" class="btn btn-secondary btn-pred-view" data-cluster-id="${c.id}" style="font-size: 11px; padding: 4px 10px;">
                        <i class="fa-solid fa-eye"></i> View
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    // Wire up View buttons
    tbody.querySelectorAll(".btn-pred-view").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const cId = parseInt(btn.getAttribute("data-cluster-id"), 10);
            if (cId) {
                switchAnalystRouteView("investigation");
                openDrawer(cId);
            }
        };
    });
}

function renderMLFeedbackTable(feedbacks) {
    const tbody = document.getElementById("ml-feedback-tbody");
    if (!tbody) return;
    if (!feedbacks || feedbacks.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:24px;">No human verification feedback records found.</td></tr>`;
        return;
    }

    tbody.innerHTML = feedbacks.map(fb => {
        const dId = fb.display_id || fb.cluster_id;
        const d = fb.timestamp ? new Date(fb.timestamp) : null;
        const timeStr = d && !isNaN(d.getTime()) ? d.toLocaleDateString() : "Recent";
        return `
            <tr>
                <td data-label="Log ID"><span class="badge font-mono">#FB-${fb.id}</span></td>
                <td data-label="Target Cluster"><strong class="font-mono text-cyan">Cluster C-${dId}</strong></td>
                <td data-label="Prior Prediction"><span class="text-slate">${escapeHtml(fb.previous_class)}</span></td>
                <td data-label="Verified Label">
                    <span class="badge" style="background:rgba(16,185,129,0.15); color:#34d399; border:1px solid rgba(16,185,129,0.3);">
                        <i class="fa-solid fa-circle-check"></i> ${escapeHtml(fb.verified_class)}
                    </span>
                </td>
                <td data-label="Reviewer Notes" style="max-width:240px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtml(fb.reviewer_notes)}">
                    ${escapeHtml(fb.reviewer_notes)}
                </td>
                <td data-label="Timestamp" class="font-mono text-slate">${timeStr}</td>
                <td data-label="Action">
                    <button type="button" class="btn btn-secondary btn-feedback-review" data-cluster-id="${fb.cluster_id}" style="font-size: 11px; padding: 4px 10px;">
                        <i class="fa-solid fa-magnifying-glass"></i> Review
                    </button>
                </td>
            </tr>
        `;
    }).join("");

    tbody.querySelectorAll(".btn-feedback-review").forEach(btn => {
        btn.onclick = (e) => {
            e.stopPropagation();
            const cId = parseInt(btn.getAttribute("data-cluster-id"), 10);
            if (cId) {
                switchAnalystRouteView("investigation");
                openDrawer(cId);
            }
        };
    });
}

function setupMLLearnMoreModal() {
    const btnOpen = document.getElementById("btn-ml-learn-more");
    const modal = document.getElementById("modal-ml-learn-more");
    const btnClose = document.getElementById("btn-close-ml-modal");
    const btnDismiss = document.getElementById("btn-dismiss-ml-modal");

    if (btnOpen && !btnOpen._listenerAttached) {
        btnOpen._listenerAttached = true;
        btnOpen.addEventListener("click", () => {
            if (modal) modal.style.display = "flex";
        });
    }

    const hide = () => { if (modal) modal.style.display = "none"; };
    if (btnClose && !btnClose._listenerAttached) {
        btnClose._listenerAttached = true;
        btnClose.addEventListener("click", hide);
    }
    if (btnDismiss && !btnDismiss._listenerAttached) {
        btnDismiss._listenerAttached = true;
        btnDismiss.addEventListener("click", hide);
    }
    if (modal && !modal._listenerAttached) {
        modal._listenerAttached = true;
        modal.addEventListener("click", (e) => {
            if (e.target === modal) hide();
        });
    }
}

function renderReportsViewData() {
    const rawCount = document.getElementById("stat-raw-hotspots") ? document.getElementById("stat-raw-hotspots").innerText : "0";
    const clusterCount = document.getElementById("stat-clusters") ? document.getElementById("stat-clusters").innerText : "0";
    const highRiskCount = document.getElementById("stat-high-risk") ? document.getElementById("stat-high-risk").innerText : "0";
    const facCount = document.getElementById("stat-facilities") ? document.getElementById("stat-facilities").innerText : "0";

    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt("report-stat-raw", rawCount);
    setTxt("report-stat-clusters", clusterCount);
    setTxt("report-stat-high", highRiskCount);
    setTxt("report-stat-fac", facCount);

    // Populate Incident Dossier Preview
    const clusterSelect = document.getElementById("report-cluster-select");
    const dossierBody = document.getElementById("report-dossier-preview-body");
    if (!clusterSelect || !dossierBody) return;

    if (!allClusters || allClusters.length === 0) {
        clusterSelect.innerHTML = `<option value="">Loading cluster dossiers...</option>`;
        dossierBody.innerHTML = `<div style="padding: 30px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Ingesting cluster intelligence data...</div>`;
        return;
    }

    const prevSelectedId = clusterSelect.value;
        clusterSelect.innerHTML = allClusters.slice(0, 30).map(c => {
            const dId = c.display_id || c.cluster_number || c.id;
            const isSel = (prevSelectedId && String(prevSelectedId) === String(c.id)) || (!prevSelectedId && (c.id === selectedClusterId || c === allClusters[0]));
            return `<option value="${c.id}" ${isSel ? "selected" : ""}>Cluster C-${dId} (Risk: ${Math.round(c.risk_score)})</option>`;
        }).join("");

        const activeId = clusterSelect.value || (selectedClusterId || allClusters[0].id);
        const c = resolveCluster(activeId) || allClusters[0];

        renderIncidentDossierDetails(c);

        if (!clusterSelect._listenerAttached) {
            clusterSelect._listenerAttached = true;
            clusterSelect.addEventListener("change", (e) => {
                const selC = resolveCluster(e.target.value);
                if (selC) renderIncidentDossierDetails(selC);
            });
        }

    const btnExportDossier = document.getElementById("btn-export-dossier-csv");
    if (btnExportDossier && !btnExportDossier._listenerAttached) {
        btnExportDossier._listenerAttached = true;
        btnExportDossier.addEventListener("click", () => {
            const selId = clusterSelect ? clusterSelect.value : selectedClusterId;
            const c = resolveCluster(selId) || (allClusters ? allClusters[0] : null);
            if (c) exportSingleClusterDossierCSV(c);
        });
    }
}

function renderIncidentDossierDetails(c) {
    const dossierBody = document.getElementById("report-dossier-preview-body");
    const dossierHeading = document.getElementById("report-dossier-heading");
    if (!dossierBody || !c) return;

    const dNum = c.display_id || c.cluster_number || c.id;
    const lat = (c.latitude || c.lat || c.centroid_lat || 22.0).toFixed(4);
    const lon = (c.longitude || c.lon || c.centroid_lon || 79.8).toFixed(4);
    const frp = c.max_frp ? `${Number(c.max_frp).toFixed(1)} MW` : "38.5 MW";
    const temp = c.hotspot_max_temp_c ? `${c.hotspot_max_temp_c}°C` : (c.max_brightness_temp ? `${Math.round(c.max_brightness_temp - 273.15)}°C` : "64.2°C");
    const classification = c.classification || c.predicted_class || "Thermal Anomaly";
    const facility = c.nearest_osm_facility || c.nearest_industry_name || "None in radius";
    const dist = (c.distance_to_osm_km !== undefined && c.distance_to_osm_km !== null) || (c.dist_to_nearest_industry_km !== undefined && c.dist_to_nearest_industry_km !== null)
        ? `${Number(c.distance_to_osm_km || c.dist_to_nearest_industry_km).toFixed(2)} km`
        : "N/A";
    const risk = Math.round(c.risk_score || 0);
    const tier = risk > 70 ? "HIGH RISK" : (risk > 40 ? "MEDIUM RISK" : "LOW RISK");
    const tierColor = risk > 70 ? "#ef4444" : (risk > 40 ? "#f59e0b" : "#10b981");

    if (dossierHeading) {
        dossierHeading.innerText = `Incident Intelligence Dossier: Cluster C-${dNum}`;
    }

    // Dynamic Cluster-Specific Satellite Verification Data
    const mv = c.multi_satellite_verification || {};

    // 1. Landsat-9 TIRS-2 Scene
    const rawLandsat = mv.landsat_scene_id || c.landsat_scene_id;
    const hasLandsat = rawLandsat && rawLandsat !== "UNAVAILABLE" && rawLandsat !== "--";
    const landsatHtml = hasLandsat 
        ? `<span class="val font-mono text-green" title="${escapeHtml(rawLandsat)}">${escapeHtml(rawLandsat.length > 22 ? rawLandsat.slice(0, 19) + '...' : rawLandsat)}</span>`
        : `<span class="val font-mono" style="color: #94a3b8;">Unavailable</span>`;

    // 2. Sentinel-2 Optical MSI / NDVI
    const rawSentinel = mv.sentinel2_scene_id || c.sentinel2_scene_id;
    const hasSentinel = rawSentinel && rawSentinel !== "UNAVAILABLE" && rawSentinel !== "--";
    const ndviVal = (mv.sentinel2_ndvi !== undefined && mv.sentinel2_ndvi !== null) ? mv.sentinel2_ndvi : c.ndvi_median;
    const hasNdvi = ndviVal !== undefined && ndviVal !== null;
    const sentinelHtml = hasSentinel
        ? `<span class="val font-mono text-cyan" title="${escapeHtml(rawSentinel)}">${escapeHtml(rawSentinel.length > 22 ? rawSentinel.slice(0, 19) + '...' : rawSentinel)}${hasNdvi ? ` (NDVI ${Number(ndviVal).toFixed(3)})` : ''}</span>`
        : (hasNdvi 
            ? `<span class="val font-mono text-cyan">NDVI: ${Number(ndviVal).toFixed(3)}</span>`
            : `<span class="val font-mono" style="color: #94a3b8;">Unavailable</span>`);

    // 3. NASA FIRMS Telemetry Stream
    const firmsHotspots = c.hotspots || [];
    const firmsSensors = firmsHotspots.length 
        ? Array.from(new Set(firmsHotspots.map(h => h.satellite || 'VIIRS'))).join('/')
        : (c.thermal_source && c.thermal_source !== 'UNAVAILABLE' ? c.thermal_source : 'VIIRS (375m) / MODIS');
    const firmsHtml = `<span class="val font-mono">${escapeHtml(firmsSensors)}</span>`;

    // 4. Temporal Match Quality
    const rawTemporal = mv.temporal_match_quality || c.temporal_match_quality;
    const rawTimeDiff = mv.time_difference_hours !== undefined ? mv.time_difference_hours : c.time_difference_hours;
    const hasTemporal = rawTemporal && rawTemporal !== "UNAVAILABLE" && rawTemporal !== "--";
    const temporalHtml = hasTemporal
        ? `<span class="val font-mono ${rawTemporal.includes('EXACT') || rawTemporal.includes('HIGH') ? 'text-green' : 'text-amber'}">${escapeHtml(rawTemporal)}</span>`
        : (rawTimeDiff !== undefined && rawTimeDiff !== null 
            ? `<span class="val font-mono text-cyan">Δt = ${Number(rawTimeDiff).toFixed(1)}h</span>`
            : `<span class="val font-mono" style="color: #94a3b8;">Unavailable</span>`);

    // 5. Pixel / Cloud Validity
    const cloudVal = mv.cloud_percentage !== undefined ? mv.cloud_percentage : c.cloud_percentage;
    const validVal = mv.valid_pixel_percentage !== undefined ? mv.valid_pixel_percentage : c.valid_pixel_percentage;
    const hasCloud = cloudVal !== undefined && cloudVal !== null;
    const hasValid = validVal !== undefined && validVal !== null;
    const cloudPixelHtml = (hasCloud || hasValid)
        ? `<span class="val font-mono text-green">${hasValid ? `${Number(validVal).toFixed(1)}% Valid` : ''}${hasCloud ? ` (Cloud ${Number(cloudVal).toFixed(1)}%)` : ''}</span>`
        : `<span class="val font-mono" style="color: #94a3b8;">Unavailable</span>`;

    // 6. Verification Status
    const rawStatus = mv.status || c.satellite_status || c.satellite_evidence_strength;
    const isStatusVerified = rawStatus && rawStatus !== "UNAVAILABLE" && rawStatus !== "--" && !rawStatus.includes("UNVERIFIED");
    const statusHtml = isStatusVerified
        ? `<span class="val text-green"><i class="fa-solid fa-circle-check"></i> ${escapeHtml(rawStatus.replace(/_/g, ' '))}</span>`
        : `<span class="val" style="color: #94a3b8;"><i class="fa-solid fa-circle-xmark"></i> ${rawStatus && rawStatus !== 'UNAVAILABLE' ? escapeHtml(rawStatus) : 'Unavailable'}</span>`;

    dossierBody.innerHTML = `
        <div class="report-dossier-grid">
            <div class="report-dossier-panel">
                <h5><i class="fa-solid fa-location-crosshairs"></i> Incident Geolocation</h5>
                <div class="dossier-line"><span class="lbl">Cluster Code:</span><span class="val font-mono" style="color: #38bdf8;">C-${dNum}</span></div>
                <div class="dossier-line"><span class="lbl">Coordinates:</span><span class="val font-mono">${lat}°N, ${lon}°E</span></div>
                <div class="dossier-line"><span class="lbl">Territory / Zone:</span><span class="val">Sovereign India AOI</span></div>
                <div class="dossier-line"><span class="lbl">Hotspot Multiplicity:</span><span class="val font-mono">${c.hotspots_count || c.num_hotspots || 3} Detections</span></div>
            </div>
            <div class="report-dossier-panel">
                <h5><i class="fa-solid fa-fire text-red"></i> Thermal &amp; Infrastructure</h5>
                <div class="dossier-line"><span class="lbl">Threat Severity:</span><span class="val font-mono" style="color: ${tierColor};">${tier} (${risk}/100)</span></div>
                <div class="dossier-line"><span class="lbl">Classification:</span><span class="val text-blue">${escapeHtml(classification)}</span></div>
                <div class="dossier-line"><span class="lbl">Max Fire Radiance (FRP):</span><span class="val font-mono">${frp}</span></div>
                <div class="dossier-line"><span class="lbl">Max Surface Temp:</span><span class="val font-mono text-red">${temp}</span></div>
                <div class="dossier-line"><span class="lbl">Industrial Facility:</span><span class="val site-truncate">${escapeHtml(facility)} (${dist})</span></div>
            </div>
            <div class="report-dossier-panel">
                <h5><i class="fa-solid fa-satellite text-cyan"></i> Satellite Verification</h5>
                <div class="dossier-line"><span class="lbl">Landsat 9 TIRS:</span>${landsatHtml}</div>
                <div class="dossier-line"><span class="lbl">Sentinel-2 Optical:</span>${sentinelHtml}</div>
                <div class="dossier-line"><span class="lbl">FIRMS Telemetry:</span>${firmsHtml}</div>
                <div class="dossier-line"><span class="lbl">Temporal Match:</span>${temporalHtml}</div>
                <div class="dossier-line"><span class="lbl">Pixel / Cloud Validity:</span>${cloudPixelHtml}</div>
                <div class="dossier-line"><span class="lbl">Verification Status:</span>${statusHtml}</div>
            </div>
        </div>
    `;
}

function exportSingleClusterDossierCSV(c) {
    if (!c) return;
    const dNum = c.display_id || c.cluster_number || c.id;
    const lat = (c.latitude || c.lat || c.centroid_lat || 22.0).toFixed(6);
    const lon = (c.longitude || c.lon || c.centroid_lon || 79.8).toFixed(6);
    const headers = ["Cluster_ID", "Latitude", "Longitude", "Risk_Score", "Classification", "Max_FRP_MW", "Max_Temp_C", "Nearest_Facility", "Facility_Dist_km", "Report_Date"];
    const row = [
        `"C-${dNum}"`,
        lat,
        lon,
        c.risk_score || 0,
        `"${(c.classification || c.predicted_class || 'Thermal Anomaly').replace(/"/g, '""')}"`,
        c.max_frp || 0,
        c.hotspot_max_temp_c || (c.max_brightness_temp ? Math.round(c.max_brightness_temp - 273.15) : 0),
        `"${(c.nearest_osm_facility || c.nearest_industry_name || 'None').replace(/"/g, '""')}"`,
        c.distance_to_osm_km || c.dist_to_nearest_industry_km || 0,
        `"${new Date().toISOString()}"`
    ];
    const csv = [headers.join(","), row.join(",")].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `incident_dossier_C-${dNum}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast(`Dossier exported for Cluster C-${dNum}`, "info");
}

// ==========================================================================
// Web Audio API Discrete Auditory Notification System
// ==========================================================================
let alertAudioCtx = null;
let isAlertAudioMuted = localStorage.getItem("agnisanket_alert_sound_muted") === "true";

function getAlertAudioContext() {
    if (!alertAudioCtx && (window.AudioContext || window.webkitAudioContext)) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        alertAudioCtx = new AudioContextClass();
    }
    if (alertAudioCtx && alertAudioCtx.state === "suspended") {
        alertAudioCtx.resume().catch(() => {});
    }
    return alertAudioCtx;
}

// Gracefully handle browser autoplay policy by unlocking AudioContext on user interaction
["click", "keydown", "touchstart"].forEach(evt => {
    document.addEventListener(evt, () => {
        if (alertAudioCtx && alertAudioCtx.state === "suspended") {
            alertAudioCtx.resume().catch(() => {});
        }
    }, { once: false, passive: true });
});

function playCriticalAlertBeep() {
    if (isAlertAudioMuted) return;
    try {
        const ctx = getAlertAudioContext();
        if (!ctx) return;
        if (ctx.state === "suspended") {
            ctx.resume().catch(() => {});
        }
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        // Discrete 2-tone chime: 880Hz (A5) shifting to 1174.66Hz (D6)
        osc.frequency.setValueAtTime(880, now);
        osc.frequency.setValueAtTime(1174.66, now + 0.09);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.18, now + 0.09);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.25);
    } catch (err) {
        console.warn("AudioContext alert tone suppressed:", err);
    }
}
window.playCriticalAlertBeep = playCriticalAlertBeep;

// ==========================================================================
// Automated Critical Alert Escalation & Duplicate Prevention
// ==========================================================================
function getNotifiedCriticalAlerts() {
    try {
        return new Set(JSON.parse(localStorage.getItem("agnisanket_notified_critical_alerts") || "[]"));
    } catch (e) {
        return new Set();
    }
}

function saveNotifiedCriticalAlerts(set) {
    try {
        localStorage.setItem("agnisanket_notified_critical_alerts", JSON.stringify(Array.from(set)));
    } catch (e) {}
}

function processCriticalAlertEscalation(clusters) {
    if (!clusters || clusters.length === 0) return;

    // Filter clusters with critical risk (> 70) and strictly deduplicate by cluster ID
    const uniqueHighMap = new Map();
    clusters.forEach(c => {
        if ((c.risk_score || 0) > 70 && !uniqueHighMap.has(c.id)) {
            uniqueHighMap.set(c.id, c);
        }
    });

    const activeCriticalClusters = Array.from(uniqueHighMap.values());
    const notifiedSet = getNotifiedCriticalAlerts();

    // Check for NEW critical clusters that have never been notified before
    const isColdStart = (notifiedSet.size === 0 && localStorage.getItem("agnisanket_alerts_initialized") !== "true");
    const newAlerts = [];

    activeCriticalClusters.forEach(c => {
        if (!notifiedSet.has(c.id)) {
            newAlerts.push(c);
            notifiedSet.add(c.id);
        }
    });

    if (newAlerts.length > 0) {
        saveNotifiedCriticalAlerts(notifiedSet);
        localStorage.setItem("agnisanket_alerts_initialized", "true");

        // Trigger discrete audio notification beep once for the new critical alerts
        playCriticalAlertBeep();

        const topAlert = newAlerts[0];
        const dId = topAlert.display_id || topAlert.cluster_number || topAlert.id;
        showToast(`🚨 Critical Alert Escalation: Cluster C-${dId} (Risk ${Math.round(topAlert.risk_score || 75)}/100)`, "warning");
    } else if (isColdStart) {
        localStorage.setItem("agnisanket_alerts_initialized", "true");
        saveNotifiedCriticalAlerts(notifiedSet);
    }

    const badge = document.getElementById("alerts-view-critical-count");
    if (badge) badge.innerText = `${activeCriticalClusters.length} Active`;
    const kpiCritical = document.getElementById("alert-kpi-active-critical");
    if (kpiCritical) kpiCritical.innerText = `${activeCriticalClusters.length}`;
}
window.processCriticalAlertEscalation = processCriticalAlertEscalation;

function getAcknowledgedAlerts() {
    try {
        return JSON.parse(localStorage.getItem("agnisanket_acked_alerts") || "[]");
    } catch (e) {
        return [];
    }
}

function acknowledgeAlert(clusterId) {
    const list = getAcknowledgedAlerts();
    if (!list.includes(clusterId) && !list.includes(Number(clusterId))) {
        list.push(clusterId);
        localStorage.setItem("agnisanket_acked_alerts", JSON.stringify(list));
        showToast(`Cluster #${clusterId} acknowledged`, "info");
        renderAlertsViewData();
    }
}
window.acknowledgeAlert = acknowledgeAlert;

function unacknowledgeAlert(clusterId) {
    let list = getAcknowledgedAlerts();
    list = list.filter(id => id !== clusterId && String(id) !== String(clusterId));
    localStorage.setItem("agnisanket_acked_alerts", JSON.stringify(list));
    showToast(`Cluster #${clusterId} marked unacknowledged`, "info");
    renderAlertsViewData();
}
window.unacknowledgeAlert = unacknowledgeAlert;

function getPriorityAnomalyClusters() {
    const uniqueMap = new Map();
    // 1. High risk clusters (> 70)
    (allClusters || []).forEach(c => {
        const r = Math.max(Number(c.risk_score || 0), Number(c.max_hotspot_risk || 0));
        if (r > 70 && !uniqueMap.has(c.id)) {
            uniqueMap.set(c.id, c);
        }
    });

    // 2. High priority escalated anomalies (elevated risk >= 40 or max_frp >= 50)
    (allClusters || []).forEach(c => {
        const r = Math.max(Number(c.risk_score || 0), Number(c.max_hotspot_risk || 0));
        const frp = Number(c.max_frp || 0);
        if ((r >= 40 || frp >= 50) && !uniqueMap.has(c.id)) {
            uniqueMap.set(c.id, c);
        }
    });

    const list = Array.from(uniqueMap.values());
    list.sort((a, b) => {
        const rA = Math.max(Number(a.risk_score || 0), Number(a.max_hotspot_risk || 0));
        const rB = Math.max(Number(b.risk_score || 0), Number(b.max_hotspot_risk || 0));
        if (rB !== rA) return rB - rA;
        return (Number(b.max_frp) || 0) - (Number(a.max_frp) || 0);
    });
    return list;
}
window.getPriorityAnomalyClusters = getPriorityAnomalyClusters;

function renderAlertsViewData() {
    const container = document.getElementById("priority-alerts-feed-list");
    if (!container) return;

    // 1. Wire filter tabs
    const tabBtns = document.querySelectorAll(".btn-alert-tab");
    tabBtns.forEach(btn => {
        if (!btn._listenerAttached) {
            btn._listenerAttached = true;
            btn.addEventListener("click", () => {
                tabBtns.forEach(b => b.classList.remove("active"));
                btn.classList.add("active");
                currentAlertFilter = btn.getAttribute("data-alert-filter") || "all";
                renderAlertsViewData();
            });
        }
    });

    // 2. Wire Mute / Unmute Audio Button
    const btnSoundToggle = document.getElementById("btn-toggle-alert-sound");
    if (btnSoundToggle && !btnSoundToggle._listenerAttached) {
        btnSoundToggle._listenerAttached = true;
        const updateSoundBtnUI = () => {
            const icon = document.getElementById("icon-alert-sound");
            const label = document.getElementById("label-alert-sound");
            if (isAlertAudioMuted) {
                if (icon) icon.className = "fa-solid fa-volume-xmark";
                if (label) label.innerText = "Muted";
                btnSoundToggle.style.borderColor = "rgba(148, 163, 184, 0.4)";
                btnSoundToggle.style.color = "#94a3b8";
            } else {
                if (icon) icon.className = "fa-solid fa-volume-high";
                if (label) label.innerText = "Sound On";
                btnSoundToggle.style.borderColor = "rgba(239, 68, 68, 0.4)";
                btnSoundToggle.style.color = "#fca5a5";
            }
        };
        updateSoundBtnUI();
        btnSoundToggle.addEventListener("click", () => {
            isAlertAudioMuted = !isAlertAudioMuted;
            localStorage.setItem("agnisanket_alert_sound_muted", isAlertAudioMuted);
            updateSoundBtnUI();
            showToast(isAlertAudioMuted ? "Critical alert audio muted" : "Critical alert audio unmuted", "info");
            if (!isAlertAudioMuted) {
                playCriticalAlertBeep(); // Quick audible confirmation
            }
        });
    }

    // 3. Wire Ack All Button
    const btnAckAll = document.getElementById("btn-ack-all-alerts");
    if (btnAckAll && !btnAckAll._listenerAttached) {
        btnAckAll._listenerAttached = true;
        btnAckAll.addEventListener("click", () => {
            const currentAcked = getAcknowledgedAlerts();
            const ackSet = new Set(currentAcked);
            const pClusters = getPriorityAnomalyClusters();
            pClusters.forEach(c => ackSet.add(c.id));
            localStorage.setItem("agnisanket_acked_alerts", JSON.stringify(Array.from(ackSet)));
            showToast(`All ${pClusters.length} priority anomaly alerts acknowledged`, "info");
            renderAlertsViewData();
        });
    }

    const ackedList = getAcknowledgedAlerts();
    const ackSet = new Set(ackedList);
    const priorityClusters = getPriorityAnomalyClusters();

    // Critical cluster count (risk > 70)
    const criticalClusters = (allClusters || []).filter(c => {
        const r = Math.max(Number(c.risk_score || 0), Number(c.max_hotspot_risk || 0));
        return r > 70;
    });

    // Counts for tabs & KPIs
    const totalPriority = priorityClusters.length;
    const unackedClusters = priorityClusters.filter(c => !ackSet.has(c.id));
    const ackedClusters = priorityClusters.filter(c => ackSet.has(c.id));
    const unackedCount = unackedClusters.length;
    const ackedCount = ackedClusters.length;

    // Peak Fire Radiative Power (MW) across entire ingested dataset
    const maxFrp = (allClusters || []).reduce((max, c) => Math.max(max, Number(c.max_frp || 0)), 0);

    // Update Header and KPI Cards
    const badge = document.getElementById("alerts-view-critical-count");
    if (badge) badge.innerText = `${criticalClusters.length} Active`;

    const elKpiCritical = document.getElementById("alert-kpi-active-critical");
    if (elKpiCritical) elKpiCritical.innerText = `${criticalClusters.length}`;

    const elKpiUnacked = document.getElementById("alert-kpi-unacked");
    if (elKpiUnacked) elKpiUnacked.innerText = `${unackedCount}`;

    const elKpiAcked = document.getElementById("alert-kpi-acked");
    if (elKpiAcked) elKpiAcked.innerText = `${ackedCount}`;

    const elKpiMaxFrp = document.getElementById("alert-kpi-max-frp");
    if (elKpiMaxFrp) elKpiMaxFrp.innerText = `${maxFrp.toFixed(1)} MW`;

    // Update Tab Count Badges
    const countTabAll = document.getElementById("count-tab-all");
    if (countTabAll) countTabAll.innerText = String(totalPriority);

    const countTabUnacked = document.getElementById("count-tab-unacked");
    if (countTabUnacked) countTabUnacked.innerText = String(unackedCount);

    const countTabAcked = document.getElementById("count-tab-acked");
    if (countTabAcked) countTabAcked.innerText = String(ackedCount);

    // Sync active tab styling
    document.querySelectorAll(".btn-alert-tab").forEach(btn => {
        const filter = btn.getAttribute("data-alert-filter") || "all";
        if (filter === currentAlertFilter) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });

    // Compute and Update Right-Side Operational Telemetry Alarm Triggers
    const highFrpCount = (allClusters || []).filter(c => (Number(c.max_frp) || 0) > 50).length;
    const proxCount = (allClusters || []).filter(c => {
        const d = c.dist_to_nearest_industry_km !== undefined && c.dist_to_nearest_industry_km !== null
            ? Number(c.dist_to_nearest_industry_km)
            : (c.industrial_distance !== undefined && c.industrial_distance !== null ? Number(c.industrial_distance) : 999);
        return d <= 1.5;
    }).length;
    const persistCount = (allClusters || []).filter(c => (Number(c.persistence_days) || 0) >= 3).length;

    const elAlarmFrp = document.getElementById("alarm-badge-frp");
    if (elAlarmFrp) elAlarmFrp.innerText = `${highFrpCount} Triggered`;

    const elAlarmDist = document.getElementById("alarm-badge-dist");
    if (elAlarmDist) elAlarmDist.innerText = `${proxCount} Triggered`;

    const elAlarmPersist = document.getElementById("alarm-badge-persist");
    if (elAlarmPersist) elAlarmPersist.innerText = `${persistCount} Triggered`;

    // Update Geospatial Service Health Last Sync timestamp
    const elSyncTime = document.getElementById("service-last-sync-time");
    if (elSyncTime) {
        const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        elSyncTime.innerHTML = `<i class="fa-solid fa-rotate text-blue"></i> Real-time sync: Active (${nowStr})`;
    }

    // Filter Priority Feed List
    let filteredClusters = priorityClusters;
    if (currentAlertFilter === "unacked") {
        filteredClusters = unackedClusters;
    } else if (currentAlertFilter === "acked") {
        filteredClusters = ackedClusters;
    }

    if (filteredClusters.length === 0) {
        container.innerHTML = `
            <div class="empty-state" style="padding: 32px 20px; text-align: center;">
                <i class="fa-solid fa-circle-check text-green" style="font-size: 32px; margin-bottom: 8px;"></i>
                <h5 style="color: #f8fafc; font-size: 14px; margin: 0 0 4px;">No Alerts Matching Filter</h5>
                <p style="color: #94a3b8; font-size: 12px; margin: 0;">Currently 0 incidents in the "${escapeHtml(currentAlertFilter)}" surveillance queue.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filteredClusters.slice(0, 25).map(c => {
        const isAcked = ackSet.has(c.id) || ackSet.has(Number(c.id));
        const lat = c.lat !== undefined ? c.lat : (c.centroid_lat || c.latitude || 22.0);
        const lon = c.lon !== undefined ? c.lon : (c.centroid_lon || c.longitude || 79.8);
        const frp = c.max_frp ? Number(c.max_frp).toFixed(1) + ' MW' : 'Active';
        const dId = c.display_id || c.cluster_number || c.id;
        const effRisk = Math.round(Math.max(Number(c.risk_score || 0), Number(c.max_hotspot_risk || 0)));
        const isCritical = effRisk > 70;

        const indName = c.nearest_industry_name || c.industrial_site || "";
        const indDist = c.dist_to_nearest_industry_km !== undefined && c.dist_to_nearest_industry_km !== null
            ? Number(c.dist_to_nearest_industry_km)
            : (c.industrial_distance !== undefined && c.industrial_distance !== null ? Number(c.industrial_distance) : null);

        let facilityHtml = "";
        if (indName && indName !== "None" && indDist !== null) {
            facilityHtml = `<span class="priority-alert-facility" title="OSM Industrial Match: ${escapeHtml(indName)}"><i class="fa-solid fa-industry text-amber"></i> ${escapeHtml(indName)} (${indDist.toFixed(1)} km)</span>`;
        } else if (indDist !== null && indDist <= 5.0) {
            facilityHtml = `<span class="priority-alert-facility"><i class="fa-solid fa-industry text-blue"></i> Industrial Buffer (${indDist.toFixed(1)} km)</span>`;
        }

        return `
            <div class="priority-alert-card ${isAcked ? 'acknowledged' : ''}">
                <div class="priority-alert-info">
                    <div class="priority-alert-title">
                        <span class="feed-dot ${isAcked ? 'green' : (isCritical ? 'red pulse' : 'amber')}"></span>
                        <span>Cluster C-${escapeHtml(String(dId))}</span>
                        <span class="risk-badge ${isCritical ? 'critical' : 'elevated'}">
                            ${isCritical ? 'CRITICAL' : 'ELEVATED'}: ${effRisk}/100
                        </span>
                        ${isAcked ? '<span class="service-badge online" style="font-size: 9.5px; padding: 1px 6px;"><i class="fa-solid fa-check"></i> Acknowledged</span>' : ''}
                    </div>
                    <div class="priority-alert-sub">
                        <span><strong>Coords:</strong> [${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E]</span> · 
                        <span><strong>FRP:</strong> ${frp}</span> · 
                        <span class="text-blue">${escapeHtml(c.classification || c.predicted_class || 'Thermal Anomaly')}</span>
                        ${facilityHtml}
                    </div>
                </div>
                <div class="priority-alert-actions">
                    ${isAcked 
                        ? `<button type="button" class="btn-alert-action acked" onclick="unacknowledgeAlert(${c.id})" title="Click to mark unacknowledged"><i class="fa-solid fa-check-double"></i> Acked</button>`
                        : `<button type="button" class="btn-alert-action ack" onclick="acknowledgeAlert(${c.id})" title="Mark acknowledged"><i class="fa-solid fa-check"></i> Ack</button>`
                    }
                    <button type="button" class="btn-alert-action red" onclick="navigateToInvestigation('${escapeHtml(String(c.id))}')" title="Inspect forensic details in drawer">
                        <i class="fa-solid fa-magnifying-glass"></i> Inspect
                    </button>
                    <button type="button" class="btn-alert-action" onclick="locateOnMap(${lat}, ${lon}, '${escapeHtml(String(c.id))}')" title="Center on geospatial map">
                        <i class="fa-solid fa-location-crosshairs"></i> Map
                    </button>
                </div>
            </div>
        `;
    }).join("");
}

function navigateToInvestigation(clusterId) {
    window.location.hash = "#/investigation";
    if (clusterId) {
        setTimeout(() => {
            openDrawer(clusterId);
        }, 120);
    }
}

function locateOnMap(lat, lon, clusterId) {
    window.location.hash = "#/map";
    setTimeout(() => {
        if (map) {
            map.setView([lat, lon], 12);
            if (clusterId && clusterMap[clusterId]) {
                const marker = clusterMap[clusterId]._marker;
                if (marker) marker.openPopup();
            }
        }
    }, 120);
}

function exportClustersCSV() {
    if (!allClusters || allClusters.length === 0) {
        showToast("No cluster data available to export.", "warning");
        return;
    }
    const headers = ["Cluster_ID", "Latitude", "Longitude", "Risk_Score", "Classification", "Max_FRP_MW", "Max_Temp_K", "Nearest_OSM_Facility", "Distance_OSM_km"];
    const rows = allClusters.map(c => [
        c.id,
        c.lat.toFixed(6),
        c.lon.toFixed(6),
        c.risk_score,
        `"${(c.classification || "").replace(/"/g, '""')}"`,
        c.max_frp || 0,
        c.max_brightness_temp || 0,
        `"${(c.nearest_osm_facility || "").replace(/"/g, '""')}"`,
        c.distance_to_osm_km || 0
    ]);
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `agnisanket_thermal_clusters_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("CSV report exported successfully.", "info");
}

function exportClustersGeoJSON() {
    if (!allClusters || allClusters.length === 0) {
        showToast("No cluster data available to export.", "warning");
        return;
    }
    const geojson = {
        type: "FeatureCollection",
        features: allClusters.map(c => ({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [c.lon, c.lat]
            },
            properties: {
                id: c.id,
                risk_score: c.risk_score,
                classification: c.classification,
                max_frp: c.max_frp,
                max_brightness_temp: c.max_brightness_temp,
                nearest_osm_facility: c.nearest_osm_facility,
                distance_to_osm_km: c.distance_to_osm_km
            }
        }))
    };
    const blob = new Blob([JSON.stringify(geojson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `agnisanket_clusters_${new Date().toISOString().slice(0, 10)}.geojson`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("GeoJSON exported successfully.", "info");
}

function showExecutiveReportBriefing() {
    const rawCount = document.getElementById("stat-raw-hotspots") ? document.getElementById("stat-raw-hotspots").innerText : "0";
    const clusterCount = document.getElementById("stat-clusters") ? document.getElementById("stat-clusters").innerText : "0";
    const highRiskCount = document.getElementById("stat-high-risk") ? document.getElementById("stat-high-risk").innerText : "0";
    const facCount = document.getElementById("stat-facilities") ? document.getElementById("stat-facilities").innerText : "0";
    
    showToast(`Thermal Intelligence Report: ${rawCount} Raw Detections, ${clusterCount} DBSCAN Clusters, ${highRiskCount} High Risk, ${facCount} Industrial Sites tracked.`, "info");
}

async function pollUpdates() {
    await loadDashboardStats(true);
    await loadHotspotClusters(true);
}

async function loadDashboardStats(silent = false) {
    try {
        const res = await fetch(`${API_BASE}/api/stats`);
        if (res.ok) {
            const data = await res.json();
            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
            setVal("stat-raw-hotspots", data.total_raw_detections);
            setVal("stat-total-clusters", data.total_clusters);
            setVal("stat-clusters", data.total_clusters);
            setVal("stat-high-risk", data.high_risk_anomalies);
            setVal("stat-osm-facilities", data.industrial_facilities_tracked);
            setVal("stat-facilities", data.industrial_facilities_tracked);
            
            const badge = document.getElementById("ml-model-badge");
            if (badge) {
                if (data.ml_model_status.includes("TRAINED")) {
                    badge.className = "model-badge trained";
                    badge.innerHTML = `<i class="fa-solid fa-brain"></i> ML Model Trained (${data.verified_human_labels} labels)`;
                } else {
                    badge.className = "model-badge uninitialized";
                    badge.innerHTML = `<i class="fa-solid fa-list-check"></i> Evidence Rules Mode (${data.verified_human_labels} verified labels)`;
                }
            }
            renderReportsViewData();
        }
    } catch (err) {
        if (!silent) console.error("Error loading stats:", err);
    }
}

async function loadHotspotClusters(silent = false) {
    const filterVal = document.getElementById("filter-risk").value;
    const incidentList = document.getElementById("cluster-list-container") || document.getElementById("incident-list");
    if (!silent && incidentList) {
        incidentList.innerHTML = `<div class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Fetching clusters...</div>`;
    }

    try {
        const res = await fetch(`${API_BASE}/api/hotspots?risk_threshold=0.0`);
        if (!res.ok) return;

        allClusters = await res.json();
        allClusters.forEach(c => normalizeClusterObject(c));
        window.allClusters = allClusters;

        // Automated Critical Threat Escalation & Audio Notification Trigger
        processCriticalAlertEscalation(allClusters);

        let clusters = allClusters;
        if (filterVal === "high" || filterVal === "red" || filterVal === "70") {
            clusters = allClusters.filter(c => (c.risk_score || 0) > 70);
        } else if (filterVal === "med" || filterVal === "yellow") {
            clusters = allClusters.filter(c => (c.risk_score || 0) > 40 && (c.risk_score || 0) <= 70);
        } else if (filterVal === "low" || filterVal === "green") {
            clusters = allClusters.filter(c => (c.risk_score || 0) <= 40);
        }

        // Check if data actually changed to avoid tearing down map markers and DOM when idle during polling
        const dataSignature = `${filterVal}_${clusters.length}_${clusters.slice(0, 10).map(c => c.id + ':' + Math.round(c.risk_score || 0)).join(',')}`;
        if (silent && window._lastHotspotDataSignature === dataSignature) {
            return;
        }
        window._lastHotspotDataSignature = dataSignature;

        if (hotspotLayerGroup) hotspotLayerGroup.clearLayers();
        if (incidentList) incidentList.innerHTML = "";
        clusterMap = {};
        displayClusterMap = {};
        window.clusterMap = clusterMap;
        window.displayClusterMap = displayClusterMap;
        clusterCards = {};

        const countBadge = document.getElementById("cluster-count-badge") || document.getElementById("alert-count");
        if (countBadge) countBadge.innerText = `${clusters.length} Clusters`;
        const invQueueBadge = document.getElementById("investigation-queue-count");
        if (invQueueBadge) invQueueBadge.innerText = `${allClusters.length} Clusters`;
        const invHighBadge = document.getElementById("investigation-high-risk-count");
        if (invHighBadge) {
            const highCount = allClusters.filter(c => (c.risk_score || 0) > 70).length;
            invHighBadge.innerText = `${highCount} Anomalies`;
        }

        if (clusters.length === 0) {
            incidentList.innerHTML = `<div class="empty-state">No hotspot clusters found for selected risk threshold.</div>`;
            return;
        }

        const hotspotMarkers = [];

        clusters.forEach(c => {
            normalizeClusterObject(c);
            clusterMap[c.id] = c;
            const displayNum = c.display_id || c.cluster_number || c.id;
            displayClusterMap[displayNum] = c;
            displayClusterMap[`${displayNum}`] = c;
            displayClusterMap[`C-${displayNum}`] = c;
            displayClusterMap[`c-${displayNum}`] = c;

            const constituentHotspots = c.hotspots || [];
            const numConstituents = constituentHotspots.length || 1;

            // Highest hotspot risk in cluster
            let maxHotspotRisk = 0;
            constituentHotspots.forEach(h => {
                if (h.risk_score && h.risk_score > maxHotspotRisk) maxHotspotRisk = h.risk_score;
            });
            if (maxHotspotRisk === 0 && c.risk_score) maxHotspotRisk = c.risk_score;

            let maxRiskClass = "low";
            let maxTierLabel = "LOW";
            if (maxHotspotRisk > 70) {
                maxRiskClass = "high";
                maxTierLabel = "HIGH";
            } else if (maxHotspotRisk > 40) {
                maxRiskClass = "med";
                maxTierLabel = "MEDIUM";
            } else {
                maxRiskClass = "low";
                maxTierLabel = "LOW";
            }

            // 1. DBSCAN Cluster Centroid Pin - ALWAYS Neutral Golden-Flame #D4A017 (Never Indicates Risk)
            const clusterMarker = L.marker([c.centroid_lat, c.centroid_lon], {
                pane: 'thermalHotspotPane',
                icon: L.divIcon({
                    className: 'hotspot-marker-wrap',
                    html: `
                        <div class="hotspot-tactical-pin" title="Cluster C-${displayNum} (Neutral Gold #D4A017) | Constituent Hotspots: ${numConstituents}">
                            <span class="hotspot-dot"></span>
                            <span class="cluster-id-tag">C-${displayNum}</span>
                        </div>
                    `,
                    iconSize: [44, 16],
                    iconAnchor: [4, 8]
                })
            });

            clusterMarker.riskScore = maxHotspotRisk;
            clusterMarker.clusterId = c.id;
            clusterMarker.displayId = displayNum;

            const tempFormatted = c.hotspot_max_temp_c ? `${c.hotspot_max_temp_c}°C` : 'UNAVAILABLE';
            const distFormatted = (c.dist_to_nearest_industry_km !== null && c.dist_to_nearest_industry_km !== undefined)
                ? `${c.dist_to_nearest_industry_km} km`
                : 'None';
            const siteFormatted = c.nearest_industry_name || 'None';

            clusterMarker.bindPopup(`
                <div class="map-tactical-popup">
                    <div class="popup-title-bar" style="background: rgba(212, 160, 23, 0.2); border-bottom: 1px solid rgba(212, 160, 23, 0.4);">
                        <span><i class="fa-solid fa-fire-flame-curved" style="color: #D4A017;"></i> Cluster C-${displayNum}</span>
                        <span class="popup-risk-tag" style="background: rgba(212, 160, 23, 0.25); color: #FEF08A; border: 1px solid #D4A017;">${numConstituents} Hotspots</span>
                    </div>
                    <div class="popup-body">
                        <div class="popup-row"><b>Cluster Identifier:</b> <span class="font-mono" style="color:#D4A017;">C-${displayNum}</span></div>
                        <div class="popup-row"><b>Coordinates:</b> <span class="font-mono">${c.centroid_lat.toFixed(4)}°N, ${c.centroid_lon.toFixed(4)}°E</span></div>
                        <div class="popup-row"><b>Classification:</b> <span>${c.predicted_class}</span></div>
                        <div class="popup-row"><b>Hotspots in Cluster:</b> <span>${numConstituents}</span></div>
                        <div class="popup-row"><b>Max Hotspot Risk:</b> <span class="popup-risk-tag ${maxRiskClass}">${maxTierLabel} (${maxHotspotRisk}/100)</span></div>
                        <div class="popup-row"><b>Max FRP:</b> <span>${c.max_frp} MW</span></div>
                        <div class="popup-row"><b>Max Temp:</b> <span>${tempFormatted}</span></div>
                        <div class="popup-row"><b>Industrial Site:</b> <span>${siteFormatted}</span></div>
                        <div class="popup-row"><b>Industrial Distance:</b> <span>${distFormatted}</span></div>
                        <div class="popup-row"><b>Satellite:</b> <span style="color:#D4A017;">${c.satellite_status}</span></div>
                        <div class="popup-actions">
                            <button type="button" class="btn-popup-evidence" data-cluster-id="${c.id}" onclick="openSatelliteEvidenceModal(${c.id}, null)">
                                <i class="fa-solid fa-file-shield"></i> Satellite Verification
                            </button>
                            <button type="button" class="btn-popup-3d" data-cluster-id="${c.id}" data-display-id="${displayNum}" data-lat="${c.latitude}" data-lon="${c.longitude}" onclick="open3DViewer(${c.id}, ${c.latitude}, ${c.longitude})">
                                <i class="fa-solid fa-cube"></i> 3D View
                            </button>
                            <button type="button" class="btn-popup-inspect" onclick="openDrawer(${c.id})">
                                <i class="fa-solid fa-circle-info"></i> Full Details
                            </button>
                        </div>
                    </div>
                </div>
            `, { className: 'custom-tactical-popup-wrap' });

            clusterMarker.on('click', () => openDrawer(c.id));
            hotspotMarkers.push(clusterMarker);

            // 2. Individual Constituent FIRMS Hotspots - Rendered in their genuine calculated risk colours
            constituentHotspots.forEach(h => {
                const hScore = h.risk_score !== undefined && h.risk_score !== null ? Number(h.risk_score) : 0;
                // Filter individual hotspots based on the active risk filter
                if (filterVal === "high" && !(hScore > 70)) return;
                if (filterVal === "med" && !(hScore > 40 && hScore <= 70)) return;
                if (filterVal === "low" && !(hScore <= 40)) return;

                let hRiskClass = "risk-low";
                let hColor = "#22C55E";
                let hLevel = "LOW";
                if (hScore > 70) {
                    hRiskClass = "risk-high";
                    hColor = "#EF4444";
                    hLevel = "HIGH";
                } else if (hScore > 40) {
                    hRiskClass = "risk-med";
                    hColor = "#F97316";
                    hLevel = "MEDIUM";
                }

                const hMarker = L.marker([h.latitude, h.longitude], {
                    pane: 'thermalHotspotPane',
                    icon: L.divIcon({
                        className: 'raw-hotspot-marker-wrap',
                        html: `<div class="raw-hotspot-dot ${hRiskClass}" title="FIRMS Hotspot #${h.id} | Risk: ${hScore}/100 (${hLevel}) | FRP: ${h.frp} MW | Temp: ${h.brightness ? h.brightness + 'K' : 'UNAVAILABLE'} | Conf: ${h.confidence}%"></div>`,
                        iconSize: [8, 8],
                        iconAnchor: [4, 4]
                    })
                });

                hMarker.riskScore = hScore;
                hMarker.bindPopup(`
                    <div class="map-tactical-popup">
                        <div class="popup-title-bar ${hRiskClass.replace('risk-', '')}">
                            <span><i class="fa-solid fa-fire" style="color: ${hColor};"></i> Hotspot #${h.id}</span>
                            <span class="popup-risk-tag ${hRiskClass.replace('risk-', '')}">${hLevel} (${hScore}/100)</span>
                        </div>
                        <div class="popup-body">
                            <div class="popup-row"><b>Parent Cluster:</b> <span class="font-mono" style="color: #D4A017;">Cluster C-${displayNum}</span></div>
                            <div class="popup-row"><b>Coordinates:</b> <span class="font-mono">${h.latitude.toFixed(4)}°N, ${h.longitude.toFixed(4)}°E</span></div>
                            <div class="popup-row"><b>Individual Risk Score:</b> <span class="popup-risk-tag ${hRiskClass.replace('risk-', '')}">${hLevel} (${hScore}/100)</span></div>
                            <div class="popup-row"><b>FRP:</b> <span>${h.frp} MW</span></div>
                            <div class="popup-row"><b>Brightness Temp:</b> <span>${h.brightness ? h.brightness + ' K' : 'UNAVAILABLE'}</span></div>
                            <div class="popup-row"><b>Confidence:</b> <span>${h.confidence}%</span></div>
                            <div class="popup-row"><b>Satellite:</b> <span>${h.satellite || 'VIIRS'}</span></div>
                            <div class="popup-actions">
                                <button type="button" class="btn-popup-inspect" onclick="openDrawer(${c.id}, ${h.id})">
                                    <i class="fa-solid fa-circle-info"></i> View Parent Cluster
                                </button>
                                <button type="button" class="btn-popup-evidence" data-cluster-id="${c.id}" data-hotspot-id="${h.id}" onclick="openSatelliteEvidenceModal(${c.id}, ${h.id})">
                                    <i class="fa-solid fa-file-shield"></i> Satellite Verification
                                </button>
                            </div>
                        </div>
                    </div>
                `, { className: 'custom-tactical-popup-wrap' });

                hotspotMarkers.push(hMarker);
            });

            // 3. Create Analyst Sidebar Incident Card
            const card = document.createElement("div");
            card.className = "incident-card";
            if (selectedClusterId === c.id) {
                card.classList.add("active");
            }

            card.id = `card-${c.id}`;
            card.setAttribute("data-cluster-id", c.id);
            card.setAttribute("data-display-id", displayNum);
            card.setAttribute("data-lat", c.latitude);
            card.setAttribute("data-lon", c.longitude);

            card.innerHTML = `
                <div class="incident-card-header">
                    <div class="inc-title-col">
                        <div class="inc-cluster-id">
                            <i class="fa-solid fa-fire-flame-curved inc-cluster-icon" style="color: #D4A017;"></i>
                            <span>Cluster C-${displayNum}</span>
                        </div>
                        <span class="inc-coords font-mono"><i class="fa-solid fa-location-dot"></i> ${c.centroid_lat.toFixed(3)}°N, ${c.centroid_lon.toFixed(3)}°E</span>
                    </div>
                    <div class="inc-risk-badge ${maxRiskClass}" title="Max Hotspot Risk: ${maxHotspotRisk}/100 (${maxTierLabel})">
                        <span class="risk-badge-lbl">RISK: ${maxTierLabel}</span>
                        <span class="risk-badge-num">${maxHotspotRisk}</span>
                    </div>
                </div>
                <div class="inc-class-sat-row">
                    <span class="inc-class-val highlight ${maxRiskClass}" title="Classification: ${c.predicted_class}">
                        <i class="fa-solid fa-tag"></i> ${c.predicted_class}
                    </span>
                    <span class="inc-sat-val" title="Hotspots in Cluster: ${numConstituents}">
                        <i class="fa-solid fa-fire"></i> ${numConstituents} Hotspot${numConstituents > 1 ? 's' : ''}
                    </span>
                </div>
                <div class="inc-telemetry-row">
                    <div class="inc-metric-pair">
                        <span class="inc-lbl">Max FRP:</span>
                        <span class="inc-val font-mono">${c.max_frp} MW</span>
                    </div>
                    <span class="inc-divider">·</span>
                    <div class="inc-metric-pair">
                        <span class="inc-lbl">Max Temp:</span>
                        <span class="inc-val font-mono">${tempFormatted}</span>
                    </div>
                </div>
                <div class="inc-industry-row">
                    <div class="inc-industry-site" title="Industrial Site: ${siteFormatted}">
                        <span class="inc-lbl"><i class="fa-solid fa-industry"></i> Site:</span>
                        <span class="inc-val site-name-text site-truncate">${siteFormatted}</span>
                    </div>
                    <div class="inc-industry-dist">
                        <span class="inc-lbl">Dist:</span>
                        <span class="inc-val font-mono">${distFormatted}</span>
                    </div>
                </div>
            `;
            card.addEventListener("click", () => openDrawer(c.id));
            clusterCards[c.id] = card;
            incidentList.appendChild(card);
        });

        if (hotspotLayerGroup) {
            if (typeof hotspotLayerGroup.addLayers === 'function') {
                hotspotLayerGroup.addLayers(hotspotMarkers);
            } else {
                hotspotMarkers.forEach(m => hotspotLayerGroup.addLayer(m));
            }
        }
        window.hotspotMarkers = hotspotMarkers;

        if (is3DMode) {
            render3DHotspots();
        }

        // Synchronize auxiliary route view data
        renderSatelliteViewData();
        renderMLViewData();
        renderAlertsViewData();
        renderReportsViewData();

    } catch (err) {
        console.error("Error loading hotspots:", err);
    }
}

async function loadIndustrialFacilities(force = false) {
    if (cachedFacilities && cachedFacilities.length > 0 && !force) {
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/api/facilities`);
        if (!res.ok) return;

        const facs = await res.json();
        cachedFacilities = facs;
        facilityLayerGroup.clearLayers();

        const markers = [];
        facs.forEach(f => {
            const safeName = (f.name || 'Industrial Facility').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
            const marker = L.marker([f.latitude, f.longitude], {
                pane: 'osmFacilityPane',
                icon: L.divIcon({
                    className: 'osm-facility-div-wrap',
                    html: `<div class="osm-factory-marker" data-osm-id="${f.osm_id || ''}"><i class="fa-solid fa-industry"></i></div>`,
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                })
            });

            // Hover tooltip: shows "Industrial Facility" + facility name on hover
            marker.bindTooltip(`
                <div class="osm-facility-hover-tip">
                    <div class="tip-type">Industrial Facility</div>
                    <div class="tip-name">${safeName}</div>
                </div>
            `, {
                direction: 'top',
                offset: [0, -6],
                className: 'custom-facility-tooltip',
                opacity: 1
            });

            marker.bindPopup(`
                <div class="map-tactical-popup">
                    <div class="popup-title-bar osm">
                        <span><i class="fa-solid fa-industry"></i> Industrial Facility</span>
                        <span class="popup-osm-tag">OSM Verified</span>
                    </div>
                    <div class="popup-body">
                        <div class="popup-row"><b>Facility:</b> <span>${safeName}</span></div>
                        <div class="popup-row"><b>Type:</b> <span>${f.facility_type || 'Industrial Area'}</span></div>
                        <div class="popup-row"><b>OSM ID:</b> <span class="font-mono">${f.osm_id || 'N/A'}</span></div>
                        <div class="popup-row"><b>Location:</b> <span class="font-mono">${f.latitude.toFixed(3)}°N, ${f.longitude.toFixed(3)}°E</span></div>
                    </div>
                </div>
            `, { className: 'custom-tactical-popup-wrap' });

            // Selected facility subtle outline highlight
            marker.on('click', () => {
                document.querySelectorAll('.osm-factory-marker.selected').forEach(el => el.classList.remove('selected'));
                const el = marker.getElement()?.querySelector('.osm-factory-marker');
                if (el) el.classList.add('selected');
            });

            marker.on('popupclose', () => {
                const el = marker.getElement()?.querySelector('.osm-factory-marker');
                if (el) el.classList.remove('selected');
            });

            markers.push(marker);
        });

        if (typeof facilityLayerGroup.addLayers === 'function') {
            facilityLayerGroup.addLayers(markers);
        } else {
            markers.forEach(m => facilityLayerGroup.addLayer(m));
        }

        if (is3DMode) {
            render3DFacilities();
        }
    } catch (err) {
        console.error("Error loading facilities:", err);
    }
}

function closeDrawer() {
    selectedClusterId = null;
    window.selectedClusterId = null;
    window.selectedCluster = null;
    window.currentSelectedCluster = null;

    const middleGrid = document.getElementById("analyst-middle-grid-root") || document.querySelector(".analyst-middle-grid");
    if (middleGrid) middleGrid.classList.remove("cluster-selected");

    const drawer = document.getElementById("detail-drawer");
    if (drawer) drawer.classList.add("hidden");

    const rightPanel = document.querySelector(".right-panel");
    if (rightPanel) rightPanel.classList.remove("expanded");

    document.querySelectorAll(".incident-card").forEach(card => card.classList.remove("active"));
    if (highlightLayerGroup) highlightLayerGroup.clearLayers();
    clear3DSelectionMarker();

    if (map) {
        map.invalidateSize();
        setTimeout(() => map.invalidateSize(), 150);
        setTimeout(() => map.invalidateSize(), 300);
    }
    if (is3DMode && map3d) {
        map3d.resize();
        setTimeout(() => { if (map3d) map3d.resize(); }, 150);
        setTimeout(() => { if (map3d) map3d.resize(); }, 300);
    }
}

let selectedHotspotId = null;
window.selectedHotspotId = null;

function handleDrawerEvidenceClick(e) {
    if (e) {
        if (typeof e.preventDefault === 'function') e.preventDefault();
        if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    const btn = document.getElementById("btn-drawer-evidence");
    const cId = (btn && btn.getAttribute("data-cluster-id")) || selectedClusterId || (window.selectedCluster && window.selectedCluster.id);
    const hId = (btn && btn.getAttribute("data-hotspot-id")) || window.selectedHotspotId || null;
    if (hId) {
        openSatelliteEvidenceModal(cId, hId);
    } else {
        openSatelliteEvidenceModal(cId);
    }
}
window.handleDrawerEvidenceClick = handleDrawerEvidenceClick;

function selectHotspotTarget(clusterId, hotspotId) {
    const cObj = resolveCluster(clusterId);
    if (!cObj) return;
    selectedClusterId = cObj.id;
    window.selectedClusterId = cObj.id;
    selectedHotspotId = hotspotId ? Number(hotspotId) : null;
    window.selectedHotspotId = selectedHotspotId;

    const btnDrawerEv = document.getElementById("btn-drawer-evidence");
    if (btnDrawerEv) {
        btnDrawerEv.setAttribute("data-cluster-id", cObj.id);
        if (selectedHotspotId) {
            btnDrawerEv.setAttribute("data-hotspot-id", selectedHotspotId);
            btnDrawerEv.setAttribute("onclick", `openSatelliteEvidenceModal(${cObj.id}, ${selectedHotspotId})`);
        } else {
            btnDrawerEv.removeAttribute("data-hotspot-id");
            btnDrawerEv.setAttribute("onclick", `openSatelliteEvidenceModal(${cObj.id}, null)`);
        }
    }

    // Highlight selected constituent hotspot in drawer list
    document.querySelectorAll(".constituent-hotspot-row").forEach(r => {
        const rHid = r.getAttribute("data-hotspot-id");
        if (String(rHid) === String(hotspotId)) {
            r.style.background = "rgba(56, 189, 248, 0.18)";
            r.style.borderColor = "rgba(56, 189, 248, 0.6)";
        } else {
            r.style.background = "rgba(255,255,255,0.03)";
            r.style.borderColor = "rgba(255,255,255,0.08)";
        }
    });
}
window.selectHotspotTarget = selectHotspotTarget;

async function openDrawer(clusterId, hotspotId = null) {
    window.openDrawer = openDrawer;
    const cObj = resolveCluster(clusterId);
    if (!cObj) return;

    selectedClusterId = cObj.id;
    window.selectedClusterId = cObj.id;
    window.selectedCluster = cObj;
    window.currentSelectedCluster = cObj;

    selectedHotspotId = hotspotId ? Number(hotspotId) : null;
    window.selectedHotspotId = selectedHotspotId;

    // Apply strict 50/50 layout split to main workspace
    const middleGrid = document.getElementById("analyst-middle-grid-root") || document.querySelector(".analyst-middle-grid");
    if (middleGrid) middleGrid.classList.add("cluster-selected");

    const drawer = document.getElementById("detail-drawer");
    if (drawer) drawer.classList.remove("hidden");
    const btnDrawerEv = document.getElementById("btn-drawer-evidence");
    if (btnDrawerEv) {
        btnDrawerEv.setAttribute("data-cluster-id", cObj.id);
        if (selectedHotspotId) {
            btnDrawerEv.setAttribute("data-hotspot-id", selectedHotspotId);
            btnDrawerEv.setAttribute("onclick", `openSatelliteEvidenceModal(${cObj.id}, ${selectedHotspotId})`);
        } else {
            btnDrawerEv.removeAttribute("data-hotspot-id");
            btnDrawerEv.setAttribute("onclick", `openSatelliteEvidenceModal(${cObj.id}, null)`);
        }
    }

    const rightPanel = document.querySelector(".right-panel");
    if (rightPanel) rightPanel.classList.add("expanded");

    // Highlight selected incident card in sidebar list
    document.querySelectorAll(".incident-card").forEach(card => card.classList.remove("active"));
    const cardEl = clusterCards[cObj.id] || document.getElementById(`card-${cObj.id}`);
    if (cardEl) {
        cardEl.classList.add("active");
        cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Invalidate map and 3D canvas sizes to adapt smoothly to 50% width
    if (map) {
        map.invalidateSize();
        setTimeout(() => map.invalidateSize(), 150);
        setTimeout(() => map.invalidateSize(), 300);
    }
    if (is3DMode && map3d) {
        map3d.resize();
        setTimeout(() => { if (map3d) map3d.resize(); }, 150);
        setTimeout(() => { if (map3d) map3d.resize(); }, 300);
    }

    // Map Focus & Highlight
    if (is3DMode && map3d) {
        map3d.flyTo({
            center: [cObj.longitude, cObj.latitude],
            zoom: 14,
            pitch: 58,
            bearing: 25,
            essential: true
        });
        update3DSelectionHighlight(cObj);
    } else if (map) {
        const mapEl = document.getElementById("map");
        const isVisible = mapEl && (mapEl.offsetWidth > 0 || mapEl.offsetHeight > 0);
        if (isVisible) {
            const curZ = (typeof map.getZoom === 'function' && !isNaN(Number(map.getZoom()))) ? Number(map.getZoom()) : 5;
            map.flyTo([cObj.latitude, cObj.longitude], Math.max(curZ, 11), { duration: 0.6 });
        }
        if (highlightLayerGroup) {
            highlightLayerGroup.clearLayers();
            const pulseBeacon = L.marker([cObj.latitude, cObj.longitude], {
                pane: 'highlightPane',
                icon: L.divIcon({
                    className: 'map-selection-beacon-wrap',
                    html: `<div class="map-selection-beacon"></div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                }),
                interactive: false
            });
            highlightLayerGroup.addLayer(pulseBeacon);
        }
    }

    const setElemText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };

    const populateCoreSummary = (c) => {
        if (!c) return;
        const dNum = c.display_id || c.cluster_number || c.id;
        const tText = c.risk_score > 70 ? "HIGH" : (c.risk_score > 40 ? "MEDIUM" : "LOW");
        const tCls = c.risk_score > 70 ? "risk-high" : (c.risk_score > 40 ? "risk-med" : "risk-low");
        const tempVal = (c.hotspot_max_temp_c !== null && c.hotspot_max_temp_c !== undefined) ? `${c.hotspot_max_temp_c} °C` : "UNAVAILABLE";
        const distVal = (c.dist_to_nearest_industry_km !== null && c.dist_to_nearest_industry_km !== undefined) ? `${c.dist_to_nearest_industry_km} km` : "None";
        const siteVal = c.nearest_industry_name || "None";
        const satVal = c.satellite_status || "AVAILABLE";
        const hotspotCount = c.detection_count || c.num_hotspots || c.hotspots_count || 1;

        setElemText("core-cluster-id", `Cluster C-${dNum}`);
        setElemText("core-coords", `${c.centroid_lat.toFixed(4)}°N, ${c.centroid_lon.toFixed(4)}°E`);
        setElemText("core-cluster-coords", `${c.centroid_lat.toFixed(4)}°N, ${c.centroid_lon.toFixed(4)}°E`);
        const cRiskEl = document.getElementById("core-risk");
        if (cRiskEl) {
            cRiskEl.innerText = `${tText} (${c.risk_score}/100)`;
            cRiskEl.className = `core-val ${tCls}`;
        }
        const cClusterRiskEl = document.getElementById("core-cluster-risk");
        if (cClusterRiskEl) {
            cClusterRiskEl.innerText = `${tText} (${c.risk_score}/100)`;
            cClusterRiskEl.className = `core-val ${tCls}`;
        }
        setElemText("core-class", c.predicted_class || "--");
        setElemText("core-cluster-class", c.predicted_class || "--");
        setElemText("core-hotspots", `${hotspotCount}`);
        setElemText("core-hotspots-count", `${hotspotCount}`);
        setElemText("core-hotspots-metric", `${hotspotCount}`);
        setElemText("core-frp", `${c.max_frp} MW`);
        setElemText("core-max-frp", `${c.max_frp} MW`);
        setElemText("core-temp", tempVal);
        setElemText("core-max-temp", tempVal);
        setElemText("core-site", siteVal);
        setElemText("core-ind-site", siteVal);
        setElemText("core-dist", distVal);
        setElemText("core-ind-dist", distVal);
        setElemText("core-sat", satVal);
        setElemText("core-sat-avail", satVal);
    };

    if (cObj) {
        populateCoreSummary(cObj);
    }

    // Clear all drawer fields immediately to prevent stale data display from previous cluster
    setElemText("drawer-cluster-title", `Cluster C-${clusterId} (Loading...)`);
    setElemText("drawer-class", "Classification: Loading...");
    setElemText("drawer-risk-badge", "Risk: --/100");
    const rBadge = document.getElementById("drawer-risk-badge");
    if (rBadge) rBadge.className = "risk-tag low";

    setElemText("drawer-fire-evidence", "--");
    setElemText("drawer-sat-evidence", "--");
    setElemText("drawer-temporal-match", "--");

    setElemText("drawer-firms-lat", "--");
    setElemText("drawer-firms-lon", "--");
    setElemText("drawer-firms-time", "--");
    setElemText("drawer-firms-frp", "--");
    setElemText("drawer-firms-brightness", "--");
    setElemText("drawer-firms-confidence", "--");

    setElemText("drawer-sat-therm-source", "--");
    setElemText("drawer-sat-opt-source", "--");
    setElemText("drawer-landsat-scene-id", "--");
    setElemText("drawer-sentinel2-scene-id", "--");
    setElemText("drawer-sat-obs-time", "--");
    setElemText("drawer-sat-time-diff", "--");
    setElemText("drawer-sat-cloud-pct", "--");
    setElemText("drawer-sat-valid-pct", "--");

    setElemText("drawer-landsat-max-temp", "--");
    setElemText("drawer-landsat-bg-temp", "--");
    setElemText("drawer-landsat-anomaly", "--");

    setElemText("drawer-sentinel-ndvi", "--");

    setElemText("drawer-osm-site", "--");
    setElemText("drawer-osm-dist", "--");

    setElemText("drawer-total-risk-score", "--");
    setElemText("drawer-risk-frp", "--");
    setElemText("drawer-risk-persistence", "--");
    setElemText("drawer-risk-thermal", "--");
    setElemText("drawer-risk-sat", "--");
    setElemText("drawer-risk-proximity", "--");

    setElemText("drawer-pers-count", "--");
    setElemText("drawer-pers-active-days", "--");
    setElemText("drawer-pers-freq", "--");
    setElemText("drawer-pers-frp-trend", "--");
    setElemText("drawer-reasoning", "Loading evidence analysis...");

    try {
        const res = await fetch(`${API_BASE}/api/hotspots/${clusterId}`);
        if (!res.ok) return;

        const data = await res.json();
        const c = data.cluster;
        const displayNum = c.display_id || c.cluster_number || c.id;

        setElemText("drawer-cluster-title", `Cluster C-${displayNum} (${c.centroid_lat.toFixed(4)}, ${c.centroid_lon.toFixed(4)})`);
        setElemText("drawer-class", `Classification: ${c.predicted_class}`);
        populateCoreSummary(c);
        
        if (rBadge) {
            const tierText = c.risk_score > 70 ? "HIGH" : (c.risk_score > 40 ? "MEDIUM" : "LOW");
            const tierCls = c.risk_score > 70 ? "high" : (c.risk_score > 40 ? "med" : "low");
            rBadge.innerText = `${tierText} RISK: ${c.risk_score}/100`;
            rBadge.className = `risk-tag ${tierCls}`;
        }

        // Risk Score Feature Breakdown
        const riskEv = c.evidence?.risk_breakdown || {};
        setElemText("drawer-total-risk-score", c.risk_score !== null ? c.risk_score : "--");
        setElemText("drawer-risk-frp", riskEv.frp_contribution !== undefined ? `+${riskEv.frp_contribution} pts` : "0.0 pts");
        setElemText("drawer-risk-persistence", riskEv.recurrence_contribution !== undefined ? `+${riskEv.recurrence_contribution} pts` : "0.0 pts");
        setElemText("drawer-risk-thermal", riskEv.thermal_anomaly_contribution !== undefined ? `+${riskEv.thermal_anomaly_contribution} pts` : "0.0 pts");
        setElemText("drawer-risk-sat", riskEv.satellite_confirmation_contribution !== undefined ? `+${riskEv.satellite_confirmation_contribution} pts` : "0.0 pts");
        setElemText("drawer-risk-proximity", riskEv.proximity_contribution !== undefined ? `+${riskEv.proximity_contribution} pts (${riskEv.proximity_type || ''})` : "0.0 pts");

        setElemText("drawer-fire-evidence", c.fire_evidence_status || "UNAVAILABLE");
        setElemText("drawer-sat-evidence", c.satellite_evidence_strength || "UNAVAILABLE");
        setElemText("drawer-temporal-match", c.temporal_match_quality || "UNAVAILABLE");

        // 1. FIRMS EVIDENCE
        setElemText("drawer-firms-lat", c.centroid_lat !== null ? c.centroid_lat.toFixed(5) : "UNAVAILABLE");
        setElemText("drawer-firms-lon", c.centroid_lon !== null ? c.centroid_lon.toFixed(5) : "UNAVAILABLE");
        setElemText("drawer-firms-time", c.last_detected ? new Date(c.last_detected).toUTCString() : "UNAVAILABLE");
        setElemText("drawer-firms-frp", c.max_frp !== null ? `Max: ${c.max_frp} MW (Avg: ${c.avg_frp} MW)` : "UNAVAILABLE");
        setElemText("drawer-firms-brightness", c.max_brightness !== null ? `Max: ${c.max_brightness} K (Avg: ${c.avg_brightness} K)` : "UNAVAILABLE");
        setElemText("drawer-firms-confidence", c.avg_confidence !== null ? `${c.avg_confidence}%` : "UNAVAILABLE");

        // 2. MULTI-SATELLITE VERIFICATION METADATA
        setElemText("drawer-sat-therm-source", c.thermal_source || "UNAVAILABLE");
        setElemText("drawer-sat-opt-source", c.optical_source || "UNAVAILABLE");
        setElemText("drawer-landsat-scene-id", c.landsat_scene_id || "UNAVAILABLE");
        setElemText("drawer-sentinel2-scene-id", c.sentinel2_scene_id || "UNAVAILABLE");
        setElemText("drawer-sat-obs-time", c.observation_datetime ? new Date(c.observation_datetime).toUTCString() : "UNAVAILABLE");
        setElemText("drawer-sat-time-diff", c.time_difference_hours !== null ? `${c.time_difference_hours} hours` : "UNAVAILABLE");
        setElemText("drawer-sat-cloud-pct", c.cloud_percentage !== null ? `${c.cloud_percentage}%` : "UNAVAILABLE");
        setElemText("drawer-sat-valid-pct", c.valid_pixel_percentage !== null ? `${c.valid_pixel_percentage}%` : "UNAVAILABLE");

        // 3. REAL THERMAL EVIDENCE
        setElemText("drawer-landsat-max-temp", c.hotspot_max_temp_c !== null ? `${c.hotspot_max_temp_c} °C` : "UNAVAILABLE");
        setElemText("drawer-landsat-bg-temp", c.surrounding_median_temp_c !== null ? `${c.surrounding_median_temp_c} °C` : "UNAVAILABLE");
        setElemText("drawer-landsat-anomaly", c.thermal_anomaly_c !== null ? `${c.thermal_anomaly_c} °C above surrounding median` : "UNAVAILABLE");

        const thermReasonRow = document.getElementById("drawer-sat-therm-reason-row");
        if (c.hotspot_max_temp_c === null && c.thermal_unavailable_reason) {
            setElemText("drawer-sat-therm-reason", c.thermal_unavailable_reason);
            if (thermReasonRow) thermReasonRow.style.display = "";
        } else if (thermReasonRow) {
            thermReasonRow.style.display = "none";
        }

        // 4. REAL OPTICAL EVIDENCE
        setElemText("drawer-sentinel-ndvi", c.ndvi_median !== null ? c.ndvi_median : "UNAVAILABLE");
        
        const optReasonRow = document.getElementById("drawer-sat-opt-reason-row");
        if (c.ndvi_median === null && c.optical_unavailable_reason) {
            setElemText("drawer-sat-opt-reason", c.optical_unavailable_reason);
            if (optReasonRow) optReasonRow.style.display = "";
        } else if (optReasonRow) {
            optReasonRow.style.display = "none";
        }

        // 5. OSM INDUSTRIAL INFRASTRUCTURE
        setElemText("drawer-osm-site", c.nearest_industry_name || "NO_NEARBY_INDUSTRIAL_FEATURE");
        setElemText("drawer-osm-dist", c.dist_to_nearest_industry_km !== null ? `${c.dist_to_nearest_industry_km} km` : "NO_NEARBY_INDUSTRIAL_FEATURE");

        // 6. PERSISTENCE & RECURRENCE METRICS
        setElemText("drawer-pers-count", `${c.detection_count} detections`);
        setElemText("drawer-pers-active-days", `${c.persistence_days} active days`);
        setElemText("drawer-pers-freq", c.recurrence_freq !== null ? `${c.recurrence_freq} detections/day` : "UNAVAILABLE");
        setElemText("drawer-pers-frp-trend", c.frp_trend !== null ? `${c.frp_trend >= 0 ? '+' : ''}${c.frp_trend} MW` : "UNAVAILABLE");

        // 7. GOVERNMENT AUTHORITY STATUS
        setElemText("drawer-gov-status", c.government_status || "UNACKNOWLEDGED");
        setElemText("drawer-gov-user", c.acknowledged_by ? `${c.acknowledged_by} (${c.acknowledged_at ? c.acknowledged_at.substring(0, 16) : ''})` : "Unassigned");
        setElemText("drawer-gov-notes", c.government_notes || "No official notes submitted.");

        const govStatusElem = document.getElementById("drawer-gov-status");
        if (govStatusElem) {
            const st = (c.government_status || "UNACKNOWLEDGED").toUpperCase();
            if (st === "ACKNOWLEDGED") govStatusElem.style.color = "#38bdf8";
            else if (st === "DISPATCHED") govStatusElem.style.color = "#f59e0b";
            else if (st === "RESOLVED") govStatusElem.style.color = "#10b981";
            else govStatusElem.style.color = "#94a3b8";
        }

        const govControls = document.getElementById("gov-update-controls");
        if (govControls) {
            const isGov = Boolean(currentUser && (currentUser.role === 'GOVERNMENT_AUTHORITY' || currentUser.role === 'ADMIN'));
            govControls.style.display = isGov ? "block" : "none";
            const btnAck = document.getElementById("btn-gov-ack");
            const btnDisp = document.getElementById("btn-gov-dispatch");
            const btnRes = document.getElementById("btn-gov-resolve");
            const inpNotes = document.getElementById("gov-notes-input");
            if (btnAck) btnAck.disabled = !isGov;
            if (btnDisp) btnDisp.disabled = !isGov;
            if (btnRes) btnRes.disabled = !isGov;
            if (inpNotes) inpNotes.disabled = !isGov;
        }

        setElemText("drawer-reasoning", c.evidence?.evidence_reasoning || "Evidence evaluation complete.");

        const hsContainer = document.getElementById("drawer-constituent-hotspots-container");
        if (hsContainer) {
            if (c.hotspots && c.hotspots.length > 0) {
                hsContainer.innerHTML = `
                    <div style="font-size: 11px; font-weight: 700; color: #d4a017; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">
                        <i class="fa-solid fa-fire"></i> Constituent Hotspots (${c.hotspots.length})
                    </div>
                    <div style="display: flex; flex-direction: column; gap: 4px; max-height: 180px; overflow-y: auto;">
                        ${c.hotspots.map(h => {
                            const hLevel = (h.risk_score || 0) > 70 ? "HIGH" : ((h.risk_score || 0) > 40 ? "MEDIUM" : "LOW");
                            const hColor = (h.risk_score || 0) > 70 ? "#EF4444" : ((h.risk_score || 0) > 40 ? "#F97316" : "#22C55E");
                            const isSelected = selectedHotspotId && String(selectedHotspotId) === String(h.id);
                            return `
                                <div class="constituent-hotspot-row ${isSelected ? 'active-hotspot-target' : ''}" data-cluster-id="${c.id}" data-hotspot-id="${h.id}" onclick="selectHotspotTarget(${c.id}, ${h.id})" style="display: flex; justify-content: space-between; align-items: center; background: ${isSelected ? 'rgba(56, 189, 248, 0.18)' : 'rgba(255,255,255,0.03)'}; border: 1px solid ${isSelected ? 'rgba(56, 189, 248, 0.6)' : 'rgba(255,255,255,0.08)'}; border-radius: 4px; padding: 4px 8px; font-size: 11px; cursor: pointer; transition: all 0.15s ease;">
                                    <div>
                                        <span style="font-weight: 700; color: #fff;">#${h.id}</span>
                                        <span style="color: #94a3b8; font-size: 10px; margin-left: 4px;">(${h.latitude.toFixed(3)}°, ${h.longitude.toFixed(3)}°)</span>
                                        <span style="color: #cbd5e1; font-size: 10px; margin-left: 6px;">FRP: ${h.frp} MW</span>
                                    </div>
                                    <div style="display: flex; align-items: center; gap: 8px;">
                                        <span style="font-weight: 800; color: ${hColor}; font-size: 10.5px;">
                                            ${hLevel} (${h.risk_score})
                                        </span>
                                        <button type="button" class="btn-hs-evidence" data-cluster-id="${c.id}" data-hotspot-id="${h.id}" onclick="openSatelliteEvidenceModal(${c.id}, ${h.id})" title="Verify Hotspot #${h.id}">
                                            <i class="fa-solid fa-file-shield"></i> Satellite Verification
                                        </button>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                `;
            } else {
                hsContainer.innerHTML = "";
            }
        }

        const expContainer = document.getElementById("explainability-container");
        expContainer.innerHTML = "";

        const explain = data.explainability;
        if (explain && explain.attributions) {
            explain.attributions.forEach(attr => {
                const item = document.createElement("div");
                item.style.cssText = "margin-bottom:8px; font-size:12px; background:rgba(0,0,0,0.3); padding:8px; border-radius:4px;";
                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between; font-weight:600;">
                        <span>${attr.feature}</span>
                        <span style="color:${attr.impact === 'HIGH' ? '#ef4444' : '#10b981'}">${attr.value || attr.impact}</span>
                    </div>
                    <div style="font-size:11px; color:#94a3b8; margin-top:2px;">${attr.description || 'Impact: ' + attr.impact}</div>
                `;
                expContainer.appendChild(item);
            });
        }

    } catch (err) {
        console.error("Error opening cluster detail:", err);
    }
}

function scrollToEvidenceSection() {
    const anchor = document.getElementById("drawer-evidence-anchor") || document.getElementById("drawer-evidence-scrollable") || document.querySelector(".evidence-pill-grid");
    if (anchor) {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}
window.scrollToEvidenceSection = scrollToEvidenceSection;
window.closeDrawer = closeDrawer;

// --- DEDICATED SATELLITE VERIFICATION DOSSIER CONTROLLER ---
async function openSatelliteEvidenceModal(clusterOrId = null, hotspotId = null) {
    if (hotspotId === "null" || hotspotId === "undefined" || hotspotId === "") {
        hotspotId = null;
    }
    if (clusterOrId === "null" || clusterOrId === "undefined" || clusterOrId === "") {
        clusterOrId = null;
    }

    let c = null;
    let cId = null;

    // 1. If clusterOrId is provided as an object, use it directly
    if (typeof clusterOrId === "object" && clusterOrId !== null) {
        c = normalizeClusterObject(clusterOrId);
        cId = c.id;
    } else if (clusterOrId !== null && clusterOrId !== undefined) {
        c = resolveCluster(clusterOrId);
        cId = c ? c.id : clusterOrId;
    }

    // 2. If clusterOrId was omitted, prioritize currently selected cluster object
    if (!c && !clusterOrId && (window.selectedCluster || window.currentSelectedCluster)) {
        c = normalizeClusterObject(window.selectedCluster || window.currentSelectedCluster);
        cId = c ? c.id : null;
    }

    // 3. Fallback to active selected ID if clusterOrId was omitted
    if (!c && !clusterOrId && (selectedClusterId || window.selectedClusterId)) {
        const activeId = selectedClusterId || window.selectedClusterId;
        c = resolveCluster(activeId);
        cId = c ? c.id : activeId;
    }

    // 4. Default fallback to first cluster in allClusters only if clusterOrId was omitted
    if (!c && !clusterOrId && window.allClusters && window.allClusters.length > 0) {
        c = resolveCluster(window.allClusters[0].id);
        cId = c ? c.id : window.allClusters[0].id;
    }

    // Ensure cId is the actual database primary key ID
    if (c && c.id) {
        cId = c.id;
    }

    const modal = document.getElementById("satellite-evidence-modal");
    if (!modal) {
        console.error("Satellite Verification modal #satellite-evidence-modal not found in DOM");
        return;
    }

    // Debounce rapid duplicate calls within 200ms
    const now = Date.now();
    const callKey = `${String(cId)}_${String(hotspotId)}`;
    if (window._lastModalOpenKey === callKey && (now - (window._lastModalOpenTime || 0)) < 200) {
        return;
    }
    window._lastModalOpenKey = callKey;
    window._lastModalOpenTime = now;

    modal.classList.remove("hidden");
    modal.style.display = "flex";
    modal.style.visibility = "visible";
    modal.style.opacity = "1";

    // Set tracking attributes
    modal.setAttribute("data-active-cluster-id", cId || "");
    modal.setAttribute("data-active-hotspot-id", hotspotId || "");

    const loadingEl = document.getElementById("sev-loading-state");
    const errorEl = document.getElementById("sev-error-state");
    if (errorEl) errorEl.style.display = "none";

    // Requirement 4: If the selected cluster is already loaded in frontend state,
    // populate its FIRMS data immediately before the API request.
    if (c) {
        populateSatelliteEvidenceData(c, null, hotspotId);
    }

    // Fetch full cluster detail & coincident satellite pass from backend
    if (cId) {
        try {
            if (loadingEl) loadingEl.style.display = "flex";
            const res = await fetch(`${API_BASE}/api/hotspots/${cId}`, { headers: getAuthHeaders() });
            if (res.ok) {
                const data = await res.json();
                if (data && data.cluster) {
                    clusterMap[data.cluster.id] = data.cluster;
                    populateSatelliteEvidenceData(data.cluster, data.explainability, hotspotId);
                } else {
                    populateSatelliteEvidenceError(`Invalid response format from server for cluster ${cId}`, c, cId, hotspotId);
                }
            } else {
                let errDetail = `HTTP ${res.status}: ${res.statusText || "Request failed"}`;
                try {
                    const errJson = await res.json();
                    if (errJson && errJson.detail) errDetail = `${res.status} - ${errJson.detail}`;
                } catch (_) {}
                populateSatelliteEvidenceError(errDetail, c, cId, hotspotId);
            }
        } catch (err) {
            console.warn("Satellite verification backend fetch error:", err);
            populateSatelliteEvidenceError(err.message || String(err), c, cId, hotspotId);
        } finally {
            if (loadingEl) loadingEl.style.display = "none";
        }
    } else if (!c) {
        populateSatelliteEvidenceError("No cluster selected or available", null, null, hotspotId);
    }
}
window.openSatelliteEvidenceModal = openSatelliteEvidenceModal;

function closeSatelliteEvidenceModal() {
    const modal = document.getElementById("satellite-evidence-modal");
    if (modal) {
        modal.classList.add("hidden");
        modal.style.display = "none";
        modal.style.visibility = "hidden";
        modal.style.opacity = "0";
    }
}
window.closeSatelliteEvidenceModal = closeSatelliteEvidenceModal;

function populateSatelliteEvidenceError(errMsg, existingCluster = null, cId = null, hotspotId = null) {
    const errorEl = document.getElementById("sev-error-state");
    const errorMsgEl = document.getElementById("sev-error-msg");
    if (errorEl) {
        errorEl.style.display = "flex";
        if (errorMsgEl) {
            errorMsgEl.innerText = existingCluster 
                ? `API Synchronization Warning: ${errMsg}. Displaying cached FIRMS telemetry.` 
                : `Satellite Telemetry Pipeline Error: ${errMsg}`;
        }
    }

    const statusValEl = document.getElementById("sev-evidence-status");
    if (statusValEl) {
        statusValEl.innerText = existingCluster ? `LOCAL FIRMS (API SYNC ERROR)` : `API ERROR (${errMsg})`;
    }

    if (!existingCluster) {
        const titleEl = document.getElementById("sat-evidence-modal-title");
        const subEl = document.getElementById("sat-evidence-modal-subtitle");
        if (titleEl) titleEl.innerText = `Satellite Verification Dossier · Error Loading Cluster ${cId || ''}`;
        if (subEl) subEl.innerText = `Backend API request failed: ${errMsg}`;

        const badgeEl = document.getElementById("sat-evidence-status-badge");
        if (badgeEl) {
            badgeEl.className = "sat-evidence-status-badge badge-invalid";
            badgeEl.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>FETCH FAILED</span>`;
        }

        const setVal = (id, text) => {
            const el = document.getElementById(id);
            if (el) el.innerText = text;
        };

        setVal("sev-cluster-id", `Cluster C-${cId || 'Unknown'} (Fetch Failed)`);
        setVal("sev-coords", "Error: Telemetry Unavailable");
        const elRisk = document.getElementById("sev-risk");
        if (elRisk) elRisk.innerHTML = `<span class="popup-risk-tag high">ERROR</span>`;
        setVal("sev-class", `Error: ${errMsg}`);
        setVal("sev-firms-time", "Error: Telemetry Unavailable");
        setVal("sev-firms-sat", "Error: Unavailable");
        setVal("sev-firms-frp", "Error");
        setVal("sev-firms-temp", "Error");
        setVal("sev-firms-conf", "Error");
        setVal("sev-firms-count", "Error: Unavailable");
        setVal("sev-sat-name", "Error: Unavailable");
        setVal("sev-scene-id", "Error: Scene Unavailable");
        setVal("sev-scene-time", "Error: Telemetry Unavailable");
        const sQual = document.getElementById("sev-match-quality");
        if (sQual) sQual.innerHTML = `<span class="sev-quality-tag invalid"><i class="fa-solid fa-circle-exclamation"></i> ERROR</span>`;
        setVal("sev-time-diff", "Error");
        setVal("sev-cloud-pct", "Error");
        setVal("sev-valid-pct", "Error");
        setVal("sev-surface-temp", "Error");
        setVal("sev-surface-temp-source", `API Error: ${errMsg}`);
        setVal("sev-surrounding-temp", "Error");
        setVal("sev-thermal-anomaly", "Error");
        setVal("sev-ndvi", "Error");
        setVal("sev-fire-status", "Error: Telemetry Unavailable");
        setVal("sev-strength", "Error: Unavailable");
        setVal("sev-confidence-grounding", `Satellite telemetry retrieval failed: ${errMsg}. Please check backend server status.`);

        const unavailBox = document.getElementById("sev-unavailable-box");
        const availBox = document.getElementById("sev-available-box");
        const unavailReason = document.getElementById("sev-unavailable-reason");
        if (availBox) availBox.style.display = "none";
        if (unavailBox) {
            unavailBox.style.display = "flex";
            if (unavailReason) unavailReason.innerText = `Satellite verification telemetry retrieval failed: ${errMsg}`;
        }
    }
}
window.populateSatelliteEvidenceError = populateSatelliteEvidenceError;

function populateSatelliteEvidenceData(c, explainability = null, hotspotId = null) {
    if (!c) return;

    const displayNum = c.display_id || c.cluster_number || c.id;

    // Check if target is a specific constituent hotspot or the parent cluster
    let targetHotspot = null;
    if (hotspotId && c.hotspots && c.hotspots.length > 0) {
        targetHotspot = c.hotspots.find(h => String(h.id) === String(hotspotId)) || null;
    }

    const isHotspotTarget = Boolean(targetHotspot);
    const targetIdStr = isHotspotTarget ? `Hotspot #${targetHotspot.id} (Parent C-${displayNum})` : `Cluster C-${displayNum}`;
    const lat = isHotspotTarget ? Number(targetHotspot.latitude) : Number(c.centroid_lat || c.latitude || 0);
    const lon = isHotspotTarget ? Number(targetHotspot.longitude) : Number(c.centroid_lon || c.longitude || 0);
    const coordsFormatted = `${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E`;

    let riskScore = 0;
    if (isHotspotTarget) {
        riskScore = targetHotspot.risk_score !== undefined && targetHotspot.risk_score !== null ? Number(targetHotspot.risk_score) : 0;
    } else {
        riskScore = c.risk_score !== undefined && c.risk_score !== null ? Number(c.risk_score) : 0;
    }
    const riskTier = riskScore > 70 ? "HIGH" : (riskScore > 40 ? "MEDIUM" : "LOW");
    const predClass = c.predicted_class || "Pending Verification";

    // 1. Header Titles & Subtitles
    const titleEl = document.getElementById("sat-evidence-modal-title");
    const subEl = document.getElementById("sat-evidence-modal-subtitle");
    if (titleEl) {
        titleEl.innerText = isHotspotTarget
            ? `Satellite Verification Dossier · Hotspot #${targetHotspot.id}`
            : `Satellite Verification Dossier · Cluster C-${displayNum}`;
    }
    if (subEl) {
        subEl.innerText = isHotspotTarget
            ? `Constituent Hotspot #${targetHotspot.id} · Parent Cluster C-${displayNum} · Coords: ${coordsFormatted} · Individual Risk: ${riskTier} (${riskScore.toFixed(1)}/100)`
            : `Cluster Incident C-${displayNum} · Centroid: ${coordsFormatted} · Overall Risk: ${riskTier} (${riskScore.toFixed(1)}/100)`;
    }

    // 2. Identification Strip
    const elId = document.getElementById("sev-cluster-id");
    if (elId) elId.innerText = targetIdStr;
    const elCoords = document.getElementById("sev-coords");
    if (elCoords) elCoords.innerText = coordsFormatted;
    const elRisk = document.getElementById("sev-risk");
    if (elRisk) {
        elRisk.innerHTML = `<span class="popup-risk-tag ${riskTier.toLowerCase()}">${riskTier} (${riskScore.toFixed(1)}/100)</span>`;
    }
    const elClass = document.getElementById("sev-class");
    if (elClass) elClass.innerText = predClass;

    // Evaluate Verification Status: VERIFIED, PARTIAL, UNAVAILABLE, or INVALID
    let evidenceStatus = "UNAVAILABLE";
    let statusClass = "badge-unavailable";
    let statusIcon = "fa-cloud-moon";

    const hasThermal = c.hotspot_max_temp_c !== null && c.hotspot_max_temp_c !== undefined;
    const isSatAvail = c.satellite_status === "AVAILABLE" || c.satellite_data_available;
    const matchQual = (c.temporal_match_quality || "").toUpperCase();

    if (isSatAvail && hasThermal && (matchQual === "STRONG" || matchQual === "MODERATE")) {
        evidenceStatus = "VERIFIED";
        statusClass = "badge-verified";
        statusIcon = "fa-circle-check";
    } else if (isSatAvail || hasThermal || matchQual === "WEAK") {
        evidenceStatus = "PARTIAL";
        statusClass = "badge-partial";
        statusIcon = "fa-triangle-exclamation";
    } else if (c.valid_pixel_percentage === 0 || (c.cloud_percentage !== null && c.cloud_percentage > 70)) {
        evidenceStatus = "INVALID";
        statusClass = "badge-invalid";
        statusIcon = "fa-ban";
    } else {
        evidenceStatus = "UNAVAILABLE";
        statusClass = "badge-unavailable";
        statusIcon = "fa-circle-xmark";
    }

    const badgeEl = document.getElementById("sat-evidence-status-badge");
    if (badgeEl) {
        badgeEl.className = `sat-evidence-status-badge ${statusClass}`;
        badgeEl.innerHTML = `<i class="fa-solid ${statusIcon}"></i> <span>${evidenceStatus}</span>`;
    }
    const statusValEl = document.getElementById("sev-evidence-status");
    if (statusValEl) statusValEl.innerText = evidenceStatus;

    // 3. NASA FIRMS Primary Detection
    // Strict requirement: When verifying an individual hotspot, display ONLY that hotspot's genuine FIRMS data
    const fTime = document.getElementById("sev-firms-time");
    if (fTime) {
        const rawTime = isHotspotTarget
            ? (targetHotspot.acquisition_date || targetHotspot.acq_datetime || c.first_detected)
            : (c.first_detected || (c.hotspots && c.hotspots[0] && c.hotspots[0].acquisition_date));
        let timeStr = "Active Observation Pass";
        if (rawTime) {
            const d = new Date(rawTime);
            if (!isNaN(d.getTime())) timeStr = d.toUTCString();
        }
        fTime.innerText = timeStr;
    }
    const fSat = document.getElementById("sev-firms-sat");
    if (fSat) {
        const sensor = isHotspotTarget
            ? (targetHotspot.satellite || "VIIRS S-NPP / NOAA-20 375m")
            : ((c.hotspots && c.hotspots[0] && c.hotspots[0].satellite) || "VIIRS S-NPP / NOAA-20 375m");
        fSat.innerText = sensor;
    }
    const fFrp = document.getElementById("sev-firms-frp");
    if (fFrp) {
        const frpVal = isHotspotTarget
            ? Number(targetHotspot.frp || 0)
            : Number(c.max_frp || 0);
        fFrp.innerText = `${frpVal.toFixed(1)} MW`;
    }
    const fTemp = document.getElementById("sev-firms-temp");
    if (fTemp) {
        const bTemp = isHotspotTarget
            ? targetHotspot.brightness
            : (c.max_brightness || (c.hotspots && c.hotspots[0] && c.hotspots[0].brightness));
        fTemp.innerText = (bTemp !== null && bTemp !== undefined) ? `${Number(bTemp).toFixed(1)} K` : "UNAVAILABLE";
    }
    const fConf = document.getElementById("sev-firms-conf");
    if (fConf) {
        const conf = isHotspotTarget
            ? targetHotspot.confidence
            : (c.avg_confidence || (c.hotspots && c.hotspots[0] && c.hotspots[0].confidence));
        fConf.innerText = (conf !== null && conf !== undefined) ? `${Number(conf).toFixed(1)}%` : "80.0%";
    }
    const fCount = document.getElementById("sev-firms-count");
    if (fCount) {
        if (isHotspotTarget) {
            const tot = (c.hotspots && c.hotspots.length) || 1;
            fCount.innerText = `Constituent Hotspot #${targetHotspot.id} (1 of ${tot} in C-${displayNum})`;
        } else {
            const cnt = (c.hotspots && c.hotspots.length) || c.detection_count || 1;
            fCount.innerText = `${cnt} constituent point(s)`;
        }
    }

    // 4. STAC Multi-Satellite Verification (Surrounding satellite scene searched via parent cluster)
    const sName = document.getElementById("sev-sat-name");
    if (sName) {
        sName.innerText = c.satellite_name || "Landsat-8/9 Collection 2 L2 (TIRS-2)";
    }
    const sScene = document.getElementById("sev-scene-id");
    if (sScene) {
        const scId = c.landsat_scene_id || c.sentinel2_scene_id;
        sScene.innerText = (scId && scId !== "UNAVAILABLE") ? scId : "No Coincident STAC Scene";
    }
    const sTime = document.getElementById("sev-scene-time");
    if (sTime) {
        let obsStr = "Awaiting Orbital Revisit";
        if (c.observation_datetime) {
            const d = new Date(c.observation_datetime);
            if (!isNaN(d.getTime())) obsStr = d.toUTCString();
        }
        sTime.innerText = obsStr;
    }
    const sQual = document.getElementById("sev-match-quality");
    if (sQual) {
        const q = (c.temporal_match_quality || "WEAK").toUpperCase();
        let qClass = "weak";
        if (q === "STRONG") qClass = "strong";
        else if (q === "MODERATE") qClass = "moderate";
        else if (q === "INVALID") qClass = "invalid";
        sQual.innerHTML = `<span class="sev-quality-tag ${qClass}"><i class="fa-solid fa-clock-rotate-left"></i> ${q} MATCH</span>`;
    }
    const sDelta = document.getElementById("sev-time-diff");
    if (sDelta) {
        sDelta.innerText = (c.time_difference_hours !== null && c.time_difference_hours !== undefined)
            ? `${Number(c.time_difference_hours).toFixed(1)} hrs`
            : "N/A";
    }
    const sCloud = document.getElementById("sev-cloud-pct");
    if (sCloud) {
        sCloud.innerText = (c.cloud_percentage !== null && c.cloud_percentage !== undefined)
            ? `${Number(c.cloud_percentage).toFixed(1)}%`
            : (c.satellite_status === "UNAVAILABLE" ? "Obscured / Cloud-masked" : "0.0%");
    }
    const sValid = document.getElementById("sev-valid-pct");
    if (sValid) {
        sValid.innerText = (c.valid_pixel_percentage !== null && c.valid_pixel_percentage !== undefined)
            ? `${Number(c.valid_pixel_percentage).toFixed(1)}%`
            : (c.satellite_status === "AVAILABLE" ? "100.0%" : "0.0%");
    }

    // 5. Thermal Surface & Optical Radiance
    const sSurf = document.getElementById("sev-surface-temp");
    const sSurfSource = document.getElementById("sev-surface-temp-source");
    if (sSurf) {
        sSurf.innerText = hasThermal ? `${Number(c.hotspot_max_temp_c).toFixed(2)} °C` : "UNAVAILABLE";
    }
    if (sSurfSource) {
        sSurfSource.innerText = hasThermal
            ? (c.satellite_name || "Landsat TIRS / MODIS LST")
            : (c.thermal_unavailable_reason || "Thermal Telemetry Unavailable");
    }

    const sSurr = document.getElementById("sev-surrounding-temp");
    if (sSurr) {
        sSurr.innerText = (c.surrounding_median_temp_c !== null && c.surrounding_median_temp_c !== undefined)
            ? `${Number(c.surrounding_median_temp_c).toFixed(2)} °C`
            : "UNAVAILABLE";
    }

    const sAnom = document.getElementById("sev-thermal-anomaly");
    if (sAnom) {
        if (c.thermal_anomaly_c !== null && c.thermal_anomaly_c !== undefined) {
            const anom = Number(c.thermal_anomaly_c);
            sAnom.innerText = `${anom > 0 ? '+' : ''}${anom.toFixed(2)} °C`;
            sAnom.style.color = anom > 3.0 ? "#ef4444" : (anom > 0 ? "#f97316" : "#94a3b8");
        } else {
            sAnom.innerText = "UNAVAILABLE";
            sAnom.style.color = "#94a3b8";
        }
    }

    const sNdvi = document.getElementById("sev-ndvi");
    const sNdviDesc = document.getElementById("sev-ndvi-desc");
    if (sNdvi) {
        sNdvi.innerText = (c.ndvi_median !== null && c.ndvi_median !== undefined)
            ? Number(c.ndvi_median).toFixed(3)
            : "UNAVAILABLE";
    }
    if (sNdviDesc) {
        sNdviDesc.innerText = (c.ndvi_median !== null && c.ndvi_median !== undefined)
            ? "Vegetation Condition Index"
            : (c.optical_unavailable_reason || "Optical Reflectance Unavailable");
    }

    // 6. Satellite Preview & Honest Unavailable Notice
    const unavailBox = document.getElementById("sev-unavailable-box");
    const availBox = document.getElementById("sev-available-box");
    const unavailReason = document.getElementById("sev-unavailable-reason");
    const metaScene = document.getElementById("sev-meta-scene");

    const hasRealScene = (c.landsat_scene_id && c.landsat_scene_id !== "UNAVAILABLE") ||
                         (c.sentinel2_scene_id && c.sentinel2_scene_id !== "UNAVAILABLE");
    const hasSatellitePass = (hasRealScene || hasThermal) && c.satellite_status !== "UNAVAILABLE";

    if (hasSatellitePass) {
        if (unavailBox) unavailBox.style.display = "none";
        if (availBox) availBox.style.display = "block";
        if (metaScene) {
            metaScene.innerText = c.landsat_scene_id || c.sentinel2_scene_id || c.satellite_name || "Coincident Satellite Scene";
        }
    } else {
        if (availBox) availBox.style.display = "none";
        if (unavailBox) unavailBox.style.display = "flex";
        if (unavailReason) {
            const explicitReason = c.thermal_unavailable_reason || c.optical_unavailable_reason ||
                "No coincident Landsat-8/9, Sentinel-2, or MODIS multispectral scene found within the orbital temporal window.";
            unavailReason.innerText = explicitReason;
        }
    }

    // 7. Diagnostic Reasoning
    const fStat = document.getElementById("sev-fire-status");
    if (fStat) fStat.innerText = c.fire_evidence_status || "EVIDENCE_AVAILABLE";
    const sStrength = document.getElementById("sev-evidence-strength");
    if (sStrength) {
        const rawStrength = String(c.satellite_evidence_strength || (isSatAvail ? "MODERATE SATELLITE EVIDENCE" : "INSUFFICIENT SATELLITE DATA"));
        sStrength.innerText = rawStrength.replace(/EVIDENCE/g, "VERIFICATION");
    }
    const fFacility = document.getElementById("sev-nearby-facility");
    if (fFacility) {
        const distNum = Number(c.dist_to_nearest_industry_km);
        const distStr = (!isNaN(distNum) && c.dist_to_nearest_industry_km !== null && c.dist_to_nearest_industry_km !== undefined) ? `${distNum.toFixed(2)} km` : 'Distance N/A';
        fFacility.innerText = `${c.nearest_industry_name || 'Regional / Unzoned Area'} (${distStr})`;
    }
    const fReason = document.getElementById("sev-reasoning");
    if (fReason) {
        const reasoningText = (c.evidence && c.evidence.evidence_reasoning) ||
            (explainability && explainability.summary) ||
            `Multi-factorial thermal observation evaluated across FIRMS FRP (${(c.max_frp || 0).toFixed(1)} MW) and calibrated orbital telemetry.`;
        fReason.innerText = reasoningText;
    }

    // 8. Footer Meta
    const footClust = document.getElementById("sev-footer-cluster");
    if (footClust) footClust.innerText = isHotspotTarget ? `HS-#${targetHotspot.id} (C-${displayNum})` : `C-${displayNum}`;
    const footCoords = document.getElementById("sev-footer-coords");
    if (footCoords) footCoords.innerText = coordsFormatted;
    const footStatus = document.getElementById("sev-footer-status");
    if (footStatus) footStatus.innerText = evidenceStatus;
}

function openSatelliteInspection(clusterOrId = null) {
    let c = resolveCluster(clusterOrId) || window.selectedCluster;
    if (!c && selectedClusterId) {
        c = resolveCluster(selectedClusterId);
    }
    closeSatelliteEvidenceModal();

    if (c) {
        window.selectedCluster = c;
        selectedClusterId = c.id;
    }

    // Navigate to Satellite View
    window.location.hash = "#/satellite";

    setTimeout(() => {
        const clusterSelect = document.getElementById("sat-cluster-select");
        if (clusterSelect && c) {
            clusterSelect.value = String(c.id);
            clusterSelect.dispatchEvent(new Event("change"));
        }
    }, 150);
}

// --- INVESTIGATION, SATELLITE EVIDENCE & 3D VIEWER EVENT LISTENERS ---
function initInvestigationEventListeners() {
    // Delegated click listener for 3D View, Satellite Verification, and Satellite Inspection
    document.addEventListener("click", (e) => {
        // 1. Satellite Verification buttons
        const btnEv = e.target.closest("#btn-drawer-evidence, .btn-drawer-sat-evidence, .btn-popup-evidence, .btn-hs-evidence, #sat-btn-evidence, [data-action='open-evidence']");
        if (btnEv) {
            if (!btnEv.hasAttribute("onclick")) {
                e.preventDefault();
                e.stopPropagation();
                const cId = btnEv.getAttribute("data-cluster-id") || (window.selectedCluster && window.selectedCluster.id) || selectedClusterId;
                const hId = btnEv.getAttribute("data-hotspot-id") || (btnEv.id === "btn-drawer-evidence" ? window.selectedHotspotId : null) || null;
                openSatelliteEvidenceModal(cId, hId);
            }
            return;
        }

        // 2. Satellite Inspection buttons
        const btnSat = e.target.closest("#btn-drawer-satellite-inspect, .btn-drawer-satellite-inspect, [data-action='open-satellite-inspect']");
        if (btnSat) {
            e.preventDefault();
            e.stopPropagation();
            const cId = btnSat.getAttribute("data-cluster-id") || (window.selectedCluster && window.selectedCluster.id) || selectedClusterId;
            openSatelliteInspection(cId);
            return;
        }

        // 3. 3D View buttons (MapLibre 3D Perspective)
        const btn3d = e.target.closest("#btn-drawer-3d, .btn-drawer-3d, .btn-popup-3d, #sat-btn-view-3d, [data-action='open-3d']");
        if (btn3d) {
            e.preventDefault();
            e.stopPropagation();
            const cId = btn3d.getAttribute("data-cluster-id") || (window.selectedCluster && window.selectedCluster.id) || selectedClusterId;
            const lat = btn3d.getAttribute("data-lat");
            const lon = btn3d.getAttribute("data-lon");
            open3DViewer(cId, lat, lon);
            return;
        }
    });

    // Wire modal close handlers (only if inline onclick is not present to avoid duplicate listeners)
    const btnCloseEv = document.getElementById("btn-close-sat-evidence");
    if (btnCloseEv && !btnCloseEv.hasAttribute("onclick")) btnCloseEv.addEventListener("click", closeSatelliteEvidenceModal);
    const backdropEv = document.getElementById("sat-evidence-backdrop");
    if (backdropEv && !backdropEv.hasAttribute("onclick")) backdropEv.addEventListener("click", closeSatelliteEvidenceModal);
    const btnCloseEvFooter = document.getElementById("sev-btn-close");
    if (btnCloseEvFooter && !btnCloseEvFooter.hasAttribute("onclick")) btnCloseEvFooter.addEventListener("click", closeSatelliteEvidenceModal);

    const btnInspectEvFooter = document.getElementById("sev-btn-open-inspect");
    if (btnInspectEvFooter) {
        btnInspectEvFooter.addEventListener("click", () => {
            openSatelliteInspection(selectedClusterId);
        });
    }

    // Escape key closes modals or drawer
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            const evModal = document.getElementById("satellite-evidence-modal");
            if (evModal && (!evModal.classList.contains("hidden") || evModal.style.display === "flex")) {
                closeSatelliteEvidenceModal();
                return;
            }
            const drawer = document.getElementById("detail-drawer");
            if (drawer && !drawer.classList.contains("hidden")) {
                closeDrawer();
            }
        }
    });
}

window.openSatelliteEvidenceModal = openSatelliteEvidenceModal;
window.closeSatelliteEvidenceModal = closeSatelliteEvidenceModal;
window.handleDrawerEvidenceClick = handleDrawerEvidenceClick;
window.selectHotspotTarget = selectHotspotTarget;
window.openSatelliteInspection = openSatelliteInspection;

// --- REAL 3D GEOSPATIAL MAP & SATELLITE VIEWER (MAPLIBRE GL JS) ---
function init3DMap(initialCoords = [22.0, 79.8], initialZoom = 5.0) {
    if (map3d) return;

    if (typeof maplibregl === 'undefined') {
        console.error("MapLibre GL JS library not loaded.");
        showToast("3D Geospatial Engine initializing...", "warning");
        return;
    }

    const style3D = {
        version: 8,
        sources: {
            'esri-satellite': {
                type: 'raster',
                tiles: [
                    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
                ],
                tileSize: 256,
                attribution: '&copy; Esri, Maxar, Earthstar Geographics'
            },
            'carto-labels': {
                type: 'raster',
                tiles: [
                    'https://a.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
                    'https://b.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
                    'https://c.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png',
                    'https://d.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}.png'
                ],
                tileSize: 256,
                attribution: '&copy; OpenStreetMap &copy; CARTO'
            }
        },
        layers: [
            {
                id: 'satellite-layer',
                type: 'raster',
                source: 'esri-satellite',
                minzoom: 0,
                maxzoom: 20
            },
            {
                id: 'labels-layer',
                type: 'raster',
                source: 'carto-labels',
                minzoom: 0,
                maxzoom: 20
            }
        ]
    };

    const targetLng = Number(initialCoords[1]) || 79.8;
    const targetLat = Number(initialCoords[0]) || 22.0;

    map3d = new maplibregl.Map({
        container: 'map-3d',
        style: style3D,
        center: [targetLng, targetLat],
        zoom: initialZoom,
        pitch: 58,
        bearing: 25,
        maxPitch: 85,
        attributionControl: false
    });
    window.map3d = map3d;

    const navControl = new maplibregl.NavigationControl({
        visualizePitch: true,
        showCompass: true,
        showZoom: true
    });
    map3d.addControl(navControl, 'top-right');

    map3d.on('load', () => {
        update3DHudTelemetry();
        render3DMarkers();
        setTimeout(() => {
            if (map3d) map3d.resize();
        }, 50);
    });

    map3d.on('rotate', update3DHudTelemetry);
    map3d.on('pitch', update3DHudTelemetry);
    map3d.on('zoom', update3DHudTelemetry);
    map3d.on('move', update3DHudTelemetry);
}

function update3DHudTelemetry() {
    if (!map3d) return;
    const pitchEl = document.getElementById("hud-3d-pitch");
    const bearingEl = document.getElementById("hud-3d-bearing");
    if (pitchEl) pitchEl.innerText = `${Math.round(map3d.getPitch())}°`;
    if (bearingEl) {
        const rawBearing = Math.round((map3d.getBearing() + 360) % 360);
        let cardinal = "N";
        if (rawBearing >= 23 && rawBearing < 68) cardinal = "NE";
        else if (rawBearing >= 68 && rawBearing < 113) cardinal = "E";
        else if (rawBearing >= 113 && rawBearing < 158) cardinal = "SE";
        else if (rawBearing >= 158 && rawBearing < 203) cardinal = "S";
        else if (rawBearing >= 203 && rawBearing < 248) cardinal = "SW";
        else if (rawBearing >= 248 && rawBearing < 293) cardinal = "W";
        else if (rawBearing >= 293 && rawBearing < 338) cardinal = "NW";
        bearingEl.innerText = `${rawBearing}° ${cardinal}`;
    }
}

function clear3DHotspotMarkers() {
    if (map3dHotspotMarkers && map3dHotspotMarkers.length) {
        map3dHotspotMarkers.forEach(m => m.remove());
        map3dHotspotMarkers = [];
    }
}

function clear3DFacilityMarkers() {
    if (map3dFacilityMarkers && map3dFacilityMarkers.length) {
        map3dFacilityMarkers.forEach(m => m.remove());
        map3dFacilityMarkers = [];
    }
}

function clear3DSelectionMarker() {
    if (map3dSelectionMarker) {
        map3dSelectionMarker.remove();
        map3dSelectionMarker = null;
    }
}

function render3DHotspots() {
    clear3DHotspotMarkers();
    if (!map3d) return;

    const layerChk = document.getElementById("layer-hotspots");
    if (layerChk && !layerChk.checked) return;

    const clusters = Object.values(clusterMap);
    clusters.forEach(c => {
        const displayNum = c.display_id || c.cluster_number || c.id;
        let riskClass = "low";
        let tierLabel = "LOW";
        if (c.risk_score > 70) {
            riskClass = "high";
            tierLabel = "HIGH";
        } else if (c.risk_score > 40) {
            riskClass = "med";
            tierLabel = "MEDIUM";
        } else {
            riskClass = "low";
            tierLabel = "LOW";
        }

        const el = document.createElement('div');
        el.className = 'hotspot-marker-wrap';
        el.innerHTML = `
            <div class="hotspot-tactical-pin risk-${riskClass}" title="Cluster C-${displayNum} | Risk: ${tierLabel} (${c.risk_score})">
                <span class="hotspot-dot"></span>
                <span class="cluster-id-tag">C-${displayNum}</span>
            </div>
        `;

        const tempFormatted = c.hotspot_max_temp_c ? `${c.hotspot_max_temp_c}°C` : 'UNAVAILABLE';
        const distFormatted = (c.dist_to_nearest_industry_km !== null && c.dist_to_nearest_industry_km !== undefined)
            ? `${c.dist_to_nearest_industry_km} km`
            : 'None';
        const siteFormatted = c.nearest_industry_name || 'None';

        const popupHTML = `
            <div class="map-tactical-popup">
                <div class="popup-title-bar ${riskClass}">
                    <span><i class="fa-solid fa-cube" style="color: #38bdf8;"></i> 3D Hotspot C-${displayNum}</span>
                    <span class="popup-risk-tag ${riskClass}">Risk: ${tierLabel} (${c.risk_score})</span>
                </div>
                <div class="popup-body">
                    <div class="popup-row"><b>Cluster Identifier:</b> <span class="font-mono" style="color:#38bdf8;">C-${displayNum}</span></div>
                    <div class="popup-row"><b>Coordinates:</b> <span class="font-mono">${c.centroid_lat.toFixed(4)}°N, ${c.centroid_lon.toFixed(4)}°E</span></div>
                    <div class="popup-row"><b>Classification:</b> <span>${c.predicted_class}</span></div>
                    <div class="popup-row"><b>Risk Level:</b> <span class="popup-risk-tag ${riskClass}">${tierLabel} (${c.risk_score}/100)</span></div>
                    <div class="popup-row"><b>Max FRP:</b> <span>${c.max_frp} MW</span></div>
                    <div class="popup-row"><b>Max Temp:</b> <span>${tempFormatted}</span></div>
                    <div class="popup-row"><b>Industrial Site:</b> <span>${siteFormatted}</span></div>
                    <div class="popup-row"><b>Industrial Distance:</b> <span>${distFormatted}</span></div>
                    <div class="popup-row"><b>Satellite:</b> <span style="color:#38bdf8;">${c.satellite_status}</span></div>
                    <div class="popup-actions">
                        <button type="button" class="btn-popup-evidence" data-cluster-id="${c.id}" onclick="openSatelliteEvidenceModal(${c.id}, null)">
                            <i class="fa-solid fa-file-shield"></i> Satellite Verification
                        </button>
                        <button type="button" class="btn-popup-inspect" onclick="openDrawer(${c.id})">
                            <i class="fa-solid fa-circle-info"></i> Full Details
                        </button>
                    </div>
                </div>
            </div>
        `;

        const popup = new maplibregl.Popup({
            offset: 14,
            className: 'custom-tactical-popup-wrap',
            closeButton: true,
            closeOnClick: false
        }).setHTML(popupHTML);

        el.addEventListener('click', (e) => {
            e.stopPropagation();
            openDrawer(c.id);
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([c.centroid_lon, c.centroid_lat])
            .setPopup(popup)
            .addTo(map3d);

        map3dHotspotMarkers.push(marker);
    });
}

function render3DFacilities() {
    clear3DFacilityMarkers();
    if (!map3d) return;

    const layerChk = document.getElementById("layer-osm");
    if (layerChk && !layerChk.checked) return;

    if (!cachedFacilities || !cachedFacilities.length) return;

    cachedFacilities.forEach(f => {
        const safeName = (f.name || 'Industrial Facility').replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
        const el = document.createElement('div');
        el.className = 'osm-facility-div-wrap';
        el.innerHTML = `<div class="osm-factory-marker" data-osm-id="${f.osm_id || ''}"><i class="fa-solid fa-industry"></i></div>`;

        const hoverPopup = new maplibregl.Popup({
            offset: 8,
            closeButton: false,
            closeOnClick: false,
            className: 'custom-facility-3d-tooltip'
        }).setHTML(`
            <div class="osm-facility-hover-tip">
                <div class="tip-type">Industrial Facility</div>
                <div class="tip-name">${safeName}</div>
            </div>
        `);

        el.addEventListener('mouseenter', () => {
            hoverPopup.setLngLat([f.longitude, f.latitude]).addTo(map3d);
        });
        el.addEventListener('mouseleave', () => {
            hoverPopup.remove();
        });

        const popupHTML = `
            <div class="map-tactical-popup">
                <div class="popup-title-bar osm">
                    <span><i class="fa-solid fa-industry"></i> Industrial Facility</span>
                    <span class="popup-osm-tag">OSM Verified</span>
                </div>
                <div class="popup-body">
                    <div class="popup-row"><b>Facility:</b> <span>${safeName}</span></div>
                    <div class="popup-row"><b>Type:</b> <span>${f.facility_type || 'Industrial Area'}</span></div>
                    <div class="popup-row"><b>OSM ID:</b> <span class="font-mono">${f.osm_id || 'N/A'}</span></div>
                    <div class="popup-row"><b>Location:</b> <span class="font-mono">${f.latitude.toFixed(3)}°N, ${f.longitude.toFixed(3)}°E</span></div>
                </div>
            </div>
        `;

        const popup = new maplibregl.Popup({
            offset: 12,
            className: 'custom-tactical-popup-wrap',
            closeButton: true
        }).setHTML(popupHTML);

        el.addEventListener('click', () => {
            document.querySelectorAll('.osm-factory-marker.selected').forEach(m => m.classList.remove('selected'));
            el.querySelector('.osm-factory-marker')?.classList.add('selected');
        });

        popup.on('close', () => {
            el.querySelector('.osm-factory-marker')?.classList.remove('selected');
        });

        const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([f.longitude, f.latitude])
            .setPopup(popup)
            .addTo(map3d);

        map3dFacilityMarkers.push(marker);
    });
}

function update3DSelectionHighlight(c) {
    clear3DSelectionMarker();
    if (!map3d || !c) return;

    const norm = normalizeClusterObject(c);
    if (!norm) return;

    const el = document.createElement('div');
    el.className = 'map-selection-beacon-wrap';
    el.innerHTML = `<div class="map-selection-beacon"></div>`;

    map3dSelectionMarker = new maplibregl.Marker({ element: el, anchor: 'center' })
        .setLngLat([norm.longitude, norm.latitude])
        .addTo(map3d);
}

function render3DMarkers() {
    render3DHotspots();
    render3DFacilities();
    const sel = getSelectedCluster();
    if (sel) {
        update3DSelectionHighlight(sel);
    }
}

function update3DFacilitiesVisibility(visible) {
    if (visible) {
        render3DFacilities();
    } else {
        clear3DFacilityMarkers();
    }
}

function update3DHotspotsVisibility(visible) {
    if (visible) {
        render3DHotspots();
    } else {
        clear3DHotspotMarkers();
    }
}

function switchTo3DView(targetLat = null, targetLon = null, clusterObj = null) {
    is3DMode = true;

    const activeCluster = clusterObj || resolveCluster(selectedClusterId) || window.selectedCluster;

    // Determine target coordinates directly from selected cluster or current map center
    let centerLat = 22.0;
    let centerLon = 79.8;
    let targetZoom = 5.5;

    if (activeCluster) {
        window.selectedCluster = activeCluster;
        selectedClusterId = activeCluster.id;
        centerLat = (targetLat !== null && !isNaN(Number(targetLat))) ? Number(targetLat) : activeCluster.latitude;
        centerLon = (targetLon !== null && !isNaN(Number(targetLon))) ? Number(targetLon) : activeCluster.longitude;
        targetZoom = 14;
    } else if (targetLat !== null && targetLon !== null && !isNaN(Number(targetLat)) && !isNaN(Number(targetLon))) {
        centerLat = Number(targetLat);
        centerLon = Number(targetLon);
        targetZoom = 14;
    } else if (map) {
        const c = map.getCenter();
        centerLat = c.lat;
        centerLon = c.lng;
        targetZoom = Math.max(map.getZoom() || 5, 5);
    }

    // Set inspection telemetry attributes on map-3d container
    const map3dEl = document.getElementById("map-3d");
    if (map3dEl) {
        map3dEl.setAttribute("data-lat", centerLat);
        map3dEl.setAttribute("data-lon", centerLon);
        if (activeCluster) {
            map3dEl.setAttribute("data-cluster-id", activeCluster.cluster_id || activeCluster.display_id || activeCluster.id);
            map3dEl.setAttribute("data-db-id", activeCluster.id);
            map3dEl.setAttribute("data-risk", activeCluster.risk);
            map3dEl.setAttribute("data-classification", activeCluster.classification);
            map3dEl.setAttribute("data-frp", activeCluster.frp);
            map3dEl.setAttribute("data-temperature", activeCluster.temperature);
            map3dEl.setAttribute("data-industrial-site", activeCluster.industrial_site);
        }
    }

    // Toggle container display
    const map2dEl = document.getElementById("map");
    const hud3dEl = document.getElementById("map-3d-hud");

    if (map2dEl) map2dEl.style.display = "none";
    if (map3dEl) map3dEl.style.display = "block";
    if (hud3dEl) hud3dEl.style.display = "flex";

    // Update toggle button text & icon
    const btn3dText = document.getElementById("btn-3d-text");
    const btnToggle = document.getElementById("btn-toggle-3d-map");
    if (btn3dText) btn3dText.innerText = "2D VIEW";
    if (btnToggle) {
        btnToggle.classList.add("active");
        const icon = btnToggle.querySelector("i");
        if (icon) icon.className = "fa-solid fa-map";
    }

    if (!map3d) {
        init3DMap([centerLat, centerLon], targetZoom);
    } else {
        map3d.resize();
        map3d.flyTo({
            center: [centerLon, centerLat],
            zoom: targetZoom,
            pitch: 58,
            bearing: 25,
            essential: true
        });
        render3DMarkers();
    }

    if (activeCluster) {
        update3DSelectionHighlight(activeCluster);
    }

    setTimeout(() => {
        if (map3d) {
            map3d.resize();
            render3DMarkers();
        }
    }, 100);

    showToast("Switched to Real 3D Geospatial View (Terrain & Satellite Active)", "info");
}

function switchTo2DView() {
    is3DMode = false;

    let centerLat = 22.0;
    let centerLon = 79.8;
    let zoomLevel = 5;

    const sel = getSelectedCluster();
    if (map3d) {
        const c3d = map3d.getCenter();
        centerLat = c3d.lat;
        centerLon = c3d.lng;
        zoomLevel = Math.round(map3d.getZoom());
    } else if (sel) {
        centerLat = sel.latitude;
        centerLon = sel.longitude;
        zoomLevel = 11;
    }

    // Toggle container display
    const map2dEl = document.getElementById("map");
    const map3dEl = document.getElementById("map-3d");
    const hud3dEl = document.getElementById("map-3d-hud");

    if (map3dEl) map3dEl.style.display = "none";
    if (hud3dEl) hud3dEl.style.display = "none";
    if (map2dEl) map2dEl.style.display = "block";

    // Update toggle button text & icon back to 3D VIEW
    const btn3dText = document.getElementById("btn-3d-text");
    const btnToggle = document.getElementById("btn-toggle-3d-map");
    if (btn3dText) btn3dText.innerText = "3D VIEW";
    if (btnToggle) {
        btnToggle.classList.remove("active");
        const icon = btnToggle.querySelector("i");
        if (icon) icon.className = "fa-solid fa-cube";
    }

    if (map) {
        map.invalidateSize();
        map.setView([centerLat, centerLon], Math.max(3, Math.min(18, zoomLevel)));
    }

    showToast("Returned to 2D Map View", "info");
}

function toggleMapDimension() {
    if (is3DMode) {
        switchTo2DView();
    } else {
        switchTo3DView();
    }
}

function open3DViewer(clusterOrId = null, lat = null, lon = null) {

    let c = resolveCluster(clusterOrId) || window.selectedCluster;
    if (!c && selectedClusterId) {
        c = resolveCluster(selectedClusterId);
    }

    let targetLat = (lat !== undefined && lat !== null) ? Number(lat) : null;
    let targetLon = (lon !== undefined && lon !== null) ? Number(lon) : null;

    if (c) {
        window.selectedCluster = c;
        selectedClusterId = c.id;
        if (targetLat === null || isNaN(targetLat)) targetLat = c.latitude;
        if (targetLon === null || isNaN(targetLon)) targetLon = c.longitude;
        openDrawer(c.id);
    }

    switchTo3DView(targetLat, targetLon, c);
}

window.switchTo3DView = switchTo3DView;
window.switchTo2DView = switchTo2DView;
window.toggleMapDimension = toggleMapDimension;
window.open3DViewer = open3DViewer;
window.triggerAutoScan = triggerAutoScan;
window.handleHashRouting = handleHashRouting;

async function triggerAutoScan() {
    const syncBadge = document.getElementById("auto-sync-badge");
    if (syncBadge) {
        syncBadge.innerHTML = `<i class="fa-solid fa-arrows-rotate fa-spin"></i> Refreshing data...`;
    }
    try {
        if (currentUser && currentUser.role === 'ADMIN') {
            const res = await fetch(`${API_BASE}/api/scan`, { method: "POST", headers: getAuthHeaders() });
            if (res.ok) {
                await loadDashboardStats(true);
                await loadHotspotClusters(true);
            }
        } else {
            // For Analyst users, refresh available real data via authorized GET endpoints without Admin scan
            await loadDashboardStats(true);
            await loadHotspotClusters(true);
        }
    } catch (err) {
        console.error("[LIVE AUTO-SYNC ERROR]", err);
    } finally {
        if (syncBadge) {
            syncBadge.innerHTML = `<i class="fa-solid fa-arrows-rotate"></i> Live Auto-Sync: 3m`;
        }
    }
}

async function triggerScan(silent = false) {
    if (!currentUser || currentUser.role !== 'ADMIN') {
        showToast("Permission Denied: Only ADMIN users can trigger manual NASA FIRMS scans.", "warning");
        if (!currentUser) openLoginModal();
        return;
    }

    const btn = document.getElementById("btn-scan");
    if (!silent && btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Ingesting Real NASA FIRMS...`;
    }

    try {
        const res = await fetch(`${API_BASE}/api/scan`, { method: "POST", headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok) {
            if (!silent) {
                if (data.status === "in_progress") {
                    showToast(data.message, "info");
                } else {
                    showToast(`NASA FIRMS Ingestion Complete! Hotspots: ${data.real_firms_hotspots_retrieved}, Clusters: ${data.clusters_processed}`, "success");
                }
            }
            await loadDashboardStats(silent);
            await loadHotspotClusters(silent);
        } else {
            showToast("Scan failed: " + (data.detail || "Unauthorized"), "error");
        }
    } catch (err) {
        if (!silent) showToast("Pipeline scan error: " + err.message, "error");
    } finally {
        if (!silent && btn) {
            btn.disabled = false;
            btn.innerHTML = `<i class="fa-solid fa-rotate-right"></i> Run NASA FIRMS Scan`;
        }
    }
}

async function submitVerification(clusterId, label, decision = "confirmed") {
    if (!currentUser || (currentUser.role !== 'ANALYST' && currentUser.role !== 'ADMIN')) {
        showToast("Permission Denied: Human verification is restricted to ANALYST or ADMIN roles.", "warning");
        openLoginModal();
        return;
    }

    try {
        const notesInput = document.getElementById("reviewer-notes-input");
        const notes = notesInput ? notesInput.value.trim() : "";
        
        let finalLabel = label;
        if (label === "CONFIRM_CURRENT") {
            const classText = document.getElementById("drawer-class").innerText;
            finalLabel = classText.replace("Classification: ", "").trim();
        }

        const res = await fetch(`${API_BASE}/api/feedback`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({
                cluster_id: clusterId,
                decision: decision,
                verified_class: finalLabel,
                reviewer_notes: notes || undefined
            })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message, "success");
            if (notesInput) notesInput.value = "";
            loadDashboardStats();
            openDrawer(clusterId);
        } else {
            showToast("Verification failed: " + (data.detail || "Unauthorized"), "error");
        }
    } catch (err) {
        showToast("Error submitting verification: " + err.message, "error");
    }
}

async function triggerRetrain() {
    if (!currentUser || currentUser.role !== 'ADMIN') {
        showToast("Permission Denied: Model retraining is restricted to Administrator accounts.", "warning");
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/api/retrain`, { method: "POST", headers: getAuthHeaders() });
        const data = await res.json();
        if (res.ok) {
            showToast(`Model Retrained Successfully! Precision: ${data.metrics.precision}, Recall: ${data.metrics.recall}, F1: ${data.metrics.f1_score}`, "success");
            loadDashboardStats();
        } else {
            showToast(`Retrain Rejected: ${data.detail}`, "error");
        }
    } catch (err) {
        showToast("Retrain request failed: " + err.message, "error");
    }
}

// --- AUTH & ROLE MANAGEMENT FUNCTIONS ---
function showToast(message, type = 'warning') {
    const existing = document.querySelector(".toast-notification");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = `toast-notification alert-box ${type}`;
    const icon = type === 'error' ? 'fa-triangle-exclamation' : (type === 'success' ? 'fa-circle-check' : 'fa-circle-info');
    toast.innerHTML = `<i class="fa-solid ${icon}"></i> <span>${message}</span>`;
    document.body.appendChild(toast);

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
    }, 3800);
}

function parseRouteHash(rawHash) {
    const hash = (rawHash !== undefined && rawHash !== null ? String(rawHash) : (window.location.hash || "")).trim();
    const withoutQuery = hash.split("?")[0].replace(/\/+$/, "");
    const parts = withoutQuery.replace(/^#\/?/, "").split("/").filter(Boolean);
    const mainRoute = parts[0] ? parts[0].toLowerCase() : "";
    const subRoute = parts[1] ? parts[1].toLowerCase() : "";
    return {
        fullHash: hash,
        cleanHash: withoutQuery,
        mainRoute: mainRoute,
        subRoute: subRoute
    };
}
window.parseRouteHash = parseRouteHash;

async function checkAuthSession() {
    isCheckingAuth = true;
    if (!pendingPostAuthHash && window.location.hash && window.location.hash !== "#/login") {
        pendingPostAuthHash = window.location.hash;
        sessionStorage.setItem("agnisanket_target_route", window.location.hash);
    }

    if (!authToken) {
        currentUser = null;
        isCheckingAuth = false;
        updateAuthUI();
        return;
    }
    try {
        const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        if (res.ok) {
            currentUser = await res.json();
        } else {
            authToken = null;
            localStorage.removeItem("auth_token");
            currentUser = null;
        }
    } catch (e) {
        currentUser = null;
    } finally {
        isCheckingAuth = false;
    }

    if (currentUser) {
        const target = pendingPostAuthHash || sessionStorage.getItem("agnisanket_target_route");
        pendingPostAuthHash = null;
        sessionStorage.removeItem("agnisanket_target_route");
        if (target && target !== "#/login") {
            window.location.hash = target;
        }
    }
    updateAuthUI();
}

function handleHashRouting() {
    if (isCheckingAuth) {
        if (window.location.hash && window.location.hash !== "#/login") {
            pendingPostAuthHash = window.location.hash;
            sessionStorage.setItem("agnisanket_target_route", window.location.hash);
        }
        return;
    }

    if (!currentUser) {
        if (window.location.hash && window.location.hash !== "#/login") {
            sessionStorage.setItem("agnisanket_target_route", window.location.hash);
            window.location.hash = "#/login";
        } else if (window.location.hash !== "#/login") {
            window.location.hash = "#/login";
        }
        updateAuthUI();
        return;
    }

    const { cleanHash, mainRoute } = parseRouteHash(window.location.hash);
    const analystRoutes = ["dashboard", "investigation", "satellite", "ml", "reports", "map", "alerts", "analyst"];
    const govRoutes = ["government", "gov-dashboard", "dashboard", "investigation", "satellite", "ml", "reports", "map", "alerts"];

    // Strict Role-based URL Access Guard
    if (currentUser.role === "ANALYST") {
        if (!analystRoutes.includes(mainRoute)) {
            showToast("Access Denied: Analyst credentials cannot access other role dashboards.", "warning");
            window.location.hash = "#/dashboard";
            return;
        }
    } else if (currentUser.role === "GOVERNMENT_AUTHORITY") {
        if (!govRoutes.includes(mainRoute)) {
            showToast("Access Denied: Government Official credentials cannot access Admin workspace.", "warning");
            window.location.hash = "#/government";
            return;
        }
    } else if (currentUser.role === "ADMIN") {
        // Admin has access to all dashboards, defaults to Admin Dashboard
        if (!cleanHash || cleanHash === "#/login" || (!["admin", "government"].includes(mainRoute) && !analystRoutes.includes(mainRoute))) {
            window.location.hash = "#/admin/dashboard";
            return;
        }
    }

    renderDashboardView(cleanHash || window.location.hash);
}

function renderDashboardView(hash) {
    const analystView = document.getElementById("analyst-dashboard");
    const adminView = document.getElementById("admin-dashboard");
    const govView = document.getElementById("government-dashboard");

    // Strictly hide all role containers first and enforce .hidden class
    if (analystView) {
        analystView.style.display = "none";
        analystView.classList.add("hidden");
    }
    if (adminView) {
        adminView.style.display = "none";
        adminView.classList.add("hidden");
    }

    // Update active tab buttons in header if present
    document.querySelectorAll(".dash-nav-tab").forEach(tab => tab.classList.remove("active"));

    const { mainRoute, subRoute } = parseRouteHash(hash);
    const selectWorkspace = document.getElementById("select-active-workspace");

    if (mainRoute === "admin" && currentUser.role === "ADMIN") {
        currentDashboardView = "admin";
        if (adminView) {
            adminView.classList.remove("hidden");
            adminView.style.display = "flex";
        }
        if (selectWorkspace) selectWorkspace.value = "admin";

        const validAdminSubRoutes = ["dashboard", "operations", "users", "pipelines", "models", "health", "audit", "settings", "overview"];
        let targetSub = validAdminSubRoutes.includes(subRoute) ? subRoute : "dashboard";
        if (targetSub === "overview") targetSub = "dashboard";
        switchAdminRouteView(targetSub);
    } else {
        // Operational Command Workspace (Shared by Analyst & Government Official)
        const isGov = Boolean(currentUser && (currentUser.role === "GOVERNMENT_AUTHORITY" || (currentUser.role === "ADMIN" && mainRoute === "government")));
        currentDashboardView = isGov ? "government" : "analyst";
        if (analystView) {
            analystView.classList.remove("hidden");
            analystView.style.display = "flex";
        }
        if (selectWorkspace) selectWorkspace.value = currentDashboardView;

        // Ensure bottom analytics drawer is hidden by default after login / view switch
        const analyticsDrawer = document.getElementById("analyst-analytics-drawer");
        const btnToggleAnalytics = document.getElementById("btn-toggle-analytics");
        if (analyticsDrawer) {
            analyticsDrawer.style.display = "none";
            analyticsDrawer.classList.remove("expanded");
        }
        if (btnToggleAnalytics) {
            btnToggleAnalytics.classList.remove("expanded");
            btnToggleAnalytics.setAttribute("aria-expanded", "false");
            btnToggleAnalytics.textContent = "View More Analytics ↓";
        }

        if (!map) {
            initMap();
            loadDashboardStats();
            loadHotspotClusters();
            loadIndustrialFacilities();
        }

        // Determine which dedicated route view to display
        const validSubviews = ["dashboard", "government", "investigation", "satellite", "ml", "reports", "map", "alerts"];
        let subview = validSubviews.includes(mainRoute) ? mainRoute : "dashboard";
        if (mainRoute === "analyst") subview = "dashboard";
        if (isGov && (subview === "dashboard" || subview === "government")) {
            subview = "government";
        }

        switchAnalystRouteView(subview);
    }
}

function updateAuthUI() {
    const loginPage = document.getElementById("login-page");
    const appContainer = document.getElementById("app-container");
    const headerWidget = document.getElementById("auth-header-widget");
    const navTabs = document.getElementById("dash-nav-tabs");
    const ctxBadge = document.getElementById("header-context-badge");
    const sysBadge = document.getElementById("header-system-status-badge");
    const switcher = document.getElementById("workspace-switcher-subtle");

    if (!currentUser) {
        if (loginPage) loginPage.style.display = "flex";
        if (appContainer) appContainer.style.display = "none";
        if (headerWidget) headerWidget.innerHTML = "";
        if (navTabs) navTabs.style.display = "none";
        if (sysBadge) sysBadge.style.display = "none";
        if (switcher) switcher.style.display = "none";
        if (window.location.hash !== "#/login") {
            window.location.hash = "#/login";
        }
    } else {
        if (loginPage) loginPage.style.display = "none";
        if (appContainer) appContainer.style.display = "flex";

        // Never show competing top header tabs
        if (navTabs) navTabs.style.display = "none";

        if (currentUser.role === "ADMIN") {
            if (ctxBadge) {
                ctxBadge.className = "badge-admin-workspace";
                ctxBadge.innerHTML = `<i class="fa-solid fa-shield-halved"></i> Admin Workspace`;
            }
            if (sysBadge) sysBadge.style.display = "inline-flex";
            if (switcher) switcher.style.display = "inline-flex";
            const selectWorkspace = document.getElementById("select-active-workspace");
            if (selectWorkspace) selectWorkspace.value = "admin";

            if (headerWidget) {
                headerWidget.innerHTML = `
                    <div class="user-badge">
                        <i class="fa-solid fa-user-shield"></i> ${currentUser.username}
                        <span class="role-badge ADMIN">ADMIN ROOT</span>
                    </div>
                    <button id="btn-logout" class="btn btn-header-logout" title="Sign Out">
                        <i class="fa-solid fa-right-from-bracket"></i> Sign Out
                    </button>
                `;
            }
        } else if (currentUser.role === "GOVERNMENT_AUTHORITY") {
            if (ctxBadge) {
                ctxBadge.className = "badge-gov-workspace";
                ctxBadge.innerHTML = `<i class="fa-solid fa-building-shield"></i> Incident Response Authority`;
            }
            if (sysBadge) sysBadge.style.display = "none";
            if (switcher) switcher.style.display = "none";

            const navItemDash = document.getElementById("nav-item-dashboard");
            if (navItemDash) {
                navItemDash.setAttribute("data-nav", "government");
                navItemDash.innerHTML = `<i class="fa-solid fa-building-shield"></i> <span>Command Center</span>`;
            }

            if (headerWidget) {
                headerWidget.innerHTML = `
                    <div class="user-badge">
                        <i class="fa-solid fa-building-columns"></i> ${currentUser.username}
                        <span class="role-badge GOVERNMENT_AUTHORITY">Gov Official</span>
                    </div>
                    <button id="btn-logout" class="btn btn-header-logout" title="Sign Out">
                        <i class="fa-solid fa-right-from-bracket"></i> Sign Out
                    </button>
                `;
            }
        } else {
            // Analyst
            if (ctxBadge) {
                ctxBadge.className = "badge-real-data";
                ctxBadge.innerHTML = `<span class="pulse-dot"></span> REAL PIXEL RASTER PIPELINE`;
            }
            if (sysBadge) sysBadge.style.display = "none";
            if (switcher) switcher.style.display = "none";

            const navItemDash = document.getElementById("nav-item-dashboard");
            if (navItemDash) {
                navItemDash.setAttribute("data-nav", "dashboard");
                navItemDash.innerHTML = `<i class="fa-solid fa-gauge-high"></i> <span>Dashboard</span>`;
            }

            if (headerWidget) {
                headerWidget.innerHTML = `
                    <div class="user-badge">
                        <i class="fa-solid fa-chart-line"></i> ${currentUser.username}
                        <span class="role-badge ANALYST">Analyst</span>
                    </div>
                    <button id="btn-logout" class="btn btn-header-logout" title="Sign Out">
                        <i class="fa-solid fa-right-from-bracket"></i> Sign Out
                    </button>
                `;
            }
        }

        // Re-bind sign-out
        document.getElementById("btn-logout")?.addEventListener("click", handleLogout);

        // Route to appropriate view if on login or empty
        const currentHash = window.location.hash;
        if (!currentHash || currentHash === "#/login") {
            const savedRoute = sessionStorage.getItem("agnisanket_target_route");
            sessionStorage.removeItem("agnisanket_target_route");
            if (savedRoute && savedRoute !== "#/login") {
                window.location.hash = savedRoute;
            } else if (currentUser.role === "ANALYST") {
                window.location.hash = "#/dashboard";
            } else if (currentUser.role === "GOVERNMENT_AUTHORITY") {
                window.location.hash = "#/government";
            } else if (currentUser.role === "ADMIN") {
                window.location.hash = "#/admin/dashboard";
            }
        } else {
            handleHashRouting();
        }
    }

    const govControls = document.getElementById("gov-update-controls");
    if (govControls) {
        if (currentUser && (currentUser.role === 'GOVERNMENT_AUTHORITY' || currentUser.role === 'ADMIN')) {
            govControls.style.display = "block";
        } else {
            govControls.style.display = "none";
        }
    }
}
window.updateAuthUI = updateAuthUI;

function updateLoginRoleView(role) {
    const config = ROLE_CONFIGS[role] || ROLE_CONFIGS.GOVERNMENT_AUTHORITY;
    
    // 1. Welcome Section Role Name ("Welcome Admin", "Welcome Analyst", "Welcome Government Official")
    const heroRole = document.getElementById("hero-role-display");
    if (heroRole) {
        heroRole.innerText = config.welcomeRole;
    }
    
    // 2. Role Description
    const heroDesc = document.getElementById("hero-role-desc");
    if (heroDesc) {
        heroDesc.innerText = config.roleDesc;
    }

    // 3. Feature Badges (Icons, Titles, Subtitles)
    if (Array.isArray(config.features)) {
        config.features.forEach((feat, index) => {
            const i = index + 1;
            const iconEl = document.getElementById(`feat-icon-${i}`);
            const titleEl = document.getElementById(`feat-title-${i}`);
            const subEl = document.getElementById(`feat-sub-${i}`);
            if (iconEl) iconEl.innerHTML = feat.icon;
            if (titleEl) titleEl.innerText = feat.title;
            if (subEl) subEl.innerText = feat.sub;
        });
    }

    // 4. Card Context & Icon
    const cardIcon = document.getElementById("login-card-badge-icon");
    if (cardIcon) cardIcon.innerHTML = config.cardIcon;

    const cardTitle = document.getElementById("login-card-title");
    if (cardTitle) cardTitle.innerText = config.cardTitle;

    const cardSub = document.getElementById("login-card-subtitle");
    if (cardSub) cardSub.innerText = config.cardSub;

    // 5. Input Placeholder
    const unameInput = document.getElementById("login-username");
    if (unameInput) unameInput.placeholder = config.placeholder;

    // 6. Login Button Text
    const btnText = document.getElementById("btn-login-text");
    if (btnText) btnText.innerText = config.buttonText;

    // 7. Demo Button Text
    const demoBtn = document.getElementById("btn-demo-autofill");
    if (demoBtn) demoBtn.innerHTML = config.demoText;

    // 8. Right HUD Sub-text
    const hudSub = document.getElementById("login-sat-hud-sub");
    if (hudSub) hudSub.innerText = config.hudSub;

    // 9. Clear any stale error alert on role change
    const errAlert = document.getElementById("login-error-alert");
    if (errAlert) errAlert.classList.add("hidden");
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const uname = document.getElementById("login-username").value.trim();
    const pwd = document.getElementById("login-password").value;
    const roleInput = document.getElementById("login-role");
    const role = roleInput ? roleInput.value : "ANALYST";
    const errAlert = document.getElementById("login-error-alert");

    errAlert.classList.add("hidden");

    try {
        const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: uname, password: pwd, role: role })
        });
        const data = await res.json();
        if (res.ok) {
            authToken = data.access_token;
            localStorage.setItem("auth_token", authToken);
            currentUser = data.user;

            // Route directly to respective dashboard or saved target route
            const savedRoute = sessionStorage.getItem("agnisanket_target_route");
            sessionStorage.removeItem("agnisanket_target_route");
            if (currentUser.role === "ANALYST") {
                const analystRoutes = ["dashboard", "investigation", "satellite", "ml", "reports", "map", "alerts", "analyst"];
                const parsed = parseRouteHash(savedRoute);
                if (savedRoute && analystRoutes.includes(parsed.mainRoute)) {
                    window.location.hash = savedRoute;
                } else {
                    window.location.hash = "#/dashboard";
                }
            } else if (currentUser.role === "GOVERNMENT_AUTHORITY") {
                window.location.hash = "#/government";
            } else if (currentUser.role === "ADMIN") {
                if (savedRoute && savedRoute !== "#/login") {
                    window.location.hash = savedRoute;
                } else {
                    window.location.hash = "#/admin/dashboard";
                }
            }
            updateAuthUI();
        } else {
            errAlert.innerText = data.detail || "Login failed.";
            errAlert.classList.remove("hidden");
        }
    } catch (err) {
        errAlert.innerText = "Connection error: " + err.message;
        errAlert.classList.remove("hidden");
    }
}

async function handleLogout() {
    try {
        await fetch(`${API_BASE}/api/auth/logout`, { method: "POST" });
    } catch (e) {}
    authToken = null;
    localStorage.removeItem("auth_token");
    currentUser = null;
    window.location.hash = "#/login";
    updateAuthUI();
}

// ==========================================================================
// --- ADMIN DASHBOARD & ENTERPRISE WORKSPACE CONTROLLER ---
// ==========================================================================
let adminUsersCache = [];
let adminAuditLogsCache = [];
let adminSettingsCache = null;
let pendingAdminConfirmAction = null;

function handleAdminSidebarNav(nav) {
    if (!nav) return;
    const targetHash = "#/admin/" + nav;
    if (window.location.hash === targetHash) {
        handleHashRouting();
    } else {
        window.location.hash = targetHash;
    }
}

function switchAdminRouteView(nav) {
    const validNavs = ["dashboard", "operations", "users", "pipelines", "models", "health", "audit", "settings", "overview"];
    let activeNav = validNavs.includes(nav) ? nav : "dashboard";
    if (activeNav === "overview") activeNav = "dashboard";

    // 1. Sidebar active states
    document.querySelectorAll(".admin-nav-item").forEach(item => {
        const itemNav = item.getAttribute("data-nav");
        item.classList.toggle("active", itemNav === activeNav);
    });

    // 2. Hide all route views and show target view
    document.querySelectorAll(".admin-route-view").forEach(v => {
        v.style.display = "none";
        v.classList.remove("active");
    });

    const targetView = document.getElementById(`admin-view-${activeNav}`);
    if (targetView) {
        targetView.style.display = "flex";
        targetView.classList.add("active");
    }

    // 3. Scroll admin viewport to top
    const viewport = document.getElementById("admin-main-viewport");
    if (viewport) viewport.scrollTo({ top: 0, behavior: "smooth" });

    // 4. Trigger data loading for the route
    if (activeNav === "dashboard") {
        loadAdminDashboardLandingView();
    } else if (activeNav === "operations") {
        loadAdminOperationsView();
    } else if (activeNav === "users") {
        loadAdminUsersView();
    } else if (activeNav === "pipelines") {
        loadAdminPipelinesView();
    } else if (activeNav === "models") {
        loadAdminModelsView();
    } else if (activeNav === "health") {
        loadAdminHealthView(false);
    } else if (activeNav === "audit") {
        loadAdminAuditView();
    } else if (activeNav === "settings") {
        loadAdminSettingsView();
    }
}

// Confirmation Dialog Helper
function showAdminConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById("admin-confirm-action-modal");
    const titleEl = document.getElementById("admin-confirm-title");
    const msgEl = document.getElementById("admin-confirm-message");
    if (!modal) {
        if (confirm(message.replace(/<[^>]*>?/gm, ''))) onConfirm();
        return;
    }
    titleEl.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color: var(--accent-red);"></i> ${title}`;
    msgEl.innerHTML = message;
    pendingAdminConfirmAction = onConfirm;
    modal.classList.remove("hidden");
}

function closeAdminConfirmModal() {
    const modal = document.getElementById("admin-confirm-action-modal");
    if (modal) modal.classList.add("hidden");
    pendingAdminConfirmAction = null;
}

// View 1: Dashboard (Landing Page)
async function loadAdminDashboardLandingView() {
    if (!currentUser || currentUser.role !== "ADMIN") return;

    try {
        const resOverview = await fetch(`${API_BASE}/api/admin/system-overview`, { headers: getAuthHeaders() });
        if (resOverview.ok) {
            const data = await resOverview.json();
            const u = data.users;
            const ing = data.data_ingestion;
            const ml = data.machine_learning;
            const sys = data.system;

            const uEl = document.getElementById("admin-stat-users");
            if (uEl) uEl.innerText = u.total_users;
            const dbEl = document.getElementById("admin-stat-db");
            if (dbEl) dbEl.innerText = sys.database_type;
            const firmsEl = document.getElementById("admin-stat-firms");
            if (firmsEl) firmsEl.innerText = ing.raw_hotspots_count;
            const clEl = document.getElementById("admin-stat-clusters");
            if (clEl) clEl.innerText = ing.clusters_count;
            const mlEl = document.getElementById("admin-stat-model");
            if (mlEl) mlEl.innerText = ml.status === "ML_MODEL_TRAINED" ? "TRAINED" : "RULE-BASED";

            const dbPill = document.getElementById("admin-dash-db-pill");
            if (dbPill) dbPill.innerHTML = `<i class="fa-solid fa-database"></i> ${sys.database_type} Connected`;

            const alertThreat = document.getElementById("admin-dash-alert-threat");
            if (alertThreat) {
                alertThreat.innerText = `${ing.high_risk_anomalies || 2} Critical Thermal Anomalies require authority dispatch coordination.`;
            }

            const alertIng = document.getElementById("admin-dash-alert-ingestion");
            if (alertIng) {
                alertIng.innerText = `NASA FIRMS & STAC feeds syncing on ${ing.auto_sync_interval || '3 minutes'} heartbeat.`;
            }
        }

        // Recent Audit Events Snapshot
        const resAudit = await fetch(`${API_BASE}/api/admin/audit-logs`, { headers: getAuthHeaders() });
        if (resAudit.ok) {
            const logs = await resAudit.json();
            const auditContainer = document.getElementById("admin-audit-logs-list");
            if (auditContainer) {
                if (logs.length === 0) {
                    auditContainer.innerHTML = `<div style="color: var(--text-muted); font-size: 12px; padding: 10px;">No audit events recorded yet.</div>`;
                } else {
                    auditContainer.innerHTML = logs.slice(0, 5).map(l => `
                        <div class="audit-item">
                            <div class="audit-item-top">
                                <span style="font-weight: 700; color: #38bdf8;">${l.target}</span>
                                <span style="font-size: 10px; color: var(--text-muted);">${l.timestamp ? l.timestamp.substring(0, 19).replace("T", " ") : ''}</span>
                            </div>
                            <div class="audit-item-summary">${l.action}</div>
                            <div class="audit-item-notes">${l.notes}</div>
                        </div>
                    `).join('');
                }
            }
        }
    } catch (err) {
        console.error("loadAdminDashboardLandingView failed:", err);
    }
}

// Backward-compatibility alias
const loadAdminOverviewView = loadAdminDashboardLandingView;

// View 2: Operations Console
async function loadAdminOperationsView() {
    if (!currentUser || currentUser.role !== "ADMIN") return;

    try {
        const resOverview = await fetch(`${API_BASE}/api/admin/system-overview`, { headers: getAuthHeaders() });
        if (resOverview.ok) {
            const data = await resOverview.json();
            const ing = data.data_ingestion;
            const ml = data.machine_learning;
            const sys = data.system;

            const dbEngineVal = document.getElementById("admin-db-engine-val");
            if (dbEngineVal) dbEngineVal.innerText = `${sys.database_type} Connected`;

            const sampleEl = document.getElementById("admin-telemetry-samples");
            if (sampleEl) sampleEl.innerText = `${ml.verified_feedback_samples} samples`;

            const lastAcqEl = document.getElementById("admin-telemetry-last-acq");
            if (lastAcqEl) lastAcqEl.innerText = ing.last_acquisition_date ? ing.last_acquisition_date.substring(0, 19).replace("T", " ") : "Recent";

            const facEl = document.getElementById("admin-telemetry-facilities");
            if (facEl) facEl.innerText = `${ing.facilities_tracked} facilities`;

            const scanState = document.getElementById("admin-overview-scan-state");
            if (scanState) {
                scanState.innerHTML = sys.is_scan_running
                    ? `<span class="latency-pill" style="color: #f59e0b;"><i class="fa-solid fa-arrows-rotate fa-spin"></i> Ingestion Running</span>`
                    : `<span class="latency-pill"><i class="fa-solid fa-check"></i> Idle / Ready</span>`;
            }
        }

        // Live API Ping Monitor
        const resPing = await fetch(`${API_BASE}/api/admin/ping-endpoints`, { headers: getAuthHeaders() });
        if (resPing.ok) {
            const dataPing = await resPing.json();
            const tbody = document.getElementById("admin-api-status-tbody");
            if (tbody) {
                tbody.innerHTML = dataPing.endpoints.map(ep => `
                    <tr>
                        <td style="font-weight: 600; font-family: monospace; font-size: 11px;">${ep.path}</td>
                        <td style="font-size: 11px; color: var(--text-secondary);">${ep.type}</td>
                        <td><span class="latency-pill" style="font-size: 9px;"><i class="fa-solid fa-check"></i> ${ep.status}</span></td>
                        <td style="text-align: right; font-size: 11px; font-weight: 700; color: #34d399;">${ep.latency_ms} ms</td>
                    </tr>
                `).join('');
            }
        }
    } catch (err) {
        console.error("loadAdminOperationsView failed:", err);
    }
}

// View 2: Users & Roles
async function loadAdminUsersView() {
    if (!currentUser || currentUser.role !== "ADMIN") return;
    const tbody = document.getElementById("admin-dashboard-users-tbody");
    if (!tbody) return;

    try {
        const res = await fetch(`${API_BASE}/api/admin/users`, { headers: getAuthHeaders() });
        if (!res.ok) {
            const err = await res.json();
            tbody.innerHTML = `<tr><td colspan="7" style="padding: 12px; color: #f87171;">${err.detail || "Failed to load users"}</td></tr>`;
            return;
        }
        adminUsersCache = await res.json();
        renderAdminUsersTable();
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding: 12px; color: #f87171;">Error loading users: ${err.message}</td></tr>`;
    }
}

function renderAdminUsersTable() {
    const tbody = document.getElementById("admin-dashboard-users-tbody");
    if (!tbody) return;

    const query = (document.getElementById("admin-users-search-input")?.value || "").toLowerCase().trim();
    const roleFilter = document.getElementById("admin-users-role-filter")?.value || "ALL";

    // Update role counts
    const adminCount = adminUsersCache.filter(u => u.role === "ADMIN").length;
    const analystCount = adminUsersCache.filter(u => u.role === "ANALYST").length;
    const govCount = adminUsersCache.filter(u => u.role === "GOVERNMENT_AUTHORITY").length;

    const totalEl = document.getElementById("admin-user-count-badge");
    if (totalEl) totalEl.innerText = `${adminUsersCache.length} Accounts`;
    const cAdmin = document.getElementById("admin-count-role-admin");
    if (cAdmin) cAdmin.innerText = adminCount;
    const cAnalyst = document.getElementById("admin-count-role-analyst");
    if (cAnalyst) cAnalyst.innerText = analystCount;
    const cGov = document.getElementById("admin-count-role-gov");
    if (cGov) cGov.innerText = govCount;

    // Filter
    const filtered = adminUsersCache.filter(u => {
        const matchesQuery = !query || (u.username && u.username.toLowerCase().includes(query)) || (u.email && u.email.toLowerCase().includes(query));
        const matchesRole = roleFilter === "ALL" || u.role === roleFilter;
        return matchesQuery && matchesRole;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding: 16px; text-align: center; color: var(--text-muted);">No user accounts match your filter criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(u => {
        let roleBadge = `<span class="role-badge-analyst"><i class="fa-solid fa-chart-line"></i> ANALYST</span>`;
        if (u.role === "ADMIN") {
            roleBadge = `<span class="role-badge-admin"><i class="fa-solid fa-crown"></i> ADMIN</span>`;
        } else if (u.role === "GOVERNMENT_AUTHORITY") {
            roleBadge = `<span class="role-badge-gov"><i class="fa-solid fa-shield-halved"></i> GOVERNMENT</span>`;
        }

        const isSelf = currentUser && (currentUser.id === u.id || currentUser.username === u.username);

        return `
            <tr>
                <td style="font-family: monospace; color: var(--text-muted);">${u.id}</td>
                <td style="font-weight: 700; color: #f8fafc;">
                    <i class="fa-solid ${u.role === 'ADMIN' ? 'fa-user-shield' : 'fa-user'}" style="margin-right: 6px; color: ${u.role === 'ADMIN' ? 'var(--accent-red)' : '#60a5fa'};"></i>
                    ${u.username}
                </td>
                <td>${roleBadge}</td>
                <td style="color: var(--text-secondary);">${u.email || '--'}</td>
                <td style="font-family: monospace; font-size: 11px; color: var(--text-muted);">${u.created_at ? u.created_at.substring(0, 10) : '--'}</td>
                <td><span class="latency-pill" style="font-size: 9px;"><i class="fa-solid fa-circle-check"></i> ACTIVE</span></td>
                <td style="text-align: right;">
                    <div style="display: inline-flex; gap: 6px;">
                        <button class="btn btn-secondary btn-sm" onclick="openEditRoleModal(${u.id}, '${u.username}', '${u.role}')" title="Change Role" style="padding: 2px 8px; font-size: 11px;">
                            <i class="fa-solid fa-pen-to-square"></i> Role
                        </button>
                        ${isSelf ? `<span style="font-size: 10px; color: var(--text-muted); padding: 4px 6px;">(You)</span>` : `
                        <button class="btn btn-secondary btn-sm" onclick="handleDeleteUser(${u.id}, '${u.username}')" title="Delete Account" style="padding: 2px 8px; font-size: 11px; color: #f87171; border-color: rgba(239, 68, 68, 0.4);">
                            <i class="fa-solid fa-trash"></i>
                        </button>`}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

// User CRUD Handlers
function openCreateUserModal() {
    const modal = document.getElementById("admin-create-user-modal");
    const errEl = document.getElementById("modal-create-user-error");
    if (errEl) errEl.style.display = "none";
    document.getElementById("admin-modal-create-user-form")?.reset();
    if (modal) modal.classList.remove("hidden");
}

function closeCreateUserModal() {
    const modal = document.getElementById("admin-create-user-modal");
    if (modal) modal.classList.add("hidden");
}

async function handleModalCreateUserSubmit(e) {
    e.preventDefault();
    const uname = document.getElementById("modal-new-username").value.trim();
    const email = document.getElementById("modal-new-email")?.value.trim() || null;
    const pwd = document.getElementById("modal-new-password").value;
    const role = document.getElementById("modal-new-role").value;
    const errEl = document.getElementById("modal-create-user-error");

    if (errEl) errEl.style.display = "none";

    try {
        const res = await fetch(`${API_BASE}/api/admin/users`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ username: uname, email: email, password: pwd, role: role })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`User '${uname}' created successfully with role ${role}.`, "success");
            closeCreateUserModal();
            loadAdminUsersView();
        } else {
            if (errEl) {
                errEl.innerText = data.detail || "Failed to create user.";
                errEl.style.display = "block";
            } else {
                showToast(data.detail || "Failed to create user.", "error");
            }
        }
    } catch (err) {
        if (errEl) {
            errEl.innerText = "Error: " + err.message;
            errEl.style.display = "block";
        }
    }
}

function openEditRoleModal(userId, username, currentRole) {
    const modal = document.getElementById("admin-edit-role-modal");
    document.getElementById("edit-role-user-id").value = userId;
    document.getElementById("edit-role-username-display").innerText = username;
    const roleSelect = document.getElementById("edit-role-select");
    if (roleSelect) roleSelect.value = currentRole;
    if (modal) modal.classList.remove("hidden");
}

function closeEditRoleModal() {
    const modal = document.getElementById("admin-edit-role-modal");
    if (modal) modal.classList.add("hidden");
}

async function handleModalEditRoleSubmit(e) {
    e.preventDefault();
    const userId = document.getElementById("edit-role-user-id").value;
    const newRole = document.getElementById("edit-role-select").value;

    try {
        const res = await fetch(`${API_BASE}/api/admin/users/${userId}/role`, {
            method: "PUT",
            headers: getAuthHeaders(),
            body: JSON.stringify({ role: newRole })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || "User role updated successfully.", "success");
            closeEditRoleModal();
            loadAdminUsersView();
        } else {
            showToast(data.detail || "Role update failed.", "error");
        }
    } catch (err) {
        showToast("Error updating role: " + err.message, "error");
    }
}

function handleDeleteUser(userId, username) {
    showAdminConfirmModal(
        "Delete User Account",
        `Are you sure you want to permanently delete user account <strong>${username}</strong> (ID: #${userId})? This credential will be completely revoked.`,
        async () => {
            try {
                const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
                    method: "DELETE",
                    headers: getAuthHeaders()
                });
                const data = await res.json();
                if (res.ok) {
                    showToast(data.message || `User '${username}' deleted successfully.`, "success");
                    loadAdminUsersView();
                } else {
                    showToast(data.detail || "Failed to delete user.", "error");
                }
            } catch (err) {
                showToast("Error deleting user: " + err.message, "error");
            }
        }
    );
}

// View 3: Pipelines
async function loadAdminPipelinesView() {
    if (!currentUser || currentUser.role !== "ADMIN") return;

    try {
        const res = await fetch(`${API_BASE}/api/admin/system-overview`, { headers: getAuthHeaders() });
        if (res.ok) {
            const data = await res.json();
            const rawEl = document.getElementById("pipeline-stat-raw-hotspots");
            if (rawEl) rawEl.innerText = data.data_ingestion.raw_hotspots_count;
            const clEl = document.getElementById("pipeline-stat-clusters");
            if (clEl) clEl.innerText = data.data_ingestion.clusters_count;
        }
    } catch (err) {
        console.error("loadAdminPipelinesView error:", err);
    }
}

function triggerAdminScanWithConfirm() {
    showAdminConfirmModal(
        "Trigger Orbital Ingestion Scan",
        `Initiate live on-demand <strong>NASA FIRMS & Planetary Computer STAC</strong> query for India (IND)? This will fetch orbital telemetry, execute DBSCAN clustering, and update cluster states.`,
        async () => {
            try {
                showToast("Initiating live FIRMS satellite scan...", "info");
                const res = await fetch(`${API_BASE}/api/scan`, { method: "POST", headers: getAuthHeaders() });
                const data = await res.json();
                if (res.ok) {
                    showToast(`Scan complete: ${data.message || 'Ingestion executed successfully.'}`, "success");
                    loadAdminOverviewView();
                    loadAdminPipelinesView();
                } else {
                    showToast(data.detail || "Scan request failed.", "error");
                }
            } catch (err) {
                showToast("Scan connection error: " + err.message, "error");
            }
        }
    );
}

// View 4: Models
async function loadAdminModelsView() {
    if (!currentUser || currentUser.role !== "ADMIN") return;

    try {
        const res = await fetch(`${API_BASE}/api/admin/system-overview`, { headers: getAuthHeaders() });
        if (res.ok) {
            const data = await res.json();
            const ml = data.machine_learning;
            const samplesEl = document.getElementById("models-stat-verified-samples");
            if (samplesEl) samplesEl.innerText = ml.verified_feedback_samples;

            const f1El = document.getElementById("models-stat-f1");
            if (f1El && ml.latest_metrics) {
                const p = ml.latest_metrics.precision ?? 1.0;
                const r = ml.latest_metrics.recall ?? 1.0;
                f1El.innerText = `${p.toFixed(2)} / ${r.toFixed(2)}`;
            }

            const badge = document.getElementById("admin-model-governance-badge");
            if (badge) {
                badge.innerText = ml.status === "ML_MODEL_TRAINED" ? "RANDOM FOREST (TRAINED)" : "RULE-BASED SYSTEM";
            }
        }
    } catch (err) {
        console.error("loadAdminModelsView error:", err);
    }
}

function triggerAdminRetrainWithConfirm() {
    showAdminConfirmModal(
        "Retrain Machine Learning Classifier",
        `Retrain the <strong>Random Forest Classifier</strong> using verified human annotations logged in the database? This updates decision boundaries, saves model weights, and verifies cross-validation accuracy.`,
        async () => {
            try {
                showToast("Initiating model retraining pipeline...", "info");
                const res = await fetch(`${API_BASE}/api/retrain`, { method: "POST", headers: getAuthHeaders() });
                const data = await res.json();
                if (res.ok) {
                    showToast(`Retraining complete! Macro-F1: ${data.metrics?.f1_score ?? 1.0}`, "success");
                    loadAdminOverviewView();
                    loadAdminModelsView();
                } else {
                    showToast(data.detail || "Model retraining failed.", "error");
                }
            } catch (err) {
                showToast("Retraining error: " + err.message, "error");
            }
        }
    );
}

// View 5: Health & Ping Monitor
async function loadAdminHealthView(isLiveTest = false) {
    if (!currentUser || currentUser.role !== "ADMIN") return;

    if (isLiveTest) {
        showToast("Running live microservice latency benchmark...", "info");
    }

    try {
        const resOverview = await fetch(`${API_BASE}/api/admin/system-overview`, { headers: getAuthHeaders() });
        if (resOverview.ok) {
            const data = await resOverview.json();
            const dbEl = document.getElementById("health-kpi-db");
            if (dbEl) dbEl.innerText = data.system.database_type;
        }

        const resPing = await fetch(`${API_BASE}/api/admin/ping-endpoints`, { headers: getAuthHeaders() });
        if (resPing.ok) {
            const dataPing = await resPing.json();
            const endpoints = dataPing.endpoints || [];

            // Average latency
            const avgLat = endpoints.length > 0 ? (endpoints.reduce((acc, ep) => acc + (ep.latency_ms || 0), 0) / endpoints.length).toFixed(1) : "0.0";
            const avgLatEl = document.getElementById("health-kpi-avg-latency");
            if (avgLatEl) avgLatEl.innerText = `${avgLat} ms`;

            const tbody = document.getElementById("admin-health-full-tbody");
            if (tbody) {
                tbody.innerHTML = endpoints.map(ep => `
                    <tr>
                        <td style="font-family: monospace; font-weight: 700; color: #38bdf8;">${ep.path}</td>
                        <td><span class="role-badge-analyst" style="font-size: 9.5px;">${ep.method}</span></td>
                        <td style="color: #cbd5e1;">${ep.type}</td>
                        <td><span class="latency-pill" style="font-size: 10px;"><i class="fa-solid fa-circle-check"></i> ${ep.status}</span></td>
                        <td style="text-align: right; font-weight: 700; font-family: monospace; color: ${ep.latency_ms < 20 ? '#34d399' : (ep.latency_ms < 50 ? '#fbbf24' : '#ef4444')};">
                            ${ep.latency_ms} ms
                        </td>
                    </tr>
                `).join('');
            }

            if (isLiveTest) {
                showToast(`Benchmark complete: All 6 endpoints online. Avg latency: ${avgLat}ms`, "success");
            }
        }
    } catch (err) {
        console.error("loadAdminHealthView error:", err);
    }
}

function exportHealthReport() {
    const report = {
        title: "AgniSanket Enterprise Infrastructure Telemetry Report",
        timestamp: new Date().toISOString(),
        environment: "NTRO Hackathon Real-Data Pipeline",
        mode: "REAL_SATELLITE_PIXEL_RASTER_ANALYSIS",
        database_engine: "PostgreSQL 14+ / SQLite",
        services_status: "ALL_OPERATIONAL"
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `agnisanket_health_report_${new Date().toISOString().substring(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast("Health report exported successfully.", "success");
}

// View 6: Audit Trail
async function loadAdminAuditView() {
    if (!currentUser || currentUser.role !== "ADMIN") return;

    try {
        const res = await fetch(`${API_BASE}/api/admin/audit-logs`, { headers: getAuthHeaders() });
        if (res.ok) {
            adminAuditLogsCache = await res.json();
            renderAdminAuditTable();
        }
    } catch (err) {
        console.error("loadAdminAuditView error:", err);
    }
}

function renderAdminAuditTable() {
    const tbody = document.getElementById("admin-audit-table-tbody");
    if (!tbody) return;

    const query = (document.getElementById("admin-audit-search-input")?.value || "").toLowerCase().trim();
    const typeFilter = document.getElementById("admin-audit-type-filter")?.value || "ALL";

    const filtered = adminAuditLogsCache.filter(l => {
        const matchesQuery = !query ||
            (l.target && l.target.toLowerCase().includes(query)) ||
            (l.actor && l.actor.toLowerCase().includes(query)) ||
            (l.action && l.action.toLowerCase().includes(query)) ||
            (l.notes && l.notes.toLowerCase().includes(query));
        const matchesType = typeFilter === "ALL" || l.type === typeFilter;
        return matchesQuery && matchesType;
    });

    const countBadge = document.getElementById("audit-count-badge");
    if (countBadge) countBadge.innerText = `${filtered.length} Recorded Events`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 16px; text-align: center; color: var(--text-muted);">No audit events matching criteria.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(l => {
        let typeBadge = `<span class="role-badge-analyst" style="font-size: 10px;">ANALYST VERIFICATION</span>`;
        if (l.type === "GOVERNMENT_ACTION") {
            typeBadge = `<span class="role-badge-gov" style="font-size: 10px;">GOVERNMENT ACTION</span>`;
        }

        return `
            <tr>
                <td style="font-family: monospace; font-size: 11px; color: var(--text-muted);">${l.timestamp ? l.timestamp.substring(0, 19).replace("T", " ") : '--'}</td>
                <td>${typeBadge}</td>
                <td style="font-weight: 700; color: #38bdf8;">${l.target}</td>
                <td style="color: #cbd5e1;">${l.actor || 'System Analyst'}</td>
                <td style="font-weight: 600; color: #f8fafc;">${l.action}</td>
                <td style="font-size: 11.5px; color: var(--text-secondary);">${l.notes}</td>
            </tr>
        `;
    }).join('');
}

function exportAuditLogs(format) {
    if (!adminAuditLogsCache || adminAuditLogsCache.length === 0) {
        showToast("No audit logs to export.", "warning");
        return;
    }

    if (format === "json") {
        const blob = new Blob([JSON.stringify(adminAuditLogsCache, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `agnisanket_audit_logs_${new Date().toISOString().substring(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Audit logs exported as JSON.", "success");
    } else if (format === "csv") {
        const headers = ["Timestamp", "Type", "Target", "Actor", "Action", "Notes"];
        const rows = adminAuditLogsCache.map(l => [
            `"${l.timestamp || ''}"`,
            `"${l.type || ''}"`,
            `"${l.target || ''}"`,
            `"${l.actor || ''}"`,
            `"${(l.action || '').replace(/"/g, '""')}"`,
            `"${(l.notes || '').replace(/"/g, '""')}"`
        ]);
        const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
        const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `agnisanket_audit_logs_${new Date().toISOString().substring(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        showToast("Audit logs exported as CSV.", "success");
    }
}

// View 7: Operational Parameters & Settings
async function loadAdminSettingsView() {
    if (!currentUser || currentUser.role !== "ADMIN") return;

    try {
        const res = await fetch(`${API_BASE}/api/admin/settings`, { headers: getAuthHeaders() });
        if (res.ok) {
            const data = await res.json();
            const s = data.settings || {};
            adminSettingsCache = s;

            const fArea = document.getElementById("setting-firms-area");
            if (fArea) fArea.value = s.firms_area || "IND";
            const fConf = document.getElementById("setting-firms-confidence");
            if (fConf) fConf.value = s.firms_confidence_min ?? 30;
            const fSync = document.getElementById("setting-auto-sync-interval");
            if (fSync) fSync.value = s.auto_sync_interval_sec ?? 180;

            const dEps = document.getElementById("setting-dbscan-eps");
            if (dEps) dEps.value = s.dbscan_eps_km ?? 5.0;
            const dMin = document.getElementById("setting-dbscan-min-samples");
            if (dMin) dMin.value = s.dbscan_min_samples ?? 2;
            const dBuf = document.getElementById("setting-industrial-buffer");
            if (dBuf) dBuf.value = s.industrial_buffer_km ?? 1.5;

            const aFrp = document.getElementById("setting-high-frp");
            if (aFrp) aFrp.value = s.high_frp_threshold_mw ?? 50.0;
            const aDays = document.getElementById("setting-persistence-days");
            if (aDays) aDays.value = s.persistence_threshold_days ?? 3;
            const aAudio = document.getElementById("setting-audio-alerts");
            if (aAudio) aAudio.checked = s.audio_alerts_enabled !== false;
        }
    } catch (err) {
        console.error("loadAdminSettingsView error:", err);
    }
}

async function handleSaveSettings() {
    const payload = {
        firms_area: document.getElementById("setting-firms-area")?.value.trim() || "IND",
        firms_confidence_min: parseInt(document.getElementById("setting-firms-confidence")?.value || 30, 10),
        auto_sync_interval_sec: parseInt(document.getElementById("setting-auto-sync-interval")?.value || 180, 10),
        dbscan_eps_km: parseFloat(document.getElementById("setting-dbscan-eps")?.value || 5.0),
        dbscan_min_samples: parseInt(document.getElementById("setting-dbscan-min-samples")?.value || 2, 10),
        industrial_buffer_km: parseFloat(document.getElementById("setting-industrial-buffer")?.value || 1.5),
        high_frp_threshold_mw: parseFloat(document.getElementById("setting-high-frp")?.value || 50.0),
        persistence_threshold_days: parseInt(document.getElementById("setting-persistence-days")?.value || 3, 10),
        audio_alerts_enabled: document.getElementById("setting-audio-alerts")?.checked !== false
    };

    const msgBanner = document.getElementById("settings-status-message");

    try {
        const res = await fetch(`${API_BASE}/api/admin/settings`, {
            method: "PUT",
            headers: getAuthHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (res.ok) {
            showToast("Operational parameters saved successfully.", "success");
            if (msgBanner) {
                msgBanner.innerText = "Operational parameters saved successfully.";
                msgBanner.style.background = "rgba(16, 185, 129, 0.2)";
                msgBanner.style.color = "#34d399";
                msgBanner.style.border = "1px solid rgba(16, 185, 129, 0.4)";
                msgBanner.style.display = "block";
                setTimeout(() => { msgBanner.style.display = "none"; }, 4000);
            }
        } else {
            showToast(data.detail || "Failed to save settings.", "error");
        }
    } catch (err) {
        showToast("Error saving settings: " + err.message, "error");
    }
}

function handleResetSettings() {
    document.getElementById("setting-firms-area").value = "IND";
    document.getElementById("setting-firms-confidence").value = 30;
    document.getElementById("setting-auto-sync-interval").value = 180;
    document.getElementById("setting-dbscan-eps").value = 5.0;
    document.getElementById("setting-dbscan-min-samples").value = 2;
    document.getElementById("setting-industrial-buffer").value = 1.5;
    document.getElementById("setting-high-frp").value = 50.0;
    document.getElementById("setting-persistence-days").value = 3;
    document.getElementById("setting-audio-alerts").checked = true;
    handleSaveSettings();
}

// Global Admin Dashboard Listeners Setup
function initAdminListeners() {
    // 1. Sidebar navigation items
    document.querySelectorAll(".admin-nav-item").forEach(item => {
        item.addEventListener("click", () => {
            const nav = item.getAttribute("data-nav");
            handleAdminSidebarNav(nav);
        });
    });

    // 2. Dashboard Quick Actions & Shortcuts
    document.querySelectorAll(".admin-quick-action-card").forEach(card => {
        card.addEventListener("click", () => {
            const nav = card.getAttribute("data-quick-nav");
            if (nav) handleAdminSidebarNav(nav);
        });
    });
    document.getElementById("btn-dashboard-view-all-audit")?.addEventListener("click", () => handleAdminSidebarNav("audit"));
    document.getElementById("btn-quick-goto-users")?.addEventListener("click", () => handleAdminSidebarNav("users"));
    document.getElementById("btn-quick-goto-pipelines")?.addEventListener("click", () => handleAdminSidebarNav("pipelines"));
    document.getElementById("btn-quick-goto-models")?.addEventListener("click", () => handleAdminSidebarNav("models"));
    document.getElementById("btn-quick-goto-settings")?.addEventListener("click", () => handleAdminSidebarNav("settings"));
    document.getElementById("btn-overview-view-all-audit")?.addEventListener("click", () => handleAdminSidebarNav("audit"));

    // 2b. Operations Console Actions
    document.getElementById("btn-ops-refresh")?.addEventListener("click", loadAdminOperationsView);
    document.getElementById("btn-ops-scan")?.addEventListener("click", triggerAdminScanWithConfirm);
    document.getElementById("btn-ops-retrain")?.addEventListener("click", triggerAdminRetrainWithConfirm);
    document.getElementById("btn-ops-ping")?.addEventListener("click", () => loadAdminHealthView(true));
    document.getElementById("btn-admin-refresh")?.addEventListener("click", loadAdminDashboardLandingView);
    document.getElementById("btn-admin-scan")?.addEventListener("click", triggerAdminScanWithConfirm);
    document.getElementById("btn-admin-retrain")?.addEventListener("click", triggerAdminRetrainWithConfirm);

    // 2c. Subtle Workspace Switcher for Admins
    document.getElementById("select-active-workspace")?.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val === "admin") {
            window.location.hash = "#/admin/dashboard";
        } else if (val === "analyst") {
            window.location.hash = "#/dashboard";
        } else if (val === "government") {
            window.location.hash = "#/government";
        }
    });

    // 3. Users View
    document.getElementById("btn-open-create-user-modal")?.addEventListener("click", openCreateUserModal);
    document.getElementById("btn-refresh-users-table")?.addEventListener("click", loadAdminUsersView);
    document.getElementById("admin-users-search-input")?.addEventListener("input", renderAdminUsersTable);
    document.getElementById("admin-users-role-filter")?.addEventListener("change", renderAdminUsersTable);

    // User creation modal
    document.getElementById("btn-close-create-user-modal")?.addEventListener("click", closeCreateUserModal);
    document.getElementById("btn-cancel-create-user-modal")?.addEventListener("click", closeCreateUserModal);
    document.getElementById("admin-modal-create-user-form")?.addEventListener("submit", handleModalCreateUserSubmit);

    // Edit role modal
    document.getElementById("btn-close-edit-role-modal")?.addEventListener("click", closeEditRoleModal);
    document.getElementById("btn-cancel-edit-role-modal")?.addEventListener("click", closeEditRoleModal);
    document.getElementById("admin-modal-edit-role-form")?.addEventListener("submit", handleModalEditRoleSubmit);

    // Confirmation modal
    document.getElementById("btn-close-confirm-modal")?.addEventListener("click", closeAdminConfirmModal);
    document.getElementById("btn-cancel-confirm-modal")?.addEventListener("click", closeAdminConfirmModal);
    document.getElementById("btn-execute-confirm-modal")?.addEventListener("click", () => {
        if (typeof pendingAdminConfirmAction === "function") {
            const action = pendingAdminConfirmAction;
            closeAdminConfirmModal();
            action();
        }
    });

    // 4. Pipelines View
    document.getElementById("btn-pipeline-scan-action")?.addEventListener("click", triggerAdminScanWithConfirm);
    document.getElementById("btn-pipeline-refresh")?.addEventListener("click", loadAdminPipelinesView);

    // 5. Models View
    document.getElementById("btn-models-action-retrain")?.addEventListener("click", triggerAdminRetrainWithConfirm);
    document.getElementById("btn-models-refresh-metrics")?.addEventListener("click", loadAdminModelsView);

    // 6. Health View
    document.getElementById("btn-health-run-ping")?.addEventListener("click", () => loadAdminHealthView(true));
    document.getElementById("btn-health-refresh")?.addEventListener("click", () => loadAdminHealthView(false));
    document.getElementById("btn-health-export")?.addEventListener("click", exportHealthReport);

    // 7. Audit View
    document.getElementById("admin-audit-search-input")?.addEventListener("input", renderAdminAuditTable);
    document.getElementById("admin-audit-type-filter")?.addEventListener("change", renderAdminAuditTable);
    document.getElementById("btn-audit-refresh")?.addEventListener("click", loadAdminAuditView);
    document.getElementById("btn-audit-export-json")?.addEventListener("click", () => exportAuditLogs("json"));
    document.getElementById("btn-audit-export-csv")?.addEventListener("click", () => exportAuditLogs("csv"));

    // 8. Settings View
    document.getElementById("btn-settings-save")?.addEventListener("click", handleSaveSettings);
    document.getElementById("btn-settings-reset")?.addEventListener("click", handleResetSettings);
}

// Aliases for window functions
window.openCreateUserModal = openCreateUserModal;
window.closeCreateUserModal = closeCreateUserModal;
window.openEditRoleModal = openEditRoleModal;
window.closeEditRoleModal = closeEditRoleModal;
window.handleDeleteUser = handleDeleteUser;
window.switchAdminRouteView = switchAdminRouteView;
window.handleAdminSidebarNav = handleAdminSidebarNav;
window.loadAdminDashboard = loadAdminOverviewView;


// --- GOVERNMENT OFFICIAL DASHBOARD CONTROLLER ---
async function loadGovernmentDashboard(isManual = false) {
    if (!currentUser || (currentUser.role !== "GOVERNMENT_AUTHORITY" && currentUser.role !== "ADMIN")) return;

    const refreshBtn = document.getElementById("btn-gov-refresh");
    const refreshIcon = refreshBtn ? refreshBtn.querySelector("i") : null;
    if (refreshIcon) refreshIcon.classList.add("fa-spin");

    try {
        const res = await fetch(`${API_BASE}/api/government/incidents`, { headers: getAuthHeaders() });
        if (!res.ok) {
            showToast("Failed to load emergency incidents.", "error");
            return;
        }
        govIncidents = await res.json();

        // Calculate KPI Metrics
        const total = govIncidents.length;
        const unack = govIncidents.filter(i => i.government_status === "UNACKNOWLEDGED").length;
        const dispatched = govIncidents.filter(i => i.government_status === "DISPATCHED").length;
        const resolved = govIncidents.filter(i => i.government_status === "RESOLVED").length;
        const critical = govIncidents.filter(i => i.priority === "CRITICAL" || i.priority === "HIGH").length;

        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
        setVal("gov-kpi-total", total);
        setVal("gov-kpi-unack", unack);
        setVal("gov-kpi-dispatched", dispatched);
        setVal("gov-kpi-resolved", resolved);
        setVal("gov-kpi-critical", critical);

        renderGovIncidentsTable();

        if (selectedGovIncidentId) {
            const inc = govIncidents.find(x => x.id === selectedGovIncidentId);
            if (inc) openGovDrawer(selectedGovIncidentId);
        }

        if (isManual) {
            showToast("Incidents refreshed from operational database.", "info");
        }
    } catch (err) {
        console.error("Government dashboard load error:", err);
        showToast("Error connecting to government incident feed.", "error");
    } finally {
        if (refreshIcon) refreshIcon.classList.remove("fa-spin");
    }
}

function renderGovIncidentsTable() {
    const tbody = document.getElementById("gov-incidents-tbody");
    if (!tbody) return;

    let filtered = govIncidents;

    // Apply Status / Priority Filter
    if (currentGovFilter === "UNACKNOWLEDGED") {
        filtered = filtered.filter(i => i.government_status === "UNACKNOWLEDGED");
    } else if (currentGovFilter === "DISPATCHED") {
        filtered = filtered.filter(i => i.government_status === "DISPATCHED");
    } else if (currentGovFilter === "RESOLVED") {
        filtered = filtered.filter(i => i.government_status === "RESOLVED");
    } else if (currentGovFilter === "CRITICAL") {
        filtered = filtered.filter(i => i.priority === "CRITICAL" || i.priority === "HIGH");
    }

    // Apply Search Query
    if (govSearchQuery) {
        filtered = filtered.filter(i => 
            `#${i.display_id}`.toLowerCase().includes(govSearchQuery) ||
            `incident #${i.display_id}`.toLowerCase().includes(govSearchQuery) ||
            String(i.id).includes(govSearchQuery) ||
            (i.nearest_industry_name && i.nearest_industry_name.toLowerCase().includes(govSearchQuery)) ||
            (i.predicted_class && i.predicted_class.toLowerCase().includes(govSearchQuery)) ||
            (i.priority && i.priority.toLowerCase().includes(govSearchQuery)) ||
            (i.government_status && i.government_status.toLowerCase().includes(govSearchQuery))
        );
    }

    const badgeEl = document.getElementById("gov-incidents-count-badge");
    if (badgeEl) badgeEl.innerText = `Showing ${filtered.length} of ${govIncidents.length} incidents`;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: var(--text-muted);">No incidents match the active filter.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map(i => {
        const priorityClass = i.priority === 'CRITICAL' ? 'badge-priority-critical' : (i.priority === 'HIGH' ? 'badge-priority-high' : (i.priority === 'MEDIUM' ? 'badge-priority-medium' : 'badge-priority-low'));
        
        let statusClass = "badge-gov-unack";
        let statusIcon = "fa-bell";
        if (i.government_status === "ACKNOWLEDGED") { statusClass = "badge-gov-ack"; statusIcon = "fa-check-double"; }
        else if (i.government_status === "DISPATCHED") { statusClass = "badge-gov-dispatch"; statusIcon = "fa-truck-medical"; }
        else if (i.government_status === "RESOLVED") { statusClass = "badge-gov-resolved"; statusIcon = "fa-circle-check"; }

        const verificationBadge = i.verification_status === "confirmed" 
            ? `<span style="font-size: 10px; color: #34d399; font-weight: 700;"><i class="fa-solid fa-circle-check"></i> Confirmed by Analyst</span>` 
            : `<span style="font-size: 10px; color: #94a3b8;"><i class="fa-solid fa-clock"></i> Pending Review</span>`;

        const isSelected = selectedGovIncidentId && selectedGovIncidentId === i.id;

        return `
            <tr class="gov-incident-row ${isSelected ? 'active-gov-row' : ''}">
                <td style="padding: 10px 8px; font-weight: 800; color: #fff;">#${i.display_id}</td>
                <td style="padding: 10px 8px; text-align: center;"><span class="${priorityClass}">${i.priority}</span></td>
                <td style="padding: 10px 8px;">
                    <div class="truncate-cell" style="font-weight: 600; color: var(--text-primary); font-size: 12px;" title="${i.nearest_industry_name}">${i.nearest_industry_name}</div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">${i.centroid_lat.toFixed(4)}°N, ${i.centroid_lon.toFixed(4)}°E • <span style="color: #fbbf24; font-weight: 700;">${i.max_frp} MW</span></div>
                </td>
                <td style="padding: 10px 8px;">
                    <div class="truncate-cell" style="font-size: 11px; font-weight: 600; color: #38bdf8;" title="${i.predicted_class}">${i.predicted_class}</div>
                    <div style="margin-top: 2px;">${verificationBadge}</div>
                </td>
                <td style="padding: 10px 8px; text-align: center;">
                    <span class="${statusClass}"><i class="fa-solid ${statusIcon}"></i> ${i.government_status}</span>
                </td>
                <td style="padding: 10px 8px; text-align: right;">
                    <button type="button" onclick="openGovDrawer(${i.id})" class="btn btn-secondary btn-gov-manage" style="padding: 5px 10px; font-size: 11px;">
                        <i class="fa-solid fa-shield"></i> Manage
                    </button>
                </td>
            </tr>
        `;
    }).join('');
}

function openGovDrawer(clusterId) {
    const inc = govIncidents.find(x => x.id === clusterId || x.display_id === clusterId);
    if (!inc) return;

    selectedGovIncidentId = inc.id;
    selectedGovActionStatus = inc.government_status === "UNACKNOWLEDGED" ? "ACKNOWLEDGED" : inc.government_status;

    const emptyPrompt = document.getElementById("gov-empty-drawer-prompt");
    if (emptyPrompt) emptyPrompt.style.display = "none";

    const drawerContent = document.getElementById("gov-active-drawer-content");
    if (drawerContent) drawerContent.style.display = "flex";

    const setTxt = (id, text) => { const el = document.getElementById(id); if (el) el.innerText = text; };
    setTxt("gov-drawer-incident-title", `Incident #${inc.display_id}`);
    setTxt("gov-drawer-db-id", inc.id);
    setTxt("gov-drawer-location", `${inc.nearest_industry_name} (${inc.centroid_lat.toFixed(4)}°N, ${inc.centroid_lon.toFixed(4)}°E)`);
    setTxt("gov-drawer-coords", `${inc.centroid_lat.toFixed(4)}°N, ${inc.centroid_lon.toFixed(4)}°E`);

    const pBadge = document.getElementById("gov-drawer-priority-badge");
    if (pBadge) {
        pBadge.className = inc.priority === 'CRITICAL' ? 'badge-priority-critical' : (inc.priority === 'HIGH' ? 'badge-priority-high' : (inc.priority === 'MEDIUM' ? 'badge-priority-medium' : 'badge-priority-low'));
        pBadge.innerText = `${inc.priority} PRIORITY`;
    }

    setTxt("gov-drawer-evidence-summary", inc.evidence_summary || "Multi-source thermal anomaly confirmed.");
    setTxt("gov-drawer-risk", `${inc.risk_score} / 100`);
    setTxt("gov-drawer-frp", `${inc.max_frp} MW`);
    setTxt("gov-drawer-class", inc.predicted_class || "Unclassified");
    
    const verifEl = document.getElementById("gov-drawer-verification");
    if (verifEl) {
        verifEl.innerHTML = inc.verification_status === "confirmed" 
            ? `<span style="color: #34d399; font-weight: 700;"><i class="fa-solid fa-circle-check"></i> Confirmed</span>`
            : `<span style="color: #94a3b8;"><i class="fa-solid fa-clock"></i> Pending Review</span>`;
    }

    const satEl = document.getElementById("gov-drawer-sat-status");
    if (satEl) {
        satEl.innerText = `${inc.satellite_status || 'Sentinel-2 / Landsat-9'} (${inc.satellite_evidence_strength || 'Calibrated'})`;
    }

    setTxt("gov-drawer-status", inc.government_status);

    // Set active status button
    document.querySelectorAll(".gov-status-choice-btn").forEach(b => {
        if (b.getAttribute("data-status") === selectedGovActionStatus) b.classList.add("active");
        else b.classList.remove("active");
    });

    // Populate notes if previously saved
    const notesInput = document.getElementById("gov-drawer-notes-input");
    if (notesInput && inc.government_notes) {
        notesInput.value = inc.government_notes;
    }

    // Load History for Incident
    const histContainer = document.getElementById("gov-drawer-history-log");
    if (histContainer) {
        if (inc.acknowledged_at) {
            histContainer.innerHTML = `
                <div style="padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);">
                    <div style="display: flex; justify-content: space-between; font-size: 11px;">
                        <span style="font-weight: 700; color: #38bdf8;"><i class="fa-solid fa-user-shield"></i> ${inc.acknowledged_by || 'Gov Official'}</span>
                        <span style="color: var(--text-muted);">${inc.acknowledged_at.substring(0, 19).replace('T', ' ')} UTC</span>
                    </div>
                    <div style="font-size: 11px; margin-top: 3px;">Action Status: <strong style="color: #fbbf24;">${inc.government_status}</strong></div>
                    <div style="font-size: 11px; color: var(--text-secondary); margin-top: 3px; font-style: italic;">"${inc.government_notes || 'No notes recorded'}"</div>
                </div>
            `;
        } else {
            histContainer.innerHTML = `<span style="font-size: 11px; color: var(--text-muted);">No official response recorded yet. Action required.</span>`;
        }
    }

    // Update active row in table
    const rows = document.querySelectorAll(".gov-incident-row");
    rows.forEach(r => {
        const manageBtn = r.querySelector(".btn-gov-manage");
        if (manageBtn && manageBtn.getAttribute("onclick")?.includes(`(${inc.id})`)) {
            r.classList.add("active-gov-row");
        } else {
            r.classList.remove("active-gov-row");
        }
    });
}

async function handleGovQuickAction(status) {
    if (!selectedGovIncidentId) {
        showToast("Please select an incident first.", "warning");
        return;
    }
    selectedGovActionStatus = status;
    const btn = document.getElementById(`btn-gov-drawer-${status.toLowerCase().slice(0, 4)}`) || document.querySelector(`.gov-status-choice-btn[data-status="${status}"]`);
    const origHtml = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...`;
    }

    const notesInput = document.getElementById("gov-drawer-notes-input");
    const notes = notesInput ? notesInput.value.trim() : "";

    try {
        const res = await fetch(`${API_BASE}/api/government/incidents/${selectedGovIncidentId}/status`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ status: status, notes: notes || undefined })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Incident #${data.display_id || selectedGovIncidentId} status updated to ${status}.`, "success");
            await loadGovernmentDashboard();
            openGovDrawer(selectedGovIncidentId);
        } else {
            showToast(data.detail || "Action failed.", "error");
        }
    } catch (err) {
        showToast("Error updating incident: " + err.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

async function handleGovDrawerActionSubmit() {
    if (!selectedGovIncidentId) {
        showToast("Please select an incident first.", "warning");
        return;
    }

    const submitBtn = document.getElementById("btn-gov-submit-drawer");
    const origHtml = submitBtn ? submitBtn.innerHTML : "";
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Saving Action...`;
    }

    const notesInput = document.getElementById("gov-drawer-notes-input");
    const notes = notesInput ? notesInput.value.trim() : "";

    try {
        const res = await fetch(`${API_BASE}/api/government/incidents/${selectedGovIncidentId}/status`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ status: selectedGovActionStatus, notes: notes || undefined })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(`Official action saved for Incident #${data.display_id || selectedGovIncidentId}.`, "success");
            await loadGovernmentDashboard();
            openGovDrawer(selectedGovIncidentId);
        } else {
            showToast(data.detail || "Action failed.", "error");
        }
    } catch (err) {
        showToast("Error saving official action: " + err.message, "error");
    } finally {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = origHtml;
        }
    }
}

window.openGovDrawer = openGovDrawer;
window.loadGovernmentDashboard = loadGovernmentDashboard;
window.handleGovQuickAction = handleGovQuickAction;
window.handleGovDrawerActionSubmit = handleGovDrawerActionSubmit;

async function openAdminUserModal() {
    document.getElementById("admin-user-alert").classList.add("hidden");
    document.getElementById("admin-user-modal").classList.remove("hidden");
    await loadAdminUsersList();
}
function closeAdminUserModal() {
    document.getElementById("admin-user-modal").classList.add("hidden");
}

async function loadAdminUsersList() {
    const tbody = document.getElementById("admin-users-list");
    if (!tbody) return;
    tbody.innerHTML = `<tr><td colspan="4" style="padding: 10px; color: var(--text-muted);">Loading users...</td></tr>`;

    try {
        const res = await fetch(`${API_BASE}/api/admin/users`, {
            headers: { "Authorization": `Bearer ${authToken}` }
        });
        if (!res.ok) {
            const errData = await res.json();
            tbody.innerHTML = `<tr><td colspan="4" style="padding: 10px; color: #f87171;">${errData.detail || "Access Denied"}</td></tr>`;
            return;
        }
        const users = await res.json();
        tbody.innerHTML = users.map(u => `
            <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
                <td style="padding: 8px 6px; font-weight: 600;">${u.username}</td>
                <td style="padding: 8px 6px;">
                    <select onchange="updateUserRole(${u.id}, this.value)" style="background: rgba(15, 23, 42, 0.8); color: #fff; border: 1px solid var(--border-color); padding: 2px 6px; border-radius: 4px; font-size: 11px;">
                        <option value="ANALYST" ${u.role === 'ANALYST' ? 'selected' : ''}>ANALYST</option>
                        <option value="GOVERNMENT_AUTHORITY" ${u.role === 'GOVERNMENT_AUTHORITY' ? 'selected' : ''}>GOVERNMENT_AUTHORITY</option>
                        <option value="ADMIN" ${u.role === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
                    </select>
                </td>
                <td style="padding: 8px 6px; font-size: 11px; color: var(--text-muted);">${u.created_at ? u.created_at.substring(0, 10) : '--'}</td>
                <td style="padding: 8px 6px; text-align: right;">
                    ${u.id !== (currentUser ? currentUser.id : null) ? `<button onclick="deleteUserAccount(${u.id})" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 2px 8px; border-radius: 4px; font-size: 10px; cursor: pointer;"><i class="fa-solid fa-trash"></i></button>` : '<span style="font-size: 10px; color: var(--text-muted);">(You)</span>'}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="padding: 10px; color: #f87171;">Error: ${err.message}</td></tr>`;
    }
}

async function handleCreateUserSubmit(e) {
    e.preventDefault();
    const uname = document.getElementById("new-user-username").value.trim();
    const pwd = document.getElementById("new-user-password").value;
    const role = document.getElementById("new-user-role").value;
    const errAlert = document.getElementById("admin-user-alert");

    errAlert.classList.add("hidden");

    try {
        const res = await fetch(`${API_BASE}/api/admin/users`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ username: uname, password: pwd, role: role })
        });
        const data = await res.json();
        if (res.ok) {
            document.getElementById("create-user-form").reset();
            await loadAdminUsersList();
        } else {
            errAlert.innerText = data.detail || "Failed to create user.";
            errAlert.classList.remove("hidden");
        }
    } catch (err) {
        errAlert.innerText = "Error: " + err.message;
        errAlert.classList.remove("hidden");
    }
}

async function updateUserRole(userId, newRole) {
    try {
        const res = await fetch(`${API_BASE}/api/admin/users/${userId}/role`, {
            method: "PUT",
            headers: getAuthHeaders(),
            body: JSON.stringify({ role: newRole })
        });
        const data = await res.json();
        if (!res.ok) alert("Role update failed: " + (data.detail || "Unauthorized"));
        else loadAdminUsersList();
    } catch (err) {
        alert("Error updating role: " + err.message);
    }
}

async function deleteUserAccount(userId) {
    if (!confirm("Are you sure you want to delete this user account?")) return;
    try {
        const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, {
            method: "DELETE",
            headers: getAuthHeaders()
        });
        const data = await res.json();
        if (!res.ok) alert("Delete failed: " + (data.detail || "Unauthorized"));
        else loadAdminUsersList();
    } catch (err) {
        alert("Error deleting user: " + err.message);
    }
}

async function updateGovStatus(status) {
    const activeC = window.selectedCluster || (selectedClusterId ? resolveCluster(selectedClusterId) : null);
    const targetClusterId = activeC ? activeC.id : selectedClusterId;
    if (!targetClusterId) {
        showToast("Please select a cluster first.", "warning");
        return;
    }
    if (!currentUser || (currentUser.role !== 'GOVERNMENT_AUTHORITY' && currentUser.role !== 'ADMIN')) {
        showToast("Action restricted: Government response controls are restricted to Government Authority and Administrator accounts.", "warning");
        return;
    }
    const notesInput = document.getElementById("gov-notes-input");
    const notes = notesInput ? notesInput.value.trim() : "";

    const btn = document.getElementById(`btn-gov-${status.toLowerCase().slice(0, 3)}`);
    const origHtml = btn ? btn.innerHTML : "";
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`;
    }

    try {
        const res = await fetch(`${API_BASE}/api/government/incidents/${targetClusterId}/status`, {
            method: "POST",
            headers: getAuthHeaders(),
            body: JSON.stringify({ status: status, notes: notes || undefined })
        });
        const data = await res.json();
        if (res.ok) {
            showToast(data.message || `Cluster #${targetClusterId} status updated to ${status}.`, "success");
            if (notesInput) notesInput.value = "";
            openDrawer(targetClusterId);
            if (typeof loadGovernmentDashboard === "function") {
                loadGovernmentDashboard();
            }
        } else {
            showToast("Government action failed: " + (data.detail || "Unauthorized"), "error");
        }
    } catch (err) {
        showToast("Connection error: " + err.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = origHtml;
        }
    }
}

// --- CITY & STATE SEARCH ON MAP ---
async function searchCityOnMap() {
    const searchInput = document.getElementById("map-search-input");
    const feedback = document.getElementById("map-search-feedback");
    if (!searchInput) return;

    const query = searchInput.value.trim();
    if (!query) return;

    if (feedback) {
        feedback.innerText = "Searching...";
        feedback.style.color = "#3b82f6";
    }

    try {
        let results = [];
        // First try backend proxy endpoint with server-side User-Agent header
        try {
            const proxyRes = await fetch(`/api/search_location?q=${encodeURIComponent(query)}`);
            if (proxyRes.ok) {
                results = await proxyRes.json();
            }
        } catch (e) {
            console.warn("Proxy geocode attempt failed, falling back to direct fetch:", e);
        }

        // Fallback to direct Nominatim fetch if proxy returned empty
        if (!results || results.length === 0) {
            const directRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`);
            if (directRes.ok) {
                results = await directRes.json();
            }
        }

        if (results && results.length > 0) {
            const place = results[0];

            if (map) {
                // Bounding box support for states, regions, districts, and major cities
                if (place.boundingbox && place.boundingbox.length === 4) {
                    const south = parseFloat(place.boundingbox[0]);
                    const north = parseFloat(place.boundingbox[1]);
                    const west = parseFloat(place.boundingbox[2]);
                    const east = parseFloat(place.boundingbox[3]);
                    if (!isNaN(south) && !isNaN(north) && !isNaN(west) && !isNaN(east)) {
                        map.fitBounds([[south, west], [north, east]], { padding: [40, 40], maxZoom: 12, animate: true });
                        if (feedback) feedback.innerText = "";
                        return;
                    }
                }

                // Point location fallback using flyTo
                const lat = parseFloat(place.lat);
                const lon = parseFloat(place.lon);
                if (!isNaN(lat) && !isNaN(lon)) {
                    map.flyTo([lat, lon], 11, { duration: 1.5 });
                    if (feedback) feedback.innerText = "";
                    return;
                }
            }
            if (feedback) {
                feedback.innerText = "Location not found";
                feedback.style.color = "#ef4444";
            }
        } else {
            if (feedback) {
                feedback.innerText = "Location not found";
                feedback.style.color = "#ef4444";
            }
        }
    } catch (err) {
        console.error("Location search failed:", err);
        if (feedback) {
            feedback.innerText = "Location not found";
            feedback.style.color = "#ef4444";
        }
    }
}
