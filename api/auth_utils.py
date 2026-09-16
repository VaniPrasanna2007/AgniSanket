import os
import hmac
import hashlib
import secrets
import json
import base64
import time

from typing import Optional, List

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from db.database import get_db
from db.models import User


# ============================================================
# AUTHENTICATION CONFIGURATION
# ============================================================

JWT_SECRET = os.getenv(
    "JWT_SECRET",
    "sih26162-ntro-secure-auth-secret-key-2026"
)

TOKEN_EXPIRE_SECONDS = 86400  # 24 hours

ALLOWED_ROLES = {
    "ADMIN",
    "ANALYST",
    "GOVERNMENT_AUTHORITY"
}


# HTTPBearer registers Bearer authentication in FastAPI/OpenAPI.
# This makes the "Authorize" button appear in Swagger UI.
#
# auto_error=False allows get_current_user() to return None
# when no token is provided. get_required_user() will then
# raise the proper 401 Unauthorized response.
security = HTTPBearer(auto_error=False)


# ============================================================
# PASSWORD HASHING
# ============================================================

def hash_password(password: str) -> str:
    """
    Hash a password securely using PBKDF2-HMAC-SHA256.

    A random salt is generated for every password.
    The stored format is:

        salt:hashed_password
    """

    salt = secrets.token_hex(16)

    key = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        100000
    )

    return f"{salt}:{key.hex()}"


def verify_password(
    plain_password: str,
    hashed_password: str
) -> bool:
    """
    Verify a plain-text password against the stored hash.
    """

    try:
        salt, key_hex = hashed_password.split(":", 1)

        new_key = hashlib.pbkdf2_hmac(
            "sha256",
            plain_password.encode("utf-8"),
            salt.encode("utf-8"),
            100000
        )

        return hmac.compare_digest(
            new_key.hex(),
            key_hex
        )

    except Exception:
        return False


# ============================================================
# BASE64URL HELPERS
# ============================================================

def _base64url_encode(data: bytes) -> str:
    """
    Encode bytes using URL-safe Base64 without padding.
    """

    return base64.urlsafe_b64encode(data) \
        .rstrip(b"=") \
        .decode("utf-8")


def _base64url_decode(data: str) -> bytes:
    """
    Decode URL-safe Base64 and restore missing padding.
    """

    padding = "=" * (4 - (len(data) % 4))

    return base64.urlsafe_b64decode(
        data + padding
    )


# ============================================================
# ACCESS TOKEN CREATION
# ============================================================

def create_access_token(
    data: dict,
    expires_seconds: int = TOKEN_EXPIRE_SECONDS
) -> str:
    """
    Create a signed access token using HMAC-SHA256.

    The token contains:

    - Header
    - Payload
    - Signature

    The final format is:

        header.payload.signature
    """

    header = {
        "alg": "HS256",
        "typ": "JWT"
    }

    payload = data.copy()

    current_time = int(time.time())

    payload["exp"] = current_time + expires_seconds
    payload["iat"] = current_time

    header_b64 = _base64url_encode(
        json.dumps(
            header,
            separators=(",", ":")
        ).encode("utf-8")
    )

    payload_b64 = _base64url_encode(
        json.dumps(
            payload,
            separators=(",", ":")
        ).encode("utf-8")
    )

    signing_input = (
        f"{header_b64}.{payload_b64}"
    ).encode("utf-8")

    signature = hmac.new(
        JWT_SECRET.encode("utf-8"),
        signing_input,
        hashlib.sha256
    ).digest()

    signature_b64 = _base64url_encode(signature)

    return (
        f"{header_b64}."
        f"{payload_b64}."
        f"{signature_b64}"
    )


# ============================================================
# ACCESS TOKEN DECODING
# ============================================================

