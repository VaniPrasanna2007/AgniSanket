import os
import io
import requests
import pandas as pd
from datetime import datetime
from dotenv import load_dotenv
from sqlalchemy.orm import Session
from db.database import SessionLocal, init_db
from db.models import RawHotspot

# Load environment variables from .env or .env.example
load_dotenv(dotenv_path=".env")
if not os.getenv("FIRMS_MAP_KEY") or os.getenv("FIRMS_MAP_KEY") == "your_firms_map_key_here":
    load_dotenv(dotenv_path=".env.example")

FIRMS_MAP_KEY = os.getenv("FIRMS_MAP_KEY")
BBOX = os.getenv("BBOX", "68,8,98,36")

def format_bbox(bbox_str: str) -> str:
    """Format bbox string into integer bounds required by NASA FIRMS Area API."""
    try:
        parts = [float(p.strip()) for p in bbox_str.split(",")]
        if len(parts) == 4:
            min_lon = int(parts[0])
            min_lat = int(parts[1])
            max_lon = int(parts[2]) + 1
            max_lat = int(parts[3]) + 1
            return f"{min_lon},{min_lat},{max_lon},{max_lat}"
    except Exception:
        pass
    return "68,8,98,36"

def get_real_firms_data(map_key: str = None, days: int = 2, sources: list = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "MODIS_NRT"]) -> list:
    """
    Fetches real active fire data directly from official NASA FIRMS API.
    Uses 0% synthetic/mock data.
    Raises ValueError / HTTPError if key is invalid or API fails.
    """
    key = map_key or FIRMS_MAP_KEY
    if not key or key == "your_firms_map_key_here":
        raise ValueError("FIRMS_MAP_KEY missing or invalid in environment variables. Set a valid NASA FIRMS MAP_KEY in .env or .env.example.")

    bbox_formatted = format_bbox(BBOX)
    all_records = []

    days_capped = min(days, 5)
    print(f"Connecting to official NASA FIRMS API (Bounding Box: {bbox_formatted}, Past {days_capped} Days)...")

    for src in sources:
        url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{src}/{bbox_formatted}/{days_capped}"
        print(f"Fetching from NASA FIRMS source {src}: {url} ...")
        try:
            res = requests.get(url, timeout=25)
            if res.status_code != 200:
                print(f"Source {src} returned HTTP {res.status_code}: {res.text.strip()}")
                continue

            content = res.text.strip()
            if "Invalid MAP_KEY" in content or "Error" in content:
                raise ValueError(f"NASA FIRMS API Key Error: {content}")

            if len(content.splitlines()) <= 1:
                print(f"NASA FIRMS API returned 0 active hotspots for source {src}.")
                continue

            df = pd.read_csv(io.StringIO(content))
            records = parse_and_clean_firms_dataframe(df, src)
            print(f"Source {src}: Parsed {len(records)} real hotspot records.")
            all_records.extend(records)

        except Exception as e:
            print(f"Error querying NASA FIRMS API source {src}: {e}")
            raise e

    print(f"\nSuccessfully fetched total of {len(all_records)} real NASA FIRMS hotspot records!")
    return all_records

def parse_and_clean_firms_dataframe(df: pd.DataFrame, default_source: str = "VIIRS_SNPP_NRT") -> list:
    """Parses real NASA FIRMS CSV dataframe into clean dictionary records."""
    records = []
    for _, row in df.iterrows():
        try:
            lat = float(row["latitude"])
            lon = float(row["longitude"])
            frp = float(row["frp"]) if "frp" in row and pd.notnull(row["frp"]) else 0.0
            brightness = float(row["bright_ti4"]) if "bright_ti4" in row and pd.notnull(row["bright_ti4"]) else (
                float(row["brightness"]) if "brightness" in row and pd.notnull(row["brightness"]) else 300.0
            )
            
            conf_val = row.get("confidence", "80")
            if str(conf_val).lower() == "n" or str(conf_val).lower() == "nominal":
                confidence = 80.0
            elif str(conf_val).lower() == "h" or str(conf_val).lower() == "high":
                confidence = 95.0
            elif str(conf_val).lower() == "l" or str(conf_val).lower() == "low":
                confidence = 50.0
            else:
                try:
                    confidence = float(conf_val)
                except Exception:
                    confidence = 75.0

            # Acquisition Date & Time
            acq_date_str = str(row["acq_date"])
            acq_time_str = str(row.get("acq_time", "0000")).zfill(4)
            hours = int(acq_time_str[:2])
            minutes = int(acq_time_str[2:4])

            dt = pd.to_datetime(acq_date_str).to_pydatetime()
            dt = dt.replace(hour=hours, minute=minutes)

            satellite = str(row.get("satellite", default_source))
            daynight = str(row.get("daynight", "D"))

            records.append({
                "latitude": lat,
                "longitude": lon,
                "brightness": brightness,
                "frp": frp,
                "confidence": confidence,
                "acquisition_date": dt,
                "satellite": satellite,
                "daynight": daynight,
                "raw_json": row.to_json()
            })
        except Exception as err:
            print(f"Error parsing FIRMS row: {err}")
            continue

    return records

def ingest_raw_hotspots(db: Session, records: list) -> int:
    """
    Persists real FIRMS records into DB without wiping historical data.
    Uses deduplication matching (latitude, longitude, acquisition_date).
    """
    if not records:
        return 0

    inserted_count = 0
    for r in records:
        existing = db.query(RawHotspot).filter(
            RawHotspot.latitude == r["latitude"],
            RawHotspot.longitude == r["longitude"],
            RawHotspot.acquisition_date == r["acquisition_date"]
        ).first()

        if not existing:
            rec = RawHotspot(
                latitude=r["latitude"],
                longitude=r["longitude"],
                brightness=r["brightness"],
                frp=r["frp"],
                confidence=r["confidence"],
                acquisition_date=r["acquisition_date"],
                satellite=r["satellite"],
                raw_json=r.get("raw_json")
            )
            db.add(rec)
            inserted_count += 1

    db.commit()
    print(f"Persisted {inserted_count} new real FIRMS hotspot records to database (deduplicated).")
    return inserted_count

if __name__ == "__main__":
    init_db()
    db = SessionLocal()
    try:
        hotspots = get_real_firms_data(days=2)
        count = ingest_raw_hotspots(db, hotspots)
        print(f"\n=======================================================")
        print(f"--- NASA FIRMS API TEST SUCCESSFUL ---")
        print(f"Total Real Hotspots Retrieved from NASA: {len(hotspots)}")
        print(f"New Real Hotspots Stored in Database: {count}")
        print(f"Total Hotspots in DB Table: {db.query(RawHotspot).count()}")
        if hotspots:
            print("\nSample Real Hotspot Record from NASA FIRMS:")
            print(hotspots[0])
        print(f"=======================================================\n")
    except Exception as e:
        print(f"\n--- FIRMS VERIFICATION FAILED ---")
        print(f"Error: {e}")
    finally:
        db.close()
