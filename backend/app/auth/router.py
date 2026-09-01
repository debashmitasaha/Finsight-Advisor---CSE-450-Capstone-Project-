from __future__ import annotations

from datetime import datetime, timedelta
import os
from typing import Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import String, cast
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Company, User
from app.services.common import serialize_user

router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer(auto_error=False)

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "7"))


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=8)
    company_id: Optional[str] = None
    is_admin: bool = False


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: dict


class RefreshResponse(TokenResponse):
    pass


class MeResponse(BaseModel):
    user: dict


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))


def _encode_token(payload: dict, expires_delta: timedelta) -> str:
    claims = payload.copy()
    claims["exp"] = datetime.utcnow() + expires_delta
    return jwt.encode(claims, SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(user_id: object) -> str:
    return _encode_token({"sub": str(user_id), "type": "access"}, timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))


def create_refresh_token(user_id: object) -> str:
    return _encode_token({"sub": str(user_id), "type": "refresh"}, timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS))


def decode_token(token: str, expected_type: str) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired") from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from exc

    if payload.get("type") != expected_type or not payload.get("sub"):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    return str(payload["sub"])


def get_user_by_id(db: Session, user_id: str) -> User | None:
    return db.query(User).filter(cast(User.user_id, String) == str(user_id)).first()


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
    user_id = decode_token(credentials.credentials, "access")
    user = get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


@router.post("/register", response_model=TokenResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if payload.company_id and not db.query(Company).filter(Company.company_id == payload.company_id).first():
        raise HTTPException(status_code=404, detail="Company not found")

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=hash_password(payload.password),
        company_id=payload.company_id,
        is_admin=payload.is_admin,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(user.user_id),
        refresh_token=create_refresh_token(user.user_id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=serialize_user(user),
    )


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User account is inactive")

    user.last_login = datetime.utcnow()
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(user.user_id),
        refresh_token=create_refresh_token(user.user_id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=serialize_user(user),
    )


@router.post("/refresh", response_model=RefreshResponse)
def refresh(credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()), db: Session = Depends(get_db)):
    user_id = decode_token(credentials.credentials, "refresh")
    user = get_user_by_id(db, user_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return RefreshResponse(
        access_token=create_access_token(user.user_id),
        refresh_token=create_refresh_token(user.user_id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=serialize_user(user),
    )


@router.get("/me", response_model=MeResponse)
def me(current_user: User = Depends(get_current_user)):
    return MeResponse(user=serialize_user(current_user))
