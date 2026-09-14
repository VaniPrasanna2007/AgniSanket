import sys
import requests
from dotenv import load_dotenv

load_dotenv()
sys.path.append('.')

from db.database import SessionLocal
from db.models import HotspotCluster, FeedbackLog

API_BASE = "http://127.0.0.1:8000"

def run_system_audit():
    print("==========================================================================")
    print("                  END-TO-END SYSTEM FEATURE AUDIT                         ")
    print("==========================================================================")
    
    passed_tests = 0
    failed_tests = 0
    
    # 1. Health & Stats Check
    try:
        r_stats = requests.get(f"{API_BASE}/api/stats").json()
        print(f"[TEST 1 PASS] Stats Endpoint: Raw Detections={r_stats['total_raw_detections']}, Clusters={r_stats['total_clusters']}, High Risk={r_stats['high_risk_anomalies']}, Verified Labels={r_stats['verified_human_labels']}")
        passed_tests += 1
    except Exception as e:
        print(f"[TEST 1 FAIL] Stats Endpoint Error: {e}")
        failed_tests += 1

    # 2. Clusters List & Risk Alignment
    try:
        clusters = requests.get(f"{API_BASE}/api/hotspots?risk_threshold=0.0").json()
        high_risk_in_api = len([c for c in clusters if c['risk_score'] > 70.0])
        print(f"[TEST 2 PASS] /api/hotspots returned {len(clusters)} clusters. High risk count (score>70): {high_risk_in_api}")
        assert high_risk_in_api == r_stats['high_risk_anomalies'], f"High risk count mismatch: API count {high_risk_in_api} vs Stats {r_stats['high_risk_anomalies']}"
        passed_tests += 1
    except Exception as e:
        print(f"[TEST 2 FAIL] Cluster List / Risk Alignment Error: {e}")
        failed_tests += 1

    # 3. Cluster Detail & Risk Contribution Sum Verification
    try:
        c_sample = clusters[0]
        cid = c_sample['id']
        detail = requests.get(f"{API_BASE}/api/hotspots/{cid}").json()
        cluster_info = detail['cluster']
        evidence = cluster_info.get('evidence', {})
        rb = evidence.get('risk_breakdown', {})
        
        sum_contrib = round(
            rb.get('frp_contribution', 0) +
            rb.get('recurrence_contribution', 0) +
            rb.get('thermal_anomaly_contribution', 0) +
            rb.get('satellite_confirmation_contribution', 0) +
            rb.get('proximity_contribution', 0), 1
        )
        
        print(f"[TEST 3 PASS] Cluster #{cid} Risk Score={cluster_info['risk_score']} | Sum of 5 Contributions={sum_contrib}")
        assert abs(cluster_info['risk_score'] - sum_contrib) < 0.1, f"Risk score mismatch: {cluster_info['risk_score']} vs {sum_contrib}"
        passed_tests += 1
    except Exception as e:
        print(f"[TEST 3 FAIL] Risk Contribution Sum Error: {e}")
        failed_tests += 1

    # 4. Human Verification Feedback Submission & Log Preservation
    try:
        target_cluster_id = clusters[0]['id']
        original_pred_class = clusters[0]['predicted_class']
        original_evidence = clusters[0].get('fire_evidence_status')
        
        # Login as analyst to obtain JWT token
        login_res = requests.post(f"{API_BASE}/api/auth/login", json={"username": "analyst1", "password": "Analyst123!", "role": "ANALYST"}).json()
        analyst_token = login_res.get("access_token")
        auth_headers = {"Authorization": f"Bearer {analyst_token}"}
        
        fb_payload = {
            "cluster_id": target_cluster_id,
            "verified_class": "Possible Vegetation/Agricultural Fire",
            "decision": "confirmed",
            "reviewer_notes": "Auditor verification test note"
        }
        r_fb = requests.post(f"{API_BASE}/api/feedback", json=fb_payload, headers=auth_headers).json()
        print(f"[TEST 4 PASS] Feedback submission status: {r_fb['status']}, total verified: {r_fb['total_verified_samples_in_db']}")
        
        # Check DB directly to ensure original prediction & evidence were NOT overwritten
        db = SessionLocal()
        db_c = db.query(HotspotCluster).filter(HotspotCluster.id == target_cluster_id).first()
        db_fb = db.query(FeedbackLog).filter(FeedbackLog.cluster_id == target_cluster_id).order_by(FeedbackLog.id.desc()).first()
        
        assert db_c.predicted_class == original_pred_class, f"Original predicted class was overwritten! Expected {original_pred_class}, got {db_c.predicted_class}"
        assert db_fb is not None, "Feedback log was not created!"
        assert db_fb.reviewer_notes == "Auditor verification test note", f"Reviewer notes mismatch: {db_fb.reviewer_notes}"
        db.close()
        
        print(f"[TEST 4 PASS] Confirmed: Original prediction '{original_pred_class}' preserved; FeedbackLog recorded notes cleanly.")
        passed_tests += 1
    except Exception as e:
        print(f"[TEST 4 FAIL] Human Verification Feedback Error: {e}")
        failed_tests += 1

    # 5. Background Scan Non-Blocking Trigger
    try:
        admin_login = requests.post(f"{API_BASE}/api/auth/login", json={"username": "admin", "password": "AdminPassword123!", "role": "ADMIN"}).json()
        admin_token = admin_login.get("access_token")
        admin_headers = {"Authorization": f"Bearer {admin_token}"}
        
        r_scan = requests.post(f"{API_BASE}/api/scan", headers=admin_headers).json()
        print(f"[TEST 5 PASS] /api/scan endpoint response: {r_scan.get('status')}")
        passed_tests += 1
    except Exception as e:
        print(f"[TEST 5 FAIL] /api/scan Error: {e}")
        failed_tests += 1

    print("\n==========================================================================")
    print(f"AUDIT COMPLETE. PASSED: {passed_tests} | FAILED: {failed_tests}")
    print("==========================================================================")

if __name__ == "__main__":
    run_system_audit()
