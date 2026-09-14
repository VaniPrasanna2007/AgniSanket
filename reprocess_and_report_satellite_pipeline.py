from db.database import SessionLocal, init_db
from db.models import HotspotCluster
from features.feature_pipeline import process_hotspot_features

def reprocess_and_report():
    print("=" * 95)
    print("FULL REPROCESSING & SATELLITE PIPELINE BEFORE/AFTER AVAILABILITY AUDIT")
    print("=" * 95)
    
    init_db()
    db = SessionLocal()
    try:
        clusters_before = db.query(HotspotCluster).all()
        total_clusters = len(clusters_before)
        
        before_landsat_meta = sum(1 for c in clusters_before if c.landsat_scene_id and c.landsat_scene_id != "UNAVAILABLE")
        before_landsat_thermal = sum(1 for c in clusters_before if c.hotspot_max_temp_c is not None)
        before_sentinel_ndvi = sum(1 for c in clusters_before if c.ndvi_median is not None)
        before_sentinel_meta = sum(1 for c in clusters_before if c.sentinel2_scene_id and c.sentinel2_scene_id != "UNAVAILABLE")
        
        print(f"BEFORE REPROCESSING AVAILABILITY (Total Clusters = {total_clusters}):")
        print(f"  - Landsat Scene Metadata   : {before_landsat_meta} / {total_clusters} ({round(before_landsat_meta/total_clusters*100, 1)}%)")
        print(f"  - Landsat Thermal Metrics  : {before_landsat_thermal} / {total_clusters} ({round(before_landsat_thermal/total_clusters*100, 1)}%)")
        print(f"  - Sentinel-2 Scene Metadata: {before_sentinel_meta} / {total_clusters} ({round(before_sentinel_meta/total_clusters*100, 1)}%)")
        print(f"  - Sentinel-2 NDVI Metrics  : {before_sentinel_ndvi} / {total_clusters} ({round(before_sentinel_ndvi/total_clusters*100, 1)}%)\n")
        
        print("Starting full database reprocess with enhanced Landsat & Sentinel-2 STAC search...")
        processed_count = process_hotspot_features(db)
        print(f"[+] Reprocessed {processed_count} clusters.\n")
        
        db.expire_all()
        clusters_after = db.query(HotspotCluster).all()
        
        after_landsat_meta = sum(1 for c in clusters_after if c.landsat_scene_id and c.landsat_scene_id != "UNAVAILABLE")
        after_landsat_thermal = sum(1 for c in clusters_after if c.hotspot_max_temp_c is not None)
        after_sentinel_ndvi = sum(1 for c in clusters_after if c.ndvi_median is not None)
        after_sentinel_meta = sum(1 for c in clusters_after if c.sentinel2_scene_id and c.sentinel2_scene_id != "UNAVAILABLE")
        
        print("-" * 95)
        print("BEFORE VS AFTER SATELLITE EVIDENCE AVAILABILITY AUDIT TABLE:")
        print("-" * 95)
        print(f"{'Evidence Metric':<30} | {'BEFORE Count (%)':<25} | {'AFTER Count (%)':<25} | {'Delta':<10}")
        print("-" * 95)
        
        b_lm_pct = f"{before_landsat_meta} ({round(before_landsat_meta/total_clusters*100, 1)}%)"
        a_lm_pct = f"{after_landsat_meta} ({round(after_landsat_meta/total_clusters*100, 1)}%)"
        d_lm = f"+{after_landsat_meta - before_landsat_meta}"
        print(f"{'Landsat Scene Metadata':<30} | {b_lm_pct:<25} | {a_lm_pct:<25} | {d_lm:<10}")
        
        b_lt_pct = f"{before_landsat_thermal} ({round(before_landsat_thermal/total_clusters*100, 1)}%)"
        a_lt_pct = f"{after_landsat_thermal} ({round(after_landsat_thermal/total_clusters*100, 1)}%)"
        d_lt = f"+{after_landsat_thermal - before_landsat_thermal}"
        print(f"{'Landsat ST_B10 Thermal':<30} | {b_lt_pct:<25} | {a_lt_pct:<25} | {d_lt:<10}")
        
        b_sm_pct = f"{before_sentinel_meta} ({round(before_sentinel_meta/total_clusters*100, 1)}%)"
        a_sm_pct = f"{after_sentinel_meta} ({round(after_sentinel_meta/total_clusters*100, 1)}%)"
        d_sm = f"+{after_sentinel_meta - before_sentinel_meta}"
        print(f"{'Sentinel-2 Scene Metadata':<30} | {b_sm_pct:<25} | {a_sm_pct:<25} | {d_sm:<10}")
        
        b_sn_pct = f"{before_sentinel_ndvi} ({round(before_sentinel_ndvi/total_clusters*100, 1)}%)"
        a_sn_pct = f"{after_sentinel_ndvi} ({round(after_sentinel_ndvi/total_clusters*100, 1)}%)"
        d_sn = f"+{after_sentinel_ndvi - before_sentinel_ndvi}"
        print(f"{'Sentinel-2 Optical NDVI':<30} | {b_sn_pct:<25} | {a_sn_pct:<25} | {d_sn:<10}")
        
        print("=" * 95)
        print("[SUCCESS] SATELLITE EVIDENCE PIPELINE REPROCESSING COMPLETED!")
        print("=" * 95)
    finally:
        db.close()

if __name__ == "__main__":
    reprocess_and_report()
