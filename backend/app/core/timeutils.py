from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from voonie.backend.app.core.exceptions import ApiError


def parse_timezone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except ZoneInfoNotFoundError as exc:
        raise ApiError(422, "invalid_timezone", "Unknown IANA timezone") from exc


def day_bounds(day: date, timezone_name: str) -> tuple[datetime, datetime]:
    zone = parse_timezone(timezone_name)
    start = datetime.combine(day, time.min, tzinfo=zone).astimezone(timezone.utc)
    end = datetime.combine(day, time.max, tzinfo=zone).astimezone(timezone.utc)
    return start, end
