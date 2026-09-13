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
    Queries live OpenStreetMap spatial data using Overpass API mirrors with multi-term failover to Nominatim Search API.
    Does NOT use synthetic data or hardcoded fake fallback distances.
    Writes detailed diagnostic logs to osm_debug.log.
    """
    radius_meters = int(radius_km * 1000)
    log_header = f"\n=== [{datetime.utcnow().isoformat()}] OSM QUERY FOR ({lat}, {lon}) RADIUS {radius_km}km ==="
    print(log_header)
    log_osm_debug(log_header)

    overpass_query = f"""[out:json][timeout:15];
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

    # 1. Try Overpass API mirrors
    for ep in OVERPASS_MIRRORS:
        log_msg = f"Attempting Overpass Mirror: {ep}"
        log_osm_debug(log_msg)
        try:
            res = requests.post(ep, data={"data": overpass_query}, headers=headers, timeout=6)
            resp_snippet = res.text[:500].replace("\n", " ")
            status_log = f"Mirror {ep} -> Status: {res.status_code} | Body snippet: {resp_snippet}"
            log_osm_debug(status_log)

            if res.status_code == 200:
                data = res.json()
                elements = data.get("elements", [])
                log_osm_debug(f"Mirror {ep} returned {len(elements)} raw elements.")
                
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
                    success_log = f"SUCCESS via Overpass Mirror {ep}: Picked nearest '{facilities[0]['name']}' at {facilities[0]['distance_km']} km"
                    log_osm_debug(success_log)
                    return facilities
        except Exception as e:
            err_log = f"Mirror {ep} Exception: {e}"
            log_osm_debug(err_log)

    # 2. Fallback to Nominatim Spatial Search API across multi-industrial terms
    log_osm_debug("Overpass mirrors returned no valid items or failed. Triggering Multi-Term Nominatim Fallback Path...")
    search_terms = ["industrial", "refinery", "factory", "steel", "power plant", "GIDC", "substation"]
    
    for term in search_terms:
        try:
            search_url = f"https://nominatim.openstreetmap.org/search?q={term}&format=json&viewbox={lon-0.75},{lat+0.75},{lon+0.75},{lat-0.75}&bounded=1&limit=10"
            log_osm_debug(f"Attempting Nominatim Fallback URL [{term}]: {search_url}")
            r = requests.get(search_url, headers=headers, timeout=5)
            log_osm_debug(f"Nominatim [{term}] -> Status: {r.status_code}")

            if r.status_code == 200:
                results = r.json()
                for res_item in results:
                    elem_lat = float(res_item['lat'])
                    elem_lon = float(res_item['lon'])
                    dist = haversine_distance(lat, lon, elem_lat, elem_lon)
                    name = res_item.get("display_name", "OSM Industrial Facility").split(",")[0]
                    fac_type = res_item.get("type", term)
                    facilities.append({
                        "name": name,
                        "facility_type": fac_type,
                        "latitude": elem_lat,
                        "longitude": elem_lon,
                        "osm_id": f"nominatim/{res_item.get('place_id')}",
                        "distance_km": round(dist, 2)
                    })
        except Exception as ne:
            log_osm_debug(f"Nominatim Exception [{term}]: {ne}")

    if facilities:
        facilities.sort(key=lambda x: x["distance_km"])
        success_nom_log = f"SUCCESS via Multi-Term Nominatim Fallback: Picked nearest '{facilities[0]['name']}' at {facilities[0]['distance_km']} km"
        log_osm_debug(success_nom_log)
        return facilities

    log_osm_debug("ULTIMATE RESULT: NO_NEARBY_INDUSTRIAL_FEATURE found.")
    return []

def get_nearest_industrial_facility(db: Session, lat: float, lon: float) -> dict:
    """
    Finds nearest industrial facility by querying live Overpass/Nominatim APIs or local database cache.
    Returns distance_km=None if no OSM feature is found within search radius.
    """
    # 1. Check local DB table of previously cached OSM facilities first for speed
    db_facilities = db.query(IndustrialFacility).all()
    if db_facilities:
        nearest_db = None
        min_dist = float("inf")
        for f in db_facilities:
            d = haversine_distance(lat, lon, f.latitude, f.longitude)
            if d < min_dist:
                min_dist = d
                nearest_db = {
                    "name": f.name,
                    "facility_type": f.facility_type,
                    "latitude": f.latitude,
                    "longitude": f.longitude,
                    "osm_id": f.osm_id,
                    "distance_km": round(d, 2)
                }
        if nearest_db and nearest_db["distance_km"] <= 35.0:
            return nearest_db

    # 2. Query live OpenStreetMap API if not cached within 35 km
    live_facilities = query_real_osm_industrial_facilities(lat, lon, radius_km=50.0)
    if live_facilities:
        nearest = live_facilities[0]
        existing = db.query(IndustrialFacility).filter(IndustrialFacility.osm_id == nearest["osm_id"]).first()
        if not existing:
            fac = IndustrialFacility(
                name=nearest["name"],
                facility_type=nearest["facility_type"],
                latitude=nearest["latitude"],
                longitude=nearest["longitude"],
                osm_id=nearest["osm_id"]
            )
            db.add(fac)
            db.commit()
        return nearest

    return {
        "name": "NO_NEARBY_INDUSTRIAL_FEATURE",
        "facility_type": "none",
        "latitude": lat,
        "longitude": lon,
        "osm_id": None,
        "distance_km": None
    }
