import sys
from sqlalchemy import func
from db.database import SessionLocal, init_db, engine
from db.models import RawHotspot, HotspotCluster
from ingestion.firms_ingestion import get_real_firms_data, ingest_raw_hotspots
from features.feature_pipeline import process_hotspot_features

def run_scan():
    print("=" * 80)
    print("SIH26162 FULL FRESH SCAN - 10-DAY NASA FIRMS WINDOW & POSTGRESQL VERIFICATION")
    print("=" * 80)
    print(f"Connected DB Engine URL: {engine.url}")
    
    init_db()
    db = SessionLocal()
    
    try:
        # Step 1: Pull 10-day FIRMS data from NASA API
        print("\n[Step 1] Ingesting 10-day NASA FIRMS data...")
        raw_hotspots = get_real_firms_data(days=10)
        new_inserted = ingest_raw_hotspots(db, raw_hotspots)
        total_raw = db.query(RawHotspot).count()
        print(f"Retrieved {len(raw_hotspots)} FIRMS records ({new_inserted} new deduplicated, total in DB: {total_raw})")
        
        # Step 2: Run spatial DBSCAN clustering & raster evidence processing
        print("\n[Step 2] Executing DBSCAN clustering and real satellite pixel raster analysis...")
        processed_clusters = process_hotspot_features(db)
        
        # Step 3: Compute Classification Breakdown & Max Risk Score
        print("\n" + "=" * 80)
        print("FULL FRESH SCAN RESULT BREAKDOWN")
        print("=" * 80)
        
        clusters = db.query(HotspotCluster).all()
        total_clusters = len(clusters)
        
        class_counts = db.query(
            HotspotCluster.predicted_class, func.count(HotspotCluster.id)
        ).group_by(HotspotCluster.predicted_class).all()
        
        max_risk = db.query(func.max(HotspotCluster.risk_score)).scalar() or 0.0
        
        print(f"Total Hotspot Clusters Processed: {total_clusters}")
        print(f"Maximum Risk Score: {max_risk:.2f}")
        print("\nClassification Distribution Breakdown:")
        for cls_name, count in sorted(class_counts, key=lambda x: x[1], reverse=True):
            pct = (count / total_clusters * 100.0) if total_clusters > 0 else 0.0
            print(f"  - {cls_name:<40}: {count:>4} clusters ({pct:.1f}%)")
            
        print("=" * 80)
        
    finally:
        db.close()

if __name__ == "__main__":
    run_scan()
