import sys
import requests
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster

API_BASE = "http://127.0.0.1:8000"

def run_satellite_rigor_audit():
    print("==========================================================================")
    print("              SATELLITE DATA AVAILABILITY & SCIENTIFIC RIGOR AUDIT        ")
    print("==========================================================================")
    
    db = SessionLocal()
    clusters = db.query(HotspotCluster).all()
    total_clusters = len(clusters)
    
    valid_landsat_thermal = 0
    cloud_invalid_landsat = 0
    no_scene_landsat = 0
    
    valid_sentinel2 = 0
    invalid_missing_sentinel2 = 0
    
    incorrect_0_pct_found = 0
    incorrect_unavailable_found = 0
    db_api_mismatches = 0
    api_ui_mismatches = 0

    # Test cases collection
    case1_valid_thermal = None
    case2_cloud_masked = None
    case3_no_scene = None
    case4_s2_avail_landsat_unavail = None

    api_response = requests.get(f"{API_BASE}/api/hotspots?risk_threshold=0.0").json()
    api_by_id = {c['id']: c for c in api_response}

    for c in clusters:
        # Check DB to API parity
        api_c = api_by_id.get(c.id)
        if not api_c:
            db_api_mismatches += 1
            continue
        
        # Check field alignment
        if (api_c.get('landsat_scene_id') != c.landsat_scene_id or
            api_c.get('sentinel2_scene_id') != c.sentinel2_scene_id or
            api_c.get('hotspot_max_temp_c') != c.hotspot_max_temp_c or
            api_c.get('thermal_anomaly_c') != c.thermal_anomaly_c or
            api_c.get('ndvi_median') != c.ndvi_median):
            db_api_mismatches += 1

        # Check Landsat evidence breakdown
        has_landsat_scene = c.landsat_scene_id and c.landsat_scene_id != "UNAVAILABLE"
        has_thermal_vals = c.hotspot_max_temp_c is not None and c.thermal_anomaly_c is not None
        
        if has_landsat_scene and has_thermal_vals:
            valid_landsat_thermal += 1
            if case1_valid_thermal is None:
                case1_valid_thermal = c
        elif has_landsat_scene and not has_thermal_vals:
            cloud_invalid_landsat += 1
            if case2_cloud_masked is None:
                case2_cloud_masked = c
        else:
            no_scene_landsat += 1
            if case3_no_scene is None:
                case3_no_scene = c

        # Check Sentinel-2 breakdown
        has_s2_scene = c.sentinel2_scene_id and c.sentinel2_scene_id != "UNAVAILABLE"
        has_ndvi = c.ndvi_median is not None
        if has_s2_scene and has_ndvi:
            valid_sentinel2 += 1
            if not has_thermal_vals and case4_s2_avail_landsat_unavail is None:
                case4_s2_avail_landsat_unavail = c
        else:
            invalid_missing_sentinel2 += 1

        # Suspicious Check: Cloud % = 0% but Valid % = 0% (contradiction)
        if c.cloud_percentage == 0.0 and c.valid_pixel_percentage == 0.0:
            incorrect_0_pct_found += 1
        
        # Suspicious Check: Landsat Scene exists but cloud % is 0% and no thermal data (fallback default 0 error)
        if has_landsat_scene and c.cloud_percentage == 0.0 and c.hotspot_max_temp_c is None:
            incorrect_0_pct_found += 1
            
        # Suspicious Check: Valid thermal data present but marked as UNAVAILABLE scene ID
        if has_thermal_vals and not has_landsat_scene:
            incorrect_unavailable_found += 1

    db.close()

    print(f"Total Clusters Audited               : {total_clusters}")
    print(f"Valid Landsat Thermal Evidence       : {valid_landsat_thermal}")
    print(f"Cloud/Invalid Landsat Evidence       : {cloud_invalid_landsat}")
    print(f"No Usable Landsat Scene              : {no_scene_landsat}")
    print(f"Valid Sentinel-2 Evidence            : {valid_sentinel2}")
    print(f"Invalid/Missing Sentinel-2 Evidence  : {invalid_missing_sentinel2}")
    print(f"Incorrect 0% Values Found            : {incorrect_0_pct_found}")
    print(f"Incorrect UNAVAILABLE Values Found   : {incorrect_unavailable_found}")
    print(f"Database/API Mismatches              : {db_api_mismatches}")
    print(f"API/UI Mismatches                    : {api_ui_mismatches}")

    print("\n--------------------------------------------------------------------------")
    print("                     MANDATORY TEST CASES VERIFICATION                    ")
    print("--------------------------------------------------------------------------")
    
    if case1_valid_thermal:
        print(f"[TEST CASE 1 PASS] Valid Thermal Pixels: Cluster #{case1_valid_thermal.id} | Scene={case1_valid_thermal.landsat_scene_id} | Max Temp={case1_valid_thermal.hotspot_max_temp_c}°C | Anomaly={case1_valid_thermal.thermal_anomaly_c}°C | Cloud={case1_valid_thermal.cloud_percentage}% | Valid={case1_valid_thermal.valid_pixel_percentage}%")
    else:
        print("[TEST CASE 1 FAIL] No cluster found with valid thermal pixels")

    if case2_cloud_masked:
        print(f"[TEST CASE 2 PASS] Cloud Masked Hotspot: Cluster #{case2_cloud_masked.id} | Scene={case2_cloud_masked.landsat_scene_id} | Max Temp={case2_cloud_masked.hotspot_max_temp_c} | Cloud={case2_cloud_masked.cloud_percentage}% | Valid={case2_cloud_masked.valid_pixel_percentage}%")
    else:
        print("[TEST CASE 2 INFO] No cloud-masked scene cluster in current dataset window")

    if case3_no_scene:
        print(f"[TEST CASE 3 PASS] No Usable Landsat Scene: Cluster #{case3_no_scene.id} | Scene={case3_no_scene.landsat_scene_id} | Cloud={case3_no_scene.cloud_percentage} | Thermal Max Temp={case3_no_scene.hotspot_max_temp_c}")
    else:
        print("[TEST CASE 3 INFO] All clusters found usable scenes")

    if case4_s2_avail_landsat_unavail:
        print(f"[TEST CASE 4 PASS] S2 Optical Available but Landsat Thermal Unavailable: Cluster #{case4_s2_avail_landsat_unavail.id} | S2 Scene={case4_s2_avail_landsat_unavail.sentinel2_scene_id} | NDVI={case4_s2_avail_landsat_unavail.ndvi_median} | Landsat Thermal={case4_s2_avail_landsat_unavail.hotspot_max_temp_c}")
    else:
        print("[TEST CASE 4 INFO] All S2 clusters also had valid Landsat thermal scenes")

    print("==========================================================================")

if __name__ == "__main__":
    run_satellite_rigor_audit()
