from sqlalchemy import Column, Integer, Float, String, DateTime, Text, ForeignKey, JSON
from sqlalchemy.orm import relationship
from datetime import datetime
from db.database import Base

class RawHotspot(Base):
    __tablename__ = "raw_hotspots"

    id = Column(Integer, primary_key=True, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    brightness = Column(Float, nullable=True)
    frp = Column(Float, nullable=False)  # Fire Radiative Power (MW)
    confidence = Column(Float, nullable=False)
    acquisition_date = Column(DateTime, default=datetime.utcnow)
    satellite = Column(String, default="VIIRS_SNPP")
    raw_json = Column(Text, nullable=True)
    cluster_id = Column(Integer, ForeignKey("hotspot_clusters.id"), nullable=True, index=True)
    risk_score = Column(Float, default=0.0)
    risk_level = Column(String, default="LOW")

    cluster = relationship("HotspotCluster", back_populates="hotspots")

class SatelliteObservation(Base):
    __tablename__ = "satellite_observations"

    id = Column(Integer, primary_key=True, index=True)
    cluster_id = Column(Integer, ForeignKey("hotspot_clusters.id"), nullable=True)
    satellite_name = Column(String, nullable=False)
    landsat_scene_id = Column(String, nullable=True)
    sentinel2_scene_id = Column(String, nullable=True)
    thermal_asset_used = Column(String, nullable=True)
    observation_datetime = Column(DateTime, nullable=True)
    cloud_percentage = Column(Float, nullable=True)
    valid_pixel_percentage = Column(Float, nullable=True)
    hotspot_max_temp_c = Column(Float, nullable=True)
    hotspot_mean_temp_c = Column(Float, nullable=True)
    surrounding_median_temp_c = Column(Float, nullable=True)
    thermal_anomaly_c = Column(Float, nullable=True)
    ndvi_median = Column(Float, nullable=True)
    quality_flag = Column(String, nullable=True)
    time_difference_hours = Column(Float, nullable=True)
    temporal_match_quality = Column(String, nullable=True)
    satellite_data_available = Column(Integer, default=0) # SQLite boolean
    thermal_data_available = Column(Integer, default=0)
    optical_data_available = Column(Integer, default=0)
    status = Column(String, default="UNAVAILABLE")

class IndustrialFacility(Base):
    __tablename__ = "industrial_facilities"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    facility_type = Column(String, default="factory")
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    osm_id = Column(String, nullable=True)

class HotspotCluster(Base):
    __tablename__ = "hotspot_clusters"

    id = Column(Integer, primary_key=True, index=True)
    cluster_key = Column(String, unique=True, index=True)
    centroid_lat = Column(Float, nullable=False)
    centroid_lon = Column(Float, nullable=False)
    avg_frp = Column(Float, nullable=False)
    max_frp = Column(Float, nullable=False)
    avg_brightness = Column(Float, nullable=True)
    max_brightness = Column(Float, nullable=True)
    avg_confidence = Column(Float, nullable=True)
    frp_trend = Column(Float, default=0.0)
    detection_count = Column(Integer, default=1)
    first_detected = Column(DateTime, nullable=True)
    last_detected = Column(DateTime, nullable=True)
    persistence_days = Column(Integer, default=1)
    recurrence_freq = Column(Float, default=1.0)
    dist_to_nearest_industry_km = Column(Float, nullable=True)
    nearest_industry_name = Column(String, nullable=True)
    land_use_type = Column(String, default="unknown")
    satellite_name = Column(String, nullable=True)
    landsat_scene_id = Column(String, nullable=True)
    sentinel2_scene_id = Column(String, nullable=True)
    thermal_source = Column(String, nullable=True)
    optical_source = Column(String, nullable=True)
    thermal_unavailable_reason = Column(String, nullable=True)
    optical_unavailable_reason = Column(String, nullable=True)
    satellite_status = Column(String, default="UNAVAILABLE")
    cloud_percentage = Column(Float, nullable=True)
    valid_pixel_percentage = Column(Float, nullable=True)
    hotspot_max_temp_c = Column(Float, nullable=True)
    surrounding_median_temp_c = Column(Float, nullable=True)
    thermal_anomaly_c = Column(Float, nullable=True)
    ndvi_median = Column(Float, nullable=True)
    time_difference_hours = Column(Float, nullable=True)
    temporal_match_quality = Column(String, nullable=True)
    observation_datetime = Column(DateTime, nullable=True)
    satellite_data_available = Column(Integer, default=0)
    thermal_data_available = Column(Integer, default=0)
    optical_data_available = Column(Integer, default=0)
    satellite_evidence_strength = Column(String, default="INSUFFICIENT SATELLITE DATA")
    fire_evidence_status = Column(String, default="INSUFFICIENT_DATA")
    predicted_class = Column(String, default="Pending")
    risk_score = Column(Float, default=0.0)
    authorization_status = Column(String, default="NOT_FOUND_IN_AVAILABLE_REGISTRY")
    ml_model_status = Column(String, default="UNINITIALIZED_RULES_ONLY")
    evidence_json = Column(JSON, nullable=True)
    verification_status = Column(String, default="pending")
    government_status = Column(String, default="UNACKNOWLEDGED") # UNACKNOWLEDGED, ACKNOWLEDGED, DISPATCHED, RESOLVED
    government_notes = Column(Text, nullable=True)
    acknowledged_by = Column(String, nullable=True)
    acknowledged_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    feedbacks = relationship("FeedbackLog", back_populates="cluster")
    hotspots = relationship("RawHotspot", back_populates="cluster")

class FeedbackLog(Base):
    __tablename__ = "feedback_logs"

    id = Column(Integer, primary_key=True, index=True)
    cluster_id = Column(Integer, ForeignKey("hotspot_clusters.id"), nullable=False)
    previous_class = Column(String, nullable=False)
    verified_class = Column(String, nullable=False)
    reviewer_notes = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.utcnow)

    cluster = relationship("HotspotCluster", back_populates="feedbacks")

class ModelVersion(Base):
    __tablename__ = "model_versions"

    id = Column(Integer, primary_key=True, index=True)
    version_name = Column(String, nullable=False)
    trained_at = Column(DateTime, default=datetime.utcnow)
    sample_count = Column(Integer, nullable=False)
    metrics_json = Column(JSON, nullable=False)
    feature_names_json = Column(JSON, nullable=False)

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, nullable=False, default="ANALYST") # ADMIN, ANALYST, GOVERNMENT_AUTHORITY
    created_at = Column(DateTime, default=datetime.utcnow)

