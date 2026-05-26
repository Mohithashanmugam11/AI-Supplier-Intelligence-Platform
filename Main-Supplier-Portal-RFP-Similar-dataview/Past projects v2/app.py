from flask import Flask, jsonify, request
import requests, os, json, time
from dotenv import load_dotenv
from flask_cors import CORS
from google import genai
from google.genai import types
from pathlib import Path

load_dotenv()
print("GEMINI KEY:", bool(os.getenv("GEMINI_API_KEY")))
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash-lite")
GEMINI_JSON_CONFIG = types.GenerateContentConfig(
    response_mime_type="application/json",
    temperature=0.2,
    max_output_tokens=1000,
)

app = Flask(__name__)
CORS(app)

ZOHO_CLIENT_ID     = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN")
BASE_URL           = "https://www.zohoapis.com"

access_token_cache = None
token_time         = None
projects_cache     = {"data": None, "time": 0}
ai_cache           = {}
STATE_FILE         = Path(__file__).with_name("app_state.json")
saved_ai_fields    = {}


def _state_key(project_name, customer):
    return f"{str(project_name or '').strip().lower()}|{str(customer or '').strip().lower()}"


def _load_state():
    global saved_ai_fields
    try:
        if STATE_FILE.exists():
            data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
            saved_ai_fields = data.get("ai_fields", {}) if isinstance(data, dict) else {}
    except Exception as e:
        print(f"State load error: {e}")


def _save_state():
    try:
        payload = {"ai_fields": saved_ai_fields}
        STATE_FILE.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"State save error: {e}")


_load_state()

# ── AUTH ──────────────────────────────────────────────────────────────────────
def get_access_token():
    global access_token_cache, token_time
    if access_token_cache and (time.time() - token_time < 3000):
        return access_token_cache
    res = requests.post("https://accounts.zoho.com/oauth/v2/token", data={
        "refresh_token": ZOHO_REFRESH_TOKEN,
        "client_id":     ZOHO_CLIENT_ID,
        "client_secret": ZOHO_CLIENT_SECRET,
        "grant_type":    "refresh_token",
    }, timeout=5)
    access_token_cache = res.json().get("access_token")
    token_time = time.time()
    return access_token_cache

# ── ZOHO FETCH (60s cache) ────────────────────────────────────────────────────
def fetch_supplier_projects():
    global projects_cache
    token   = get_access_token()
    headers = {"Authorization": f"Zoho-oauthtoken {token}"}
    items   = requests.get(f"{BASE_URL}/crm/v2/Supplier_Past_Projects", headers=headers).json().get("data", [])
    result  = []
    for item in items:
        r = requests.get(f"{BASE_URL}/crm/v2/Supplier_Past_Projects/{item['id']}", headers=headers)
        if r.status_code == 200:
            record = r.json()["data"][0]
            if record.get("Index_Ready"):
                continue
            result.append(record)
    projects_cache["data"] = result
    projects_cache["time"] = time.time()
    return result

# ── GEMINI: all project fields in one call ───────────────────────────────────
def generate_all_fields(project_name, customer, parts):
    cache_key = f"all_{project_name}"
    if cache_key in ai_cache:
        return ai_cache[cache_key]

    parts_text = ""
    for i, p in enumerate(parts):
        parts_text += f"""
Part {i+1}: {p.get('part_name','')}
  Process: {p.get('process','')}
  Material: {p.get('material','')}
  Tolerance: {p.get('tolerance','')}
  Outcome: {p.get('outcome','')}
  Existing What Worked: {p.get('what_worked','none')}
  Existing What Failed: {p.get('what_failed','none')}
"""

    prompt = f"""Create high-signal supplier project notes from the records.

Project: {project_name}
Customer: {customer}
{parts_text}

Rules: be specific to process/material/tolerance; no generic filler. Reuse existing worked/failed text when present; otherwise infer a practical note from the part record.
Return JSON only:
{{"overview":"<=35 words, supplier-view summary","parts":[{{"what_worked":"<=22 words","what_failed":"<=22 words","quoting_lesson":"<=22 words on cost/risk/schedule"}}]}}
parts must contain exactly {len(parts)} objects in the same order.
"""

    for attempt in range(3):
        try:
            resp = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=GEMINI_JSON_CONFIG,
            )
            text = resp.text.strip().replace("```json","").replace("```","").strip()
            parsed = json.loads(text)
            ai_cache[cache_key] = parsed
            print(f"AI generated for: {project_name}")
            return parsed
        except json.JSONDecodeError as e:
            print(f"JSON parse error attempt {attempt + 1}/3: {e}")
            continue
        except Exception as e:
            if "429" in str(e):
                print(f"Rate limited, waiting 65s...")
                time.sleep(65)
            else:
                print(f"Gemini error: {e}")
                return None
    return None

# ── ROUTES ────────────────────────────────────────────────────────────────────

