import sys
import requests
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster

API_BASE = "http://127.0.0.1:8000"

def test_db_api_alignment():
    db = SessionLocal()
    try:
        db_clusters = db.query(HotspotCluster).order_by(HotspotCluster.id.asc()).all()
        print(f"Total DB Clusters: {len(db_clusters)}")
        
        # Test 1: GET /api/hotspots
        res_list = requests.get(f"{API_BASE}/api/hotspots?risk_threshold=0.0")
        assert res_list.status_code == 200, f"API list request failed: {res_list.status_code}"
        api_clusters = res_list.json()
        print(f"API /api/hotspots returned {len(api_clusters)} clusters")
        assert len(api_clusters) == len(db_clusters), f"Mismatch in count: DB={len(db_clusters)}, API={len(api_clusters)}"
        
        api_map = {c["id"]: c for c in api_clusters}
        
        mismatches = 0
        tested_count = 0
        
        for db_c in db_clusters[:20]: # Test first 20 clusters thoroughly
            tested_count += 1
            cid = db_c.id
            assert cid in api_map, f"Cluster ID {cid} missing from /api/hotspots response"
            api_c = api_map[cid]
            
            # Check fields in /api/hotspots
            fields_to_check = [
                ("centroid_lat", db_c.centroid_lat, api_c["centroid_lat"]),
                ("centroid_lon", db_c.centroid_lon, api_c["centroid_lon"]),
                ("max_frp", round(db_c.max_frp, 1), api_c["max_frp"]),
                ("avg_frp", round(db_c.avg_frp, 1), api_c["avg_frp"]),
                ("persistence_days", db_c.persistence_days, api_c["persistence_days"]),
                ("risk_score", db_c.risk_score, api_c["risk_score"]),
                ("predicted_class", db_c.predicted_class, api_c["predicted_class"]),
                ("satellite_status", db_c.satellite_status, api_c["satellite_status"]),
                ("landsat_scene_id", db_c.landsat_scene_id, api_c.get("landsat_scene_id")),
                ("sentinel2_scene_id", db_c.sentinel2_scene_id, api_c.get("sentinel2_scene_id")),
                ("hotspot_max_temp_c", db_c.hotspot_max_temp_c, api_c["hotspot_max_temp_c"]),
                ("surrounding_median_temp_c", db_c.surrounding_median_temp_c, api_c["surrounding_median_temp_c"]),
                ("thermal_anomaly_c", db_c.thermal_anomaly_c, api_c["thermal_anomaly_c"]),
                ("ndvi_median", db_c.ndvi_median, api_c["ndvi_median"]),
                ("cloud_percentage", db_c.cloud_percentage, api_c["cloud_percentage"]),
                ("valid_pixel_percentage", db_c.valid_pixel_percentage, api_c["valid_pixel_percentage"]),
                ("dist_to_nearest_industry_km", round(db_c.dist_to_nearest_industry_km, 2) if db_c.dist_to_nearest_industry_km is not None else None, api_c["dist_to_nearest_industry_km"]),
                ("nearest_industry_name", db_c.nearest_industry_name, api_c["nearest_industry_name"])
            ]
            
            for fname, db_val, api_val in fields_to_check:
                if db_val != api_val:
                    print(f"[MISMATCH] Cluster #{cid} Field '{fname}': DB={db_val} vs API={api_val}")
                    mismatches += 1

            # Test 2: GET /api/hotspots/{id}
            res_detail = requests.get(f"{API_BASE}/api/hotspots/{cid}")
            assert res_detail.status_code == 200, f"API detail request failed for cluster {cid}: {res_detail.status_code}"
            detail_data = res_detail.json().get("cluster", {})
            
            detail_fields = [
                ("landsat_scene_id", db_c.landsat_scene_id, detail_data.get("landsat_scene_id")),
                ("sentinel2_scene_id", db_c.sentinel2_scene_id, detail_data.get("sentinel2_scene_id")),
                ("hotspot_max_temp_c", db_c.hotspot_max_temp_c, detail_data.get("hotspot_max_temp_c")),
                ("thermal_anomaly_c", db_c.thermal_anomaly_c, detail_data.get("thermal_anomaly_c")),
                ("ndvi_median", db_c.ndvi_median, detail_data.get("ndvi_median")),
                ("dist_to_nearest_industry_km", db_c.dist_to_nearest_industry_km, detail_data.get("dist_to_nearest_industry_km"))
            ]
            
            for fname, db_val, api_val in detail_fields:
                if db_val != api_val:
                    print(f"[DETAIL MISMATCH] Cluster #{cid} Field '{fname}': DB={db_val} vs API={api_val}")
                    mismatches += 1

        print(f"\nTested {tested_count} clusters. Total Mismatches Found: {mismatches}")
        return mismatches
    finally:
        db.close()

if __name__ == "__main__":
    test_db_api_alignment()
