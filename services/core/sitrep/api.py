import asyncio
import hashlib
import os
import secrets
from datetime import UTC, datetime
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi import APIRouter, Cookie, Depends, FastAPI, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, field_validator
from prometheus_client import CONTENT_TYPE_LATEST, Counter, generate_latest
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from .db import engine, ready
from .providers import DEFAULT_PROVIDERS, PROVIDERS, Event

passwords = PasswordHasher()
cookie_secure = os.getenv("SECURE_COOKIES", "true") == "true"
origin = os.getenv("PUBLIC_ORIGIN", "http://localhost:8080").rstrip("/")
setup_token = os.getenv("SETUP_TOKEN", "")
requests = Counter("sitrep_http_responses", "HTTP responses", ["status"])
app = FastAPI(title="SITREP API", version="0.1.0", docs_url=None,
              openapi_url="/api/openapi.json", redoc_url=None)
api = APIRouter(prefix="/api/v1")


class Credentials(BaseModel):
    username: str = Field(pattern=r"^[a-zA-Z0-9_.-]{3,80}$")
    password: str = Field(min_length=12, max_length=256)


class Location(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    country: str = Field(pattern=r"^[A-Z]{2}$")
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    radius: int = Field(ge=1, le=2000)
    timezone: str = Field(max_length=80)
    language: Literal["en", "pt-PT"] = "en"
    units: Literal["metric", "imperial"] = "metric"
    district: str | None = Field(default=None, pattern=r"^[A-Z]{3}$")

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("Use an IANA time zone") from exc
        return value


class Setup(Credentials):
    token: str = Field(max_length=256)
    location: Location


class Account(Credentials):
    role: Literal["admin", "viewer"] = "viewer"


@app.exception_handler(RequestValidationError)
async def invalid_request(_request: Request, _error: RequestValidationError):
    return JSONResponse({"detail": "Invalid request fields"}, status_code=422)


@app.middleware("http")
async def protect(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"} and request.headers.get("origin") != origin:
        return Response('{"detail":"Origin rejected"}', 403, media_type="application/json")
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    requests.labels(str(response.status_code)).inc()
    return response


def digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def require_user(sitrep_session: Annotated[str | None, Cookie(max_length=128)] = None):
    if sitrep_session:
        with engine.connect() as conn:
            user = conn.execute(text("""
                SELECT a.username, a.role FROM sessions s JOIN accounts a USING (username)
                WHERE s.digest=:digest AND s.expires_at > now()
            """), {"digest": digest(sitrep_session)}).mappings().first()
            if user:
                return dict(user)
    raise HTTPException(401, "Sign in required")


def require_admin(user=Depends(require_user)):
    if user["role"] != "admin":
        raise HTTPException(403, "Administrator access required")
    return user


def audit(conn, actor, action):
    conn.execute(text("INSERT INTO audit (actor, action) VALUES (:actor, :action)"),
                 {"actor": actor, "action": action})


def insert_location(conn, location):
    return conn.execute(text("""
        INSERT INTO locations (name,country,latitude,longitude,radius,timezone,language,units,district)
        VALUES (:name,:country,:latitude,:longitude,:radius,:timezone,:language,:units,:district)
        RETURNING id
    """), location.model_dump()).scalar_one()


@api.get("/health")
def health():
    try:
        ready()
    except SQLAlchemyError as exc:
        raise HTTPException(503, "Database unavailable") from exc
    return {"status": "ready"}


@api.get("/setup")
def setup_status():
    with engine.connect() as conn:
        return {"required": not conn.execute(text("SELECT EXISTS(SELECT 1 FROM accounts)")).scalar_one()}


@api.post("/setup", status_code=201)
def setup(body: Setup):
    if len(setup_token) < 32 or not secrets.compare_digest(setup_token.encode(), body.token.encode()):
        raise HTTPException(403, "Invalid bootstrap token")
    with engine.begin() as conn:
        conn.execute(text("SELECT pg_advisory_xact_lock(331007)"))
        if conn.execute(text("SELECT EXISTS(SELECT 1 FROM accounts)")).scalar_one():
            raise HTTPException(409, "Setup already completed")
        conn.execute(text("INSERT INTO accounts VALUES (:username,:hashed,'admin')"),
                     {"username": body.username, "hashed": passwords.hash(body.password)})
        insert_location(conn, body.location)
        audit(conn, body.username, "bootstrap")
    return {"username": body.username}


@api.post("/login")
def login(body: Credentials, response: Response):
    with engine.begin() as conn:
        user = conn.execute(text("SELECT * FROM accounts WHERE username=:username"),
                            {"username": body.username}).mappings().first()
        try:
            if user is None:
                passwords.hash(body.password)
                raise HTTPException(401, "Invalid credentials")
            passwords.verify(user["password_hash"], body.password)
        except VerifyMismatchError as exc:
            raise HTTPException(401, "Invalid credentials") from exc
        token = secrets.token_urlsafe(32)
        conn.execute(text("""
            INSERT INTO sessions VALUES (:digest, :username, now() + interval '7 days')
        """), {"digest": digest(token), "username": body.username})
    response.set_cookie("sitrep_session", token, httponly=True, secure=cookie_secure,
                        samesite="strict", max_age=604800, path="/api")
    return {"username": user["username"], "role": user["role"]}


@api.post("/logout")
def logout(response: Response, sitrep_session: Annotated[str | None, Cookie(max_length=128)] = None):
    if sitrep_session:
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM sessions WHERE digest=:digest"), {"digest": digest(sitrep_session)})
    response.delete_cookie("sitrep_session", path="/api", secure=cookie_secure,
                           httponly=True, samesite="strict")
    return {"status": "signed_out"}


@api.get("/session")
def session(user=Depends(require_user)):
    return user


@api.get("/locations")
def locations(_user=Depends(require_user)):
    with engine.connect() as conn:
        return [dict(row) for row in conn.execute(text("SELECT * FROM locations ORDER BY id")).mappings()]


@api.post("/locations", status_code=201)
def add_location(location: Location, user=Depends(require_admin)):
    with engine.begin() as conn:
        identifier = insert_location(conn, location)
        audit(conn, user["username"], "location_created")
    return {"id": identifier}


@api.post("/accounts", status_code=201)
def create_account(account: Account, user=Depends(require_admin)):
    with engine.begin() as conn:
        inserted = conn.execute(text("""
            INSERT INTO accounts VALUES (:username,:hashed,:role) ON CONFLICT DO NOTHING
            RETURNING username
        """), {"username": account.username, "hashed": passwords.hash(account.password),
               "role": account.role}).scalar()
        if inserted is None:
            raise HTTPException(409, "Username already exists")
        audit(conn, user["username"], "account_created")
    return {"username": inserted}


@api.get("/providers")
@api.get("/providers/health")
def providers(_user=Depends(require_user)):
    with engine.connect() as conn:
        health_rows = {row.provider: row for row in conn.execute(text("SELECT * FROM provider_health"))}
    enabled = set(os.getenv("ENABLED_PROVIDERS", DEFAULT_PROVIDERS).split(","))
    result = []
    for provider in PROVIDERS:
        row = health_rows.get(provider.id)
        success = row.succeeded_at if row else None
        age = (datetime.now(UTC) - success).total_seconds() if success else float("inf")
        state = "DISABLED"
        if provider.id in enabled:
            state = "OFFLINE" if age > provider.interval_seconds * 5 else (
                "DEGRADED" if row.error or age > provider.interval_seconds * 2 else "ONLINE"
            )
        result.append(dict(id=provider.id, name=provider.name, category=provider.category,
                           docs=provider.docs, terms=provider.terms, coverage=provider.coverage,
                           interval_seconds=provider.interval_seconds, credentials=provider.credentials,
                           state=state, attempted_at=row.attempted_at if row else None,
                           succeeded_at=success, error=row.error if row else None))
    return result


@api.get("/events", response_model=list[Event])
def events(location_id: Annotated[int | None, Query(ge=1)] = None,
           category: Annotated[list[Annotated[str, Field(min_length=1, max_length=40)]] | None,
                               Query(max_length=12)] = None,
           severity: Annotated[int, Query(ge=0, le=4)] = 0,
           limit: Annotated[int, Query(ge=1, le=500)] = 200,
           offset: Annotated[int, Query(ge=0, le=10000)] = 0,
           _user=Depends(require_user)):
    with engine.connect() as conn:
        location = None
        if location_id is not None:
            location = conn.execute(text("SELECT * FROM locations WHERE id=:id"),
                                    {"id": location_id}).mappings().first()
            if location is None:
                raise HTTPException(404, "Monitoring area unavailable")
        criteria = ""
        params = dict(categories=category or [], all_categories=not category, severity=severity, limit=limit, offset=offset)
        if location is not None:
            criteria = """AND (
                ST_DWithin(point, ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography,:meters)
                OR (point IS NULL AND district = :district AND :country = 'PT')
            )"""
            params.update(lon=location.longitude, lat=location.latitude,
                          meters=location.radius * 1000, district=location.district,
                          country=location.country)
        return list(conn.execute(text(f"""
            SELECT payload FROM events WHERE expires_at > now() AND severity >= :severity
            AND (:all_categories OR category = ANY(CAST(:categories AS text[]))) {criteria}
            ORDER BY severity DESC, occurred_at DESC, provider, external_id LIMIT :limit OFFSET :offset
        """), params).scalars())


def stream_revision(token: str):
    with engine.connect() as conn:
        valid = conn.execute(text("""
            SELECT EXISTS (SELECT 1 FROM sessions WHERE digest=:digest AND expires_at > now())
        """), {"digest": digest(token)}).scalar_one()
        if not valid:
            return None
        return conn.execute(text("SELECT version FROM event_revisions WHERE id = 1")).scalar_one()


@api.get("/stream", response_class=StreamingResponse)
async def stream(request: Request, sitrep_session: Annotated[str, Cookie(max_length=128)],
                 _user=Depends(require_user)):
    async def messages():
        previous = None
        for _ in range(30):
            if await request.is_disconnected():
                return
            revision = await asyncio.to_thread(stream_revision, sitrep_session)
            if revision is None:
                yield "event: signed-out\ndata: {}\n\n"
                return
            if revision != previous:
                yield f"event: events-changed\ndata: {revision}\n\n"
                previous = revision
            else:
                yield ": heartbeat\n\n"
            await asyncio.sleep(10)
    return StreamingResponse(messages(), media_type="text/event-stream",
                             headers={"X-Accel-Buffering": "no"})


class AlertAck(BaseModel):
    provider: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,49}$")
    external_id: str = Field(min_length=1, max_length=160)


class AlertRule(BaseModel):
    category: str = Field(pattern=r"^[a-z][a-z0-9_]{0,39}$")
    minimum_severity: int = Field(ge=1, le=4)


@api.get("/alert-rules", response_model=list[AlertRule])
def alert_rules(_user=Depends(require_user)):
    with engine.connect() as conn:
        return conn.execute(text("SELECT * FROM alert_rules ORDER BY category")).mappings().all()


@api.post("/alert-rules", response_model=AlertRule)
def save_alert_rule(rule: AlertRule, user=Depends(require_admin)):
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO alert_rules (category, minimum_severity) VALUES (:category, :minimum_severity)
            ON CONFLICT (category) DO UPDATE SET minimum_severity = EXCLUDED.minimum_severity
        """), rule.model_dump())
        audit(conn, user["username"], "alert_rule_saved")
    return rule


@api.get("/alerts")
def alerts(user=Depends(require_user)):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT e.payload, a.acknowledged_at FROM events e
            LEFT JOIN alert_rules r ON r.category = e.category
            LEFT JOIN alert_acknowledgements a
                ON a.provider=e.provider AND a.external_id=e.external_id AND a.username=:username
            WHERE e.severity >= COALESCE(r.minimum_severity, 2) AND e.expires_at > now()
            ORDER BY e.severity DESC, e.occurred_at DESC, e.provider, e.external_id LIMIT 200
        """), user).mappings()
        return [dict(event=row.payload, acknowledged_at=row.acknowledged_at) for row in rows]


