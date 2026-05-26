import google.generativeai as genai
genai.configure(api_key="AIzaSyBdfpTsqpdL5aVdFVQ4o_kTfWrXlPOZerw")
#(api_key="AIzaSyDO9Fuz31W50k27Dho-yxPgTN-JBJAdRmk")

print("Listing available models for your key:")
for m in genai.list_models():
    print(f" > {m.name}")