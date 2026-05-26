"""
TrustBridge — Geolocation Matcher
Deterministically normalizes and matches location vs preference.
Falls back to Gemini only for unknown/complex geographies.
"""

import os
import json
from typing import Literal
import httpx

_GEO_CACHE: dict[tuple[str, str], str] = {}

def normalize_text(text: str | None) -> str:
    if not text:
        return ""
    return text.strip().lower()

def deterministic_match(company_location: str, geo_preference: str) -> Literal["match", "partial", "no_match", "unknown"]:
    loc = normalize_text(company_location)
    pref = normalize_text(geo_preference)
    
    if not loc or not pref:
        return "unknown"
        
    if loc == pref or pref in loc:
        return "match"

    us_aliases = {"us", "usa", "united states", "united states of america", "domestic", "itar"}
    na_aliases = {"na", "north america", "us/canada", "us & canada", "us/mexico"}
    
    us_states = {
        "alabama", "al", "alaska", "ak", "arizona", "az", "arkansas", "ar", "california", "ca",
        "colorado", "co", "connecticut", "ct", "delaware", "de", "florida", "fl", "georgia", "ga",
        "hawaii", "hi", "idaho", "id", "illinois", "il", "indiana", "in", "iowa", "ia", "kansas", "ks",
        "kentucky", "ky", "louisiana", "la", "maine", "me", "maryland", "md", "massachusetts", "ma",
        "michigan", "mi", "minnesota", "mn", "mississippi", "ms", "missouri", "mo", "montana", "mt",
        "nebraska", "ne", "nevada", "nv", "new hampshire", "nh", "new jersey", "nj", "new mexico", "nm",
        "new york", "ny", "north carolina", "nc", "north dakota", "nd", "ohio", "oh", "oklahoma", "ok",
        "oregon", "or", "pennsylvania", "pa", "rhode island", "ri", "south carolina", "sc",
        "south dakota", "sd", "tennessee", "tn", "texas", "tx", "utah", "ut", "vermont", "vt",
        "virginia", "va", "washington", "wa", "west virginia", "wv", "wisconsin", "wi", "wyoming", "wy"
    }
    
    loc_words = set(loc.replace(",", " ").split())
    is_loc_us = any(alias == loc or alias in loc_words for alias in us_aliases) or any(state in loc_words or loc.endswith(f", {state}") for state in us_states)
    
    is_pref_us = pref in us_aliases
    is_pref_na = pref in na_aliases
    
    if is_loc_us and is_pref_us:
        return "match"
        
    if is_loc_us and is_pref_na:
        return "match"
        
    non_us_countries = {"china", "india", "uk", "united kingdom", "europe", "eu", "mexico", "canada", "germany", "japan", "taiwan", "vietnam"}
    is_loc_non_us = any(c in loc_words for c in non_us_countries)
    
    if is_pref_us and is_loc_non_us:
        return "no_match"
        
    if is_pref_na and is_loc_non_us and "mexico" not in loc_words and "canada" not in loc_words:
        return "no_match"
        
    return "unknown"

async def evaluate_geo_match(company_location: str | None, geo_preference: str | None) -> Literal["match", "partial", "no_match", "unknown"]:
    if not company_location or not geo_preference:
        return "unknown"
        
    loc = normalize_text(company_location)
    pref = normalize_text(geo_preference)
    
    cache_key = (loc, pref)
    if cache_key in _GEO_CACHE:
        return _GEO_CACHE[cache_key]
        
    result = deterministic_match(company_location, geo_preference)
    if result != "unknown":
        _GEO_CACHE[cache_key] = result
        return result
        
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        _GEO_CACHE[cache_key] = "unknown"
        return "unknown"
        
    prompt = f"""
Evaluate if the supplier's location matches the buyer's geographical preference.

Supplier Location: "{company_location}"
Buyer Preference: "{geo_preference}"

Respond with exactly one word from the following options in JSON format:
{{"result": "match"}} - If the location fully satisfies the preference.
{{"result": "partial"}} - If it partially satisfies or is adjacent/near but not exact.
{{"result": "no_match"}} - If the location is clearly outside the preferred area.
{{"result": "unknown"}} - If the location or preference is too ambiguous.
"""
    model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                url,
                json={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {"temperature": 0.0, "responseMimeType": "application/json"},
                }
            )
            response.raise_for_status()
            data = response.json()
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            parsed = json.loads(text)
            res = parsed.get("result", "unknown").lower()
            if res in ["match", "partial", "no_match"]:
                _GEO_CACHE[cache_key] = res
                return res
            else:
                _GEO_CACHE[cache_key] = "unknown"
                return "unknown"
    except Exception as e:
        print(f"[geo_match] Gemini fallback failed: {e}")
        _GEO_CACHE[cache_key] = "unknown"
        return "unknown"
