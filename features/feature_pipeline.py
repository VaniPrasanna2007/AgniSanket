import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.cluster import DBSCAN
from sqlalchemy.orm import Session
from db.database import SessionLocal, init_db
from db.models import RawHotspot, HotspotCluster, SatelliteObservation
from ingestion.satellite_verification import verify_hotspot_stac_satellite
from ingestion.osm_enrichment import get_nearest_industrial_facility
from features.risk_engine import calculate_evidence_risk_score, get_satellite_evidence_strength, calculate_individual_hotspot_risk_score
from model.classifier import classify_cluster_evidence

def process_hotspot_features(db: Session, kms_per_radian: float = 6371.0, eps_km: float = 3.5, min_samples: int = 1, max_clusters: int = None) -> int:
    """
    Groups real accumulated DB raw FIRMS hotspots into spatial DBSCAN clusters,
    performs REAL PIXEL-LEVEL satellite raster analysis (Landsat LST thermal & Sentinel-2 NDVI),
    queries live OSM industrial facilities, computes historical persistence, and updates cluster records.
    Uses 0% synthetic/mock data.
    """
    raw_hotspots = db.query(RawHotspot).all()
    if not raw_hotspots:
        print("No raw hotspots found in database to process.")
        return 0

    print(f"Processing spatial DBSCAN clustering and real raster pixel analysis on {len(raw_hotspots)} raw FIRMS hotspots...")

    data = []
    for h in raw_hotspots:
        data.append({
            "id": h.id,
            "latitude": h.latitude,
            "longitude": h.longitude,
            "frp": h.frp,
            "brightness": h.brightness,
            "confidence": h.confidence,
            "acquisition_date": h.acquisition_date
        })

    df = pd.DataFrame(data)
    coords_rad = np.radians(df[["latitude", "longitude"]].values)
    epsilon = eps_km / kms_per_radian

    dbscan = DBSCAN(eps=epsilon, min_samples=min_samples, metric="haversine")
    df["cluster_label"] = dbscan.fit_predict(coords_rad)

    cluster_count = 0

    for label, group in df.groupby("cluster_label"):
        if max_clusters and cluster_count >= max_clusters:
            break
        centroid_lat = float(group["latitude"].mean())
        centroid_lon = float(group["longitude"].mean())
        avg_frp = float(group["frp"].mean())
        max_frp = float(group["frp"].max())

        avg_brightness = round(float(group["brightness"].mean()), 2) if "brightness" in group and group["brightness"].notnull().any() else None
        max_brightness = round(float(group["brightness"].max()), 2) if "brightness" in group and group["brightness"].notnull().any() else None
        avg_confidence = round(float(group["confidence"].mean()), 1) if "confidence" in group and group["confidence"].notnull().any() else None

        dates = pd.to_datetime(group["acquisition_date"])
        first_detected = dates.min().to_pydatetime()
        last_detected = dates.max().to_pydatetime()

        distinct_days = len(dates.dt.date.unique())
        persistence_days = max(1, distinct_days)
        detection_count = len(group)
        recurrence_freq = round(detection_count / persistence_days, 2)

        if len(group) > 1:
            sorted_g = group.sort_values("acquisition_date")
            frp_trend = round(float(sorted_g.iloc[-1]["frp"] - sorted_g.iloc[0]["frp"]), 2)
        else:
            frp_trend = 0.0

        cluster_key = f"c_{round(centroid_lat, 3)}_{round(centroid_lon, 3)}"

        # 1. Query live Overpass API / cache for nearest industrial facility
        facility = get_nearest_industrial_facility(db, centroid_lat, centroid_lon)
        dist_km = facility.get("distance_km")
        facility_name = facility.get("name", "NO_NEARBY_INDUSTRIAL_FEATURE")

        # 2. Perform REAL PIXEL-LEVEL satellite raster analysis (Landsat LST + Sentinel-2 NDVI)
        sat_info = verify_hotspot_stac_satellite(centroid_lat, centroid_lon, last_detected)

        # Calculate satellite evidence strength
        sat_evidence = get_satellite_evidence_strength(
            thermal_data_available=sat_info["thermal_data_available"],
            optical_data_available=sat_info["optical_data_available"],
            temporal_match_quality=sat_info["temporal_match_quality"],
            cloud_percentage=sat_info.get("cloud_percentage"),
            thermal_anomaly_c=sat_info.get("thermal_anomaly_c")
        )

        fire_evidence_status = "INSUFFICIENT_DATA"
        if sat_evidence in ["STRONG SATELLITE EVIDENCE", "MODERATE SATELLITE EVIDENCE"]:
            fire_evidence_status = "EVIDENCE_AVAILABLE"

        # 3. Calculate transparent evidence-based risk score
        risk_data = calculate_evidence_risk_score(
            max_frp=max_frp,
            persistence_days=persistence_days,
            detection_count=detection_count,
            dist_to_nearest_industry_km=dist_km,
            satellite_status=sat_info["status"],
            temporal_match_quality=sat_info["temporal_match_quality"],
            thermal_anomaly_c=sat_info.get("thermal_anomaly_c"),
            cloud_percentage=sat_info.get("cloud_percentage"),
            satellite_data_available=sat_info["satellite_data_available"]
        )

        cluster_feature_dict = {
            "centroid_lat": centroid_lat,
            "centroid_lon": centroid_lon,
            "avg_frp": avg_frp,
            "max_frp": max_frp,
            "persistence_days": persistence_days,
            "recurrence_freq": recurrence_freq,
            "dist_to_nearest_industry_km": dist_km,
            "satellite_status": sat_info["status"],
            "satellite_evidence_strength": sat_evidence,
            "fire_evidence_status": fire_evidence_status,
            "risk_score": risk_data["risk_score"]
        }

        classification_res = classify_cluster_evidence(db, cluster_feature_dict)
        # Requirement 11: Authorization status must be UNKNOWN if no official registry is available
        auth_status = "UNKNOWN"

        existing_c = db.query(HotspotCluster).filter(HotspotCluster.cluster_key == cluster_key).first()

        if existing_c:
            existing_c.centroid_lat = centroid_lat
            existing_c.centroid_lon = centroid_lon
            existing_c.avg_frp = avg_frp
            existing_c.max_frp = max_frp
            existing_c.avg_brightness = avg_brightness
            existing_c.max_brightness = max_brightness
            existing_c.avg_confidence = avg_confidence
            existing_c.frp_trend = frp_trend
            existing_c.detection_count = detection_count
            existing_c.first_detected = first_detected
            existing_c.last_detected = last_detected
            existing_c.persistence_days = persistence_days
            existing_c.recurrence_freq = recurrence_freq
            existing_c.dist_to_nearest_industry_km = dist_km
            existing_c.nearest_industry_name = facility_name
            existing_c.satellite_name = sat_info.get("satellite_name")
            existing_c.landsat_scene_id = sat_info.get("landsat_scene_id")
            existing_c.sentinel2_scene_id = sat_info.get("sentinel2_scene_id")
            obs_dt = datetime.fromisoformat(sat_info["observation_datetime"].replace("Z", "+00:00")).replace(tzinfo=None) if sat_info.get("observation_datetime") else None
            existing_c.satellite_name = sat_info.get("satellite_name")
            existing_c.landsat_scene_id = sat_info.get("landsat_scene_id")
            existing_c.sentinel2_scene_id = sat_info.get("sentinel2_scene_id")
            existing_c.thermal_source = sat_info.get("thermal_source")
            existing_c.optical_source = sat_info.get("optical_source")
            existing_c.thermal_unavailable_reason = sat_info.get("thermal_unavailable_reason")
            existing_c.optical_unavailable_reason = sat_info.get("optical_unavailable_reason")
            existing_c.satellite_status = sat_info["status"]
            existing_c.cloud_percentage = sat_info.get("cloud_percentage")
            existing_c.valid_pixel_percentage = sat_info.get("valid_pixel_percentage")
            existing_c.hotspot_max_temp_c = sat_info.get("hotspot_max_temp_c")
            existing_c.surrounding_median_temp_c = sat_info.get("surrounding_median_temp_c")
            existing_c.thermal_anomaly_c = sat_info.get("thermal_anomaly_c")
            existing_c.ndvi_median = sat_info.get("ndvi_median")
            existing_c.time_difference_hours = sat_info.get("time_difference_hours")
            existing_c.temporal_match_quality = sat_info["temporal_match_quality"]
            existing_c.observation_datetime = obs_dt
            existing_c.satellite_data_available = sat_info["satellite_data_available"]
            existing_c.thermal_data_available = sat_info["thermal_data_available"]
            existing_c.optical_data_available = sat_info["optical_data_available"]
            existing_c.satellite_evidence_strength = sat_evidence
            existing_c.fire_evidence_status = fire_evidence_status
            existing_c.predicted_class = classification_res["predicted_class"]
            existing_c.risk_score = risk_data["risk_score"]
            existing_c.authorization_status = auth_status
            existing_c.ml_model_status = classification_res["ml_model_status"]
            existing_c.evidence_json = {
                "risk_breakdown": risk_data["evidence"],
                "stac_satellite": sat_info,
                "osm_facility": facility,
                "evidence_reasoning": classification_res["reasoning"]
            }
            c_obj = existing_c
        else:
            obs_dt = datetime.fromisoformat(sat_info["observation_datetime"].replace("Z", "+00:00")).replace(tzinfo=None) if sat_info.get("observation_datetime") else None
            c_obj = HotspotCluster(
                cluster_key=cluster_key,
                centroid_lat=centroid_lat,
                centroid_lon=centroid_lon,
                avg_frp=avg_frp,
                max_frp=max_frp,
                avg_brightness=avg_brightness,
                max_brightness=max_brightness,
                avg_confidence=avg_confidence,
                frp_trend=frp_trend,
                detection_count=detection_count,
                first_detected=first_detected,
                last_detected=last_detected,
                persistence_days=persistence_days,
                recurrence_freq=recurrence_freq,
                dist_to_nearest_industry_km=dist_km,
                nearest_industry_name=facility_name,
                satellite_name=sat_info.get("satellite_name"),
                landsat_scene_id=sat_info.get("landsat_scene_id"),
                sentinel2_scene_id=sat_info.get("sentinel2_scene_id"),
                thermal_source=sat_info.get("thermal_source"),
                optical_source=sat_info.get("optical_source"),
                thermal_unavailable_reason=sat_info.get("thermal_unavailable_reason"),
                optical_unavailable_reason=sat_info.get("optical_unavailable_reason"),
                satellite_status=sat_info["status"],
                cloud_percentage=sat_info.get("cloud_percentage"),
                valid_pixel_percentage=sat_info.get("valid_pixel_percentage"),
                hotspot_max_temp_c=sat_info.get("hotspot_max_temp_c"),
                surrounding_median_temp_c=sat_info.get("surrounding_median_temp_c"),
                thermal_anomaly_c=sat_info.get("thermal_anomaly_c"),
                ndvi_median=sat_info.get("ndvi_median"),
                time_difference_hours=sat_info.get("time_difference_hours"),
                temporal_match_quality=sat_info["temporal_match_quality"],
                observation_datetime=obs_dt,
                satellite_data_available=sat_info["satellite_data_available"],
                thermal_data_available=sat_info["thermal_data_available"],
                optical_data_available=sat_info["optical_data_available"],
                satellite_evidence_strength=sat_evidence,
                fire_evidence_status=fire_evidence_status,
                predicted_class=classification_res["predicted_class"],
                risk_score=risk_data["risk_score"],
                authorization_status=auth_status,
                ml_model_status=classification_res["ml_model_status"],
                evidence_json={
                    "risk_breakdown": risk_data["evidence"],
                    "stac_satellite": sat_info,
                    "osm_facility": facility,
                    "evidence_reasoning": classification_res["reasoning"]
                }
            )
            db.add(c_obj)

        db.commit()

        # 4. Compute genuine individual hotspot risk scores and link constituent RawHotspots
        hotspot_ids = group["id"].tolist()
        raw_members = db.query(RawHotspot).filter(RawHotspot.id.in_(hotspot_ids)).all()
        for member in raw_members:
            member.cluster_id = c_obj.id
            h_risk = calculate_individual_hotspot_risk_score(
                frp=member.frp,
                brightness=member.brightness,
                confidence=member.confidence,
                dist_to_nearest_industry_km=dist_km,
                satellite_data_available=sat_info["satellite_data_available"],
                cloud_percentage=sat_info.get("cloud_percentage"),
                temporal_match_quality=sat_info.get("temporal_match_quality"),
                thermal_anomaly_c=sat_info.get("thermal_anomaly_c")
            )
            member.risk_score = h_risk["risk_score"]
            member.risk_level = h_risk["risk_level"]
        db.commit()

        # Save SatelliteObservation record
        sat_obs = SatelliteObservation(
            cluster_id=c_obj.id,
            satellite_name=sat_info.get("satellite_name", "Landsat-8/9 & Sentinel-2"),
            landsat_scene_id=sat_info.get("landsat_scene_id"),
            sentinel2_scene_id=sat_info.get("sentinel2_scene_id"),
            thermal_asset_used=sat_info.get("thermal_asset_used"),
            observation_datetime=datetime.fromisoformat(sat_info["observation_datetime"].replace("Z", "+00:00")).replace(tzinfo=None) if sat_info.get("observation_datetime") else None,
            cloud_percentage=sat_info.get("cloud_percentage"),
            valid_pixel_percentage=sat_info.get("valid_pixel_percentage"),
            hotspot_max_temp_c=sat_info.get("hotspot_max_temp_c"),
            hotspot_mean_temp_c=sat_info.get("hotspot_mean_temp_c"),
            surrounding_median_temp_c=sat_info.get("surrounding_median_temp_c"),
            thermal_anomaly_c=sat_info.get("thermal_anomaly_c"),
            ndvi_median=sat_info.get("ndvi_median"),
            quality_flag=sat_info.get("quality_flag"),
            time_difference_hours=sat_info.get("time_difference_hours"),
            temporal_match_quality=sat_info.get("temporal_match_quality"),
            satellite_data_available=sat_info.get("satellite_data_available"),
            thermal_data_available=sat_info.get("thermal_data_available"),
            optical_data_available=sat_info.get("optical_data_available"),
            status=sat_info["status"]
        )
        db.add(sat_obs)
        db.commit()

        cluster_count += 1

    print(f"Feature pipeline processed {cluster_count} real hotspot clusters with real pixel-level satellite metrics.")
    return cluster_count

if __name__ == "__main__":
    init_db()
    db = SessionLocal()
    try:
        count = process_hotspot_features(db)
        print(f"\n--- REAL RASTER FEATURE PIPELINE TEST SUCCESSFUL ---")
        print(f"Total Clusters Processed: {count}")
    finally:
        db.close()
