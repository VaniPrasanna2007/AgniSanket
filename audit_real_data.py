import os
import sys
import json
from datetime import datetime
from db.database import SessionLocal, init_db
from db.models import RawHotspot, HotspotCluster, SatelliteObservation
from ingestion.firms_ingestion import get_real_firms_data, ingest_raw_hotspots
from features.feature_pipeline import process_hotspot_features

def run_live_audit_20_records():
    print("=" * 80)
    print("SIH26162 REAL DATA PIPELINE AUDIT - 20 FIRMS HOTSPOTS & PIXEL-LEVEL RASTER ANALYSIS")
    print("=" * 80)

    init_db()
    db = SessionLocal()

    try:
        # Step 1: Query FIRMS or fetch existing DB raw hotspots
        raw_hotspots = db.query(RawHotspot).all()
        print(f"Database currently holds {len(raw_hotspots)} raw FIRMS records.")

        if len(raw_hotspots) < 20:
            print("Fetching real NASA FIRMS hotspots to ensure at least 20 records...")
            new_data = get_real_firms_data(days=2)
            ingest_raw_hotspots(db, new_data)
            raw_hotspots = db.query(RawHotspot).all()
            print(f"Total raw hotspots in DB after ingestion: {len(raw_hotspots)}")

        if not raw_hotspots:
            print("ERROR: No raw FIRMS hotspots found in database.")
            return

        # Take 20 records
        audit_records = raw_hotspots[:20]
        print(f"\nRunning pixel-level satellite raster & OSM audit on top 20 FIRMS hotspots...\n")

        # Process clusters
        cluster_count = process_hotspot_features(db, max_clusters=20)

        # Retrieve processed cluster records
        clusters = db.query(HotspotCluster).all()
        print(f"\nTotal Hotspot Clusters Processed and Saved in DB: {len(clusters)}")
        print("=" * 80)

        markdown_lines = []
        markdown_lines.append("# Live System Audit Report: Real FIRMS Hotspot Pipeline Verification\n")
        markdown_lines.append(f"**Audit Timestamp**: {datetime.utcnow().isoformat()} UTC\n")
        markdown_lines.append(f"**Total Raw FIRMS Detections**: {len(raw_hotspots)}\n")
        markdown_lines.append(f"**Total Hotspot Clusters Processed**: {len(clusters)}\n\n")
        markdown_lines.append("| Cluster ID | Centroid (Lat, Lon) | Max FRP | Persistence | Time Diff (Hours) | Temporal Quality | STAC Scene ID | Valid Pix % | Hotspot Max Temp (°C) | Temp Anomaly (°C) | Industry Dist (km) | Nearest Industry | Classification | Risk Score |\n")
        markdown_lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n")

        for c in clusters:
            dist_str = f"{c.dist_to_nearest_industry_km:.2f} km" if c.dist_to_nearest_industry_km is not None else "UNAVAILABLE"
            cloud_str = f"{c.cloud_percentage:.1f}%" if c.cloud_percentage is not None else "UNAVAILABLE"
            valid_str = f"{c.valid_pixel_percentage:.1f}%" if c.valid_pixel_percentage is not None else "UNAVAILABLE"
            temp_str = f"{c.hotspot_max_temp_c:.1f} °C" if c.hotspot_max_temp_c is not None else "UNAVAILABLE"
            anomaly_str = f"{c.thermal_anomaly_c:.1f} °C" if c.thermal_anomaly_c is not None else "UNAVAILABLE"
            diff_h_str = f"{c.time_difference_hours:.1f} hrs" if c.time_difference_hours is not None else "UNAVAILABLE"
            quality_str = c.temporal_match_quality if c.temporal_match_quality else "INVALID"
            scene_str = c.satellite_status

            print(f"\n--- Cluster #{c.id} Details ---")
            print(f"  Coordinates              : ({c.centroid_lat:.4f}, {c.centroid_lon:.4f})")
            print(f"  Max FRP / Persistence    : {c.max_frp} MW / {c.persistence_days} days")
            print(f"  Time Diff to FIRMS       : {diff_h_str} (Quality: {quality_str})")
            print(f"  Satellite Status         : {c.satellite_status}")
            print(f"  Cloud / Valid Pixel %    : Cloud={cloud_str}, Valid={valid_str}")
            print(f"  Hotspot Max Temp / Anomaly: Max={temp_str}, Anomaly={anomaly_str}")
            print(f"  Industry Distance        : {dist_str} ({c.nearest_industry_name})")
            print(f"  Classification / Risk    : {c.predicted_class} (Risk Score: {c.risk_score})")

            markdown_lines.append(f"| #{c.id} | ({c.centroid_lat:.4f}, {c.centroid_lon:.4f}) | {c.max_frp:.1f} MW | {c.persistence_days} days | {diff_h_str} | {quality_str} | {c.satellite_status} | {valid_str} | {temp_str} | {anomaly_str} | {dist_str} | {c.nearest_industry_name} | {c.predicted_class} | {c.risk_score} |\n")

        with open("audit_real_data.md", "w", encoding="utf-8") as f:
            f.writelines(markdown_lines)

        print(f"\nAudit complete. Markdown report saved to audit_real_data.md.")

    finally:
        db.close()

if __name__ == "__main__":
    run_live_audit_20_records()
