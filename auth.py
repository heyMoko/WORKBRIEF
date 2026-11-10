"""Password hashing and JWT helpers for WorkBrief authentication."""

import os
import re
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import HTTPException, status
from jwt.exceptions import InvalidTokenError
from pwdlib import PasswordHash

from database import initialize_postgres_schema, load_database_environment, open_connection

PASSWORD_HASHER = PasswordHash.recommended()
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_MINUTES = 60 * 12
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def jwt_secret():
    load_database_environment()
    secret = os.getenv("JWT_SECRET")
    if not secret or len(secret) < 32:
        raise HTTPException(status_code=503, detail=".env에 32자 이상 JWT_SECRET을 설정해주세요.")
    return secret


def normalize_email(email):
    normalized = email.strip().casefold()
    if not EMAIL_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=422, detail="올바른 이메일 주소를 입력해주세요.")
    return normalized


def validate_password(password):
    if len(password) < 10:
        raise HTTPException(status_code=422, detail="비밀번호는 10자 이상이어야 합니다.")


def public_user(row):
    return {"id": row["id"], "email": row["email"], "display_name": row["display_name"]}


def register_user(email, display_name, password):
    initialize_postgres_schema()
    email = normalize_email(email)
    display_name = display_name.strip()
    validate_password(password)
    if not 2 <= len(display_name) <= 30:
        raise HTTPException(status_code=422, detail="이름은 2~30자로 입력해주세요.")
    with open_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM users WHERE email = %s", (email,))
            if cursor.fetchone():
                raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다.")
            cursor.execute(
                """INSERT INTO users (email, display_name, password_hash, created_at)
                   VALUES (%s, %s, %s, %s) RETURNING id, email, display_name""",
                (email, display_name, PASSWORD_HASHER.hash(password), datetime.now(timezone.utc)),
            )
            return public_user(cursor.fetchone())


def authenticate_user(email, password):
    initialize_postgres_schema()
    email = normalize_email(email)
    with open_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id, email, display_name, password_hash FROM users WHERE email = %s", (email,))
            user = cursor.fetchone()
    if not user or not PASSWORD_HASHER.verify(password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    return public_user(user)


def create_access_token(user):
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MINUTES)
    return jwt.encode({"sub": str(user["id"]), "exp": expires_at}, jwt_secret(), algorithm=JWT_ALGORITHM)


def current_user_from_token(token):
    initialize_postgres_schema()
    credentials_error = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="로그인이 필요하거나 로그인 시간이 만료됐습니다.")
    try:
        payload = jwt.decode(token, jwt_secret(), algorithms=[JWT_ALGORITHM])
        user_id = int(payload.get("sub", ""))
    except (InvalidTokenError, ValueError, TypeError):
        raise credentials_error
    with open_connection() as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id, email, display_name FROM users WHERE id = %s", (user_id,))
            user = cursor.fetchone()
    if not user:
        raise credentials_error
    return public_user(user)
