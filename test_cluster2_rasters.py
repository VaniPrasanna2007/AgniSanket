import rasterio
from rasterio.warp import transform
import pystac_client
import planetary_computer
import numpy as np
from datetime import datetime

PLANETARY_COMPUTER_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

lat = 27.26775
lon = 88.31142
acq_date = datetime(2026, 8, 27, 7, 48, 0) # FIRMS detection time for DB ID 101

catalog = pystac_client.Client.open(PLANETARY_COMPUTER_STAC_URL, modifier=planetary_computer.sign_inplace)
bbox = [lon - 0.15, lat - 0.15, lon + 0.15, lat + 0.15]

start_7d = "2026-08-20T00:00:00Z"
end_7d = "2026-09-03T23:59:59Z"

print("--- TESTING LANDSAT RASTERS FOR CLUSTER #2 ---")
l_search = catalog.search(collections=["landsat-c2-l2"], bbox=bbox, datetime=f"{start_7d}/{end_7d}")
l_items = list(l_search.items())

for item in l_items:
    dt_str = item.properties.get("datetime")
    item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
    diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
    print(f"\nItem: {item.id} | Datetime: {dt_str} | Diff: {diff_h:.1f} hours")
    
    st_b10 = item.assets.get("ST_B10") or item.assets.get("lwir11")
    qa_pixel = item.assets.get("qa_pixel")
    
    if not (st_b10 and qa_pixel):
        print("  Missing ST_B10 or qa_pixel asset")
        continue

    try:
        with rasterio.open(st_b10.href) as src_t, rasterio.open(qa_pixel.href) as src_qa:
            xs, ys = transform("EPSG:4326", src_t.crs, [lon], [lat])
            tx, ty = xs[0], ys[0]
            b = src_t.bounds
            print(f"  Raster Bounds: {b.left:.2f}, {b.bottom:.2f}, {b.right:.2f}, {b.top:.2f} | Target: {tx:.2f}, {ty:.2f}")
            
            if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                print("  Target OUTSIDE bounds!")
                continue

            r, c = src_t.index(tx, ty)
            print(f"  Raster Row/Col index: row={r}, col={c} (height={src_t.height}, width={src_t.width})")

            win = rasterio.windows.Window(c - 7, r - 7, 15, 15)
            raw_t = src_t.read(1, window=win).astype(float)
            qa_p = src_qa.read(1, window=win)

            is_fill = (qa_p & 1) > 0
            is_dilated = (qa_p & (1 << 1)) > 0
            is_cirrus = (qa_p & (1 << 2)) > 0
            is_cloud = (qa_p & (1 << 3)) > 0
            is_shadow = (qa_p & (1 << 4)) > 0
            is_snow = (qa_p & (1 << 5)) > 0
            
            invalid_mask = is_fill | is_dilated | is_cirrus | is_cloud | is_shadow | is_snow | (raw_t <= 0)
            valid_cnt = int(np.sum(~invalid_mask))
            cloud_cnt = int(np.sum(invalid_mask))
            print(f"  Window Pixels: Total=225 | Valid={valid_cnt} | Cloud/Masked={cloud_cnt}")

            if valid_cnt > 0:
                temp_c = (raw_t * 0.00341802 + 149.0) - 273.15
                temp_c[invalid_mask] = np.nan
                center = temp_c[5:10, 5:10]
                valid_center = center[~np.isnan(center)]
                outer = temp_c.copy()
                outer[5:10, 5:10] = np.nan
                valid_outer = outer[~np.isnan(outer)]
                print(f"  Center Valid: {len(valid_center)} | Outer Valid: {len(valid_outer)}")
                if len(valid_center) > 0 and len(valid_outer) > 0:
                    max_temp = np.max(valid_center)
                    bg_temp = np.median(valid_outer)
                    print(f"  ==> SUCCESS! Max Temp={max_temp:.2f}°C, Anomaly={max_temp - bg_temp:.2f}°C")
    except Exception as e:
        print(f"  Error opening raster: {e}")

print("\n--- TESTING SENTINEL-2 RASTERS FOR CLUSTER #2 ---")
s2_search = catalog.search(collections=["sentinel-2-l2a"], bbox=bbox, datetime=f"{start_7d}/{end_7d}")
s2_items = list(s2_search.items())

for item in s2_items:
    dt_str = item.properties.get("datetime")
    item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
    diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
    print(f"\nItem: {item.id} | Datetime: {dt_str} | Diff: {diff_h:.1f} hours")
    
    red_a = item.assets.get("B04") or item.assets.get("red")
    nir_a = item.assets.get("B08") or item.assets.get("nir")
    scl_a = item.assets.get("SCL") or item.assets.get("scl")
    
    if not (red_a and nir_a):
        print("  Missing B04 or B08 asset")
        continue

    try:
        with rasterio.open(red_a.href) as src_r, rasterio.open(nir_a.href) as src_n:
            xs_s2, ys_s2 = transform("EPSG:4326", src_r.crs, [lon], [lat])
            tx_s2, ty_s2 = xs_s2[0], ys_s2[0]
            b_s2 = src_r.bounds
            print(f"  Raster Bounds: {b_s2.left:.2f}, {b_s2.bottom:.2f}, {b_s2.right:.2f}, {b_s2.top:.2f} | Target: {tx_s2:.2f}, {ty_s2:.2f}")

            if not (b_s2.left <= tx_s2 <= b_s2.right and b_s2.bottom <= ty_s2 <= b_s2.top):
                print("  Target OUTSIDE bounds!")
                continue

            r_s2, c_s2 = src_r.index(tx_s2, ty_s2)
            print(f"  Raster Row/Col index: row={r_s2}, col={c_s2} (height={src_r.height}, width={src_r.width})")

            win_s2 = rasterio.windows.Window(c_s2 - 7, r_s2 - 7, 15, 15)
            r_pix = src_r.read(1, window=win_s2).astype(float)
            n_pix = src_n.read(1, window=win_s2).astype(float)

            cloud_scl = np.zeros_like(r_pix, dtype=bool)
            if scl_a:
                with rasterio.open(scl_a.href) as src_scl:
                    scl_pix = src_scl.read(1, window=win_s2)
                    cloud_scl = np.isin(scl_pix, [0, 1, 2, 3, 8, 9, 10, 11])

            denom = n_pix + r_pix
            valid_mask = (denom > 0) & (~cloud_scl)
            valid_cnt = int(np.sum(valid_mask))
            print(f"  Window Pixels: Valid NDVI Pixels={valid_cnt}/225")

            if valid_cnt > 0:
                ndvi = (n_pix - r_pix) / denom
                valid_ndvi = ndvi[valid_mask]
                med_ndvi = np.median(valid_ndvi)
                print(f"  ==> SUCCESS! Median NDVI={med_ndvi:.3f}")
    except Exception as e:
        print(f"  Error opening Sentinel-2 raster: {e}")
