from __future__ import annotations

import json
import re
from collections import defaultdict
from pathlib import Path
import yaml


DATA_DIR = Path(__file__).resolve().parent / "data"
EQUIPMENT_PATH = DATA_DIR / "equipment.json"
MATERIALS_PATH = DATA_DIR / "materials.yml"


def normalize_text(text: str | None) -> str:
    if not text or not isinstance(text, str):
        return ""
    text = text.lower()
    text = re.sub(r"\([^)]*\)", "", text)
    text = re.sub(r"([a-z]+)(\d+)", r"\1 \2", text)
    text = re.sub(r"(\d+)([a-z]+)", r"\1 \2", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def canonicalize_equipment(text: str | None) -> str:
    if not text:
        return ""
    text = text.lower()
    for fluff in (
        "universal machine",
        "turning center",
        "vertical milling center",
        "machining center",
        "cnc",
        "machine",
        "center",
        "series",
    ):
        text = text.replace(fluff, "")
    vf_frac = re.search(r"vf[\s\-]*(\d{1,2})/(\d{2})", text)
    if vf_frac:
        combined = vf_frac.group(1) + vf_frac.group(2)
        text = re.sub(r"vf[\s\-]*\d{1,2}/\d{2}", f"vf{combined}", text)
    text = text.replace("-", "")
    text = text.replace("/", "")
    text = re.sub(r"([a-z]+)(\d+)", r"\1 \2", text)
    text = re.sub(r"(\d+)([a-z]+)", r"\1 \2", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_numbers(text: str | None) -> list[str]:
    return re.findall(r"\d+", text or "")


def load_equipment_db() -> list[dict]:
    if not EQUIPMENT_PATH.exists():
        return []
    with EQUIPMENT_PATH.open("r", encoding="utf-8", errors="replace") as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def _normalize_material_map(raw_map) -> dict[str, dict]:
    if not isinstance(raw_map, dict):
        return {}
    normalized: dict[str, dict] = {}
    for generic, block in raw_map.items():
        if not isinstance(block, dict):
            continue
        aliases = block.get("aliases", [])
        materials = block.get("materials", [])
        normalized[str(generic)] = {
            "aliases": aliases if isinstance(aliases, list) else [],
            "materials": materials if isinstance(materials, list) else [],
        }
    return normalized


def load_material_map() -> dict[str, dict]:
    if not MATERIALS_PATH.exists():
        return {}
    with MATERIALS_PATH.open("r", encoding="utf-8", errors="replace") as f:
        raw = yaml.safe_load(f)
    return _normalize_material_map(raw)


EQUIPMENT_DB = load_equipment_db()
MATERIAL_MAP = load_material_map()
MANUFACTURER_INDEX: defaultdict[str, list[dict]] = defaultdict(list)

for equipment in EQUIPMENT_DB:
    manufacturer = normalize_text(equipment.get("Manufacturer Name"))
    if manufacturer:
        MANUFACTURER_INDEX[manufacturer].append(equipment)


def extract_manufacturer(text: str | None) -> str | None:
    spoken = normalize_text(text)
    for manufacturer in MANUFACTURER_INDEX.keys():
        if manufacturer and manufacturer in spoken:
            return manufacturer
    return None


def _equipment_candidate(equipment: dict, score: int) -> dict:
    record_id = str(equipment.get("Record Id") or "").replace("zcrm_", "").strip()
    return {
        "record_id": record_id,
        "name": str(equipment.get("Equipment Name") or "").strip(),
        "manufacturer": str(equipment.get("Manufacturer Name") or "").strip(),
        "equipment_link": str(equipment.get("Equipment Link") or "").strip(),
        "score": score,
    }


def resolve_equipment_match(extracted_text: str | None, limit: int = 3) -> dict:
    raw = str(extracted_text or "").strip()
    spoken = canonicalize_equipment(raw)
    if not spoken:
        return {"status": "UNRESOLVED", "best_match": None, "matches": []}

    spoken_tokens = set(spoken.split())
    spoken_nums = extract_numbers(spoken)
    manufacturer_key = extract_manufacturer(raw)
    candidates = MANUFACTURER_INDEX.get(manufacturer_key, []) if manufacturer_key else EQUIPMENT_DB

    scored: list[tuple[int, dict]] = []
    for equipment in candidates:
        score = 0
        equipment_name = str(equipment.get("Equipment Name") or "")
        name_norm = canonicalize_equipment(equipment_name)
        equip_tokens = set(name_norm.split())
        equip_nums = extract_numbers(name_norm)

        score += len(equip_tokens & spoken_tokens) * 3

        if spoken_nums and equip_nums:
            if spoken_nums == equip_nums:
                score += 15
            elif any(num in equip_nums for num in spoken_nums):
                score += 8
            else:
                score -= 5

        for alias in equipment.get("Aliases", []) or []:
            alias_norm = canonicalize_equipment(alias)
            alias_tokens = set(alias_norm.split())
            if alias_tokens and alias_tokens.issubset(spoken_tokens):
                score += 6

        manufacturer = normalize_text(equipment.get("Manufacturer Name"))
        if manufacturer and manufacturer in spoken:
            score += 3

        if score > 0:
            scored.append((score, equipment))

    scored.sort(key=lambda item: item[0], reverse=True)
    top = [_equipment_candidate(equipment, score) for score, equipment in scored[: max(limit, 1)]]
    best = top[0] if top else None

    if not best or best["score"] < 4:
        return {"status": "UNRESOLVED", "best_match": None, "matches": top}

    best_norm = canonicalize_equipment(best["name"])
    best_nums = extract_numbers(best_norm)
    if spoken_nums and not any(num in best_nums for num in spoken_nums):
        return {"status": "UNRESOLVED", "best_match": None, "matches": top}

    best["confidence"] = "high" if best["score"] >= 15 else "medium" if best["score"] >= 8 else "low"
    return {"status": "MATCHED", "best_match": best, "matches": top}


def normalize_free_text_list(raw: str | list[str] | None) -> list[str]:
    if isinstance(raw, list):
        values = raw
    else:
        values = re.split(r"[\r\n,;]+", str(raw or ""))
    seen = set()
    out: list[str] = []
    for value in values:
        item = str(value or "").strip()
        key = item.lower()
        if not item or key in seen:
            continue
        seen.add(key)
        out.append(item)
    return out


def join_free_text_list(raw: str | list[str] | None) -> str:
    return ", ".join(normalize_free_text_list(raw))


def token_match(a: str | None, b: str | None, threshold: float = 0.6) -> bool:
    a_tokens = set(normalize_text(a).split())
    b_tokens = set(normalize_text(b).split())
    if not a_tokens or not b_tokens:
        return False
    overlap = len(a_tokens & b_tokens) / max(len(a_tokens), len(b_tokens))
    return overlap >= threshold


def resolve_material_alias(material_text: str | None) -> dict:
    spoken = normalize_text(material_text)
    if not spoken:
        return {"status": "UNRESOLVED"}

    for generic, block in MATERIAL_MAP.items():
        for material in block.get("materials", []) or []:
            if not isinstance(material, dict):
                continue
            brand = str(material.get("brand_name") or "").strip()
            brand_norm = normalize_text(brand)
            if brand_norm and (spoken in brand_norm or brand_norm in spoken or token_match(spoken, brand_norm, 0.75)):
                return {
                    "status": "MATCHED",
                    "brand_name": brand,
                    "generic": generic,
                    "material_class": str(material.get("class") or "").strip(),
                    "material_family": str(material.get("family") or "").strip(),
                    "material_type": str(material.get("type") or "").strip(),
                }

    for generic, block in MATERIAL_MAP.items():
        aliases = block.get("aliases", []) or []
        for alias in aliases:
            alias_norm = normalize_text(alias)
            if alias_norm and (spoken in alias_norm or alias_norm in spoken or token_match(spoken, alias_norm, 0.75)):
                brands = [
                    str(item.get("brand_name") or "").strip()
                    for item in (block.get("materials") or [])
                    if isinstance(item, dict) and str(item.get("brand_name") or "").strip()
                ]
                if len(brands) == 1:
                    return {"status": "MATCHED", "brand_name": brands[0], "generic": generic}
                if brands:
                    return {"status": "AMBIGUOUS", "generic": generic, "options": brands}

    for generic, block in MATERIAL_MAP.items():
        generic_norm = normalize_text(generic)
        if generic_norm and (spoken in generic_norm or generic_norm in spoken or token_match(spoken, generic_norm, 0.75)):
            brands = [
                str(item.get("brand_name") or "").strip()
                for item in (block.get("materials") or [])
                if isinstance(item, dict) and str(item.get("brand_name") or "").strip()
            ]
            if len(brands) == 1:
                return {"status": "MATCHED", "brand_name": brands[0], "generic": generic}
            if brands:
                return {"status": "AMBIGUOUS", "generic": generic, "options": brands}

    return {"status": "UNRESOLVED"}


def encode_machine_notes(notes: str | None, manufacturer: str | None = "", serial_text: str | None = "") -> str:
    base = str(notes or "").strip()
    meta = []
    if str(manufacturer or "").strip():
        meta.append(f"Manufacturer: {str(manufacturer).strip()}")
    if str(serial_text or "").strip():
        meta.append(f"Serial: {str(serial_text).strip()}")
    meta_block = "\n".join(meta).strip()
    if meta_block and base:
        return f"{meta_block}\n\n{base}".strip()
    return meta_block or base


def decode_machine_notes(raw_notes: str | None) -> dict:
    raw = str(raw_notes or "").strip()
    if not raw:
        return {"manufacturer": "", "serial_text": "", "notes": ""}
    lines = raw.splitlines()
    manufacturer = ""
    serial_text = ""
    body_start = 0
    for idx, line in enumerate(lines):
        clean = line.strip()
        lower = clean.lower()
        if lower.startswith("manufacturer:"):
            manufacturer = clean.split(":", 1)[1].strip()
            body_start = idx + 1
            continue
        if lower.startswith("serial:"):
            serial_text = clean.split(":", 1)[1].strip()
            body_start = idx + 1
            continue
        if not clean and idx <= body_start:
            body_start = idx + 1
            continue
        break
    notes = "\n".join(lines[body_start:]).strip()
    return {"manufacturer": manufacturer, "serial_text": serial_text, "notes": notes}
