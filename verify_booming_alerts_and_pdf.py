import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import websocket

CHROME_PATH = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
USER_DATA_DIR = tempfile.mkdtemp(prefix="chrome_verify_booming_")
BASE_URL = "http://127.0.0.1:8000"
CDP_PORT = 9348

call_id = 0
console_logs = []

def send_cdp(ws, method, params=None):
    global call_id
    call_id += 1
    msg = {"id": call_id, "method": method, "params": params or {}}
    ws.send(json.dumps(msg))
    while True:
        res = json.loads(ws.recv())
        if res.get("method") == "Runtime.consoleAPICalled":
            args = res.get("params", {}).get("args", [])
            text = " ".join([str(a.get("value", a.get("description", ""))) for a in args])
            console_logs.append(text)
        elif res.get("method") == "Runtime.exceptionThrown":
            exc = res.get("params", {}).get("exceptionDetails", {})
            text = exc.get("text", "") + " " + exc.get("exception", {}).get("description", "")
            console_logs.append("[JS EXCEPTION] " + text)
        if res.get("id") == call_id:
            return res.get("result", {})

def eval_js(ws, expr):
    res = send_cdp(ws, "Runtime.evaluate", {
        "expression": expr,
        "returnByValue": True,
        "awaitPromise": True
    })
    if "exceptionDetails" in res:
        print("JS EXCEPTION:", res["exceptionDetails"])
    return res.get("result", {}).get("value")

def capture_screenshot(ws, filename):
    res = send_cdp(ws, "Page.captureScreenshot", {"format": "png"})
    if "data" in res:
        img_bytes = base64.b64decode(res["data"])
        with open(filename, "wb") as f:
            f.write(img_bytes)
        print(f"  [SCREENSHOT] Saved: {filename} ({len(img_bytes)} bytes)")
        return True
    return False

