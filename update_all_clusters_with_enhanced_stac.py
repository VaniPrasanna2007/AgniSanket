from db.database import SessionLocal, init_db
from db.models import HotspotCluster
from features.feature_pipeline import process_hotspot_features
from features.risk_engine import calculate_evidence_risk_score

def update_all_clusters_with_enhanced_stac():
    print("=" * 95)
    print("REPROCESSING ALL 233 CLUSTERS IN POSTGRESQL WITH ENHANCED LANDSAT STAC SEARCH")
    print("=" * 95)
    
    init_db()
    db = SessionLocal()
    try:
        count = process_hotspot_features(db)
        print(f"\n[1] Successfully reprocessed {count} clusters in PostgreSQL.")
        
        clusters = db.query(HotspotCluster).all()
        landsat_meta_count = sum(1 for c in clusters if c.landsat_scene_id and c.landsat_scene_id != "UNAVAILABLE")
        landsat_thermal_count = sum(1 for c in clusters if c.hotspot_max_temp_c is not None)
        
        print("\n" + "-" * 95)
        print("DATABASE COMPLETENESS AFTER ENHANCED LANDSAT STAC REPROCESSING:")
        print("-" * 95)
        print(f"Total Clusters in DB                   : {len(clusters)}")
        print(f"Clusters with Valid Landsat Scene ID   : {landsat_meta_count} / {len(clusters)} ({round(landsat_meta_count/len(clusters)*100, 1)}%)")
        print(f"Clusters with Valid Thermal Metrics    : {landsat_thermal_count} / {len(clusters)} ({round(landsat_thermal_count/len(clusters)*100, 1)}%)")
        print("=" * 95)
    finally:
        db.close()

if __name__ == "__main__":
    update_all_clusters_with_enhanced_stac()
