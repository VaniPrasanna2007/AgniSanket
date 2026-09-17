from fastapi.testclient import TestClient
from api.main import app
from db.database import SessionLocal
from db.models import User, HotspotCluster

client = TestClient(app)

def test_health_and_stats():
    res_health = client.get("/api/health")
    assert res_health.status_code == 200
    assert res_health.json()["status"] == "online"

    res_stats = client.get("/api/stats")
    assert res_stats.status_code == 200
    assert "total_clusters" in res_stats.json()

def test_login_success_and_failure():
    # Valid admin login
    res = client.post("/api/auth/login", json={"username": "admin", "password": "AdminPassword123!", "role": "ADMIN"})
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "success"
    assert "access_token" in body
    assert body["user"]["role"] == "ADMIN"

    # Invalid login
    res_bad = client.post("/api/auth/login", json={"username": "admin", "password": "WrongPassword!", "role": "ADMIN"})
    assert res_bad.status_code == 401

def test_auth_me_endpoint():
    # Login as analyst
    login_res = client.post("/api/auth/login", json={"username": "analyst1", "password": "Analyst123!", "role": "ANALYST"})
    token = login_res.json()["access_token"]

    # Call /api/auth/me with Bearer token
    headers = {"Authorization": f"Bearer {token}"}
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 200
    assert res.json()["username"] == "analyst1"
    assert res.json()["role"] == "ANALYST"

def test_unauthenticated_protected_operations():
    # Attempt feedback without auth -> 401
    res = client.post("/api/feedback", json={"cluster_id": 1, "verified_class": "Industrial Thermal Anomaly"})
    assert res.status_code == 401

    # Attempt admin user list without auth -> 401
    res = client.get("/api/admin/users")
    assert res.status_code == 401

    # Attempt retrain without auth -> 401
    res = client.post("/api/retrain")
    assert res.status_code == 401

def test_role_based_permissions():
    # 1. Login Analyst
    analyst_token = client.post("/api/auth/login", json={"username": "analyst1", "password": "Analyst123!", "role": "ANALYST"}).json()["access_token"]
    analyst_headers = {"Authorization": f"Bearer {analyst_token}"}

    # Analyst CAN submit feedback
    res_fb = client.post("/api/feedback", json={"cluster_id": 1, "verified_class": "Industrial Thermal Anomaly", "decision": "confirmed"}, headers=analyst_headers)
    assert res_fb.status_code in [200, 404]  # 200 if cluster 1 exists, 404 if not, but NOT 401/403!

    # Analyst CANNOT access admin user list -> 403
    res_admin = client.get("/api/admin/users", headers=analyst_headers)
    assert res_admin.status_code == 403

    # Analyst CANNOT access retrain -> 403
    res_retrain = client.post("/api/retrain", headers=analyst_headers)
    assert res_retrain.status_code == 403

    # 2. Login Government Authority
    gov_token = client.post("/api/auth/login", json={"username": "gov1", "password": "GovAuth123!", "role": "GOVERNMENT_AUTHORITY"}).json()["access_token"]
    gov_headers = {"Authorization": f"Bearer {gov_token}"}

    # Government Authority CAN view incidents
    res_gov_list = client.get("/api/government/incidents", headers=gov_headers)
    assert res_gov_list.status_code == 200

    # Government Authority CAN update incident status
    res_gov_update = client.post("/api/government/incidents/1/status", json={"status": "ACKNOWLEDGED", "notes": "On-site dispatch scheduled"}, headers=gov_headers)
    assert res_gov_update.status_code in [200, 404]

    # Government Authority CANNOT access admin users -> 403
    res_gov_admin = client.get("/api/admin/users", headers=gov_headers)
    assert res_gov_admin.status_code == 403

def test_admin_user_management():
    # Login Admin
    admin_token = client.post("/api/auth/login", json={"username": "admin", "password": "AdminPassword123!", "role": "ADMIN"}).json()["access_token"]
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    # List Users
    res_list = client.get("/api/admin/users", headers=admin_headers)
    assert res_list.status_code == 200
    assert len(res_list.json()) >= 3

    # Create new test user
    new_uname = "temp_test_user_99"
    res_create = client.post("/api/admin/users", json={"username": new_uname, "password": "TempPass123!", "role": "ANALYST"}, headers=admin_headers)
    assert res_create.status_code == 200
    user_id = res_create.json()["user"]["id"]

    # Update role to GOVERNMENT_AUTHORITY
    res_role = client.put(f"/api/admin/users/{user_id}/role", json={"role": "GOVERNMENT_AUTHORITY"}, headers=admin_headers)
    assert res_role.status_code == 200
    assert res_role.json()["user"]["role"] == "GOVERNMENT_AUTHORITY"

    # Delete user
    res_del = client.delete(f"/api/admin/users/{user_id}", headers=admin_headers)
    assert res_del.status_code == 200

if __name__ == "__main__":
    print("Running Auth & RBAC Test Suite...")
    test_health_and_stats()
    print("[PASS] Health & Stats API")
    test_login_success_and_failure()
    print("[PASS] Login Success & Failure")
    test_auth_me_endpoint()
    print("[PASS] /api/auth/me Profile API")
    test_unauthenticated_protected_operations()
    print("[PASS] Unauthenticated 401 Rejection")
    test_role_based_permissions()
    print("[PASS] Role-Based Access Control (RBAC)")
    test_admin_user_management()
    print("[PASS] Admin User Management (Create, List, Update Role, Delete)")
    print("\nALL BACKEND AUTH & RBAC TESTS PASSED 100% PERFECTLY!")

