import os
import requests
import numpy as np
import rasterio
from rasterio.warp import transform
import pystac_client
import planetary_computer
from datetime import datetime, timedelta

PLANETARY_COMPUTER_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

def determine_temporal_quality(diff_h: float) -> str:
    if diff_h <= 12.0:
        return "STRONG"
    elif diff_h <= 48.0:
        return "MODERATE"
    elif diff_h <= 168.0:
        return "WEAK"
    else:
        return "INVALID"

def verify_hotspot_stac_satellite(lat: float, lon: float, acq_date: datetime = None) -> dict:
    if acq_date is None:
        acq_date = datetime.utcnow()

    bbox = [lon - 0.15, lat - 0.15, lon + 0.15, lat + 0.15]
    catalog = pystac_client.Client.open(PLANETARY_COMPUTER_STAC_URL, modifier=planetary_computer.sign_inplace)

    evidence = {
        "status": "UNAVAILABLE",
        "satellite_name": "Multi-Satellite STAC Search (Landsat, Sentinel-2, MODIS)",
        "landsat_scene_id": "UNAVAILABLE",
        "sentinel2_scene_id": "UNAVAILABLE",
        "thermal_source": "UNAVAILABLE",
        "optical_source": "UNAVAILABLE",
        "thermal_unavailable_reason": "No valid unmasked thermal pixels found across Landsat-8/9 Band 10 and MODIS 1km LST within ±7 day window",
        "optical_unavailable_reason": "No valid unmasked optical pixels found across Sentinel-2 (B04/B08) and Landsat-8/9 (SR_B4/SR_B5) within ±7 day window",
        "thermal_asset_used": None,
        "observation_datetime": None,
        "cloud_percentage": None,
        "valid_pixel_percentage": None,
        "hotspot_max_temp_c": None,
        "hotspot_mean_temp_c": None,
        "surrounding_median_temp_c": None,
        "thermal_anomaly_c": None,
        "ndvi_median": None,
        "time_difference_hours": None,
        "temporal_match_quality": "INVALID",
        "quality_flag": "RASTER_UNAVAILABLE",
        "satellite_data_available": 0,
        "thermal_data_available": 0,
        "optical_data_available": 0
    }

    start_7d = (acq_date - timedelta(days=7)).strftime("%Y-%m-%dT00:00:00Z")
    end_7d = (acq_date + timedelta(days=7)).strftime("%Y-%m-%dT23:59:59Z")

    # =========================================================================
    # 1. THERMAL EVIDENCE: PRIMARY LANDSAT 8/9, SECONDARY MODIS DAILY LST
    # =========================================================================
    landsat_items = []
    try:
        l_search = catalog.search(collections=["landsat-c2-l2"], bbox=bbox, datetime=f"{start_7d}/{end_7d}", limit=20)
        landsat_items = list(l_search.items())
    except Exception as e:
        print(f"STAC search exception for Landsat: {e}")

    l_candidates = []
    for item in landsat_items:
        dt_str = item.properties.get("datetime")
        if dt_str:
            item_dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00")).replace(tzinfo=None)
            diff_h = abs((item_dt - acq_date).total_seconds()) / 3600.0
            if diff_h <= 168.0:
                cloud_prop = float(item.properties.get("eo:cloud_cover", 100.0) or 100.0)
                l_candidates.append((diff_h, cloud_prop, item))

    l_candidates.sort(key=lambda x: (x[0], x[1]))

    thermal_success = False
    cloud_masked_landsat = None

    for diff_h, cloud_p, item in l_candidates:
        thermal_asset = item.assets.get("ST_B10") or item.assets.get("lwir11")
        qa_asset = item.assets.get("qa_pixel")

        if thermal_asset and qa_asset:
            try:
                with rasterio.open(thermal_asset.href) as src_t, rasterio.open(qa_asset.href) as src_qa:
                    xs, ys = transform("EPSG:4326", src_t.crs, [lon], [lat])
                    tx, ty = xs[0], ys[0]
                    b = src_t.bounds

                    if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                        continue

                    row, col = src_t.index(tx, ty)
                    if 7 <= row < src_t.height - 7 and 7 <= col < src_t.width - 7:
                        win = rasterio.windows.Window(col - 7, row - 7, 15, 15)
                        raw_t = src_t.read(1, window=win).astype(float)
                        qa_p = src_qa.read(1, window=win)

                        invalid_mask = ((qa_p & (1 | 2 | 4 | 8 | 16 | 32)) > 0) | (raw_t <= 0)
                        total_px = 225
                        inv_cnt = int(np.sum(invalid_mask))
                        val_cnt = total_px - inv_cnt
                        val_pct = round((val_cnt / total_px) * 100.0, 1)
                        cld_pct = round((inv_cnt / total_px) * 100.0, 1)

                        if cloud_masked_landsat is None:
                            cloud_masked_landsat = {
                                "landsat_scene_id": item.id,
                                "cloud_percentage": cld_pct,
                                "valid_pixel_percentage": val_pct,
                                "observation_datetime": item.properties.get("datetime"),
                                "time_difference_hours": round(diff_h, 1),
                                "temporal_match_quality": determine_temporal_quality(diff_h),
                                "satellite_name": f"Landsat-8/9 ({item.id})"
                            }

                        if val_cnt > 0:
                            temp_c = (raw_t * 0.00341802 + 149.0) - 273.15
                            temp_c[invalid_mask] = np.nan

                            center = temp_c[5:10, 5:10]
                            v_center = center[~np.isnan(center)]
                            outer = temp_c.copy()
                            outer[5:10, 5:10] = np.nan
                            v_outer = outer[~np.isnan(outer)]

                            if len(v_center) > 0 and len(v_outer) > 0:
                                max_t = float(np.max(v_center))
                                mean_t = float(np.mean(v_center))
                                bg_t = float(np.median(v_outer))
                                anom = max_t - bg_t

                                evidence["valid_pixel_percentage"] = val_pct
                                evidence["cloud_percentage"] = cld_pct
                                evidence["landsat_scene_id"] = item.id
                                evidence["thermal_asset_used"] = thermal_asset.title or "ST_B10"
                                evidence["observation_datetime"] = item.properties.get("datetime")
                                evidence["time_difference_hours"] = round(diff_h, 1)
                                evidence["temporal_match_quality"] = determine_temporal_quality(diff_h)
                                evidence["satellite_data_available"] = 1
                                evidence["hotspot_max_temp_c"] = round(max_t, 2)
                                evidence["hotspot_mean_temp_c"] = round(mean_t, 2)
                                evidence["surrounding_median_temp_c"] = round(bg_t, 2)
                                evidence["thermal_anomaly_c"] = round(anom, 2)
                                evidence["thermal_data_available"] = 1
                                evidence["thermal_source"] = f"Landsat-8/9 Band 10 ({item.id})"
                                evidence["thermal_unavailable_reason"] = None
                                evidence["satellite_name"] = f"Landsat-8/9 Collection 2 L2 ({item.id})"
                                evidence["status"] = "AVAILABLE"
                                evidence["quality_flag"] = "VALID_RASTER_OBSERVATION"
                                thermal_success = True
                                break
            except Exception:
                pass

    # FALLBACK THERMAL SOURCE: MODIS DAILY 1km LST (modis-11A1-061)
    if not thermal_success:
        try:
            modis_search = catalog.search(collections=["modis-11A1-061"], bbox=bbox, datetime=f"{start_7d}/{end_7d}", limit=10)
            m_items = list(modis_search.items())
            m_candidates = []
            for item in m_items:
                dt_str = item.properties.get("datetime")
                if not dt_str:
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
                        if 3 <= r < src_lst.height - 3 and 3 <= c < src_lst.width - 3:
                            win = rasterio.windows.Window(c - 3, r - 3, 7, 7)
                            raw_lst = src_lst.read(1, window=win).astype(float)
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
                                    max_t = float(np.max(v_center))
                                    mean_t = float(np.mean(v_center))
                                    bg_t = float(np.median(v_outer))
                                    anom = max_t - bg_t

                                    evidence["satellite_data_available"] = 1
                                    evidence["thermal_data_available"] = 1
                                    evidence["hotspot_max_temp_c"] = round(max_t, 2)
                                    evidence["hotspot_mean_temp_c"] = round(mean_t, 2)
                                    evidence["surrounding_median_temp_c"] = round(bg_t, 2)
                                    evidence["thermal_anomaly_c"] = round(anom, 2)
                                    evidence["thermal_source"] = f"MODIS 1km LST ({item.id})"
                                    evidence["thermal_unavailable_reason"] = None

                                    if evidence["status"] == "UNAVAILABLE":
                                        evidence["status"] = "AVAILABLE"
                                        evidence["satellite_name"] = f"MODIS LST 1km ({item.id})"
                                        evidence["time_difference_hours"] = round(diff_h, 1)
                                        evidence["temporal_match_quality"] = determine_temporal_quality(diff_h)
                                        evidence["observation_datetime"] = item_dt.isoformat() + "Z"
                                        evidence["quality_flag"] = "VALID_MODIS_LST_OBSERVATION"

                                    thermal_success = True
                                    break
                except Exception:
                    pass
        except Exception:
            pass

    # Record cloud metadata if Landsat thermal existed but was cloud masked
    if not thermal_success and cloud_masked_landsat:
        evidence["landsat_scene_id"] = cloud_masked_landsat["landsat_scene_id"]
        evidence["cloud_percentage"] = cloud_masked_landsat["cloud_percentage"]
        evidence["valid_pixel_percentage"] = cloud_masked_landsat["valid_pixel_percentage"]
        evidence["observation_datetime"] = cloud_masked_landsat["observation_datetime"]
        evidence["time_difference_hours"] = cloud_masked_landsat["time_difference_hours"]
        evidence["temporal_match_quality"] = cloud_masked_landsat["temporal_match_quality"]
        evidence["satellite_name"] = cloud_masked_landsat["satellite_name"]
        evidence["quality_flag"] = "CLOUD_MASKED_HOTSPOT"
        evidence["satellite_data_available"] = 1

    # =========================================================================
    # 2. OPTICAL EVIDENCE: PRIMARY SENTINEL-2, SECONDARY LANDSAT 8/9 OPTICAL
    # =========================================================================
    optical_success = False

    try:
        s2_search = catalog.search(collections=["sentinel-2-l2a"], bbox=bbox, datetime=f"{start_7d}/{end_7d}", limit=20)
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

            if red_a and nir_a:
                try:
                    with rasterio.open(red_a.href) as src_r, rasterio.open(nir_a.href) as src_n:
                        xs, ys = transform("EPSG:4326", src_r.crs, [lon], [lat])
                        tx, ty = xs[0], ys[0]
                        b = src_r.bounds
                        if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                            continue

                        r_s2, c_s2 = src_r.index(tx, ty)
                        if 7 <= r_s2 < src_r.height - 7 and 7 <= c_s2 < src_r.width - 7:
                            win_s2 = rasterio.windows.Window(c_s2 - 7, r_s2 - 7, 15, 15)
                            red_pix = src_r.read(1, window=win_s2).astype(float)
                            nir_pix = src_n.read(1, window=win_s2).astype(float)

                            if red_pix.shape == (15, 15) and nir_pix.shape == (15, 15):
                                cloud_scl = np.zeros_like(red_pix, dtype=bool)
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

                                denom = nir_pix + red_pix
                                valid_ndvi_mask = (denom > 0) & (~cloud_scl)

                                evidence["satellite_data_available"] = 1

                                if np.sum(valid_ndvi_mask) > 0:
                                    ndvi_mat = (nir_pix - red_pix) / denom
                                    valid_ndvi_vals = ndvi_mat[valid_ndvi_mask]
                                    evidence["ndvi_median"] = round(float(np.median(valid_ndvi_vals)), 3)
                                    evidence["sentinel2_scene_id"] = item.id
                                    evidence["optical_data_available"] = 1
                                    evidence["optical_source"] = f"Sentinel-2 L2A ({item.id})"
                                    evidence["optical_unavailable_reason"] = None

                                    if evidence["status"] == "UNAVAILABLE":
                                        evidence["status"] = "AVAILABLE"
                                        evidence["satellite_name"] = f"Sentinel-2 L2A ({item.id})"
                                        evidence["quality_flag"] = "VALID_OPTICAL_OBSERVATION"
                                        dt_str = item.properties.get("datetime")
                                        if dt_str:
                                            evidence["time_difference_hours"] = round(diff_h, 1)
                                            evidence["temporal_match_quality"] = determine_temporal_quality(diff_h)
                                            evidence["observation_datetime"] = dt_str
                                    optical_success = True
                                    break
                except Exception:
                    pass
    except Exception:
        pass

    # SECONDARY OPTICAL FALLBACK: LANDSAT-8/9 OPTICAL (SR_B4, SR_B5)
    if not optical_success and l_candidates:
        for diff_h, cloud_p, item in l_candidates:
            red_a = item.assets.get("SR_B4") or item.assets.get("red")
            nir_a = item.assets.get("SR_B5") or item.assets.get("nir08")
            qa_a = item.assets.get("qa_pixel")

            if red_a and nir_a and qa_a:
                try:
                    with rasterio.open(red_a.href) as src_r, rasterio.open(nir_a.href) as src_n, rasterio.open(qa_a.href) as src_qa:
                        xs, ys = transform("EPSG:4326", src_r.crs, [lon], [lat])
                        tx, ty = xs[0], ys[0]
                        b = src_r.bounds
                        if not (b.left <= tx <= b.right and b.bottom <= ty <= b.top):
                            continue
                        r, c = src_r.index(tx, ty)
                        if 7 <= r < src_r.height - 7 and 7 <= c < src_r.width - 7:
                            win = rasterio.windows.Window(c - 7, r - 7, 15, 15)
                            r_pix = src_r.read(1, window=win).astype(float) * 0.0000275 - 0.2
                            n_pix = src_n.read(1, window=win).astype(float) * 0.0000275 - 0.2
                            qa_p = src_qa.read(1, window=win)

                            invalid_mask = (qa_p & (1 | 2 | 4 | 8 | 16 | 32)) > 0
                            denom = n_pix + r_pix
                            valid_mask = (denom > 0) & (~invalid_mask) & (r_pix > 0) & (n_pix > 0)

                            if np.sum(valid_mask) > 0:
                                ndvi_mat = (n_pix - r_pix) / denom
                                valid_ndvi_vals = ndvi_mat[valid_mask]
                                evidence["ndvi_median"] = round(float(np.median(valid_ndvi_vals)), 3)
                                evidence["landsat_scene_id"] = item.id
                                evidence["optical_data_available"] = 1
                                evidence["optical_source"] = f"Landsat-8/9 Surface Reflectance ({item.id})"
                                evidence["optical_unavailable_reason"] = None

                                if evidence["status"] == "UNAVAILABLE":
                                    evidence["status"] = "AVAILABLE"
                                    evidence["satellite_name"] = f"Landsat-8/9 Surface Reflectance ({item.id})"
                                    evidence["quality_flag"] = "VALID_LANDSAT_OPTICAL_OBSERVATION"
                                    evidence["time_difference_hours"] = round(diff_h, 1)
                                    evidence["temporal_match_quality"] = determine_temporal_quality(diff_h)
                                    evidence["observation_datetime"] = item.properties.get("datetime")

                                optical_success = True
                                break
                except Exception:
                    pass

    return evidence
