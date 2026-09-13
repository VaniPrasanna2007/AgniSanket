def get_satellite_evidence_strength(
    thermal_data_available: int,
    optical_data_available: int,
    temporal_match_quality: str,
    cloud_percentage: float,
    thermal_anomaly_c: float
) -> str:
    """
    Determines the strength of satellite evidence based on data availability, cloud cover, and temporal match.
    """
    if temporal_match_quality == "INVALID":
        return "INSUFFICIENT SATELLITE DATA"
    
    if cloud_percentage is not None and cloud_percentage > 70.0:
        return "INSUFFICIENT SATELLITE DATA"

    if thermal_data_available and temporal_match_quality == "STRONG":
        if thermal_anomaly_c is not None and thermal_anomaly_c > 10.0:
            return "STRONG SATELLITE EVIDENCE"
        return "MODERATE SATELLITE EVIDENCE"
        
    if thermal_data_available and temporal_match_quality in ["MODERATE", "WEAK"]:
        return "MODERATE SATELLITE EVIDENCE"
        
    if optical_data_available and not thermal_data_available:
        return "WEAK SATELLITE EVIDENCE"
        
    return "INSUFFICIENT SATELLITE DATA"

def calculate_evidence_risk_score(
    max_frp: float,
    persistence_days: int,
    detection_count: int,
    dist_to_nearest_industry_km: float = None,
    satellite_status: str = "UNAVAILABLE",
    temporal_match_quality: str = "INVALID",
    thermal_anomaly_c: float = None,
    cloud_percentage: float = None,
    satellite_data_available: int = 0
) -> dict:
    """
    Calculates a transparent 0-100 Risk Score from 5 measurable evidence factors:
    1. FRP Intensity (0-30 pts)
    2. Persistence & Recurrence (0-25 pts)
    3. Landsat Thermal Anomaly (0-15 pts)
    4. Satellite Confirmation (0-15 pts)
    5. Industrial Proximity (0-15 pts)
    
    Missing evidence contributes 0.0 points (no artificial points).
    """
    # 1. Thermal Intensity Factor (0 - 30 pts)
    frp_pts = min(30.0, (max_frp / 80.0) * 30.0) if max_frp else 0.0

    # 2. Persistence & Recurrence Factor (0 - 25 pts)
    pers_days = max(1, persistence_days) if persistence_days else 1
    det_cnt = max(1, detection_count) if detection_count else 1
    persistence_pts = min(15.0, (pers_days / 7.0) * 15.0)
    count_pts = min(10.0, (det_cnt / 15.0) * 10.0)
    recurrence_pts = persistence_pts + count_pts

    # 3. Landsat Thermal Anomaly Factor (0 - 15 pts)
    if thermal_anomaly_c is not None and thermal_anomaly_c > 0.0:
        thermal_anomaly_pts = min(15.0, (thermal_anomaly_c / 15.0) * 15.0)
    else:
        thermal_anomaly_pts = 0.0

    # 4. Satellite Confirmation Factor (0 - 15 pts)
    if satellite_data_available and (cloud_percentage is None or cloud_percentage <= 70.0):
        if temporal_match_quality == "STRONG":
            sat_pts = 15.0
        elif temporal_match_quality == "MODERATE":
            sat_pts = 10.0
        elif temporal_match_quality == "WEAK":
            sat_pts = 5.0
        else:
            sat_pts = 0.0
    else:
        sat_pts = 0.0

    # 5. Industrial Proximity Factor (0 - 15 pts)
    # Closer distance to an industrial site = higher industrial thermal proximity risk evidence.
    if dist_to_nearest_industry_km is None:
        proximity_pts = 0.0
        proximity_type = "NO_NEARBY_INDUSTRIAL_FEATURE"
    elif dist_to_nearest_industry_km <= 2.0:
        proximity_pts = 15.0  # Highest proximity evidence (registered industrial facility)
        proximity_type = "REGISTERED_INDUSTRIAL_SITE"
    elif dist_to_nearest_industry_km <= 10.0:
        proximity_pts = 8.0   # Moderate proximity evidence (industrial periphery)
        proximity_type = "NEARBY_INDUSTRIAL_PERIPHERY"
    else:
        proximity_pts = 2.0   # Lowest proximity evidence (far from industry)
        proximity_type = "FAR_INDUSTRIAL_LOCATION"

    frp_contrib = round(frp_pts, 1)
    recurrence_contrib = round(recurrence_pts, 1)
    thermal_anomaly_contrib = round(thermal_anomaly_pts, 1)
    sat_contrib = round(sat_pts, 1)
    proximity_contrib = round(proximity_pts, 1)

    total_risk = round(frp_contrib + recurrence_contrib + thermal_anomaly_contrib + sat_contrib + proximity_contrib, 1)
    final_risk = min(100.0, max(0.0, total_risk))

    evidence_breakdown = {
        "frp_contribution": frp_contrib,
        "recurrence_contribution": recurrence_contrib,
        "thermal_anomaly_contribution": thermal_anomaly_contrib,
        "satellite_confirmation_contribution": sat_contrib,
        "proximity_contribution": proximity_contrib,
        "proximity_type": proximity_type,
        "satellite_quality_flag": satellite_status,
        "cloud_percentage": cloud_percentage
    }

    return {
        "risk_score": final_risk,
        "evidence": evidence_breakdown
    }

