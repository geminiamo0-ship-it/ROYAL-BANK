import json
import glob

files = glob.glob(r"C:\Users\Administrator\.gemini\antigravity\scratch\processed_data\questions_chunk_*.json")
found = False

for f in files:
    with open(f, "r", encoding="utf-8") as fp:
        items = json.load(fp)
        for item in items:
            if "muscle weakness and increased urinary volume" in item.get("text_html", ""):
                print("FOUND QUESTION ID:", item.get("id"))
                print("--- RAW TEXT_HTML ---")
                print(item.get("text_html"))
                print("---------------------")
                found = True
                break
    if found:
        break
