import sys
from db.database import SessionLocal
from db.models import HotspotCluster

db = SessionLocal()
clusters = db.query(HotspotCluster).all()

for c in clusters:
    has_landsat_scene = c.landsat_scene_id and c.landsat_scene_id != "UNAVAILABLE"
    has_thermal_vals = c.hotspot_max_temp_c is not None and c.thermal_anomaly_c is not None
    if has_thermal_vals and not has_landsat_scene:
        print(f"Cluster #{c.id}: landsat_scene_id='{c.landsat_scene_id}', max_temp={c.hotspot_max_temp_c}, anomaly={c.thermal_anomaly_c}, sat_name='{c.satellite_name}'")

db.close()
