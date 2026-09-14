import sys
import requests
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal, init_db
from db.models import HotspotCluster, RawHotspot
from ingestion.satellite_verification import verify_hotspot_stac_satellite
from features.feature_pipeline import process_hotspot_features

API_BASE = "http://127.0.0.1:8000"

def reprocess_and_verify_all():
    print("==========================================================================")
    print("              REPROCESSING & AUDITING SATELLITE PIPELINE                  ")
    print("==========================================================================")
    
    db = SessionLocal()
    clusters = db.query(HotspotCluster).order_by(HotspotCluster.id.asc()).all()
    total_count = len(clusters)
    print(f"Loaded {total_count} clusters from PostgreSQL database.")

    print("\nUpdating satellite verification data for all clusters...")
    for idx, c in enumerate(clusters, start=1):
        sat_info = verify_hotspot_stac_satellite(c.centroid_lat, c.centroid_lon, c.last_detected)
        
        obs_dt = None
        if sat_info.get("observation_datetime"):
            obs_dt = str(sat_info["observation_datetime"]).replace("Z", "+00:00")
            from datetime import datetime
            obs_dt = datetime.fromisoformat(obs_dt).replace(tzinfo=None)

        c.satellite_name = sat_info.get("satellite_name")
        c.landsat_scene_id = sat_info.get("landsat_scene_id") or "UNAVAILABLE"
        c.sentinel2_scene_id = sat_info.get("sentinel2_scene_id") or "UNAVAILABLE"
        c.hotspot_max_temp_c = sat_info.get("hotspot_max_temp_c")
        c.surrounding_median_temp_c = sat_info.get("surrounding_median_temp_c")
        c.thermal_anomaly_c = sat_info.get("thermal_anomaly_c")
        c.ndvi_median = sat_info.get("ndvi_median")

        # Atomic source rule enforcement
        if c.hotspot_max_temp_c is not None:
            c.thermal_source = sat_info.get("thermal_source") or "UNAVAILABLE"
            c.thermal_unavailable_reason = None
        else:
            c.thermal_source = "UNAVAILABLE"
            c.thermal_unavailable_reason = sat_info.get("thermal_unavailable_reason") or "No valid unmasked thermal pixels found across Landsat-8/9 or MODIS within ±7 day window"

        if c.ndvi_median is not None:
            c.optical_source = sat_info.get("optical_source") or "UNAVAILABLE"
            c.optical_unavailable_reason = None
        else:
            c.optical_source = "UNAVAILABLE"
            c.optical_unavailable_reason = sat_info.get("optical_unavailable_reason") or "No valid unmasked optical pixels found across Sentinel-2 or Landsat-8/9 within ±7 day window"
        c.time_difference_hours = sat_info.get("time_difference_hours")
        c.temporal_match_quality = sat_info["temporal_match_quality"]
        c.observation_datetime = obs_dt
        c.satellite_data_available = sat_info["satellite_data_available"]
        c.thermal_data_available = sat_info["thermal_data_available"]
        c.optical_data_available = sat_info["optical_data_available"]

        if idx % 5 == 0 or idx == total_count:
            db.commit()
            print(f"Processed {idx}/{total_count} clusters...")

    db.commit()
    db.close()
    print("\nDatabase update completed.")

if __name__ == "__main__":
    reprocess_and_verify_all()
