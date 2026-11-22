from datetime import UTC, datetime
from typing import Literal
from urllib.parse import urlsplit

from pydantic import AwareDatetime, BaseModel, Field, HttpUrl, field_validator, model_validator

from .geocoding import Coordinates


class BridgeNotice(BaseModel):
    direction: Literal["both", "northbound", "southbound"]
    status: Literal["restricted", "closed"]
    source_url: HttpUrl
    expires_at: AwareDatetime

    @field_validator("source_url")
    @classmethod
    def require_https(cls, value):
        if value.scheme != "https" or value.username or value.password:
            raise ValueError("Use a public HTTPS source URL")
        return value


class MapAsset(Coordinates):
    kind: Literal["bridge", "road_watch", "camera"]
    name: str = Field(min_length=1, max_length=120)
    source_url: HttpUrl
    attribution: str = Field(min_length=1, max_length=200)
    enabled: bool = True
    road: str | None = Field(default=None, max_length=120)
    camera_type: Literal["external", "snapshot", "hls", "iframe", "youtube"] = "external"
    media_url: HttpUrl | None = None
    refresh_seconds: int = Field(default=60, ge=15, le=3600)
    licensing: str | None = Field(default=None, max_length=500)
    notice: BridgeNotice | None = None

    @field_validator("source_url", "media_url")
    @classmethod
    def require_https(cls, value):
        if value is not None and (value.scheme != "https" or value.username or value.password):
            raise ValueError("Use public HTTPS URLs without embedded credentials")
        return value

    @model_validator(mode="after")
    def validate_source(self):
        if self.kind != "camera" and (self.camera_type != "external" or self.media_url):
            raise ValueError("Only cameras can have media")
        if self.camera_type != "external" and (not self.media_url or not self.licensing):
            raise ValueError("An approved media URL and licensing information are required")
        if self.camera_type in {"youtube", "iframe"}:
            url = urlsplit(str(self.media_url))
            if url.hostname not in {"www.youtube.com", "www.youtube-nocookie.com"} or not url.path.startswith("/embed/"):
                raise ValueError("Only approved YouTube embed URLs are supported; use an external source link otherwise")
        if self.notice and self.kind != "bridge":
            raise ValueError("Directional notices apply to bridges")
        return self


def asset_view(row):
    result = dict(row.payload, id=row.id)
    notice = result.get("notice")
    if notice and datetime.fromisoformat(notice["expires_at"]) <= datetime.now(UTC):
        result["notice"] = None
    return result
