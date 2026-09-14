import requests

res = requests.get("http://127.0.0.1:8000/api/hotspots?risk_threshold=0.0")
data = res.json()
print("Total API clusters:", len(data))
if data:
    print("First cluster keys:", list(data[0].keys()))
    print("First cluster sample:", {k: data[0][k] for k in ["id", "display_id", "cluster_number"] if k in data[0]})

detail_res = requests.get(f"http://127.0.0.1:8000/api/hotspots/{data[0]['id']}")
print("Detail response status:", detail_res.status_code)
if detail_res.status_code == 200:
    print("Detail keys:", list(detail_res.json()["cluster"].keys()))
