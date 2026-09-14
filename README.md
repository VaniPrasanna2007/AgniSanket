# SIH26162 Industrial Thermal Anomaly Detection Pipeline

An industrial-grade thermal anomaly detection and verification system designed for real-world satellite observation and infrastructure monitoring.

---

## 🛰️ Architecture & Real-Data Pipeline

The active pipeline operates strictly on authentic satellite imagery, spatial data, and remote sensing standards:

```text
NASA FIRMS Hotspots
       ↓
STAC API Verification (Microsoft Planetary Computer)
       ↓
Pixel-Level COG Raster Analysis (rasterio + pystac-client)
       ↓
Quality Masking (USGS QA_PIXEL Bitwise Filtering)
       ↓
Thermal & Optical Indices (Landsat 8/9 ST_B10 + Sentinel-2 B04/B08 NDVI)
       ↓
OSM Industrial Infrastructure Context (Multi-Mirror Overpass + Nominatim Failover)
       ↓
Risk Assessment & Rule-Based / ML Classification
       ↓
FastAPI & Modern Glassmorphic Dashboard
```

---

## 🔬 Satellite Verification System (`ingestion/satellite_verification.py`)

The active satellite verification module relies on **Microsoft Planetary Computer's STAC API**, `pystac-client`, and `rasterio` for real-world raster processing:

### 1. Landsat 8/9 Collection 2 Level-2 Thermal Processing
- **Asset**: Surface Temperature Band 10 (`ST_B10`).
- **Scale & Offset**: Applies official USGS Level-2 scaling:
  $$T_{\text{Celsius}} = (\text{DN} \times 0.00341802 + 149.0) - 273.15$$
- **QA_PIXEL Masking**: Unpacks 16-bit bitmask flags to filter clouds, cloud shadows, snow, and water before running any statistical calculations.
- **Spatial Windowing**: Computes thermal anomaly by comparing the inner $5 \times 5$ hotspot window against the surrounding background median ($15 \times 15$ window).

### 2. Sentinel-2 Optical Analysis
- **Assets**: Band 4 (Red, `B04`) and Band 8 (NIR, `B08`).
- **NDVI Calculation**: Real pixel-level Normalized Difference Vegetation Index calculation:
  $$\text{NDVI} = \frac{\text{B08} - \text{B04}}{\text{B08} + \text{B04}}$$

---

## 🏭 OSM Industrial Context (`ingestion/osm_enrichment.py`)

- **Multi-Mirror Overpass API Querying**: Rotates across global Overpass instances (`overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee`) to query industrial land use, power plants, manufacturing units, and substations within a 25 km search radius.
- **Nominatim Spatial Search Failover**: Automatically fails over to the OpenStreetMap Nominatim Search API if Overpass mirrors experience network latency or rate-limiting.
- **Fail-Soft Handling**: Returns `NULL` / `UNAVAILABLE` when no feature is present, preventing false proximity risk inflation.

---

## 🛠️ Installation & Setup

### Prerequisites
- Python 3.10+
- PostgreSQL 14+ (or default fallback to SQLite)

### 1. Clone Repository & Install Dependencies
```bash
python -m venv venv
venv\Scripts\activate  # Windows
pip install -r requirements.txt
```

### 2. Environment Configuration
Copy `.env.example` to `.env` and configure credentials:
```bash
cp .env.example .env
```

### 3. Database Initialization
```bash
python -c "from db.database import init_db; init_db()"
```

### 4. Start API Server
```bash
uvicorn api.main:app --reload --port 8000
```

### 5. Launch Dashboard
Open `frontend/index.html` in any modern web browser or serve via HTTP.

---

## 📁 Repository Structure

```text
├── api/                        # FastAPI application endpoints
├── db/                         # SQLAlchemy database models & session management
├── features/                   # Risk engine & spatial feature pipeline
├── frontend/                   # Modern glassmorphic dashboard (HTML/CSS/JS)
├── ingestion/                  # Data ingestion & satellite analysis
│   ├── firms_ingestion.py      # NASA FIRMS hotspot ingestion
│   ├── osm_enrichment.py       # Live OSM spatial enrichment & failover
│   ├── satellite_verification.py# Planetary Computer STAC + rasterio pipeline
│   └── gee_verification.py     # (Alternate implementation - not active)
├── model/                      # ML classification & rule engine
├── requirements.txt            # Python dependencies
└── test_5_real_records.py      # End-to-end real-data audit script
```
