import os
import sys
from datetime import datetime
from db.database import SessionLocal, init_db
from db.models import RawHotspot, HotspotCluster, SatelliteObservation
from ingestion.satellite_verification import verify_hotspot_stac_satellite
from ingestion.osm_enrichment import get_nearest_industrial_facility
from features.risk_engine import calculate_evidence_risk_score, get_satellite_evidence_strength

def audit_5_real_records():
    print("=" * 80, flush=True)
    print("SIH26162 AUDIT: TESTING 5 REAL FIRMS RECORDS WITH LIVE SATELLITE RASTER & OSM ANALYSIS", flush=True)
    print("=" * 80, flush=True)

    init_db()
    db = SessionLocal()

    try:
        raw_hotspots = db.query(RawHotspot).all()
        print(f"Database contains {len(raw_hotspots)} raw FIRMS records.", flush=True)
        if len(raw_hotspots) < 5:
            print("Error: Need at least 5 raw FIRMS records in database.", flush=True)
            return

        records_to_test = raw_hotspots[:5]

        for i, h in enumerate(records_to_test, 1):
            print("\n" + "=" * 60, flush=True)
            print(f"RECORD #{i}: FIRMS ID {h.id}", flush=True)
            print("=" * 60, flush=True)
            print(f"FIRMS ID                   : {h.id}", flush=True)
            print(f"Coordinates                : ({h.latitude}, {h.longitude})", flush=True)
            print(f"FIRMS Acquisition Time     : {h.acquisition_date.isoformat()}", flush=True)

            # 1. Real OSM facility check
            facility = get_nearest_industrial_facility(db, h.latitude, h.longitude)
            dist_km = facility.get("distance_km")
            facility_name = facility.get("name", "NO_NEARBY_INDUSTRIAL_FEATURE")
            dist_str = f"{dist_km:.2f} km" if dist_km is not None else "UNAVAILABLE"

            # 2. Real STAC & Pixel Raster Analysis
            sat_info = verify_hotspot_stac_satellite(h.latitude, h.longitude, h.acquisition_date)

            # Calculate evidence strength & status
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

            # Calculate risk score
            risk_data = calculate_evidence_risk_score(
                max_frp=h.frp,
                persistence_days=1,
                detection_count=1,
                dist_to_nearest_industry_km=dist_km,
                satellite_status=sat_info["status"],
                temporal_match_quality=sat_info["temporal_match_quality"],
                thermal_anomaly_c=sat_info.get("thermal_anomaly_c"),
                cloud_percentage=sat_info.get("cloud_percentage")
            )

            # Record summary print
            scene_id = sat_info.get("landsat_scene_id") or sat_info.get("sentinel2_scene_id") or "UNAVAILABLE"
            thermal_asset = sat_info.get("thermal_asset_used") or "UNAVAILABLE"
            valid_px = f"{sat_info.get('valid_pixel_percentage')}%" if sat_info.get('valid_pixel_percentage') is not None else "UNAVAILABLE"
            cloud_px = f"{sat_info.get('cloud_percentage')}%" if sat_info.get('cloud_percentage') is not None else "UNAVAILABLE"
            max_temp = f"{sat_info.get('hotspot_max_temp_c')} °C" if sat_info.get('hotspot_max_temp_c') is not None else "UNAVAILABLE"
            mean_temp = f"{sat_info.get('hotspot_mean_temp_c')} °C" if sat_info.get('hotspot_mean_temp_c') is not None else "UNAVAILABLE"
            bg_temp = f"{sat_info.get('surrounding_median_temp_c')} °C" if sat_info.get('surrounding_median_temp_c') is not None else "UNAVAILABLE"
            anomaly = f"{sat_info.get('thermal_anomaly_c')} °C" if sat_info.get('thermal_anomaly_c') is not None else "UNAVAILABLE"
            ndvi = f"{sat_info.get('ndvi_median')}" if sat_info.get('ndvi_median') is not None else "UNAVAILABLE"

            print(f"\n--- AUDIT SUMMARY FOR RECORD #{h.id} ---", flush=True)
            print(f"FIRMS ID                   : {h.id}", flush=True)
            print(f"Coordinates                : ({h.latitude}, {h.longitude})", flush=True)
            print(f"FIRMS Acquisition Time     : {h.acquisition_date.isoformat()}", flush=True)
            print(f"Satellite Scene            : {scene_id}", flush=True)
            print(f"Thermal Asset              : {thermal_asset}", flush=True)
            print(f"Valid Pixels %             : {valid_px}", flush=True)
            print(f"Cloud/Invalid Pixels %     : {cloud_px}", flush=True)
            print(f"Temperature Statistics     : Max={max_temp}, Mean={mean_temp}", flush=True)
            print(f"Surrounding Temperature    : Median={bg_temp}", flush=True)
            print(f"Thermal Anomaly            : {anomaly}", flush=True)
            print(f"NDVI                       : {ndvi}", flush=True)
            print(f"OSM Industrial Feature     : {facility_name}", flush=True)
            print(f"Real Industry Distance     : {dist_str}", flush=True)
            print(f"Temporal Match Quality     : {sat_info.get('temporal_match_quality')}", flush=True)
            print(f"Final Evidence Status      : {sat_info.get('status')} / {fire_evidence_status}", flush=True)
            print(f"Risk Score                 : {risk_data['risk_score']}/100", flush=True)

    finally:
        db.close()

if __name__ == "__main__":
    audit_5_real_records()
