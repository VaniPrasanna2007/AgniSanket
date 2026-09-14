import rasterio
from rasterio.warp import transform
import pystac_client
import planetary_computer
import numpy as np
from datetime import datetime

PLANETARY_COMPUTER_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

lat = 27.26775
lon = 88.31142
acq_date = datetime(2026, 8, 27, 7, 48, 0)

catalog = pystac_client.Client.open(PLANETARY_COMPUTER_STAC_URL, modifier=planetary_computer.sign_inplace)
bbox = [lon - 0.15, lat - 0.15, lon + 0.15, lat + 0.15]

start_7d = "2026-08-20T00:00:00Z"
end_7d = "2026-09-03T23:59:59Z"

print("--- TESTING LANDSAT-8/9 OPTICAL NDVI FALLBACK ---")
l_search = catalog.search(collections=["landsat-c2-l2"], bbox=bbox, datetime=f"{start_7d}/{end_7d}")
l_items = list(l_search.items())

for item in l_items:
    dt_str = item.properties.get("datetime")
    item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
    diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
    print(f"\nItem: {item.id} | Datetime: {dt_str} | Diff: {diff_h:.1f} hours")

    red_asset = item.assets.get("SR_B4") or item.assets.get("red")
    nir_asset = item.assets.get("SR_B5") or item.assets.get("nir08")
    qa_asset = item.assets.get("qa_pixel")

    if not (red_asset and nir_asset and qa_asset):
        print("  Missing SR_B4 or SR_B5 or qa_pixel asset")
        continue

    try:
        with rasterio.open(red_asset.href) as src_r, rasterio.open(nir_asset.href) as src_n, rasterio.open(qa_asset.href) as src_qa:
            xs, ys = transform("EPSG:4326", src_r.crs, [lon], [lat])
            tx, ty = xs[0], ys[0]
            b = src_r.bounds
            
            if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                print("  Target OUTSIDE bounds!")
                continue

            r, c = src_r.index(tx, ty)
            if not (7 <= r < src_r.height - 7 and 7 <= c < src_r.width - 7):
                print("  Too close to edge!")
                continue

            win = rasterio.windows.Window(c - 7, r - 7, 15, 15)
            r_pix = src_r.read(1, window=win).astype(float) * 0.0000275 - 0.2
            n_pix = src_n.read(1, window=win).astype(float) * 0.0000275 - 0.2
            qa_p = src_qa.read(1, window=win)

            invalid_mask = (qa_p & (1 | 2 | 4 | 8 | 16 | 32)) > 0
            denom = n_pix + r_pix
            valid_mask = (denom > 0) & (~invalid_mask) & (r_pix > 0) & (n_pix > 0)

            valid_cnt = int(np.sum(valid_mask))
            print(f"  Landsat Optical Window Pixels: Valid={valid_cnt}/225")

            if valid_cnt > 0:
                ndvi = (n_pix - r_pix) / denom
                valid_ndvi = ndvi[valid_mask]
                med_ndvi = float(np.median(valid_ndvi))
                print(f"  ==> SUCCESS! Landsat Optical Fallback Scene={item.id} | Median NDVI={med_ndvi:.3f}")
    except Exception as e:
        print(f"  Error opening Landsat optical raster: {e}")

print("\n--- TESTING MODIS DAILY LST (modis-11A1-061) THERMAL FALLBACK ---")
modis_search = catalog.search(collections=["modis-11A1-061"], bbox=bbox, datetime=f"{start_7d}/{end_7d}")
modis_items = list(modis_search.items())
print(f"Found {len(modis_items)} MODIS LST items.")

for item in modis_items:
    dt_str = item.properties.get("datetime")
    print(f"MODIS Item: {item.id} | Datetime: {dt_str}")
    lst_asset = item.assets.get("LST_Day_1km")
    if lst_asset:
        print(f"  Asset href: {lst_asset.href[:80]}...")
