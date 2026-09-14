import sys
import pystac_client
import planetary_computer
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster

PLANETARY_COMPUTER_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

def investigate_cluster_2():
    db = SessionLocal()
    # Find cluster by lat/lon or display_id=2 or id
    all_clusters = db.query(HotspotCluster).order_by(HotspotCluster.id.asc()).all()
    
    cluster_2 = None
    for idx, c in enumerate(all_clusters, start=1):
        if idx == 2 or c.id == 2 or (abs(c.centroid_lat - 27.26775) < 0.01 and abs(c.centroid_lon - 88.31142) < 0.01):
            print(f"Match found in DB: Display # {idx} | DB ID={c.id} | Lat={c.centroid_lat}, Lon={c.centroid_lon}")
            cluster_2 = c
            break
            
    if not cluster_2:
        print("Cluster #2 not found in DB by exact match. Inspecting first 5 clusters:")
        for idx, c in enumerate(all_clusters[:5], start=1):
            print(f" Display #{idx} | DB ID={c.id} | Lat={c.centroid_lat:.5f}, Lon={c.centroid_lon:.5f} | Time={c.last_detected}")
        cluster_2 = all_clusters[1]

    print("\n--- CLUSTER DATABASE TELEMETRY ---")
    print(f"DB ID               : {cluster_2.id}")
    print(f"Coordinates         : ({cluster_2.centroid_lat}, {cluster_2.centroid_lon})")
    print(f"FIRMS Detection Time: {cluster_2.last_detected}")
    print(f"Satellite Name      : {cluster_2.satellite_name}")
    print(f"Landsat Scene ID    : {cluster_2.landsat_scene_id}")
    print(f"Sentinel-2 Scene ID : {cluster_2.sentinel2_scene_id}")
    print(f"Observation Time    : {cluster_2.observation_datetime}")
    print(f"Time Difference     : {cluster_2.time_difference_hours} hours")
    print(f"Cloud %             : {cluster_2.cloud_percentage}%")
    print(f"Valid Pixel %       : {cluster_2.valid_pixel_percentage}%")
    print(f"Max Temp C          : {cluster_2.hotspot_max_temp_c}")
    print(f"Thermal Anomaly C   : {cluster_2.thermal_anomaly_c}")
    print(f"NDVI Median         : {cluster_2.ndvi_median}")

    # Now let's perform deep STAC query for lat=27.26775, lon=88.31142, acq_date=2026-08-27 02:18:00
    lat = 27.26775
    lon = 88.31142
    acq_date = datetime(2026, 8, 27, 2, 18, 0)
    
    print("\n==========================================================================")
    print(f"              DEEP STAC QUERY FOR ({lat}, {lon}) AT {acq_date}            ")
    print("==========================================================================")

    catalog = pystac_client.Client.open(PLANETARY_COMPUTER_STAC_URL, modifier=planetary_computer.sign_inplace)
    bbox = [lon - 0.15, lat - 0.15, lon + 0.15, lat + 0.15]

    start_7d = (acq_date - timedelta(days=7)).strftime("%Y-%m-%dT00:00:00Z")
    end_7d = (acq_date + timedelta(days=7)).strftime("%Y-%m-%dT23:59:59Z")

    # 1. LANDSAT 8/9 STAC SEARCH
    print(f"\nSearching Landsat-8/9 (landsat-c2-l2) between {start_7d} and {end_7d}...")
    l_search = catalog.search(
        collections=["landsat-c2-l2"],
        bbox=bbox,
        datetime=f"{start_7d}/{end_7d}",
        limit=50
    )
    l_items = list(l_search.items())
    print(f"Found {len(l_items)} Landsat scenes total.")
    for item in l_items:
        dt_str = item.properties.get("datetime")
        cloud_cover = item.properties.get("eo:cloud_cover")
        item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
        diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
        print(f"  - Landsat Item: {item.id} | Datetime: {dt_str} | Diff: {diff_h:.1f} hours ({diff_h/24:.1f} days) | CloudCover: {cloud_cover}%")

    # 2. SENTINEL-2 STAC SEARCH
    print(f"\nSearching Sentinel-2 (sentinel-2-l2a) between {start_7d} and {end_7d}...")
    s2_search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=bbox,
        datetime=f"{start_7d}/{end_7d}",
        limit=50
    )
    s2_items = list(s2_search.items())
    print(f"Found {len(s2_items)} Sentinel-2 scenes total.")
    for item in s2_items:
        dt_str = item.properties.get("datetime")
        cloud_cover = item.properties.get("eo:cloud_cover")
        item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
        diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
        print(f"  - Sentinel-2 Item: {item.id} | Datetime: {dt_str} | Diff: {diff_h:.1f} hours ({diff_h/24:.1f} days) | CloudCover: {cloud_cover}%")

    db.close()

if __name__ == "__main__":
    investigate_cluster_2()
