import google.generativeai as genai
genai.configure(api_key="")
#(api_key="")

print("Listing available models for your key:")
for m in genai.list_models():
    print(f" > {m.name}")
