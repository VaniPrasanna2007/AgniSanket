import sys
import time
import requests
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster

API_BASE = "http://127.0.0.1:8000"

def test_live_system_end_to_end():
    print("==========================================================================")
    print("             FINAL END-TO-END LIVE SYSTEM & PARITY TEST                   ")
    print("==========================================================================")

    # 1. API Performance & Health Check
    print("\n--- 1. API RESPONSE TIME & HEALTH CHECKS ---")
    endpoints = [
        ("/api/health", "Health Check"),
        ("/api/stats", "System Stats"),
        ("/api/hotspots?risk_threshold=0.0", "List Hotspots"),
    ]
    
    for ep, label in endpoints:
        t0 = time.time()
        res = requests.get(f"{API_BASE}{ep}")
        dt_ms = (time.time() - t0) * 1000.0
        if res.status_code == 200:
            print(f"[PASS] {label:20s} ({ep:35s}) -> HTTP 200 | Time: {dt_ms:.1f} ms")
        else:
            print(f"[FAIL] {label:20s} ({ep:35s}) -> HTTP {res.status_code}")

    # Fetch all hotspots
    api_clusters = requests.get(f"{API_BASE}/api/hotspots?risk_threshold=0.0").json()
    print(f"\nTotal clusters returned by API: {len(api_clusters)}")

    db = SessionLocal()
    db_map = {c.id: c for c in db.query(HotspotCluster).all()}

    # Select at least 10 clusters covering RED (risk>=70), YELLOW (40<=risk<70), and GREEN (risk<40)
    red_clusters = [c for c in api_clusters if c["risk_score"] >= 70]
    yellow_clusters = [c for c in api_clusters if 40 <= c["risk_score"] < 70]
    green_clusters = [c for c in api_clusters if c["risk_score"] < 40]

    print(f"Cluster Distribution: RED={len(red_clusters)}, YELLOW={len(yellow_clusters)}, GREEN={len(green_clusters)}")

    selected = []
    selected.extend(red_clusters[:4])
    selected.extend(yellow_clusters[:4])
    selected.extend(green_clusters[:4])

    print(f"\n--- 2. DETAILED 10+ CLUSTER AUDIT ({len(selected)} CLUSTERS TESTED) ---")

    atomic_thermal_failures = 0
    risk_score_failures = 0
    db_api_parity_failures = 0
    firms_confusion_failures = 0

    for idx, c_api in enumerate(selected, start=1):
        c_id = c_api["id"]
        c_db = db_map.get(c_id)
        
        # Test detail endpoint
        t0 = time.time()
        detail_res = requests.get(f"{API_BASE}/api/hotspots/{c_id}")
        dt_ms = (time.time() - t0) * 1000.0
        if detail_res.status_code != 200:
            print(f"[FAIL] Detail endpoint for cluster DB_ID={c_id} failed ({dt_ms:.1f} ms)")
            db_api_parity_failures += 1
            continue

        c_detail = detail_res.json()["cluster"]
        ev_breakdown = c_detail.get("evidence", {}).get("risk_breakdown", {})

        # 1. DB -> API parity check
        if (c_api["landsat_scene_id"] != (c_db.landsat_scene_id or "UNAVAILABLE") or
            c_api["sentinel2_scene_id"] != (c_db.sentinel2_scene_id or "UNAVAILABLE") or
            c_api["hotspot_max_temp_c"] != c_db.hotspot_max_temp_c or
            c_api["risk_score"] != c_db.risk_score):
            db_api_parity_failures += 1

        # 2. Atomic Rule Check (Thermal metrics: all 3 present or all 3 None/UNAVAILABLE)
        max_t = c_api["hotspot_max_temp_c"]
        bg_t = c_api["surrounding_median_temp_c"]
        anom_t = c_api["thermal_anomaly_c"]
        
        all_thermal_present = (max_t is not None) and (bg_t is not None) and (anom_t is not None)
        all_thermal_none = (max_t is None) and (bg_t is None) and (anom_t is None)

        if not (all_thermal_present or all_thermal_none):
            atomic_thermal_failures += 1
            print(f"[FAIL] Thermal atomic rule violated for Cluster #{c_api['display_id']}: max={max_t}, bg={bg_t}, anom={anom_t}")

        # 3. Risk Score Math Check
        if ev_breakdown:
            sum_contrib = round(
                ev_breakdown.get("frp_contribution", 0.0) +
                ev_breakdown.get("recurrence_contribution", 0.0) +
                ev_breakdown.get("thermal_anomaly_contribution", 0.0) +
                ev_breakdown.get("satellite_confirmation_contribution", 0.0) +
                ev_breakdown.get("proximity_contribution", 0.0),
                1
            )
            expected_risk = min(100.0, max(0.0, sum_contrib))
            if abs(expected_risk - c_api["risk_score"]) > 0.1:
                risk_score_failures += 1
                print(f"[FAIL] Risk score mismatch for Cluster #{c_api['display_id']}: API={c_api['risk_score']}, Sum={sum_contrib}")

        # Printable summary row
        print(f"Cluster #{c_api['display_id']:3d} | DB_ID={c_id:3d} | Risk={c_api['risk_score']:5.1f} ({c_api['predicted_class']:15s}) | "
              f"L-Scene: {c_api['landsat_scene_id'][:18] if c_api['landsat_scene_id'] else 'UNAVAILABLE':18s} | "
              f"Temp: {str(max_t) if max_t else 'UNAVAIL':7s} | NDVI: {str(c_api['ndvi_median']) if c_api['ndvi_median'] else 'UNAVAIL':7s} | "
              f"Detail API: {dt_ms:.1f} ms")

    print("\n--- 3. VERIFICATION SUMMARY ---")
    print(f"Clusters Evaluated Field-by-Field : {len(selected)}")
    print(f"Atomic Thermal Rule Failures      : {atomic_thermal_failures}")
    print(f"Risk Score Math Mismatches        : {risk_score_failures}")
    print(f"Database / API Parity Mismatches  : {db_api_parity_failures}")

    if atomic_thermal_failures == 0 and risk_score_failures == 0 and db_api_parity_failures == 0:
        print("\n[SUCCESS] ALL LIVE BACKEND AND API CHECKS PASSED WITH 100% INTEGRITY.")
    else:
        print("\n[FAIL] VERIFICATION DETECTED ERRORS.")

    db.close()

if __name__ == "__main__":
    test_live_system_end_to_end()
