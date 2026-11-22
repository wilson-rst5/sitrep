from sitrep.geocoding import Coordinates, normalize_nominatim, resolve


def test_normalize_address_keeps_administrative_levels_separate():
    fields, code = normalize_nominatim({"display_name": "Fixture", "address": {
        "country_code": "pt", "country": "Portugal", "state_district": "District",
        "municipality": "Municipality", "town": "Town", "suburb": "Neighbourhood",
    }})
    assert code == "PT"
    assert fields["district_name"] == "District"
    assert fields["municipality"] == "Municipality"
    assert fields["city"] == "Town"
    assert fields["region"] is None


def test_lookup_returns_offline_timezone_with_no_geocoder(monkeypatch):
    monkeypatch.delenv("GEOCODER_URL", raising=False)
    result = resolve(Coordinates(latitude=38.7223, longitude=-9.1393))
    assert result["timezone"] == "Europe/Lisbon"
    assert result["country"] is None
    assert result["geography"].resolved_fields == ["timezone"]
    assert result["status"] == "not_configured"
