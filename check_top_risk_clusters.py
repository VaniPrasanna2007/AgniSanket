import sys
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster

db = SessionLocal()
clusters = db.query(HotspotCluster).order_by(HotspotCluster.risk_score.desc()).limit(15).all()

print(f"Top 15 Risk Score Clusters in DB:")
for idx, c in enumerate(clusters, start=1):
    print(f"Rank {idx:2d} | DB_ID={c.id:3d} | Risk Score={c.risk_score:5.1f} | Max FRP={c.max_frp:6.1f} MW | Anomaly={str(c.thermal_anomaly_c):6s} | Dist={str(c.dist_to_nearest_industry_km):6s} km | Sat={c.satellite_status}")

db.close()