def decode_access_token(
    token: str
) -> Optional[dict]:
    """
    Verify the token signature and expiry.

    Returns:
        Token payload if valid
        None if invalid or expired
    """

    try:
        parts = token.strip().split(".")

        if len(parts) != 3:
            return None

        header_b64, payload_b64, signature_b64 = parts

        signing_input = (
            f"{header_b64}.{payload_b64}"
        ).encode("utf-8")

        expected_signature = _base64url_encode(
            hmac.new(
                JWT_SECRET.encode("utf-8"),
                signing_input,
                hashlib.sha256
            ).digest()
        )

        # Prevent token tampering
        if not hmac.compare_digest(
            signature_b64,
            expected_signature
        ):
            return None

        payload = json.loads(
            _base64url_decode(payload_b64)
            .decode("utf-8")
        )

        # Validate expiry
        expiration_time = payload.get("exp", 0)

        if expiration_time < int(time.time()):
            return None

        return payload

    except Exception:
        return None


# ============================================================
# GET CURRENT USER
# ============================================================

def get_current_user(
    credentials: Optional[
        HTTPAuthorizationCredentials
    ] = Depends(security),
    db: Session = Depends(get_db)
) -> Optional[User]:
    """
    FastAPI dependency that returns the authenticated user.

    If no token is provided or the token is invalid,
    this function returns None.

    The get_required_user() function is responsible for
    enforcing authentication.
    """

    if not credentials:
        return None

    # HTTPBearer already removes the "Bearer " prefix.
    token = credentials.credentials

    payload = decode_access_token(token)

    if not payload:
        return None

    username = payload.get("sub")

    if not username:
        return None

    user = (
        db.query(User)
        .filter(User.username == username)
        .first()
    )

    return user


# ============================================================
# REQUIRED USER AUTHENTICATION
# ============================================================

def get_required_user(
    current_user: Optional[User] = Depends(get_current_user)
) -> User:
    """
    Enforce authentication.

    Raises:
        401 if token is missing or invalid
        403 if account is deactivated

    Returns:
        Authenticated active user
    """

    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "Authentication token missing or invalid. "
                "Please login."
            ),
            headers={
                "WWW-Authenticate": "Bearer"
            }
        )

    # Check both possible account status fields.
    is_active = getattr(
        current_user,
        "is_active",
        1
    )

    account_status = getattr(
        current_user,
        "status",
        "ACTIVE"
    )

    if (
        is_active == 0
        or account_status == "INACTIVE"
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Account has been deactivated by "
                "administrator. Access revoked."
            )
        )

    return current_user


# ============================================================
# ROLE-BASED ACCESS CONTROL
# ============================================================

def require_roles(
    allowed_roles: List[str]
):
    """
    Dependency factory for role-based access control.

    Example:

        @app.get("/admin-only")
        def admin_only(
            user: User = Depends(require_roles(["ADMIN"]))
        ):
            return {"message": "Admin access granted"}
    """

    def role_checker(
        current_user: User = Depends(get_required_user)
    ) -> User:

        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Access denied. Required role in "
                    f"{allowed_roles}, but user has role "
                    f"'{current_user.role}'."
                )
            )

        return current_user

    return role_checker


# ============================================================
# DEFAULT USER SEEDING
# ============================================================

def seed_default_users(db: Session):
    """
    Create or synchronize default application accounts.

    Default accounts:

        admin
        analyst1
        gov1

    Existing users are updated with the default password,
    role, and email.
    """

    seed_users = [
        (
            "admin",
            "AdminPassword123!",
            "ADMIN",
            "admin@ntro-thermal.gov.in"
        ),
        (
            "analyst1",
            "Analyst123!",
            "ANALYST",
            "analyst@ntro-thermal.gov.in"
        ),
        (
            "gov1",
            "GovAuth123!",
            "GOVERNMENT_AUTHORITY",
            "gov@ntro-thermal.gov.in"
        )
    ]

    for username, password, role, email in seed_users:

        user = (
            db.query(User)
            .filter(
                User.username.ilike(username)
            )
            .first()
        )

        if not user:
            user = User(
                username=username,
                password_hash=hash_password(password),
                role=role,
                email=email
            )

            db.add(user)

        else:
            user.password_hash = hash_password(password)
            user.role = role

            if not user.email:
                user.email = email

    db.commit()

    print(
        "[AUTH DB SEED] Created/Updated default seed users "
        "(admin, analyst1, gov1)."
    )
