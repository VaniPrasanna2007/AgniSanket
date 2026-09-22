import os
import logging
from urllib.parse import urlparse
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

# Logger setup
logger = logging.getLogger("db.database")
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")

# Check both DATABASE_URL (Render default) and DB_URL
raw_db_url = os.getenv("DATABASE_URL") or os.getenv("DB_URL")

def sanitize_db_url(url: str) -> str:
    """Returns a sanitized DB URL masking any credentials."""
    try:
        parsed = urlparse(url)
        scheme = parsed.scheme
        host = parsed.hostname or "localhost"
        port = f":{parsed.port}" if parsed.port else ""
        dbname = parsed.path
        return f"{scheme}://***:***@{host}{port}{dbname}"
    except Exception:
        return "<masked-url>"

if raw_db_url and raw_db_url.strip():
    configured_url = raw_db_url.strip()
    # Normalize postgres:// to postgresql:// for SQLAlchemy compatibility
    if configured_url.startswith("postgres://"):
        configured_url = configured_url.replace("postgres://", "postgresql://", 1)
    
    DB_URL = configured_url
    dialect = DB_URL.split("://")[0] if "://" in DB_URL else "unknown"
    
    if DB_URL.startswith("sqlite"):
        logger.info("[DATABASE CONFIG] Using SQLite database. Connection: %s", sanitize_db_url(DB_URL))
        engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
    else:
        logger.info("[DATABASE CONFIG] Configured database type: %s. Connecting to: %s", dialect, sanitize_db_url(DB_URL))
        try:
            # Configure pooling for production PostgreSQL connections
            engine = create_engine(
                DB_URL,
                pool_pre_ping=True,
                pool_size=5,
                max_overflow=10,
                pool_recycle=1800
            )
            # Test connection immediately
            with engine.connect() as conn:
                pass
            logger.info("[DATABASE CONFIG] Successfully established connection to %s database.", dialect)
        except Exception as e:
            logger.error("[DATABASE FATAL] Connection to %s database failed: %s", dialect, e)
            logger.error("[DATABASE FATAL] Target endpoint: %s", sanitize_db_url(DB_URL))
            logger.error("[DATABASE FATAL] SQLite fallback is disabled because a database URL was explicitly configured.")
            raise ConnectionError(
                f"Failed to connect to configured database ({dialect}): {e}. Check DATABASE_URL/DB_URL credentials and network reachability."
            ) from e
else:
    # No PostgreSQL URL configured - only now fall back to local SQLite
    DB_URL = "sqlite:///./sih_thermal.db"
    logger.info("[DATABASE CONFIG] No DATABASE_URL or DB_URL configured. Defaulting to local SQLite: sih_thermal.db")
    engine = create_engine(DB_URL, connect_args={"check_same_thread": False})

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def init_db():
    Base.metadata.create_all(bind=engine)
    with engine.begin() as conn:
        cols_to_add = [
            ("government_status", "VARCHAR DEFAULT 'UNACKNOWLEDGED'"),
            ("government_notes", "TEXT"),
            ("acknowledged_by", "VARCHAR"),
            ("acknowledged_at", "TIMESTAMP")
        ]
        for col_name, col_type in cols_to_add:
            try:
                from sqlalchemy import text
                conn.execute(text(f"ALTER TABLE hotspot_clusters ADD COLUMN {col_name} {col_type}"))
            except Exception:
                pass

        raw_cols_to_add = [
            ("cluster_id", "INTEGER"),
            ("risk_score", "FLOAT DEFAULT 0.0"),
            ("risk_level", "VARCHAR DEFAULT 'LOW'")
        ]
        for col_name, col_type in raw_cols_to_add:
            try:
                from sqlalchemy import text
                conn.execute(text(f"ALTER TABLE raw_hotspots ADD COLUMN {col_name} {col_type}"))
            except Exception:
                pass

        user_cols_to_add = [
            ("is_active", "INTEGER DEFAULT 1"),
            ("status", "VARCHAR DEFAULT 'ACTIVE'")
        ]
        for col_name, col_type in user_cols_to_add:
            try:
                from sqlalchemy import text
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type}"))
            except Exception:
                pass