@api.get("/alerts/history")
def alert_history(user=Depends(require_user)):
    with engine.connect() as conn:
        rows = conn.execute(text("""
            SELECT event_snapshot AS event, acknowledged_at FROM alert_acknowledgements
            WHERE username=:username AND acknowledged_at > now() - interval '30 days'
            ORDER BY acknowledged_at DESC, provider, external_id LIMIT 200
        """), user).mappings()
        return [dict(row) for row in rows]


@api.get("/alerts/status")
def alert_status(provider: str, external_id: str, user=Depends(require_user)):
    with engine.connect() as conn:
        row = conn.execute(text("""
            SELECT e.severity >= COALESCE(r.minimum_severity, 2) AS eligible, a.acknowledged_at
            FROM events e LEFT JOIN alert_rules r ON r.category = e.category
            LEFT JOIN alert_acknowledgements a
                ON a.provider=e.provider AND a.external_id=e.external_id AND a.username=:username
            WHERE e.provider=:provider AND e.external_id=:external_id AND e.expires_at > now()
        """), {"provider": provider, "external_id": external_id, "username": user["username"]}).mappings().first()
    if row is None:
        raise HTTPException(404, "Alert unavailable")
    return dict(row)


@api.post("/alerts/acknowledge")
def acknowledge(alert: AlertAck, user=Depends(require_user)):
    with engine.begin() as conn:
        params = {**alert.model_dump(), "username": user["username"]}
        acknowledged = conn.execute(text("""
            INSERT INTO alert_acknowledgements (username, provider, external_id, event_snapshot)
            SELECT :username, e.provider, e.external_id, e.payload
            FROM events e LEFT JOIN alert_rules r ON r.category = e.category
            WHERE e.provider=:provider AND e.external_id=:external_id
                AND e.severity >= COALESCE(r.minimum_severity, 2) AND e.expires_at > now()
            ON CONFLICT (username, provider, external_id) DO UPDATE
            SET acknowledged_at=alert_acknowledgements.acknowledged_at
            RETURNING acknowledged_at
        """), params).scalar()
        if acknowledged is None:
            raise HTTPException(404, "Alert unavailable")
    return {"acknowledged_at": acknowledged}


@api.get("/audit")
def audit_log(_admin=Depends(require_admin)):
    with engine.connect() as conn:
        return [dict(row) for row in conn.execute(text("""
            SELECT * FROM audit ORDER BY id DESC LIMIT 100
        """)).mappings()]


@api.get("/events/{provider}/{external_id}", response_model=Event)
def event(provider: str, external_id: str, _user=Depends(require_user)):
    with engine.connect() as conn:
        result = conn.execute(text("""
            SELECT payload FROM events WHERE provider=:provider AND external_id=:external_id AND expires_at > now()
        """), {"provider": provider, "external_id": external_id}).scalar()
    if result is None:
        raise HTTPException(404, "Event unavailable")
    return result


@app.get("/metrics", include_in_schema=False)
def metrics(_admin=Depends(require_admin)):
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


app.include_router(api)