def calculate_individual_hotspot_risk_score(
    frp: float,
    brightness: float = None,
    confidence: float = None,
    dist_to_nearest_industry_km: float = None,
    satellite_data_available: int = 0,
    cloud_percentage: float = None,
    temporal_match_quality: str = "INVALID",
    thermal_anomaly_c: float = None,
) -> dict:
    """
    Calculates a genuine individual FIRMS hotspot risk_score (0-100) using ONLY real available evidence:
    1. FIRMS FRP Intensity (0-25 pts)
    2. FIRMS Brightness Temperature (0-20 pts)
    3. FIRMS Detection Confidence (0-15 pts)
    4. Industrial Proximity (0-15 pts)
    5. Valid Satellite Thermal Anomaly (0-15 pts)
    6. Satellite Temporal Match / Evidence Quality (0-10 pts)
    
    Missing evidence contributes 0.0 points and is explicitly documented as unavailable.
    """
    # 1. FIRMS FRP Intensity (0 - 30 pts)
    frp_val = float(frp) if frp is not None else 0.0
    frp_pts = min(30.0, (frp_val / 40.0) * 30.0) if frp_val > 0 else 0.0

    # 2. FIRMS Brightness Temperature (0 - 20 pts)
    if brightness is not None and brightness > 300.0:
        bright_pts = min(20.0, ((brightness - 300.0) / 40.0) * 20.0)
    else:
        bright_pts = 0.0

    # 3. FIRMS Detection Confidence (0 - 15 pts)
    conf_val = float(confidence) if confidence is not None else 0.0
    conf_pts = min(15.0, (conf_val / 100.0) * 15.0) if conf_val > 0 else 0.0

    # 4. Industrial Proximity (0 - 15 pts)
    if dist_to_nearest_industry_km is None:
        prox_pts = 0.0
        prox_type = "UNAVAILABLE"
    elif dist_to_nearest_industry_km <= 2.0:
        prox_pts = 15.0
        prox_type = "REGISTERED_INDUSTRIAL_SITE"
    elif dist_to_nearest_industry_km <= 10.0:
        prox_pts = 8.0
        prox_type = "NEARBY_INDUSTRIAL_PERIPHERY"
    else:
        prox_pts = 2.0
        prox_type = "FAR_INDUSTRIAL_LOCATION"

    # 5. Satellite Thermal Anomaly (0 - 10 pts)
    if thermal_anomaly_c is not None and thermal_anomaly_c > 0.0:
        thermal_pts = min(10.0, (thermal_anomaly_c / 10.0) * 10.0)
    else:
        thermal_pts = 0.0

    if satellite_data_available and (cloud_percentage is None or cloud_percentage <= 70.0):
        if temporal_match_quality == "STRONG":
            sat_pts = 10.0
        elif temporal_match_quality == "MODERATE":
            sat_pts = 6.0
        elif temporal_match_quality == "WEAK":
            sat_pts = 3.0
        else:
            sat_pts = 0.0
    else:
        sat_pts = 0.0

    frp_c = round(frp_pts, 1)
    bright_c = round(bright_pts, 1)
    conf_c = round(conf_pts, 1)
    prox_c = round(prox_pts, 1)
    thermal_c = round(thermal_pts, 1)
    sat_c = round(sat_pts, 1)

    total = round(frp_c + bright_c + conf_c + prox_c + thermal_c + sat_c, 1)
    final_score = min(100.0, max(0.0, total))

    if final_score > 70.0:
        level = "HIGH"
        color = "#EF4444"
    elif final_score > 40.0:
        level = "MEDIUM"
        color = "#F97316"
    else:
        level = "LOW"
        color = "#22C55E"

    return {
        "risk_score": final_score,
        "risk_level": level,
        "color": color,
        "evidence": {
            "frp_contribution": frp_c,
            "brightness_contribution": bright_c,
            "confidence_contribution": conf_c,
            "proximity_contribution": prox_c,
            "thermal_anomaly_contribution": thermal_c,
            "satellite_contribution": sat_c,
            "proximity_type": prox_type,
            "thermal_anomaly_available": thermal_anomaly_c is not None,
            "satellite_match_available": bool(satellite_data_available)
        }
    }

