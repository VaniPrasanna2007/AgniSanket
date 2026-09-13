import os
import hmac
import hashlib
import secrets
import json
import base64
import time
from typing import Optional, List
from fastapi import Depends, HTTPException, status, Header
from sqlalchemy.orm import Session
from db.database import get_db
from db.models import User

JWT_SECRET = os.getenv("JWT_SECRET", "sih26162-ntro-secure-auth-secret-key-2026")
TOKEN_EXPIRE_SECONDS = 86400  # 24 hours

ALLOWED_ROLES = {"ADMIN", "ANALYST", "GOVERNMENT_AUTHORITY"}

def hash_password(password: str) -> str:
    """Hash password securely using PBKDF2-HMAC-SHA256 with 100,000 rounds and random salt."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    )
    return f"{salt}:{key.hex()}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify plain text password against stored salt:key hash."""
    try:
        salt, key_hex = hashed_password.split(':')
        new_key = hashlib.pbkdf2_hmac(
            'sha256',
            plain_password.encode('utf-8'),
            salt.encode('utf-8'),
            100000
        )
        return hmac.compare_digest(new_key.hex(), key_hex)
    except Exception:
        return False

def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b'=').decode('utf-8')

def _base64url_decode(data: str) -> bytes:
    padding = '=' * (4 - (len(data) % 4))
    return base64.urlsafe_b64decode(data + padding)

def create_access_token(data: dict, expires_seconds: int = TOKEN_EXPIRE_SECONDS) -> str:
    """Generate tamper-proof HMAC-SHA256 signed access token."""
    header = {"alg": "HS256", "typ": "JWT"}
    payload = data.copy()
    payload["exp"] = int(time.time()) + expires_seconds
    payload["iat"] = int(time.time())

    header_b64 = _base64url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    payload_b64 = _base64url_encode(json.dumps(payload, separators=(',', ':')).encode('utf-8'))

    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
    signature = hmac.new(JWT_SECRET.encode('utf-8'), signing_input, hashlib.sha256).digest()
    sig_b64 = _base64url_encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"

def decode_access_token(token: str) -> Optional[dict]:
    """Verify signature and return token payload if valid and unexpired."""
    try:
        parts = token.strip().split('.')
        if len(parts) != 3:
            return None
        
        header_b64, payload_b64, sig_b64 = parts
        signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')
        expected_sig = _base64url_encode(hmac.new(JWT_SECRET.encode('utf-8'), signing_input, hashlib.sha256).digest())

        if not hmac.compare_digest(sig_b64, expected_sig):
            return None

        payload = json.loads(_base64url_decode(payload_b64).decode('utf-8'))
        if payload.get("exp", 0) < int(time.time()):
            return None  # Token expired

        return payload
    except Exception:
        return None

def get_current_user(authorization: Optional[str] = Header(None), db: Session = Depends(get_db)) -> Optional[User]:
    """FastAPI Dependency: returns logged in User or None if unauthenticated."""
    if not authorization:
        return None

    token = authorization.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()

    payload = decode_access_token(token)
    if not payload or "sub" not in payload:
        return None

    user = db.query(User).filter(User.username == payload["sub"]).first()
    return user

def get_required_user(current_user: Optional[User] = Depends(get_current_user)) -> User:
    """Dependency: enforces authentication (raises 401 if unauthenticated)."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token missing or invalid. Please login."
        )
    return current_user

def require_roles(allowed_roles: List[str]):
    """Dependency factory: enforces role-based access control (raises 403 if unauthorized)."""
    def role_checker(current_user: User = Depends(get_required_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required role in {allowed_roles}, but user has role '{current_user.role}'."
            )
        return current_user
    return role_checker

def seed_default_users(db: Session):
    """Seed / synchronize default accounts if missing or out of sync."""
    seed_users = [
        ("admin", "AdminPassword123!", "ADMIN", "admin@ntro-thermal.gov.in"),
        ("analyst1", "Analyst123!", "ANALYST", "analyst@ntro-thermal.gov.in"),
        ("gov1", "GovAuth123!", "GOVERNMENT_AUTHORITY", "gov@ntro-thermal.gov.in")
    ]
    for uname, pwd, role, email in seed_users:
        u = db.query(User).filter(User.username.ilike(uname)).first()
        if not u:
            u = User(
                username=uname,
                password_hash=hash_password(pwd),
                role=role,
                email=email
            )
            db.add(u)
        else:
            u.password_hash = hash_password(pwd)
            u.role = role
            if not u.email:
                u.email = email
    db.commit()
    print("[AUTH DB SEED] Created/Updated default seed users (admin, analyst1, gov1).")
