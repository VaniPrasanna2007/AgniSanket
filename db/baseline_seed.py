import os
import gzip
import json
from datetime import datetime
from sqlalchemy.orm import Session
from db.models import RawHotspot, HotspotCluster, IndustrialFacility

BASELINE_FILE = os.path.join(os.path.dirname(__file__), "baseline_data.json.gz")

def seed_baseline_if_empty(db: Session) -> bool:
    """
    Seeds historical baseline data ONLY when the database is completely empty.
    Requirements:
    1. Seed only when HotspotCluster count is 0 and RawHotspot count is 0.
    2. Never reseed on every restart (if data exists, return False immediately).
    3. Clearly identify seeded data as historical baseline data.
    4. Never overwrite real live data.
    5. Optional; failure to read seed file logs a warning and does not hide DB errors.
    """
    try:
        cluster_count = db.query(HotspotCluster).count()
        hotspot_count = db.query(RawHotspot).count()

        if cluster_count > 0 or hotspot_count > 0:
            # Database already contains data. Strictly do NOT reseed.
            return False

        if not os.path.exists(BASELINE_FILE):
            print("[BASELINE SEED] No baseline_data.json.gz found. Starting with clean empty database.")
            return False

        print("\n==================== [HISTORICAL BASELINE SEED] ====================")
        print("[BASELINE SEED] Database is completely empty (0 clusters, 0 raw hotspots).")
        print(f"[BASELINE SEED] Loading historical baseline dataset from {BASELINE_FILE}...")

        with gzip.open(BASELINE_FILE, "rt", encoding="utf-8") as f:
            data = json.load(f)

        # 1. Populate Industrial Facilities
        facilities_data = data.get("facilities", [])
        if facilities_data:
            fac_objs = [
                IndustrialFacility(
                    name=f["name"],
                    facility_type=f.get("facility_type", "factory"),
                    latitude=f["latitude"],
                    longitude=f["longitude"],
                    osm_id=f.get("osm_id")
                )
                for f in facilities_data
            ]
            db.bulk_save_objects(fac_objs)
            db.commit()
            print(f"[BASELINE SEED] Seeded {len(fac_objs)} baseline industrial facilities.")

        # 2. Populate Clusters
        clusters_data = data.get("clusters", [])
        cluster_id_mapping = {}
        for c in clusters_data:
            ev_json = c.get("evidence_json") or {}
            if isinstance(ev_json, dict):
                ev_json["is_historical_baseline"] = True
            first_dt = datetime.fromisoformat(c["first_detected"]) if c.get("first_detected") else None
            last_dt = datetime.fromisoformat(c["last_detected"]) if c.get("last_detected") else None
            obs_dt = datetime.fromisoformat(c["observation_datetime"]) if c.get("observation_datetime") else None
            ack_dt = datetime.fromisoformat(c["acknowledged_at"]) if c.get("acknowledged_at") else None

            cluster_obj = HotspotCluster(
                cluster_key=c["cluster_key"],
                centroid_lat=c["centroid_lat"],
                centroid_lon=c["centroid_lon"],
                avg_frp=c["avg_frp"],
                max_frp=c["max_frp"],
                avg_brightness=c.get("avg_brightness"),
                max_brightness=c.get("max_brightness"),
                avg_confidence=c.get("avg_confidence"),
                frp_trend=c.get("frp_trend", 0.0),
                detection_count=c.get("detection_count", 1),
                first_detected=first_dt,
                last_detected=last_dt,
                persistence_days=c.get("persistence_days", 1),
                recurrence_freq=c.get("recurrence_freq", 1.0),
                dist_to_nearest_industry_km=c.get("dist_to_nearest_industry_km"),
                nearest_industry_name=c.get("nearest_industry_name"),
                satellite_status=c.get("satellite_status", "AVAILABLE"),
                landsat_scene_id=c.get("landsat_scene_id"),
                sentinel2_scene_id=c.get("sentinel2_scene_id"),
                thermal_source=c.get("thermal_source"),
                optical_source=c.get("optical_source"),
                thermal_unavailable_reason=c.get("thermal_unavailable_reason"),
                optical_unavailable_reason=c.get("optical_unavailable_reason"),
                cloud_percentage=c.get("cloud_percentage"),
                valid_pixel_percentage=c.get("valid_pixel_percentage"),
                hotspot_max_temp_c=c.get("hotspot_max_temp_c"),
                surrounding_median_temp_c=c.get("surrounding_median_temp_c"),
                thermal_anomaly_c=c.get("thermal_anomaly_c"),
                ndvi_median=c.get("ndvi_median"),
                time_difference_hours=c.get("time_difference_hours"),
                temporal_match_quality=c.get("temporal_match_quality"),
                observation_datetime=obs_dt,
                satellite_data_available=c.get("satellite_data_available", 1),
                thermal_data_available=c.get("thermal_data_available", 1),
                optical_data_available=c.get("optical_data_available", 1),
                satellite_evidence_strength=c.get("satellite_evidence_strength", "MODERATE SATELLITE EVIDENCE"),
                fire_evidence_status=c.get("fire_evidence_status", "EVIDENCE_AVAILABLE"),
                predicted_class=c.get("predicted_class", "Pending"),
                risk_score=c.get("risk_score", 0.0),
                authorization_status=c.get("authorization_status", "UNKNOWN"),
                ml_model_status=c.get("ml_model_status", "RULES_EVIDENCE_EVALUATED"),
                evidence_json=ev_json,
                government_status=c.get("government_status", "UNACKNOWLEDGED"),
                government_notes=c.get("government_notes"),
                acknowledged_by=c.get("acknowledged_by"),
                acknowledged_at=ack_dt
            )
            db.add(cluster_obj)
            cluster_id_mapping[c["id"]] = cluster_obj

        db.commit()
        print(f"[BASELINE SEED] Seeded {len(clusters_data)} historical baseline clusters.")

        # 3. Populate Raw Hotspots
        raw_data = data.get("raw_hotspots", [])
        raw_objs = []
        for r in raw_data:
            acq_dt = datetime.fromisoformat(r["acquisition_date"]) if r.get("acquisition_date") else None
            matched_cluster = cluster_id_mapping.get(r.get("cluster_id"))
            cluster_fk = matched_cluster.id if matched_cluster else None

            raw_objs.append(RawHotspot(
                latitude=r["latitude"],
                longitude=r["longitude"],
                brightness=r.get("brightness"),
                frp=r["frp"],
                confidence=r["confidence"],
                acquisition_date=acq_dt,
                satellite=r.get("satellite", "VIIRS"),
                cluster_id=cluster_fk,
                risk_score=r.get("risk_score", 0.0),
                risk_level=r.get("risk_level", "LOW")
            ))

        db.bulk_save_objects(raw_objs)
        db.commit()
        print(f"[BASELINE SEED] Seeded {len(raw_objs)} historical baseline raw hotspots.")
        print("====================================================================\n")
        return True

    except Exception as e:
        print(f"[BASELINE SEED WARNING] Could not load optional baseline seed: {e}")
        db.rollback()
        return False
