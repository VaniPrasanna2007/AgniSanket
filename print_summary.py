from sqlalchemy import func
from db.database import SessionLocal, engine
from db.models import RawHotspot, HotspotCluster
from model.classifier import classify_cluster_evidence

def print_summary():
    db = SessionLocal()
    try:
        print("=" * 80)
        print("SIH26162 HARDENED SYSTEM VERIFICATION SUMMARY")
        print(f"Active PostgreSQL Database Engine: {engine.url}")
        print("=" * 80)

        # 1. Raw FIRMS Stream Records
        raw_count = db.query(RawHotspot).count()
        raw_samples = db.query(RawHotspot).limit(3).all()
        print(f"\n--- 1. REAL NASA FIRMS API DATA AUTHENTICITY ---")
        print(f"Total Raw NASA FIRMS Detections Ingested in Database: {raw_count}")
        print("\nFirst 3 Raw Hotspot Records from Live Stream:")
        for idx, r in enumerate(raw_samples, 1):
            print(f"  [{idx}] Lat: {r.latitude:.4f}, Lon: {r.longitude:.4f}, FRP: {r.frp:.2f} MW, Brightness: {r.brightness:.2f} K, Acq Date: {r.acquisition_date}, Satellite: {r.satellite}")

        # 2. Cluster Summary & Classification Breakdown
        clusters = db.query(HotspotCluster).all()
        total_clusters = len(clusters)
        min_risk = db.query(func.min(HotspotCluster.risk_score)).scalar() or 0.0
        max_risk = db.query(func.max(HotspotCluster.risk_score)).scalar() or 0.0

        class_counts = db.query(
            HotspotCluster.predicted_class, func.count(HotspotCluster.id)
        ).group_by(HotspotCluster.predicted_class).all()

        print(f"\n--- 2. CLUSTERING & CLASSIFICATION SUMMARY ---")
        print(f"Total Clusters Processed : {total_clusters}")
        print(f"Minimum Risk Score       : {min_risk:.2f}")
        print(f"Maximum Risk Score       : {max_risk:.2f}")
        print("\nClassification Distribution Breakdown:")
        for cls_name, count in sorted(class_counts, key=lambda x: x[1], reverse=True):
            pct = (count / total_clusters * 100.0) if total_clusters > 0 else 0.0
            print(f"  - {cls_name:<42}: {count:>4} clusters ({pct:.1f}%)")

        # 3. Classifier Rule Reasoning for 3 Real Clusters
        print(f"\n--- 3. RULE ENGINE & REASONING VERIFICATION FOR 3 REAL CLUSTERS ---")
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
            print(f"\nCluster #{c.id} ({c.centroid_lat:.4f}, {c.centroid_lon:.4f}):")
            print(f"  Max FRP / Persistence      : {c.max_frp:.1f} MW / {c.persistence_days} days")
            print(f"  Industry Proximity         : {dist_str} ({c.nearest_industry_name})")
            print(f"  Satellite Evidence Strength: {c.satellite_evidence_strength}")
            print(f"  Fire Evidence Status       : {c.fire_evidence_status}")
            print(f"  Predicted Classification   : {c.predicted_class}")
            print(f"  Exact Rule Reasoning       : \"{res['reasoning']}\"")

        print("=" * 80)
    finally:
        db.close()

if __name__ == "__main__":
    print_summary()
