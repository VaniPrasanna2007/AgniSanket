import os
from datetime import datetime
from sqlalchemy.orm import Session
from db.database import SessionLocal, init_db
from db.models import FeedbackLog, HotspotCluster, ModelVersion
from model.classifier import FEATURE_NAMES, MODEL_PATH
from model.explainer import EXPLAINER_PATH

os.makedirs("model/artifacts", exist_ok=True)

def train_model_from_human_feedback(db: Session, min_samples_required: int = 5) -> dict:
    """
    Trains a real RandomForestClassifier exclusively on human-verified feedback labels stored in the database.
    Does NOT use synthetic or invented data distributions.
    Returns metrics dictionary or error message if sample count is insufficient.
    """
    feedbacks = db.query(FeedbackLog).all()
    sample_count = len(feedbacks)

    if sample_count < min_samples_required:
        return {
            "status": "error",
            "message": f"ML model training aborted: Insufficient human-verified training samples (found {sample_count}, minimum {min_samples_required} required). Please submit human verification labels via the dashboard first.",
            "verified_samples_found": sample_count
        }

    import joblib
    import shap
    import pandas as pd
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.model_selection import train_test_split
    from sklearn.metrics import classification_report, precision_recall_fscore_support, confusion_matrix

    print(f"Loading {sample_count} human-verified feedback samples from database...")

    X = []
    y = []

    for f in feedbacks:
        cluster = db.query(HotspotCluster).filter(HotspotCluster.id == f.cluster_id).first()
        if cluster:
            vec = [
                cluster.max_frp or 0.0,
                cluster.avg_frp or 0.0,
                cluster.persistence_days or 1,
                cluster.recurrence_freq or 1.0,
                cluster.dist_to_nearest_industry_km if cluster.dist_to_nearest_industry_km is not None else -1.0,
                cluster.risk_score or 0.0
            ]
            X.append(vec)
            y.append(f.verified_class)

    if len(X) < min_samples_required:
        return {
            "status": "error",
            "message": "Valid cluster feature vectors for feedback labels could not be extracted.",
            "verified_samples_found": len(X)
        }

    # Class distribution check
    y_series = pd.Series(y)
    class_dist = y_series.value_counts().to_dict()
    print(f"Training set class distribution: {class_dist}")

    # Train / Test split if samples permit
    if len(X) >= 8 and len(class_dist) > 1:
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.25, random_state=42)
    else:
        X_train, X_test, y_train, y_test = X, X, y, y

    # Train Random Forest
    rf = RandomForestClassifier(n_estimators=100, max_depth=6, random_state=42)
    rf.fit(X_train, y_train)

    # Evaluate
    y_pred = rf.predict(X_test)
    precision, recall, f1, _ = precision_recall_fscore_support(y_test, y_pred, average="weighted", zero_division=0)
    cm = confusion_matrix(y_test, y_pred).tolist()

    # Save model artifact
    joblib.dump(rf, MODEL_PATH)

    # Fit and save SHAP Explainer
    explainer = shap.TreeExplainer(rf)
    joblib.dump(explainer, EXPLAINER_PATH)

    metrics = {
        "verified_sample_count": len(X),
        "class_distribution": class_dist,
        "precision": round(float(precision), 4),
        "recall": round(float(recall), 4),
        "f1_score": round(float(f1), 4),
        "confusion_matrix": cm
    }

    # Persist model version to DB
    ver = ModelVersion(
        version_name=f"v_feedback_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}",
        sample_count=len(X),
        metrics_json=metrics,
        feature_names_json=FEATURE_NAMES
    )
    db.add(ver)
    db.commit()

    print(f"Model successfully trained on {len(X)} human-verified labels. Precision: {metrics['precision']}, Recall: {metrics['recall']}, F1: {metrics['f1_score']}")

    return {
        "status": "success",
        "message": f"Random Forest model successfully trained on {len(X)} human-verified labels.",
        "metrics": metrics
    }

if __name__ == "__main__":
    init_db()
    db = SessionLocal()
    try:
        res = train_model_from_human_feedback(db)
        print("Model Retrain Test Result:")
        print(res)
    finally:
        db.close()
