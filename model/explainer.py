import os
import joblib
import shap
import pandas as pd
from model.classifier import MODEL_PATH, FEATURE_NAMES

EXPLAINER_PATH = "model/artifacts/explainer.pkl"

def generate_shap_or_evidence_explanation(cluster_features: dict) -> dict:
    """
    Generates SHAP feature explanations if a real trained ML model exists,
    otherwise generates a transparent Evidence Feature Attribution Breakdown.
    Does NOT generate fake SHAP values.
    """
    # 1. Check if real trained ML model and SHAP explainer exist
    if os.path.exists(MODEL_PATH) and os.path.exists(EXPLAINER_PATH):
        try:
            import numpy as np
            explainer = joblib.load(EXPLAINER_PATH)
            feature_vector = [float(cluster_features.get(f, 0.0) or 0.0) for f in FEATURE_NAMES]
            shap_vals = explainer.shap_values(np.array([feature_vector]))
            
            # Convert to feature impact list for the predicted class
            class_idx = 0
            if os.path.exists(MODEL_PATH):
                try:
                    rf_model = joblib.load(MODEL_PATH)
                    pred_class = rf_model.predict([feature_vector])[0]
                    if hasattr(rf_model, "classes_") and pred_class in list(rf_model.classes_):
                        class_idx = list(rf_model.classes_).index(pred_class)
                except Exception:
                    class_idx = 0

            if isinstance(shap_vals, list):
                # Multi-class list of matrices -> select predicted class matrix, first sample row
                c_idx = min(class_idx, len(shap_vals) - 1)
                impacts = shap_vals[c_idx][0]
            elif isinstance(shap_vals, np.ndarray):
                if shap_vals.ndim == 3:
                    # (n_samples, n_features, n_classes) -> select sample 0, all features, predicted class
                    c_idx = min(class_idx, shap_vals.shape[2] - 1)
                    impacts = shap_vals[0, :, c_idx]
                elif shap_vals.ndim == 2:
                    impacts = shap_vals[0]
                else:
                    impacts = shap_vals.flatten()
            else:
                impacts = np.asarray(shap_vals).flatten()

            attributions = []
            for name, val in zip(FEATURE_NAMES, impacts):
                val_float = float(np.asarray(val).flat[0])
                attributions.append({
                    "feature": name,
                    "attribution_value": round(val_float, 4),
                    "impact": "HIGH" if abs(val_float) > 0.1 else ("MEDIUM" if abs(val_float) > 0.02 else "LOW"),
                    "direction": "POSITIVE" if val_float >= 0 else "NEGATIVE"
                })

            return {
                "explainer_type": "SHAP_TREE_EXPLAINER",
                "attributions": attributions
            }
        except Exception as e:
            print(f"Error executing SHAP explainer: {e}")

    # 2. Transparent Evidence Feature Attribution Breakdown (when ML model is not trained yet)
    max_frp = cluster_features.get("max_frp", 0.0)
    persistence = cluster_features.get("persistence_days", 1)
    dist_km = cluster_features.get("dist_to_nearest_industry_km")
    sat_status = cluster_features.get("satellite_status", "UNAVAILABLE")

    dist_val_str = f"{round(dist_km, 2)} km" if dist_km is not None else "NO_NEARBY_INDUSTRIAL_FEATURE"

    attributions = [
        {
            "feature": "Persistence Duration",
            "value": f"{persistence} days",
            "impact": "HIGH" if persistence >= 3 else ("MEDIUM" if persistence >= 2 else "LOW"),
            "description": "Historical detection persistence over distinct calendar days."
        },
        {
            "feature": "Thermal FRP Intensity",
            "value": f"{max_frp} MW",
            "impact": "HIGH" if max_frp >= 40.0 else ("MEDIUM" if max_frp >= 15.0 else "LOW"),
            "description": "Maximum Fire Radiative Power measured by NASA satellite sensor."
        },
        {
            "feature": "Industrial Proximity Distance",
            "value": dist_val_str,
            "impact": "HIGH" if (dist_km is None or dist_km > 10.0) else "LOW",
            "description": "Distance to nearest registered OSM industrial facility."
        },
        {
            "feature": "Satellite STAC Quality",
            "value": str(sat_status),
            "impact": "HIGH" if sat_status == "AVAILABLE" else "MEDIUM",
            "description": "Sentinel-2 / Landsat observation cloud cover and quality flag."
        }
    ]

    return {
        "explainer_type": "TRANSPARENT_EVIDENCE_BREAKDOWN",
        "attributions": attributions,
        "note": "ML SHAP attributions will activate automatically once a trained ML model is generated from human feedback labels."
    }
