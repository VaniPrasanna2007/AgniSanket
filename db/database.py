import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("DB_URL", "sqlite:///./sih_thermal.db")

# Create engine compatible with SQLite & PostgreSQL
if DB_URL.startswith("sqlite"):
    engine = create_engine(DB_URL, connect_args={"check_same_thread": False})
else:
    try:
        engine = create_engine(DB_URL)
        # Test connection
        with engine.connect() as conn:
            pass
    except Exception as e:
        print(f"PostgreSQL connection failed ({e}). Falling back to SQLite database...")
        DB_URL = "sqlite:///./sih_thermal.db"
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
