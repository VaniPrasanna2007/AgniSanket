import rasterio
from rasterio.warp import transform
import pystac_client
import planetary_computer
import numpy as np
from datetime import datetime, timedelta

PLANETARY_COMPUTER_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

def test_verify_multi_satellite(lat: float, lon: float, acq_date: datetime):
    catalog = pystac_client.Client.open(PLANETARY_COMPUTER_STAC_URL, modifier=planetary_computer.sign_inplace)
    bbox = [lon - 0.15, lat - 0.15, lon + 0.15, lat + 0.15]
    
    start_7d = (acq_date - timedelta(days=7)).strftime("%Y-%m-%dT00:00:00Z")
    end_7d = (acq_date + timedelta(days=7)).strftime("%Y-%m-%dT23:59:59Z")

    print(f"\n==========================================================================")
    print(f"       MULTI-SATELLITE VERIFICATION FOR ({lat}, {lon}) AT {acq_date}")
    print(f"==========================================================================")

    thermal_found = False
    thermal_source = "UNAVAILABLE"
    thermal_scene_id = "UNAVAILABLE"
    thermal_reason = "No valid thermal scene or unmasked thermal pixels found across Landsat-8/9 or MODIS"
    max_temp = None
    bg_temp = None
    anomaly = None

    # 1. PRIMARY THERMAL: LANDSAT-8/9
    l_search = catalog.search(collections=["landsat-c2-l2"], bbox=bbox, datetime=f"{start_7d}/{end_7d}")
    l_items = list(l_search.items())

    l_candidates = []
    for item in l_items:
        dt_str = item.properties.get("datetime")
        if dt_str:
            item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
            diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
            if diff_h <= 168.0:
                cloud_p = float(item.properties.get("eo:cloud_cover", 100.0) or 100.0)
                l_candidates.append((diff_h, cloud_p, item))

    l_candidates.sort(key=lambda x: (x[0], x[1]))

    for diff_h, cloud_p, item in l_candidates:
        st_b10 = item.assets.get("ST_B10") or item.assets.get("lwir11")
        qa_pixel = item.assets.get("qa_pixel")
        if not (st_b10 and qa_pixel):
            continue

        try:
            with rasterio.open(st_b10.href) as src_t, rasterio.open(qa_pixel.href) as src_qa:
                xs, ys = transform("EPSG:4326", src_t.crs, [lon], [lat])
                tx, ty = xs[0], ys[0]
                b = src_t.bounds
                if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                    continue
                r, c = src_t.index(tx, ty)
                if not (7 <= r < src_t.height - 7 and 7 <= c < src_t.width - 7):
                    continue

                win = rasterio.windows.Window(c - 7, r - 7, 15, 15)
                raw_t = src_t.read(1, window=win).astype(float)
                qa_p = src_qa.read(1, window=win)

                invalid_mask = (qa_p & (1 | 2 | 4 | 8 | 16 | 32)) > 0 | (raw_t <= 0)
                if np.sum(~invalid_mask) > 0:
                    temp_c = (raw_t * 0.00341802 + 149.0) - 273.15
                    temp_c[invalid_mask] = np.nan
                    center = temp_c[5:10, 5:10]
                    v_center = center[~np.isnan(center)]
                    outer = temp_c.copy()
                    outer[5:10, 5:10] = np.nan
                    v_outer = outer[~np.isnan(outer)]

                    if len(v_center) > 0 and len(v_outer) > 0:
                        max_temp = round(float(np.max(v_center)), 2)
                        bg_temp = round(float(np.median(v_outer)), 2)
                        anomaly = round(max_temp - bg_temp, 2)
                        thermal_found = True
                        thermal_source = f"Landsat-8/9 Thermal Band 10 ({item.id})"
                        thermal_scene_id = item.id
                        thermal_reason = "Valid real thermal pixels extracted from Landsat Band 10"
                        print(f"  [PRIMARY THERMAL SUCCESS] Landsat Scene: {item.id} | Max Temp: {max_temp}°C | Anomaly: {anomaly}°C")
                        break
        except Exception as e:
            pass

    # 2. FALLBACK THERMAL: MODIS DAILY LST (modis-11A1-061) IF LANDSAT FAILED
    if not thermal_found:
        print("  Landsat thermal unavailable/cloud-masked. Trying MODIS Daily LST (modis-11A1-061) fallback...")
        modis_search = catalog.search(collections=["modis-11A1-061"], bbox=bbox, datetime=f"{start_7d}/{end_7d}")
        m_items = list(modis_search.items())
        
        m_candidates = []
        for item in m_items:
            dt_str = item.properties.get("datetime")
            if not dt_str:
                # Parse MODIS date from item ID e.g. MOD11A1.A2026239...
                parts = item.id.split(".")
                if len(parts) >= 2 and parts[1].startswith("A"):
                    year = int(parts[1][1:5])
                    doy = int(parts[1][5:8])
                    item_dt = datetime(year, 1, 1) + timedelta(days=doy - 1)
                    diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
                    m_candidates.append((diff_h, item, item_dt))
            else:
                item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
                diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
                m_candidates.append((diff_h, item, item_dt))

        m_candidates.sort(key=lambda x: x[0])

        for diff_h, item, item_dt in m_candidates:
            lst_asset = item.assets.get("LST_Day_1km")
            qc_asset = item.assets.get("QC_Day")
            if not lst_asset:
                continue

            try:
                with rasterio.open(lst_asset.href) as src_lst:
                    xs, ys = transform("EPSG:4326", src_lst.crs, [lon], [lat])
                    tx, ty = xs[0], ys[0]
                    b = src_lst.bounds
                    if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                        continue
                    r, c = src_lst.index(tx, ty)
                    if not (3 <= r < src_lst.height - 3 and 3 <= c < src_lst.width - 3):
                        continue

                    win = rasterio.windows.Window(c - 3, r - 3, 7, 7)
                    raw_lst = src_lst.read(1, window=win).astype(float)
                    
                    # Valid MODIS LST range: > 0 (scaled by 0.02, K -> C)
                    valid_lst_mask = raw_lst > 0
                    if np.sum(valid_lst_mask) > 0:
                        temp_c = (raw_lst * 0.02) - 273.15
                        temp_c[~valid_lst_mask] = np.nan
                        
                        center = temp_c[2:5, 2:5]
                        v_center = center[~np.isnan(center)]
                        outer = temp_c.copy()
                        outer[2:5, 2:5] = np.nan
                        v_outer = outer[~np.isnan(outer)]

                        if len(v_center) > 0 and len(v_outer) > 0:
                            max_temp = round(float(np.max(v_center)), 2)
                            bg_temp = round(float(np.median(v_outer)), 2)
                            anomaly = round(max_temp - bg_temp, 2)
                            thermal_found = True
                            thermal_source = f"MODIS LST 1km ({item.id})"
                            thermal_scene_id = item.id
                            thermal_reason = "Valid real LST pixels extracted from MODIS 1km LST"
                            print(f"  [MODIS THERMAL SUCCESS] Item: {item.id} | Diff: {diff_h:.1f}h | Max Temp: {max_temp}°C | Anomaly: {anomaly}°C")
                            break
            except Exception as e:
                pass

    # 3. OPTICAL NDVI: PRIMARY SENTINEL-2, FALLBACK LANDSAT-8/9 OPTICAL
    optical_found = False
    optical_source = "UNAVAILABLE"
    optical_scene_id = "UNAVAILABLE"
    optical_reason = "No valid optical scene or unmasked pixels found across Sentinel-2 or Landsat-8/9"
    ndvi_val = None

    s2_search = catalog.search(collections=["sentinel-2-l2a"], bbox=bbox, datetime=f"{start_7d}/{end_7d}")
    s2_items = list(s2_search.items())

    s2_candidates = []
    for item in s2_items:
        dt_str = item.properties.get("datetime")
        if dt_str:
            item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
            diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
            if diff_h <= 168.0:
                cloud_p = float(item.properties.get("eo:cloud_cover", 100.0) or 100.0)
                s2_candidates.append((diff_h, cloud_p, item))

    s2_candidates.sort(key=lambda x: (x[0], x[1]))

    for diff_h, cloud_p, item in s2_candidates:
        red_a = item.assets.get("B04") or item.assets.get("red")
        nir_a = item.assets.get("B08") or item.assets.get("nir")
        scl_a = item.assets.get("SCL") or item.assets.get("scl")
        if not (red_a and nir_a):
            continue

        try:
            with rasterio.open(red_a.href) as src_r, rasterio.open(nir_a.href) as src_n:
                xs, ys = transform("EPSG:4326", src_r.crs, [lon], [lat])
                tx, ty = xs[0], ys[0]
                b = src_r.bounds
                if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                    continue
                r, c = src_r.index(tx, ty)
                if not (7 <= r < src_r.height - 7 and 7 <= c < src_r.width - 7):
                    continue

                win = rasterio.windows.Window(c - 7, r - 7, 15, 15)
                r_pix = src_r.read(1, window=win).astype(float)
                n_pix = src_n.read(1, window=win).astype(float)

                cloud_scl = np.zeros_like(r_pix, dtype=bool)
                if scl_a:
                    try:
                        with rasterio.open(scl_a.href) as src_scl:
                            xs_scl, ys_scl = transform("EPSG:4326", src_scl.crs, [lon], [lat])
                            r_scl, c_scl = src_scl.index(xs_scl[0], ys_scl[0])
                            if 4 <= r_scl < src_scl.height - 4 and 4 <= c_scl < src_scl.width - 4:
                                win_scl = rasterio.windows.Window(c_scl - 4, r_scl - 4, 8, 8)
                                scl_raw = src_scl.read(1, window=win_scl)
                                if scl_raw.shape == (8, 8):
                                    scl_10m = np.kron(scl_raw, np.ones((2, 2), dtype=int))[:15, :15]
                                    cloud_scl = np.isin(scl_10m, [0, 1, 2, 3, 8, 9, 10, 11])
                    except Exception:
                        pass

                denom = n_pix + r_pix
                valid_mask = (denom > 0) & (~cloud_scl)
                if np.sum(valid_mask) > 0:
                    ndvi = (n_pix - r_pix) / denom
                    valid_ndvi = ndvi[valid_mask]
                    ndvi_val = round(float(np.median(valid_ndvi)), 3)
                    optical_found = True
                    optical_source = f"Sentinel-2 L2A ({item.id})"
                    optical_scene_id = item.id
                    optical_reason = "Valid real optical pixels extracted from Sentinel-2 B04/B08"
                    print(f"  [PRIMARY OPTICAL SUCCESS] Sentinel-2 Scene: {item.id} | Median NDVI: {ndvi_val}")
                    break
        except Exception:
            pass

    # FALLBACK OPTICAL: LANDSAT-8/9 OPTICAL (SR_B4, SR_B5) IF SENTINEL-2 FAILED
    if not optical_found:
        print("  Sentinel-2 optical unavailable/cloud-masked. Trying Landsat-8/9 Optical (SR_B4/SR_B5) fallback...")
        for diff_h, cloud_p, item in l_candidates:
            red_a = item.assets.get("SR_B4") or item.assets.get("red")
            nir_a = item.assets.get("SR_B5") or item.assets.get("nir08")
            qa_a = item.assets.get("qa_pixel")
            if not (red_a and nir_a and qa_a):
                continue

            try:
                with rasterio.open(red_a.href) as src_r, rasterio.open(nir_a.href) as src_n, rasterio.open(qa_a.href) as src_qa:
                    xs, ys = transform("EPSG:4326", src_r.crs, [lon], [lat])
                    tx, ty = xs[0], ys[0]
                    b = src_r.bounds
                    if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                        continue
                    r, c = src_r.index(tx, ty)
                    if not (7 <= r < src_r.height - 7 and 7 <= c < src_r.width - 7):
                        continue

                    win = rasterio.windows.Window(c - 7, r - 7, 15, 15)
                    r_pix = src_r.read(1, window=win).astype(float) * 0.0000275 - 0.2
                    n_pix = src_n.read(1, window=win).astype(float) * 0.0000275 - 0.2
                    qa_p = src_qa.read(1, window=win)

                    invalid_mask = (qa_p & (1 | 2 | 4 | 8 | 16 | 32)) > 0
                    denom = n_pix + r_pix
                    valid_mask = (denom > 0) & (~invalid_mask) & (r_pix > 0) & (n_pix > 0)

                    if np.sum(valid_mask) > 0:
                        ndvi = (n_pix - r_pix) / denom
                        valid_ndvi = ndvi[valid_mask]
                        ndvi_val = round(float(np.median(valid_ndvi)), 3)
                        optical_found = True
                        optical_source = f"Landsat-8/9 Surface Reflectance ({item.id})"
                        optical_scene_id = item.id
                        optical_reason = "Valid real optical pixels extracted from Landsat SR_B4/SR_B5"
                        print(f"  [LANDSAT OPTICAL SUCCESS] Scene: {item.id} | Median NDVI: {ndvi_val}")
                        break
            except Exception:
                pass

    print("\nSUMMARY RESULT:")
    print(f"  Thermal Source : {thermal_source}")
    print(f"  Max Temp       : {max_temp}°C" if max_temp else f"  Max Temp       : UNAVAILABLE (Reason: {thermal_reason})")
    print(f"  Optical Source : {optical_source}")
    print(f"  NDVI Median    : {ndvi_val}" if ndvi_val else f"  NDVI Median    : UNAVAILABLE (Reason: {optical_reason})")

if __name__ == "__main__":
    test_verify_multi_satellite(27.26775, 88.31142, datetime(2026, 8, 27, 7, 48, 0))
