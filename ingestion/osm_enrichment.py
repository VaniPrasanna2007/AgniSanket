import math
import requests
from datetime import datetime
from sqlalchemy.orm import Session
from db.database import SessionLocal, init_db
from db.models import IndustrialFacility

OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter"
]

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculates real great-circle distance between two geographic points in kilometers."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2.0) ** 2 +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2.0) ** 2)
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

def log_osm_debug(msg: str):
    """Appends debug log messages to osm_debug.log."""
    try:
        with open("osm_debug.log", "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except Exception:
        pass

def query_real_osm_industrial_facilities(lat: float, lon: float, radius_km: float = 50.0) -> list:
    """
    Queries live OpenStreetMap spatial data using Overpass API mirrors with short timeout.
    Does NOT use synthetic data or hardcoded fake fallback distances.
    Writes detailed diagnostic logs to osm_debug.log.
    """
    radius_meters = int(radius_km * 1000)
    log_header = f"\n=== [{datetime.utcnow().isoformat()}] OSM QUERY FOR ({lat}, {lon}) RADIUS {radius_km}km ==="
    log_osm_debug(log_header)

    overpass_query = f"""[out:json][timeout:8];
(
  node(around:{radius_meters},{lat},{lon})["landuse"~"industrial|construction|commercial|harbour"];
  way(around:{radius_meters},{lat},{lon})["landuse"~"industrial|construction|commercial|harbour"];
  relation(around:{radius_meters},{lat},{lon})["landuse"~"industrial|construction|commercial|harbour"];
  node(around:{radius_meters},{lat},{lon})["man_made"~"works|industrial|substation|petroleum|pipeline|chimney|storage_tank"];
  way(around:{radius_meters},{lat},{lon})["man_made"~"works|industrial|substation|petroleum|pipeline|chimney|storage_tank"];
  node(around:{radius_meters},{lat},{lon})["power"~"plant|substation|generator"];
  way(around:{radius_meters},{lat},{lon})["power"~"plant|substation|generator"];
  node(around:{radius_meters},{lat},{lon})["building"~"industrial|manufacture|warehouse|commercial"];
  way(around:{radius_meters},{lat},{lon})["building"~"industrial|manufacture|warehouse|commercial"];
  node(around:{radius_meters},{lat},{lon})["industrial"];
  way(around:{radius_meters},{lat},{lon})["industrial"];
);
out center 25;"""

    headers = {"User-Agent": "SIH26162-ThermalDetection/1.0 (contact@sih26162.gov.in)"}
    facilities = []

    # 1. Try Overpass API mirrors with 5s timeout
    for ep in OVERPASS_MIRRORS:
        try:
            res = requests.post(ep, data={"data": overpass_query}, headers=headers, timeout=5)
            if res.status_code == 200:
                data = res.json()
                elements = data.get("elements", [])
                
                for elem in elements:
                    elem_lat = elem.get("lat") or (elem.get("center", {}).get("lat") if "center" in elem else None)
                    elem_lon = elem.get("lon") or (elem.get("center", {}).get("lon") if "center" in elem else None)
                    if elem_lat and elem_lon:
                        tags = elem.get("tags", {})
                        name = tags.get("name") or tags.get("industrial") or tags.get("man_made") or tags.get("power") or f"OSM Industrial Site #{elem['id']}"
                        fac_type = tags.get("man_made") or tags.get("power") or tags.get("industrial") or tags.get("building") or tags.get("landuse", "industrial")
                        dist = haversine_distance(lat, lon, elem_lat, elem_lon)
                        facilities.append({
                            "name": name,
                            "facility_type": fac_type,
                            "latitude": elem_lat,
                            "longitude": elem_lon,
                            "osm_id": f"{elem.get('type', 'node')}/{elem['id']}",
                            "distance_km": round(dist, 2)
                        })
                if facilities:
                    facilities.sort(key=lambda x: x["distance_km"])
                    print(f"[OSM ENRICHMENT] Fetched {len(facilities)} facilities from Overpass mirror: {ep}")
                    return facilities
        except Exception as e:
            log_osm_debug(f"Overpass Mirror {ep} Exception: {e}")

    # 2. Fast single-term fallback to Nominatim only if Overpass failed
    try:
        search_url = f"https://nominatim.openstreetmap.org/search?q=industrial&format=json&viewbox={lon-0.5},{lat+0.5},{lon+0.5},{lat-0.5}&bounded=1&limit=5"
        r = requests.get(search_url, headers=headers, timeout=4)
        if r.status_code == 200:
            results = r.json()
            for res_item in results:
                elem_lat = float(res_item['lat'])
                elem_lon = float(res_item['lon'])
                dist = haversine_distance(lat, lon, elem_lat, elem_lon)
                name = res_item.get("display_name", "OSM Industrial Facility").split(",")[0]
                facilities.append({
                    "name": name,
                    "facility_type": res_item.get("type", "industrial"),
                    "latitude": elem_lat,
                    "longitude": elem_lon,
                    "osm_id": f"nominatim/{res_item.get('place_id')}",
                    "distance_km": round(dist, 2)
                })
            if facilities:
                facilities.sort(key=lambda x: x["distance_km"])
                print(f"[OSM ENRICHMENT] Fetched {len(facilities)} facilities from Nominatim fallback.")
                return facilities
    except Exception as ne:
        log_osm_debug(f"Nominatim Exception: {ne}")

    return []

def get_nearest_industrial_facility(db: Session, lat: float, lon: float, cached_facilities: list = None, allow_live_query: bool = True) -> dict:
    """
    Finds nearest industrial facility by checking local database cache first.
    Reuses the existing facilities stored in DB before making live Overpass requests.
    Returns distance_km=None if no OSM feature is found within search radius.
    """
    # 1. Check local DB table of previously cached OSM facilities first for speed
    facilities_to_check = cached_facilities
    if facilities_to_check is None:
        facilities_to_check = db.query(IndustrialFacility).all()

    if facilities_to_check:
        nearest_db = None
        min_dist = float("inf")
        for f in facilities_to_check:
            # Check attribute access (object or dict)
            f_lat = f.latitude if hasattr(f, "latitude") else f.get("latitude")
            f_lon = f.longitude if hasattr(f, "longitude") else f.get("longitude")
            f_name = f.name if hasattr(f, "name") else f.get("name")
            f_type = f.facility_type if hasattr(f, "facility_type") else f.get("facility_type")
            f_osm_id = f.osm_id if hasattr(f, "osm_id") else f.get("osm_id")

            d = haversine_distance(lat, lon, f_lat, f_lon)
            if d < min_dist:
                min_dist = d
                nearest_db = {
                    "name": f_name,
                    "facility_type": f_type,
                    "latitude": f_lat,
                    "longitude": f_lon,
                    "osm_id": f_osm_id,
                    "distance_km": round(d, 2)
                }
        if nearest_db and nearest_db["distance_km"] <= 50.0:
            return nearest_db

    # 2. Query live OpenStreetMap API only if allowed and no cached facility within 50 km
    if allow_live_query:
        live_facilities = query_real_osm_industrial_facilities(lat, lon, radius_km=50.0)
        if live_facilities:
            # Persist ALL returned facilities to database for future clusters to reuse
            stored_count = 0
            existing_osm_ids = set(r[0] for r in db.query(IndustrialFacility.osm_id).all())
            for fac_item in live_facilities:
                if fac_item["osm_id"] not in existing_osm_ids:
                    existing_osm_ids.add(fac_item["osm_id"])
                    new_fac = IndustrialFacility(
                        name=fac_item["name"],
                        facility_type=fac_item["facility_type"],
                        latitude=fac_item["latitude"],
                        longitude=fac_item["longitude"],
                        osm_id=fac_item["osm_id"]
                    )
                    db.add(new_fac)
                    if cached_facilities is not None:
                        cached_facilities.append(new_fac)
                    stored_count += 1
            if stored_count > 0:
                db.commit()
                print(f"[OSM ENRICHMENT] Stored {stored_count} newly fetched industrial facilities in DB.")
            
            return live_facilities[0]

    return {
        "name": "NO_NEARBY_INDUSTRIAL_FEATURE",
        "facility_type": "none",
        "latitude": lat,
        "longitude": lon,
        "osm_id": None,
        "distance_km": None
    }
