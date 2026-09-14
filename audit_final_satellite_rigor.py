import sys
import requests
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster

API_BASE = "http://127.0.0.1:8000"

def run_final_rigor_audit():
    print("==========================================================================")
    print("           COMPREHENSIVE SATELLITE EVIDENCE & RIGOR AUDIT                 ")
    print("==========================================================================")

    db = SessionLocal()
    clusters = db.query(HotspotCluster).order_by(HotspotCluster.id.asc()).all()
    total_clusters = len(clusters)

    # Fetch API hotspots
    try:
        api_res = requests.get(f"{API_BASE}/api/hotspots?risk_threshold=0.0")
        if api_res.status_code != 200:
            print(f"[ERROR] API endpoint /api/hotspots failed with status {api_res.status_code}")
            return
        api_clusters = api_res.json()
    except Exception as e:
        print(f"[ERROR] Connection to API server failed: {e}")
        return

    api_by_id = {c['id']: c for c in api_clusters}

    valid_landsat_thermal = 0
    valid_sentinel2_optical = 0
    real_cloud_pct_count = 0
    real_valid_pixel_pct_count = 0
    legitimately_unavailable = 0
    incorrectly_populated = 0
    db_api_mismatches = 0
    fabricated_values_found = 0

    cluster_2_audit = None

    for idx, c in enumerate(clusters, start=1):
        api_c = api_by_id.get(c.id)
        if not api_c:
            db_api_mismatches += 1
            continue

        # Check DB to API parity
        if (api_c.get("landsat_scene_id") != (c.landsat_scene_id or "UNAVAILABLE") or
            api_c.get("sentinel2_scene_id") != (c.sentinel2_scene_id or "UNAVAILABLE") or
            api_c.get("hotspot_max_temp_c") != c.hotspot_max_temp_c or
            api_c.get("thermal_anomaly_c") != c.thermal_anomaly_c or
            api_c.get("ndvi_median") != c.ndvi_median):
            db_api_mismatches += 1

        # Check Cluster #2 audit specifically
        if idx == 2 or c.id == 101 or (abs(c.centroid_lat - 27.26775) < 0.01 and abs(c.centroid_lon - 88.31142) < 0.01):
            cluster_2_audit = {
                "display_id": idx,
                "db_id": c.id,
                "lat": c.centroid_lat,
                "lon": c.centroid_lon,
                "firms_time": c.last_detected,
                "landsat_scene": c.landsat_scene_id,
                "sentinel2_scene": c.sentinel2_scene_id,
                "obs_time": c.observation_datetime,
                "time_diff_hours": c.time_difference_hours,
                "cloud_pct": c.cloud_percentage,
                "valid_pixel_pct": c.valid_pixel_percentage,
                "max_temp": c.hotspot_max_temp_c,
                "anomaly": c.thermal_anomaly_c,
                "ndvi": c.ndvi_median
            }

        # Check metrics breakdown
        if c.hotspot_max_temp_c is not None and c.thermal_anomaly_c is not None:
            valid_landsat_thermal += 1

        if c.ndvi_median is not None:
            valid_sentinel2_optical += 1

        if c.cloud_percentage is not None:
            real_cloud_pct_count += 1

        if c.valid_pixel_percentage is not None:
            real_valid_pixel_pct_count += 1

        # Check legitimately UNAVAILABLE
        if c.hotspot_max_temp_c is None and (c.landsat_scene_id == "UNAVAILABLE" or c.cloud_percentage == 100.0 or c.valid_pixel_percentage < 10.0):
            legitimately_unavailable += 1

        # Contradiction check (e.g. Cloud % = 0% and Valid % = 0%)
        if c.cloud_percentage == 0.0 and c.valid_pixel_percentage == 0.0:
            incorrectly_populated += 1
            fabricated_values_found += 1

        # Fabrication check: Max temp present without scene id
        if c.hotspot_max_temp_c is not None and (not c.landsat_scene_id or c.landsat_scene_id == "UNAVAILABLE"):
            fabricated_values_found += 1
            incorrectly_populated += 1

    print(f"\nTotal Clusters Audited               : {total_clusters}")
    print(f"Clusters with Valid Landsat Thermal  : {valid_landsat_thermal}")
    print(f"Clusters with Valid Sentinel-2 NDVI  : {valid_sentinel2_optical}")
    print(f"Clusters with Real Cloud %           : {real_cloud_pct_count}")
    print(f"Clusters with Real Valid Pixel %     : {real_valid_pixel_pct_count}")
    print(f"Legitimately UNAVAILABLE Clusters    : {legitimately_unavailable}")
    print(f"Incorrectly Populated Clusters       : {incorrectly_populated}")
    print(f"Database / API Mismatches            : {db_api_mismatches}")
    print(f"Fabricated / Hardcoded Values Found  : {fabricated_values_found}")

    print("\n--------------------------------------------------------------------------")
    print("                     SPECIFIC AUDIT FOR CLUSTER #2                        ")
    print("--------------------------------------------------------------------------")
    if cluster_2_audit:
        print(f"Display Label       : Cluster #{cluster_2_audit['display_id']} (DB ID: {cluster_2_audit['db_id']})")
        print(f"FIRMS Coordinates   : ({cluster_2_audit['lat']}, {cluster_2_audit['lon']})")
        print(f"FIRMS Timestamp     : {cluster_2_audit['firms_time']}")
        print(f"Landsat Scene ID    : {cluster_2_audit['landsat_scene']}")
        print(f"Sentinel-2 Scene ID : {cluster_2_audit['sentinel2_scene']}")
        print(f"Observation Time    : {cluster_2_audit['obs_time']}")
        print(f"Time Difference     : {cluster_2_audit['time_diff_hours']} hours")
        print(f"Cloud Percentage    : {cluster_2_audit['cloud_pct']}%")
        print(f"Valid Pixel %       : {cluster_2_audit['valid_pixel_pct']}%")
        print(f"Hotspot Max Temp    : {cluster_2_audit['max_temp']} °C")
        print(f"Thermal Anomaly     : {cluster_2_audit['anomaly']} °C")
        print(f"NDVI Median         : {cluster_2_audit['ndvi']}")
    else:
        print("[FAIL] Cluster #2 audit data not found!")

    print("==========================================================================")
    if db_api_mismatches == 0 and fabricated_values_found == 0 and incorrectly_populated == 0:
        print("                 AUDIT RESULT: ALL CHECKS PASSED 100%                    ")
    else:
        print("                 AUDIT RESULT: CHECKS FAILED                              ")
    print("==========================================================================")

    db.close()

if __name__ == "__main__":
    run_final_rigor_audit()