def main():
    print("==========================================================================")
    print("   BOOMING ALERTS & PDF REPORT DOWNLOAD/PRINT BROWSER VERIFICATION       ")
    print("==========================================================================")
    
    os.makedirs(USER_DATA_DIR, exist_ok=True)
    chrome_cmd = [
        CHROME_PATH,
        "--headless=new",
        f"--remote-debugging-port={CDP_PORT}",
        "--remote-allow-origins=*",
        "--disable-extensions",
        f"--user-data-dir={USER_DATA_DIR}",
        "--window-size=1920,1080",
        "--disable-gpu",
        "--no-sandbox",
        "about:blank"
    ]
    
    print(f"Launching Chrome on CDP port {CDP_PORT}...")
    proc = subprocess.Popen(chrome_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    results = {
        "government": {},
        "analyst": {},
        "screenshots": [],
        "overall_success": False
    }
    
    ws = None
    try:
        for _ in range(25):
            time.sleep(0.3)
            try:
                req = urllib.request.urlopen(f"http://127.0.0.1:{CDP_PORT}/json")
                tabs = json.loads(req.read().decode())
                page_tab = next((t for t in tabs if t.get("type") == "page" and not t.get("url", "").startswith("chrome-extension://")), None)
                if not page_tab:
                    page_tab = next((t for t in tabs if t.get("type") == "page"), None)
                if page_tab and page_tab.get("webSocketDebuggerUrl"):
                    ws = websocket.create_connection(page_tab["webSocketDebuggerUrl"], timeout=10)
                    break
            except Exception:
                pass
                
        if not ws:
            raise RuntimeError(f"Could not connect to Chrome CDP on port {CDP_PORT}")
            
        send_cdp(ws, "Page.enable")
        send_cdp(ws, "Runtime.enable")
        send_cdp(ws, "Network.enable")
        send_cdp(ws, "Console.enable")
        
        # -------------------------------------------------------------
        # STEP 1: GOVERNMENT OFFICIAL LOGIN & BOOMING ALERT VERIFICATION
        # -------------------------------------------------------------
        print("\n--- [TEST 1] GOVERNMENT OFFICIAL LOGIN & BOOMING ALERT ---")
        send_cdp(ws, "Page.navigate", {"url": f"{BASE_URL}/#/login"})
        time.sleep(1.5)
        
        gov_login = eval_js(ws, """
        (async () => {
            for (let i = 0; i < 40; i++) {
                if (document.getElementById('login-form')) break;
                await new Promise(r => setTimeout(r, 100));
            }
            try { sessionStorage.clear(); } catch(e) {}
            document.getElementById('login-username').value = 'gov1';
            document.getElementById('login-password').value = 'GovAuth123!';
            document.getElementById('login-role').value = 'GOVERNMENT_AUTHORITY';
            document.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true }));
            for (let i = 0; i < 40; i++) {
                await new Promise(r => setTimeout(r, 150));
                if (document.getElementById('booming-critical-banner') && document.getElementById('booming-critical-banner').style.display === 'block') {
                    break;
                }
            }
            
            return {
                role: currentUser ? currentUser.role : null,
                username: currentUser ? currentUser.username : null,
                govDashboardDisplay: document.getElementById('government-dashboard').style.display,
                bannerDisplay: document.getElementById('booming-critical-banner').style.display,
                bannerText: document.getElementById('booming-banner-text').innerText,
                modalDisplay: document.getElementById('emergency-booming-alert-overlay').style.display,
                modalTitle: document.getElementById('booming-alert-title').innerText,
                modalBadge: document.getElementById('booming-alert-badge').innerText,
                incidentId: document.getElementById('booming-incident-id').innerText,
                incidentStatus: document.getElementById('booming-incident-status').innerText,
                riskScore: document.getElementById('booming-risk-score').innerText,
                frp: document.getElementById('booming-frp').innerText,
                classification: document.getElementById('booming-class').innerText,
                location: document.getElementById('booming-location').innerText,
                coords: document.getElementById('booming-coords').innerText,
                primaryBtnText: document.getElementById('btn-booming-primary-action').innerText
            };
        })()
        """)
        
        print(f"Government Login & Booming Alert state:\n{json.dumps(gov_login, indent=2)}")
        assert gov_login["role"] == "GOVERNMENT_AUTHORITY", f"Role mismatch: {gov_login['role']}"
        assert gov_login["govDashboardDisplay"] == "flex", f"Gov dashboard not flex: {gov_login['govDashboardDisplay']}"
        assert gov_login["bannerDisplay"] == "block", f"Banner not block: {gov_login['bannerDisplay']}"
        assert gov_login["modalDisplay"] == "flex", f"Modal overlay not flex: {gov_login['modalDisplay']}"
        assert "CRITICAL" in gov_login["modalTitle"] or "OFFICIAL" in gov_login["modalTitle"], "Modal title mismatch"
        print("  [PASS] Government Official login succeeded and Booming Critical Alert triggered on screen!")
        
        gov_screen = "c:\\Users\\vanip\\Downloads\\sih26162-thermal-detection\\government_booming_alert.png"
        capture_screenshot(ws, gov_screen)
        results["screenshots"].append(gov_screen)
        results["government"]["login_and_alert"] = gov_login
        
        # -------------------------------------------------------------
        # STEP 2: TEST PRIMARY ACTION DISPATCH FROM BOOMING ALERT
        # -------------------------------------------------------------
        print("\n--- [TEST 2] BOOMING ALERT 'TAKE IMMEDIATE ACTION' DIRECTIVE ---")
        action_outcome = eval_js(ws, """
        (() => {
            document.getElementById('btn-booming-primary-action').click();
            return {
                modalDisplayAfter: document.getElementById('emergency-booming-alert-overlay').style.display,
                bannerDisplayAfter: document.getElementById('booming-critical-banner').style.display,
                drawerDisplay: document.getElementById('gov-active-drawer-content').style.display,
                drawerTitle: document.getElementById('gov-drawer-incident-title').innerText,
                drawerStatusVal: selectedGovActionStatus,
                dispatchBtnActive: document.getElementById('btn-gov-drawer-dispatch').classList.contains('active')
            };
        })()
        """)
        print(f"Action Outcome:\n{json.dumps(action_outcome, indent=2)}")
        assert action_outcome["modalDisplayAfter"] == "none", "Modal should be closed after clicking action"
        assert action_outcome["drawerDisplay"] == "flex", "Drawer should be open"
        assert action_outcome["drawerStatusVal"] == "DISPATCHED" or action_outcome["dispatchBtnActive"], "Status should be primed to DISPATCHED"
        print("  [PASS] 'Take Immediate Action' opens incident dispatch drawer primed to DISPATCHED!")
        results["government"]["primary_action"] = action_outcome
        
        # -------------------------------------------------------------
        # STEP 3: OFFICIAL REPORTS & PDF DOWNLOAD / PRINT
        # -------------------------------------------------------------
        print("\n--- [TEST 3] OFFICIAL REPORTS VIEW & PDF PRINT / DOWNLOAD ---")
        reports_prep = eval_js(ws, """
        (async () => {
            navigateToGovRoute('official-reports');
            for (let i = 0; i < 40; i++) {
                await new Promise(r => setTimeout(r, 200));
                const body = document.getElementById('gov-report-content-body');
                if (body && body.innerHTML.includes('metrics-table')) break;
            }
            
            return {
                currentRoute: window.location.hash,
                reportsViewDisplay: document.getElementById('gov-view-official-reports').style.display,
                btnDownloadDisplay: document.getElementById('btn-gov-download-report').style.display,
                btnPrintDisplay: document.getElementById('btn-gov-print-report').style.display,
                formatVal: document.getElementById('gov-report-format').value,
                metaText: document.getElementById('gov-report-meta').innerText,
                bodyHasTable: document.getElementById('gov-report-content-body').innerHTML.includes('metrics-table')
            };
        })()
        """)
        print(f"Reports View Prep:\n{json.dumps(reports_prep, indent=2)}")
        assert reports_prep["reportsViewDisplay"] == "flex", "Official reports view not visible"
        assert reports_prep["btnDownloadDisplay"] == "inline-flex", "Download PDF button not visible"
        assert reports_prep["bodyHasTable"] == True, "Report table was not auto-compiled"
        print("  [PASS] Official Reports view auto-compiled dossier with PDF download button visible!")
        
        report_screen = "c:\\Users\\vanip\\Downloads\\sih26162-thermal-detection\\government_reports_pdf.png"
        capture_screenshot(ws, report_screen)
        results["screenshots"].append(report_screen)
        results["government"]["reports_view"] = reports_prep
        
        # Test clicking Download File (PDF)
        print("\n--- [TEST 4] CLICKING DOWNLOAD FILE (PDF) & PRINT TRIGGER ---")
        dl_pdf_test = eval_js(ws, """
        (async () => {
            let pdfFetchUrl = null;
            let blobUrlCreated = null;
            
            // Intercept URL.createObjectURL
            const origCreate = URL.createObjectURL;
            URL.createObjectURL = function(blob) {
                const url = origCreate.call(URL, blob);
                blobUrlCreated = { url: url, size: blob.size, type: blob.type };
                return url;
            };
            
            // Track fetch
            const origFetch = window.fetch;
            window.fetch = async function(...args) {
                const res = await origFetch.apply(window, args);
                if (typeof args[0] === 'string' && args[0].includes('/api/government/reports/generate-pdf')) {
                    pdfFetchUrl = args[0];
                }
                return res;
            };
            
            // Click Download Report button
            await downloadGovOfficialReport();
            await new Promise(r => setTimeout(r, 1200));
            
            // Check for created print iframe
            const printIframes = Array.from(document.querySelectorAll('iframe')).map(f => f.src);
            
            return {
                pdfFetchUrl: pdfFetchUrl,
                blobCreated: blobUrlCreated,
                printIframes: printIframes
            };
        })()
        """)
        print(f"PDF Download & Print Outcome:\n{json.dumps(dl_pdf_test, indent=2)}")
        assert dl_pdf_test["pdfFetchUrl"] is not None and "generate-pdf" in dl_pdf_test["pdfFetchUrl"], "PDF endpoint not fetched"
        assert dl_pdf_test["blobCreated"] is not None, "Blob URL was not created"
        assert dl_pdf_test["blobCreated"]["size"] > 5000, f"Blob size too small: {dl_pdf_test['blobCreated']['size']}"
        assert len(dl_pdf_test["printIframes"]) > 0, "Print iframe was not mounted"
        print("  [PASS] Click on Download File generates official PDF and triggers browser print pipeline!")
        results["government"]["pdf_download_print"] = dl_pdf_test
        
        # -------------------------------------------------------------
        # STEP 4: LOGOUT & ANALYST MODULE BOOMING ALERT
        # -------------------------------------------------------------
        print("\n--- [TEST 5] LOGOUT & ANALYST LOGIN ---")
        eval_js(ws, """
        (async () => {
            await handleLogout();
            await new Promise(r => setTimeout(r, 800));
        })()
        """)
        
        send_cdp(ws, "Page.navigate", {"url": f"{BASE_URL}/#/login"})
        time.sleep(1.0)
        
        print("\n--- [TEST 6] ANALYST BOOMING ALERT VERIFICATION ---")
        analyst_login = eval_js(ws, """
        (async () => {
            for (let i = 0; i < 40; i++) {
                if (document.getElementById('login-form')) break;
                await new Promise(r => setTimeout(r, 100));
            }
            try { sessionStorage.clear(); } catch(e) {}
            document.getElementById('login-username').value = 'analyst1';
            document.getElementById('login-password').value = 'Analyst123!';
            document.getElementById('login-role').value = 'ANALYST';
            document.getElementById('login-form').dispatchEvent(new Event('submit', { cancelable: true }));
            for (let i = 0; i < 40; i++) {
                await new Promise(r => setTimeout(r, 200));
                if (document.getElementById('booming-critical-banner') && document.getElementById('booming-critical-banner').style.display === 'block') {
                    break;
                }
            }
            
            return {
                role: currentUser ? currentUser.role : null,
                username: currentUser ? currentUser.username : null,
                analystDashboardDisplay: document.getElementById('analyst-dashboard').style.display,
                bannerDisplay: document.getElementById('booming-critical-banner').style.display,
                bannerText: document.getElementById('booming-banner-text').innerText,
                modalDisplay: document.getElementById('emergency-booming-alert-overlay').style.display,
                modalTitle: document.getElementById('booming-alert-title').innerText,
                modalBadge: document.getElementById('booming-alert-badge').innerText,
                incidentId: document.getElementById('booming-incident-id').innerText,
                incidentStatus: document.getElementById('booming-incident-status').innerText,
                riskScore: document.getElementById('booming-risk-score').innerText,
                frp: document.getElementById('booming-frp').innerText,
                classification: document.getElementById('booming-class').innerText,
                location: document.getElementById('booming-location').innerText,
                primaryBtnText: document.getElementById('btn-booming-primary-action').innerText
            };
        })()
        """)
        print(f"Analyst Login & Booming Alert state:\n{json.dumps(analyst_login, indent=2)}")
        assert analyst_login["role"] == "ANALYST", f"Role mismatch: {analyst_login['role']}"
        assert analyst_login["analystDashboardDisplay"] == "flex", "Analyst dashboard not flex"
        assert analyst_login["bannerDisplay"] == "block", f"Banner not block: {analyst_login['bannerDisplay']}"
        assert analyst_login["modalDisplay"] == "flex", f"Modal overlay not flex: {analyst_login['modalDisplay']}"
        assert "ANALYST" in analyst_login["modalTitle"], f"Expected Analyst in modal title: {analyst_login['modalTitle']}"
        assert "Inspect Satellite Evidence" in analyst_login["primaryBtnText"], f"Expected Inspect Satellite Evidence button: {analyst_login['primaryBtnText']}"
        print("  [PASS] Analyst Module successfully triggers Booming Alert with specialized investigation directive!")
        
        analyst_screen = "c:\\Users\\vanip\\Downloads\\sih26162-thermal-detection\\analyst_booming_alert.png"
        capture_screenshot(ws, analyst_screen)
        results["screenshots"].append(analyst_screen)
        results["analyst"]["login_and_alert"] = analyst_login
        
        # -------------------------------------------------------------
        # STEP 5: ANALYST SATELLITE EVIDENCE INSPECTION DIRECTIVE
        # -------------------------------------------------------------
        print("\n--- [TEST 7] ANALYST PRIMARY ACTION (INSPECT SATELLITE EVIDENCE) ---")
        analyst_action = eval_js(ws, """
        (async () => {
            document.getElementById('btn-booming-primary-action').click();
            await new Promise(r => setTimeout(r, 800));
            const activeItem = document.querySelector('.analyst-nav-item.active');
            const activeNav = activeItem ? activeItem.getAttribute('data-nav') : null;
            return {
                modalDisplayAfter: document.getElementById('emergency-booming-alert-overlay').style.display,
                currentNav: activeNav,
                hash: window.location.hash
            };
        })()
        """)
        print(f"Analyst Action Outcome:\n{json.dumps(analyst_action, indent=2)}")
        assert analyst_action["modalDisplayAfter"] == "none", "Modal should close"
        assert analyst_action["currentNav"] in ("satellite", "investigation") and "satellite" in analyst_action["hash"], f"Unexpected analyst route: {analyst_action}"
        print("  [PASS] Analyst 'Inspect Satellite Evidence' directs straight to anomaly investigation & satellite evidence!")
        
        analyst_inspect_screen = "c:\\Users\\vanip\\Downloads\\sih26162-thermal-detection\\analyst_investigation_view.png"
        capture_screenshot(ws, analyst_inspect_screen)
        results["screenshots"].append(analyst_inspect_screen)
        results["analyst"]["primary_action"] = analyst_action
        
        results["overall_success"] = True
        print("\n==========================================================================")
        print("   ALL VERIFICATIONS PASSED PERFECTLY! 100% SUCCESSFUL TEST EXECUTION     ")
        print("==========================================================================")
        
    finally:
        if ws:
            ws.close()
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except Exception:
            proc.kill()
            
    with open("c:\\Users\\vanip\\Downloads\\sih26162-thermal-detection\\booming_pdf_verification_results.json", "w") as f:
        json.dump(results, f, indent=2)
    print("Verification results written to booming_pdf_verification_results.json")

if __name__ == "__main__":
    main()
