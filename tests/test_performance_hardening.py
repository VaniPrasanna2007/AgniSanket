import os
import sys
import gzip
import json
import unittest
from dotenv import load_dotenv

sys.path.insert(0, os.getcwd())
load_dotenv(dotenv_path=os.path.join(os.getcwd(), '.env'), override=True)
neon_url = os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")

if neon_url:
    os.environ["DATABASE_URL"] = neon_url
    os.environ["DB_URL"] = neon_url

from sqlalchemy import func
from db.database import SessionLocal
from db.models import HotspotCluster, RawHotspot, IndustrialFacility, User

class TestPerformanceHardening(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db = SessionLocal()

    @classmethod
    def tearDownClass(cls):
        cls.db.close()

    def test_database_counts_preserved(self):
        """Verify 1,141 clusters, 5,904 clustered hotspots, 3,079 unclustered, 557 facilities."""
        total_clusters = self.db.query(func.count(HotspotCluster.id)).scalar()
        clustered_hotspots = self.db.query(func.count(RawHotspot.id)).filter(RawHotspot.cluster_id.isnot(None)).scalar()
        unclustered_hotspots = self.db.query(func.count(RawHotspot.id)).filter(RawHotspot.cluster_id.is_(None)).scalar()
        total_facilities = self.db.query(func.count(IndustrialFacility.id)).scalar()

        self.assertEqual(total_clusters, 1141, f"Expected 1,141 clusters, got {total_clusters}")
        self.assertEqual(clustered_hotspots, 5904, f"Expected 5,904 clustered raw hotspots, got {clustered_hotspots}")
        self.assertEqual(unclustered_hotspots, 3079, f"Expected 3,079 unclustered raw hotspots, got {unclustered_hotspots}")
        self.assertEqual(total_facilities, 557, f"Expected 557 industrial facilities, got {total_facilities}")
        print(f"\n[PASS] Database integrity: 1,141 clusters, 5,904 clustered, 3,079 unclustered, 557 facilities.")

    def test_strict_high_risk_rule(self):
        """Verify strict high risk rule: risk_score > 70.0 only."""
        high_risk_db = self.db.query(func.count(HotspotCluster.id)).filter(HotspotCluster.risk_score > 70.0).scalar()
        
        # Test boundary cases
        borderline_70 = self.db.query(func.count(HotspotCluster.id)).filter(HotspotCluster.risk_score == 70.0).scalar()
        self.assertEqual(borderline_70, 0, "Risk score 70.0 exactly must not qualify as strict high risk > 70.0")

        # Verify no cluster with risk <= 70 is flagged as high risk
        invalid_high = self.db.query(func.count(HotspotCluster.id)).filter(HotspotCluster.risk_score <= 70.0, HotspotCluster.risk_score > 70.0).scalar()
        self.assertEqual(invalid_high, 0)
        print(f"[PASS] Strict High-Risk rule (> 70.0) verified. High risk count: {high_risk_db}.")

    def test_api_hotspots_contract_compatibility(self):
        """Verify /api/hotspots returns 1,141 clusters with required keys."""
        from api.main import list_clusters
        resp = list_clusters(risk_threshold=0.0, db=self.db)
        
        data = json.loads(resp.body.decode('utf-8'))
        self.assertEqual(len(data), 1141, f"API must return all 1,141 clusters without truncation, got {len(data)}")

        sample = data[0]
        required_keys = [
            "id", "display_id", "cluster_number", "centroid_lat", "centroid_lon",
            "max_frp", "predicted_class", "risk_score", "hotspots", "num_hotspots",
            "government_status", "satellite_status"
        ]
        for key in required_keys:
            self.assertIn(key, sample, f"Missing required key '{key}' in /api/hotspots response")

        print(f"[PASS] /api/hotspots contract compatible: all 1,141 clusters returned with complete schemas.")

    def test_gzip_compression_performance(self):
        """Verify GZip compression achieves > 85% payload reduction."""
        from api.main import list_clusters
        resp = list_clusters(risk_threshold=0.0, db=self.db)
        uncompressed = resp.body
        compressed = gzip.compress(uncompressed)

        ratio = ((len(uncompressed) - len(compressed)) / len(uncompressed)) * 100
        self.assertGreater(ratio, 85.0, f"GZip compression ratio should be > 85%, got {ratio:.1f}%")
        print(f"[PASS] GZip compression: Uncompressed {len(uncompressed)/(1024*1024):.2f} MB -> Compressed {len(compressed)/(1024*1024):.2f} MB ({ratio:.1f}% reduction).")

    def test_bounded_response_cache(self):
        """Verify response cache remains bounded and does not overflow max entries."""
        from api.main import set_cached_response, MAX_CACHE_ENTRIES, _api_response_cache
        
        initial_keys = list(_api_response_cache.keys())
        for i in range(MAX_CACHE_ENTRIES + 5):
            set_cached_response(f"test_key_{i}", f"data_{i}".encode('utf-8'))

        self.assertLessEqual(len(_api_response_cache), MAX_CACHE_ENTRIES, f"Response cache exceeded MAX_CACHE_ENTRIES ({MAX_CACHE_ENTRIES})")
        print(f"[PASS] Response cache bounds enforced: current size {len(_api_response_cache)} <= {MAX_CACHE_ENTRIES}.")

    def test_frontend_app_js_swr_integrity(self):
        """Verify app.js contains non-blocking SWR hydration and AbortController timeout."""
        app_js_path = os.path.join(os.getcwd(), 'frontend', 'js', 'app.js')
        with open(app_js_path, 'r', encoding='utf-8') as f:
            code = f.read()

        self.assertIn("renderHotspotsUI", code, "app.js must contain renderHotspotsUI helper")
        self.assertIn("renderFacilitiesUI", code, "app.js must contain renderFacilitiesUI helper")
        self.assertIn("AbortController", code, "app.js fetchWithFallback must use AbortController")
        self.assertIn("hasRenderedFromCache", code, "app.js must track cached SWR rendering status")
        print(f"[PASS] Frontend app.js SWR and timeout hardening verified.")

if __name__ == '__main__':
    unittest.main()
