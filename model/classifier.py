import os
import joblib
import pandas as pd
from sqlalchemy.orm import Session
from db.models import FeedbackLog, ModelVersion

MODEL_PATH = "model/artifacts/rf_model.pkl"

FEATURE_NAMES = [
    "max_frp",
    "avg_frp",
    "persistence_days",
    "recurrence_freq",
    "dist_to_nearest_industry_km",
    "risk_score"
]

def classify_cluster_evidence(db: Session, cluster_features: dict) -> dict:
    """
    Classifies thermal hotspot cluster using either:
    1. Real Trained ML Model (if verified human feedback samples >= 5 and model artifact exists)
    2. Transparent Evidence-Based Rule Engine (when verified human samples < 5)
    
    Does NOT use synthetic training data or fake probabilities.
    Classification outputs do NOT overclaim fire status based simply on satellite availability.
    """
    verified_count = db.query(FeedbackLog).count()

    # Check if a real trained ML model artifact exists
    if os.path.exists(MODEL_PATH) and verified_count >= 5:
        try:
            model = joblib.load(MODEL_PATH)
            vec = []
            for f in FEATURE_NAMES:
                val = cluster_features.get(f)
                if val is None:
                    val = -1.0 if f == "dist_to_nearest_industry_km" else 0.0
                vec.append(float(val))
            pred = model.predict([vec])[0]
            probs = model.predict_proba([vec])[0]
            max_prob = float(max(probs))

            return {
                "predicted_class": str(pred),
                "confidence_score": round(max_prob * 100.0, 1),
                "ml_model_status": "ML_MODEL_TRAINED",
                "reasoning": f"Random Forest ML Model prediction (trained on {verified_count} human-verified samples)."
            }
        except Exception as e:
            print(f"Error loading trained ML model: {e}")

    # Evidence-Based Rule Engine fallback
    dist_km = cluster_features.get("dist_to_nearest_industry_km")
    persistence = cluster_features.get("persistence_days", 1)
    max_frp = cluster_features.get("max_frp", 0.0)
    sat_evidence = cluster_features.get("satellite_evidence_strength", "INSUFFICIENT SATELLITE DATA")
    fire_evidence_status = cluster_features.get("fire_evidence_status", "INSUFFICIENT_DATA")

    if sat_evidence == "INSUFFICIENT SATELLITE DATA" or fire_evidence_status == "INSUFFICIENT_DATA":
        pred_class = "Insufficient Evidence"
        reason = f"Classification uncertain. Satellite thermal evidence is unavailable or clouded. FIRMS persistence: {persistence} days, max FRP: {max_frp} MW."
    elif dist_km is not None and dist_km <= 2.0:
        pred_class = "Possible Industrial Thermal Event" if max_frp >= 25.0 else "Persistent Industrial Thermal Source"
        reason = f"Hotspot within {round(dist_km, 2)} km of registered industry. Max FRP: {max_frp} MW. Satellite evidence: {sat_evidence}."
    elif persistence >= 2 and (dist_km is None or dist_km > 10.0) and max_frp >= 15.0:
        pred_class = "Possible Vegetation/Agricultural Fire"
        dist_str = f"{round(dist_km, 1)} km from industry" if dist_km is not None else "no nearby OSM industry"
        reason = f"Persistent thermal source ({persistence} days active, {dist_str}). Satellite evidence: {sat_evidence}."
    elif max_frp >= 20.0 and persistence <= 2:
        pred_class = "Possible Vegetation/Agricultural Fire"
        reason = f"High FRP intensity ({max_frp} MW) with low persistence duration ({persistence} day) in non-industrial context. Satellite evidence: {sat_evidence}."
    else:
        pred_class = "Uncertain"
        dist_str = f"{round(dist_km, 2)} km" if dist_km is not None else "NO_NEARBY_INDUSTRIAL_FEATURE"
        reason = f"Mixed evidence. FRP: {max_frp} MW, Distance to industry: {dist_str}, Satellite evidence: {sat_evidence}."

    return {
        "predicted_class": pred_class,
        "confidence_score": None,
        "ml_model_status": f"UNINITIALIZED_RULES_ONLY (ML model not trained yet - {verified_count} verified human labels in DB)",
        "reasoning": reason
    }
