import os
import requests
from dotenv import load_dotenv

load_dotenv()

ZOHO_CLIENT_ID = os.getenv("ZOHO_CLIENT_ID")
ZOHO_CLIENT_SECRET = os.getenv("ZOHO_CLIENT_SECRET")
ZOHO_REFRESH_TOKEN = os.getenv("ZOHO_REFRESH_TOKEN")

url = "https://accounts.zoho.com/oauth/v2/token"

params = {
    "refresh_token": ZOHO_REFRESH_TOKEN,
    "client_id": ZOHO_CLIENT_ID,
    "client_secret": ZOHO_CLIENT_SECRET,
    "grant_type": "refresh_token"
}

res = requests.post(url, params=params)
data = res.json()

print("STATUS:", res.status_code)
print("FULL RESPONSE:", data)

# ✅ Extract access token
if "access_token" in data:
    print("\n✅ NEW ACCESS TOKEN:")
    print(data["access_token"])
else:
    print("\n❌ FAILED — CHECK CREDENTIALS")