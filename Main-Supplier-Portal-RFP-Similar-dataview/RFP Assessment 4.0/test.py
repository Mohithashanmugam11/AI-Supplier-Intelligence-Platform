import requests
import os
from dotenv import load_dotenv
 
load_dotenv()
 
ACCESS_TOKEN = os.getenv("ZOHO_ACCESS_TOKEN")
 
url = "https://www.zohoapis.com/crm/v2/Deals"
 
headers = {
    "Authorization": f"Zoho-oauthtoken {ACCESS_TOKEN}"
}
 
res = requests.get(url, headers=headers)
 
print("STATUS:", res.status_code)
print("RESPONSE:", res.text)