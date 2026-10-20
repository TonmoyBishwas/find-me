"""Generate black & white character concept sheets with Gemini.

Reads GEMINI_API_KEY from .env (never committed). Tracks spend in characters/gemini/spend.json.
Usage: python scripts/gen_characters.py
"""
import base64, json, os, pathlib, sys, urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "characters" / "gemini"
MODEL = "gemini-2.5-flash-image"
PRICE_PER_OUTPUT_TOKEN = 30 / 1_000_000   # image output
PRICE_PER_INPUT_TOKEN = 0.30 / 1_000_000
BUDGET_STOP = 0.38                         # leave headroom under the $0.50 cap

def load_key():
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="):
            return line.split("=", 1)[1].strip()
    sys.exit("GEMINI_API_KEY missing in .env")

BASE = ("Pure black ink on a pure white background, no grey fills, no color, no shading gradients, "
        "flat 2D, clean thick outlines, simple and readable at small size, full body, "
        "character turnaround style sheet, no text, no labels, no watermark. ")

STYLES = {
    "01_classic_stick":   "Four classic stick-figure students side by side: a male and a female (female has a ponytail and a skirt-shaped triangle body), each shown standing and mid-walk. Round circle heads, simple dot eyes and smile.",
    "02_bean_body":       "Four cute bean-shaped cartoon students (pill shaped bodies with stick arms and legs): a male with short spiky hair and a backpack, a female with a bun and a tote bag, each shown standing and walking.",
    "03_xkcd_minimal":    "Four ultra-minimal xkcd-style line figures: a male with a cap and a female with long straight hair, each shown standing and walking, very thin consistent strokes, blank circle faces.",
    "04_chibi":           "Four chibi students with big round heads and small bodies: a male with messy hair and glasses holding a laptop, a female with twin braids holding books, standing and walking poses.",
    "05_silhouette":      "Four solid black silhouette student figures in a bold pictogram style like airport signage: a male with a backpack and a female with a ponytail and backpack, standing and walking.",
    "06_doodle_marker":   "Four hand-drawn marker doodle students, notebook sketch style with slightly wobbly lines: a male in a hoodie and a female with a headscarf (hijab), standing and waving and walking.",
    "07_peanuts_comic":   "Four classic newspaper comic strip style kids-as-university-students: a male in a striped t-shirt and a female in a dress with a short bob haircut, standing and walking poses.",
    "08_geometric":       "Four geometric minimalist figures built from circles, triangles and rectangles: a male (rectangle torso) and a female (triangle dress torso, long hair), standing and walking, Bauhaus style.",
    "09_lively_stick":    "Four expressive stick figures with thick limbs and big expressive faces: a male with a hand raised waving 'over here!' and a female looking around searching with a hand over her eyes, plus each walking.",
}

def generate(key, name, prompt):
    body = {"contents": [{"parts": [{"text": BASE + prompt}]}],
            "generationConfig": {"responseModalities": ["IMAGE"]}}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
        data=json.dumps(body).encode(), method="POST",
        headers={"Content-Type": "application/json", "x-goog-api-key": key})
    with urllib.request.urlopen(req, timeout=180) as r:
        data = json.load(r)
    usage = data.get("usageMetadata", {})
    cost = (usage.get("promptTokenCount", 0) * PRICE_PER_INPUT_TOKEN
            + usage.get("candidatesTokenCount", 0) * PRICE_PER_OUTPUT_TOKEN)
    saved = False
    for cand in data.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            if "inlineData" in part:
                ext = "png" if "png" in part["inlineData"]["mimeType"] else "jpg"
                (OUT / f"{name}.{ext}").write_bytes(base64.b64decode(part["inlineData"]["data"]))
                saved = True
    return cost, usage, saved

def main():
    key = load_key()
    spend_file = OUT / "spend.json"
    spend = json.loads(spend_file.read_text()) if spend_file.exists() else {"total": 0.0, "calls": []}
    only = sys.argv[1:]
    for name, prompt in STYLES.items():
        if only and name not in only:
            continue
        if not only and any(c["name"] == name and c["saved"] for c in spend["calls"]):
            continue
        if spend["total"] >= BUDGET_STOP:
            print("budget stop reached"); break
        try:
            cost, usage, saved = generate(key, name, prompt)
        except Exception as e:
            print(name, "ERROR", e); continue
        spend["total"] += cost
        spend["calls"].append({"name": name, "cost": round(cost, 5), "saved": saved, "usage": usage})
        spend_file.write_text(json.dumps(spend, indent=2))
        print(f"{name}: saved={saved} cost=${cost:.4f} total=${spend['total']:.4f}")

if __name__ == "__main__":
    main()
