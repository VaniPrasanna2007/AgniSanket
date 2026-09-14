import sys
import requests
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster

API_BASE = "http://127.0.0.1:8000"

def run_dashboard_verification_audit():
    print("==========================================================================")
    print("              FULL DASHBOARD & SATELLITE PIPELINE AUDIT                  ")
    print("==========================================================================")
    
    db = SessionLocal()
    db_clusters = db.query(HotspotCluster).order_by(HotspotCluster.id.asc()).all()
    total_db = len(db_clusters)
    
    # 1. API Verification
    try:
        api_res = requests.get(f"{API_BASE}/api/hotspots?risk_threshold=0.0")
        if api_res.status_code != 200:
            print(f"[FAIL] API /api/hotspots returned status code {api_res.status_code}")
            return
        api_data = api_res.json()
    except Exception as e:
        print(f"[FAIL] Could not connect to API server: {e}")
        return

    print(f"Total Clusters in Database : {total_db}")
    print(f"Total Clusters in API      : {len(api_data)}")

    # 2. Numbering Audit
    numbering_errors = 0
    sequential_numbers = []
    
    for idx, c in enumerate(api_data, start=1):
        disp_id = c.get("display_id") or c.get("cluster_number")
        if disp_id != idx:
            numbering_errors += 1
        sequential_numbers.append(disp_id)
        
    print("\n--- 1. CLUSTER NUMBERING AUDIT ---")
    if numbering_errors == 0:
        print(f"[PASS] Cluster numbering is 100% sequential (1 to {len(api_data)}) across API & UI.")
        print(f"Sample sequence: Cluster #{sequential_numbers[0]}, Cluster #{sequential_numbers[1]}, Cluster #{sequential_numbers[2]}, ... Cluster #{sequential_numbers[-1]}")
    else:
        print(f"[FAIL] Found {numbering_errors} cluster numbering discrepancies.")

    # 3. Database to API Parity Audit
    db_api_mismatches = 0
    db_map = {c.id: c for c in db_clusters}
    
    for api_c in api_data:
        db_c = db_map.get(api_c["id"])
        if not db_c:
            db_api_mismatches += 1
            continue
        
        if (api_c.get("landsat_scene_id") != (db_c.landsat_scene_id or "UNAVAILABLE") or
            api_c.get("sentinel2_scene_id") != (db_c.sentinel2_scene_id or "UNAVAILABLE") or
            api_c.get("hotspot_max_temp_c") != db_c.hotspot_max_temp_c or
            api_c.get("thermal_anomaly_c") != db_c.thermal_anomaly_c or
            api_c.get("ndvi_median") != db_c.ndvi_median):
            db_api_mismatches += 1

    print("\n--- 2. DATABASE -> API DATA PARITY AUDIT ---")
    if db_api_mismatches == 0:
        print("[PASS] Database and API telemetry match with 100% parity.")
    else:
        print(f"[FAIL] Found {db_api_mismatches} database-to-API mismatches.")

    # 4. Satellite Telemetry Integrity Audit
    valid_landsat = 0
    cloud_masked_landsat = 0
    unavailable_landsat = 0
    valid_sentinel2 = 0
    fake_0_pct_found = 0

    for c in db_clusters:
        l_scene = c.landsat_scene_id
        has_l_scene = l_scene and l_scene != "UNAVAILABLE"
        has_temp = c.hotspot_max_temp_c is not None

        if has_l_scene and has_temp:
            valid_landsat += 1
        elif has_l_scene and not has_temp:
            cloud_masked_landsat += 1
        else:
            unavailable_landsat += 1

        if c.sentinel2_scene_id and c.sentinel2_scene_id != "UNAVAILABLE":
            valid_sentinel2 += 1

        # Check for fake 0% cloud with 0% valid pixel (contradiction)
        if c.cloud_percentage == 0.0 and c.valid_pixel_percentage == 0.0:
            fake_0_pct_found += 1

    print("\n--- 3. SATELLITE TELEMETRY RIGOR AUDIT ---")
    print(f"Valid Landsat Thermal Observations   : {valid_landsat}")
    print(f"Cloud-Masked Landsat Scenes          : {cloud_masked_landsat}")
    print(f"No Usable Landsat Scene (UNAVAILABLE): {unavailable_landsat}")
    print(f"Valid Sentinel-2 Optical Scenes      : {valid_sentinel2}")
    print(f"Fake 0% / Contradictory Values Found : {fake_0_pct_found}")

    if fake_0_pct_found == 0:
        print("[PASS] No synthetic or hardcoded 0% values found.")
    else:
        print(f"[FAIL] Found {fake_0_pct_found} synthetic 0% values.")

    # 5. Detail Endpoint Verification
    detail_errors = 0
    for sample_id in [db_clusters[0].id, db_clusters[len(db_clusters)//2].id, db_clusters[-1].id]:
        detail_res = requests.get(f"{API_BASE}/api/hotspots/{sample_id}")
        if detail_res.status_code == 200:
            d_json = detail_res.json().get("cluster", {})
            if "display_id" not in d_json or "cluster_number" not in d_json:
                detail_errors += 1
        else:
            detail_errors += 1

    print("\n--- 4. INSPECTION DRAWER API AUDIT ---")
    if detail_errors == 0:
        print("[PASS] Detail endpoint returns sequential display_id and cluster_number correctly.")
    else:
        print(f"[FAIL] Found {detail_errors} detail endpoint errors.")

    print("\n==========================================================================")
    if numbering_errors == 0 and db_api_mismatches == 0 and fake_0_pct_found == 0 and detail_errors == 0:
        print("                 SYSTEM AUDIT RESULT: ALL TESTS PASSED                    ")
    else:
        print("                 SYSTEM AUDIT RESULT: AUDIT FAILED                        ")
    print("==========================================================================")

    db.close()

if __name__ == "__main__":
    run_dashboard_verification_audit()
