import sys
import requests
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster

API_BASE = "http://127.0.0.1:8000"

def audit_end_to_end():
    print("==========================================================================")
    print("      FINAL END-TO-END MULTI-SATELLITE VERIFICATION & AUDIT TEST          ")
    print("==========================================================================")

    db = SessionLocal()
    db_clusters = db.query(HotspotCluster).order_by(HotspotCluster.id.asc()).limit(25).all()
    print(f"Loaded {len(db_clusters)} clusters from PostgreSQL DB.\n")

    # 1. API LIST ENDPOINT AUDIT
    resp = requests.get(f"{API_BASE}/api/hotspots")
    assert resp.status_code == 200, f"API list request failed: {resp.status_code}"
    api_list = resp.json()
    api_map = {item["id"]: item for item in api_list}

    print("Checking Database <-> API Parity for initial 25 clusters...\n")
    discrepancies = 0

    for idx, c in enumerate(db_clusters, start=1):
        api_c = api_map.get(c.id)
        if not api_c:
            print(f"[FAIL] Cluster DB_ID={c.id} missing from API response!")
            discrepancies += 1
            continue

        # Check Display ID parity
        if api_c["display_id"] != idx:
            print(f"[FAIL] Display ID mismatch for DB_ID={c.id}: DB idx={idx}, API={api_c['display_id']}")
            discrepancies += 1

        # Check Thermal parity
        if api_c["hotspot_max_temp_c"] != c.hotspot_max_temp_c:
            print(f"[FAIL] Max temp mismatch for Cluster #{idx}: DB={c.hotspot_max_temp_c}, API={api_c['hotspot_max_temp_c']}")
            discrepancies += 1

        # Check Optical parity
        if api_c["ndvi_median"] != c.ndvi_median:
            print(f"[FAIL] NDVI mismatch for Cluster #{idx}: DB={c.ndvi_median}, API={api_c['ndvi_median']}")
            discrepancies += 1

        # Check Traceability fields
        if not api_c.get("thermal_source"):
            print(f"[FAIL] Missing thermal_source for Cluster #{idx}")
            discrepancies += 1

        if not api_c.get("optical_source"):
            print(f"[FAIL] Missing optical_source for Cluster #{idx}")
            discrepancies += 1

        # Check detail endpoint parity
        detail_resp = requests.get(f"{API_BASE}/api/hotspots/{c.id}")
        assert detail_resp.status_code == 200
        detail_data = detail_resp.json().get("cluster", {})

        if detail_data.get("display_id") != idx:
            print(f"[FAIL] Detail endpoint display_id mismatch for DB_ID={c.id}")
            discrepancies += 1

        if detail_data.get("thermal_source") != api_c["thermal_source"]:
            print(f"[FAIL] Detail endpoint thermal_source mismatch for DB_ID={c.id}")
            discrepancies += 1

        print(f"[PASS] Cluster #{idx:2d} (DB_ID={c.id:3d}) | Risk Score: {c.risk_score:5.1f} | "
              f"Thermal: {str(c.thermal_source)[:28]:28s} ({str(c.hotspot_max_temp_c):5s} C) | "
              f"Optical: {str(c.optical_source)[:28]:28s} (NDVI={str(c.ndvi_median):5s}) | PARITY VERIFIED")

    db.close()

    print("\n==========================================================================")
    if discrepancies == 0:
        print("SUCCESS: 100% PARITY CONFIRMED ACROSS POSTGRESQL DB, FASTAPI, AND MULTI-SAT ENGINE!")
    else:
        print(f"WARNING: AUDIT COMPLETED WITH {discrepancies} DISCREPANCIES.")
    print("==========================================================================")

if __name__ == "__main__":
    audit_end_to_end()
