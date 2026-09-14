import json
from sqlalchemy import func
from db.database import SessionLocal, init_db, engine
from db.models import RawHotspot, HotspotCluster
from ingestion.firms_ingestion import get_real_firms_data, ingest_raw_hotspots
from features.feature_pipeline import process_hotspot_features
from model.classifier import classify_cluster_evidence

def run_deep_audit():
    print("=" * 80)
    print("SIH26162 LIVE DATA & CLASSIFICATION RULE AUDIT")
    print(f"PostgreSQL Active Engine URL: {engine.url}")
    print("=" * 80)

    init_db()
    db = SessionLocal()

    try:
        # PROBLEM 1: Fetch raw NASA FIRMS data and print raw response
        print("\n--- PROBLEM 1: REAL NASA FIRMS API RESPONSE ---")
        raw_records = get_real_firms_data(days=5)
        print(f"\nTotal Raw NASA FIRMS Detections Retrieved: {len(raw_records)}")
        print("\nFirst 3 Raw FIRMS Hotspot Records from NASA API Stream:")
        for idx, rec in enumerate(raw_records[:3], 1):
            print(f"  [{idx}] Lat: {rec['latitude']:.4f}, Lon: {rec['longitude']:.4f}, FRP: {rec['frp']} MW, Brightness: {rec['brightness']} K, Acq Date: {rec['acquisition_date']}, Satellite: {rec['satellite']}")

        # Ingest and Process Features
        new_inserted = ingest_raw_hotspots(db, raw_records)
        print(f"\nPersisted {new_inserted} new deduplicated records into database.")
        
        # Process DBSCAN clusters
        processed_count = process_hotspot_features(db)

        # Output Summary Stats
        clusters = db.query(HotspotCluster).all()
        total_clusters = len(clusters)

        class_counts = db.query(
            HotspotCluster.predicted_class, func.count(HotspotCluster.id)
        ).group_by(HotspotCluster.predicted_class).all()

        min_risk = db.query(func.min(HotspotCluster.risk_score)).scalar() or 0.0
        max_risk = db.query(func.max(HotspotCluster.risk_score)).scalar() or 0.0

        print("\n--- CLUSTERING & CLASSIFICATION SUMMARY ---")
        print(f"Total Hotspot Clusters in Database : {total_clusters}")
        print(f"Minimum Risk Score                 : {min_risk:.2f}")
        print(f"Maximum Risk Score                 : {max_risk:.2f}")
        print("\nClassification Distribution Breakdown:")
        for cls_name, count in sorted(class_counts, key=lambda x: x[1], reverse=True):
            pct = (count / total_clusters * 100.0) if total_clusters > 0 else 0.0
            print(f"  - {cls_name:<42}: {count:>4} clusters ({pct:.1f}%)")

        # PROBLEM 3: Reasoning Verification for 3 Real Clusters
        print("\n" + "=" * 80)
        print("PROBLEM 3: EXACT CLASSIFIER RULE & REASONING FOR 3 REAL CLUSTERS")
        print("=" * 80)

        sample_clusters = clusters[:3]
        for c in sample_clusters:
            feat_dict = {
                "max_frp": c.max_frp,
                "avg_frp": c.avg_frp,
                "persistence_days": c.persistence_days,
                "recurrence_freq": c.recurrence_freq,
                "dist_to_nearest_industry_km": c.dist_to_nearest_industry_km,
                "risk_score": c.risk_score,
                "satellite_status": c.satellite_status,
                "satellite_evidence_strength": c.satellite_evidence_strength,
                "fire_evidence_status": c.fire_evidence_status
            }
            res = classify_cluster_evidence(db, feat_dict)
            dist_str = f"{c.dist_to_nearest_industry_km:.2f} km" if c.dist_to_nearest_industry_km is not None else "UNAVAILABLE"
            print(f"\nCluster #{c.id} Details:")
            print(f"  Centroid Coordinates       : ({c.centroid_lat:.4f}, {c.centroid_lon:.4f})")
            print(f"  Max FRP / Persistence      : {c.max_frp:.1f} MW / {c.persistence_days} days")
            print(f"  Industry Proximity         : {dist_str} ({c.nearest_industry_name})")
            print(f"  Satellite Evidence Strength: {c.satellite_evidence_strength}")
            print(f"  Fire Evidence Status       : {c.fire_evidence_status}")
            print(f"  Predicted Classification   : {c.predicted_class}")
            print(f"  Rule Reasoning String      : \"{res['reasoning']}\"")

        print("=" * 80)

    finally:
        db.close()

if __name__ == "__main__":
    run_deep_audit()