@app.route("/projects")
def get_projects():
    data     = fetch_supplier_projects()
    projects = []
    for record in data:
        name     = record.get("Name", "")
        supplier = (record.get("Supplier_Name") or {}).get("name", "")
        subform  = record.get("Past_Projects", [])
        saved    = saved_ai_fields.get(_state_key(name, supplier), {})
        saved_parts = {str((p or {}).get("part_id") or "").strip(): (p or {}) for p in saved.get("parts", [])}
        first    = subform[0] if subform else {}

        parts_raw = []
        for i, part in enumerate(subform):
            p1 = part.get("Process_Primary", "")
            p2 = part.get("Process_Secondary", "")
            part_id = str(part.get("id", "")).strip()
            saved_part = saved_parts.get(part_id, {})
            parts_raw.append({
                "part_id":        part_id,
                "part_label":     f"PART-{chr(65+i)}",
                "part_name":      part.get("Project_Name") or part.get("Name", ""),
                "date":           part.get("Project_Date", ""),
                "process":        f"{p1}. Secondary: {p2}" if p2 else p1,
                "material":       part.get("Material", ""),
                "tolerance":      part.get("Tolerance_Class", ""),
                "finish":         part.get("Surface_Finish") or "",
                "outcome":        part.get("Outcome", ""),
                "industry":       part.get("Customer_Industry", ""),
                "what_worked":    part.get("What_Worked") or saved_part.get("what_worked", "") or "",
                "what_failed":    part.get("What_didn_t_work") or saved_part.get("what_failed", "") or "",
                "quoting_lesson": part.get("Quoting_Lesson") or saved_part.get("quoting_lesson", "") or "",
            })

        projects.append({
            "id":            record.get("id"),
            "job_id":        f"JOB-{record.get('id','')[-4:]}",
            "project_name":  name,
            "customer":      supplier,
            "date":          record.get("Created_Time", "")[:7],
            "process_hint":  first.get("Process_Primary", ""),
            "material_hint": first.get("Material", ""),
            "overview":      "",
            "parts":         parts_raw,
            "sharing_tier":  "Attributed",
            "match_pts":     len(subform) * 4,
        })

    return jsonify({"projects": projects})


@app.route("/ai-fields", methods=["POST"])
def ai_fields():
    body      = request.json
    proj_name = body.get("project_name", "")
    customer  = body.get("customer", "")
    parts     = body.get("parts", [])

    result = generate_all_fields(proj_name, customer, parts)

    if not result:
        return jsonify({
            "overview": "",
            "parts": [{"what_worked": "", "what_failed": "", "quoting_lesson": ""} for _ in parts]
        })

    out_parts = []
    for i, part in enumerate(parts):
        ai_part = result.get("parts", [])[i] if i < len(result.get("parts", [])) else {}
        out_parts.append({
            "part_id":        part.get("part_id", ""),
            "what_worked":    part.get("what_worked") or ai_part.get("what_worked", ""),
            "what_failed":    part.get("what_failed") or ai_part.get("what_failed", ""),
            "quoting_lesson": ai_part.get("quoting_lesson", ""),
        })

    saved_ai_fields[_state_key(proj_name, customer)] = {
        "overview": result.get("overview", ""),
        "parts": out_parts,
        "updated_at": time.time(),
    }
    _save_state()

    return jsonify({"overview": result.get("overview", ""), "parts": out_parts})


@app.route("/mfg-lessons", methods=["POST"])
def mfg_lessons_ai():
    body      = request.json
    proj_name = body.get("project_name", "")
    customer  = body.get("customer", "")
    parts     = body.get("parts", [])
    cache_key = f"mfg_{proj_name}"

    if cache_key in ai_cache:
        print(f"MFG cache hit: {proj_name}")
        return jsonify({"lessons": ai_cache[cache_key]})

    parts_text = ""
    for p in parts:
        parts_text += f"""
Part: {p.get('part_name','')}
Process: {p.get('process','')}
Material: {p.get('material','')}
Outcome: {p.get('outcome','')}
What Worked: {p.get('what_worked','none')}
What Failed: {p.get('what_failed','none')}
"""

    prompt = f"""Extract reusable manufacturing lessons from the project.

Project: {proj_name}
Customer: {customer}
{parts_text}

Rules: each lesson must name a concrete driver: setup, tooling, material behavior, inspection, tolerance, heat, supplier/customer coordination, or secondary ops. Avoid generic advice.
Return JSON only. Extract 2-4 lessons:
{{"lessons":[{{"category":"Fixturing|Thermal|Material|Process|Quality","title":"specific short title","desc":"<=28 practical words","source_part":"part name"}}]}}
"""

    for attempt in range(5):
        try:
            resp = client.models.generate_content(
                model=GEMINI_MODEL,
                contents=prompt,
                config=GEMINI_JSON_CONFIG,
            )
            text = resp.text.strip().replace("```json","").replace("```","").strip()
            parsed = json.loads(text)
            lessons = parsed.get("lessons", [])
            ai_cache[cache_key] = lessons
            print(f"MFG lessons generated for: {proj_name} — {len(lessons)} lessons")
            return jsonify({"lessons": lessons})
        except json.JSONDecodeError as e:
            print(f"MFG JSON parse error attempt {attempt + 1}/5: {e}")
            continue
        except Exception as e:
            msg = str(e)
            if "429" in msg:
                # Extract retry delay from error message if available
                import re
                match = re.search(r"retryDelay.*?(\d+)s", msg)
                wait = int(match.group(1)) + 5 if match else 70
                print(f"MFG rate limited, waiting {wait}s...")
                time.sleep(wait)
            else:
                print(f"MFG AI error: {e}")
                return jsonify({"lessons": []})

    return jsonify({"lessons": []})


if __name__ == "__main__":
    app.run(debug=True)
