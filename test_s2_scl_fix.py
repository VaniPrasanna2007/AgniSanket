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

s2_search = catalog.search(collections=["sentinel-2-l2a"], bbox=bbox, datetime="2026-08-20T00:00:00Z/2026-09-03T23:59:59Z")
s2_items = list(s2_search.items())

print(f"Testing Sentinel-2 fixed SCL logic over {len(s2_items)} candidate scenes for Cluster #2...")

for item in s2_items:
    dt_str = item.properties.get("datetime")
    item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
    diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
    print(f"\nItem: {item.id} | Datetime: {dt_str} | Diff: {diff_h:.1f} hours ({diff_h/24:.1f} days)")

    red_a = item.assets.get("B04") or item.assets.get("red")
    nir_a = item.assets.get("B08") or item.assets.get("nir")
    scl_a = item.assets.get("SCL") or item.assets.get("scl")

    if not (red_a and nir_a):
        print("  Missing B04 or B08")
        continue

    try:
        with rasterio.open(red_a.href) as src_r, rasterio.open(nir_a.href) as src_n:
            xs, ys = transform("EPSG:4326", src_r.crs, [lon], [lat])
            tx, ty = xs[0], ys[0]
            b = src_r.bounds

            if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                print("  Out of bounds")
                continue

            r, c = src_r.index(tx, ty)
            if not (7 <= r < src_r.height - 7 and 7 <= c < src_r.width - 7):
                print("  Too close to edge")
                continue

            win_10m = rasterio.windows.Window(c - 7, r - 7, 15, 15)
            r_pix = src_r.read(1, window=win_10m).astype(float)
            n_pix = src_n.read(1, window=win_10m).astype(float)

            cloud_scl = np.zeros_like(r_pix, dtype=bool)
            
            if scl_a:
                try:
                    with rasterio.open(scl_a.href) as src_scl:
                        xs_scl, ys_scl = transform("EPSG:4326", src_scl.crs, [lon], [lat])
                        r_scl, c_scl = src_scl.index(xs_scl[0], ys_scl[0])
                        # Read matching window or resample
                        win_scl = rasterio.windows.Window(c_scl - 3, r_scl - 3, 7, 7)
                        scl_raw = src_scl.read(1, window=win_scl)
                        # Resize scl_raw to (15, 15) using nearest neighbor or check center
                        if scl_raw.shape == (7, 7):
                            import scipy.ndimage
                            scl_10m = scipy.ndimage.zoom(scl_raw, 15/7, order=0)[:15, :15]
                            cloud_scl = np.isin(scl_10m, [0, 1, 2, 3, 8, 9, 10, 11])
                except Exception as scl_err:
                    print(f"  SCL read warning: {scl_err}")

            denom = n_pix + r_pix
            valid_mask = (denom > 0) & (~cloud_scl)
            valid_cnt = int(np.sum(valid_mask))
            cloud_cnt = int(np.sum(cloud_scl))
            
            print(f"  10m Window Pixels: Valid={valid_cnt}/225 | Cloud/Masked={cloud_cnt}/225")

            if valid_cnt > 0:
                ndvi = (n_pix - r_pix) / denom
                valid_ndvi = ndvi[valid_mask]
                med_ndvi = float(np.median(valid_ndvi))
                print(f"  ==> SUCCESS! Scene={item.id} | Diff={diff_h:.1f}h | Median NDVI={med_ndvi:.3f}")
                break
    except Exception as e:
        print(f"  Error reading raster: {e}")
