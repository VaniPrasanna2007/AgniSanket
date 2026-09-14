import sys
from db.database import SessionLocal
from db.models import HotspotCluster
from ingestion.satellite_verification import verify_hotspot_stac_satellite

db = SessionLocal()
clusters = db.query(HotspotCluster).filter(HotspotCluster.landsat_scene_id.is_(None)).all()
print(f"Found {len(clusters)} clusters with NULL landsat_scene_id. Reprocessing...")

for c in clusters:
    sat_info = verify_hotspot_stac_satellite(c.centroid_lat, c.centroid_lon, c.last_detected)
    c.landsat_scene_id = sat_info.get("landsat_scene_id") or "UNAVAILABLE"
    c.sentinel2_scene_id = sat_info.get("sentinel2_scene_id") or "UNAVAILABLE"
    c.satellite_name = sat_info.get("satellite_name")
    c.cloud_percentage = sat_info.get("cloud_percentage")
    c.valid_pixel_percentage = sat_info.get("valid_pixel_percentage")
    c.hotspot_max_temp_c = sat_info.get("hotspot_max_temp_c")
    c.surrounding_median_temp_c = sat_info.get("surrounding_median_temp_c")
    c.thermal_anomaly_c = sat_info.get("thermal_anomaly_c")
    c.ndvi_median = sat_info.get("ndvi_median")
    db.commit()
    print(f"Updated Cluster #{c.id}: landsat_scene_id={c.landsat_scene_id}")

db.close()
print("Legacy clusters updated successfully.")
