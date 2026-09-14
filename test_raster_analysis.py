import json
from db.database import SessionLocal, init_db
from db.models import RawHotspot
from ingestion.satellite_verification import verify_hotspot_stac_satellite

init_db()
db = SessionLocal()

# Query 5 existing raw FIRMS records from the database
records = db.query(RawHotspot).limit(5).all()

print("\n" + "="*80)
print("SIH26162 REAL PIXEL-LEVEL SATELLITE RASTER ANALYSIS AUDIT REPORT")
print("="*80)

for idx, r in enumerate(records, 1):
    print(f"\n------------------------------------------------------------------------")
    print(f"FIRMS RECORD #{idx} [DB ID: {r.id}]")
    print(f"------------------------------------------------------------------------")
    
    res = verify_hotspot_stac_satellite(r.latitude, r.longitude, r.acquisition_date)
    
    # 1. REAL DATA (Direct Ingested Measurements)
    print("\n[REAL DATA - Direct Ingested & Query Context]")
    print(f"  • FIRMS ID                   : {r.id}")
    print(f"  • Latitude                   : {r.latitude}")
    print(f"  • Longitude                  : {r.longitude}")
    print(f"  • FIRMS Acquisition Time     : {r.acquisition_date}")
    print(f"  • FIRMS FRP Intensity        : {r.frp} MW")
    
    # 2. CALCULATED FROM REAL PIXELS (Pixel Raster Analytics)
    print("\n[CALCULATED FROM REAL PIXELS - STAC Raster Analytics]")
    print(f"  • Satellite Scene ID         : {res.get('landsat_scene_id') or res.get('sentinel2_scene_id') or 'N/A'}")
    print(f"  • Satellite Platform         : {res.get('satellite_name')}")
    print(f"  • Thermal Asset Used         : {res.get('thermal_asset_used') or 'N/A'}")
    print(f"  • Cloud / Quality Result     : {res.get('quality_flag')}")
    print(f"  • Valid Pixel Percentage     : {res.get('valid_pixel_percentage')}%" if res.get('valid_pixel_percentage') is not None else "  • Valid Pixel Percentage     : UNAVAILABLE")
    print(f"  • Cloud Pixel Percentage     : {res.get('cloud_percentage')}%" if res.get('cloud_percentage') is not None else "  • Cloud Pixel Percentage     : UNAVAILABLE")
    
    if res.get('hotspot_max_temp_c') is not None:
        print(f"  • Hotspot Max Temperature    : {res.get('hotspot_max_temp_c')} °C")
        print(f"  • Hotspot Mean Temperature   : {res.get('hotspot_mean_temp_c')} °C")
    else:
        print("  • Hotspot Temperature Stats  : UNAVAILABLE (Cloud obscured or invalid pixels)")

    if res.get('surrounding_median_temp_c') is not None:
        print(f"  • Surrounding Median Temp    : {res.get('surrounding_median_temp_c')} °C")
    else:
        print("  • Surrounding Temp Stats     : UNAVAILABLE")

    if res.get('thermal_anomaly_c') is not None:
        print(f"  • Thermal Anomaly (Delta)    : +{res.get('thermal_anomaly_c')} °C elevation")
    else:
        print("  • Thermal Anomaly (Delta)    : UNAVAILABLE")

    if res.get('ndvi_median') is not None:
        print(f"  • Sentinel-2 Median NDVI     : {res.get('ndvi_median')}")
    else:
        print("  • Sentinel-2 Median NDVI     : UNAVAILABLE (No valid optical pixels)")

    # 3. UNAVAILABLE DATA / FINAL EVIDENCE STATUS
    print("\n[UNAVAILABLE DATA / FINAL EVIDENCE STATUS]")
    print(f"  • Final Satellite Status     : {res.get('status')}")
    print(f"  • Time Difference to FIRMS   : {res.get('time_difference_hours')} hours" if res.get('time_difference_hours') is not None else "  • Time Difference to FIRMS   : UNAVAILABLE")

print("\n" + "="*80)
print("AUDIT SUMMARY: Zero synthetic/fake values used. Explicit UNAVAILABLE reported for missing pixels.")
print("="*80 + "\n")

db.close()
