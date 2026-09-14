import pystac_client
import planetary_computer
from datetime import datetime

PLANETARY_COMPUTER_STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

catalog = pystac_client.Client.open(PLANETARY_COMPUTER_STAC_URL, modifier=planetary_computer.sign_inplace)

# Let's search for collections matching thermal or optical
cols = catalog.get_collections()

thermal_cols = []
optical_cols = []

for c in cols:
    cid = c.id
    ctitle = c.title
    if any(k in cid.lower() for k in ["landsat", "modis", "aster", "sentinel", "viirs"]):
        print(f"Collection: {cid:30s} | Title: {ctitle}")

# Test querying Landsat-8/9 optical assets (SR_B4, SR_B5, QA_PIXEL)
lat = 27.26775
lon = 88.31142
bbox = [lon - 0.15, lat - 0.15, lon + 0.15, lat + 0.15]

search = catalog.search(collections=["landsat-c2-l2"], bbox=bbox, datetime="2026-08-20T00:00:00Z/2026-09-03T23:59:59Z")
items = list(search.items())
if items:
    sample = items[0]
    print(f"\nSample Landsat-8/9 assets for {sample.id}:")
    for key in sample.assets.keys():
        if key in ["SR_B4", "SR_B5", "ST_B10", "qa_pixel", "red", "nir08", "lwir11"]:
            print(f"  Asset key: {key:10s} | Title: {sample.assets[key].title}")
