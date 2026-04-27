"""
Bomber Boat — regenerate Instagram profile pic + post image from scratch.
Run: python make_images.py  → outputs bomberboat-profile.png + bomberboat-post.png next to this file.
Pillow auto-installed if missing.
"""
import subprocess, sys, os

print(f"Python: {sys.executable}")
out = os.path.dirname(os.path.abspath(__file__))
print(f"Saving to: {out}")

# Auto-install Pillow if needed
try:
    from PIL import Image, ImageDraw, ImageFont
    print("Pillow: OK")
except ImportError:
    print("Installing Pillow...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "Pillow"])
    from PIL import Image, ImageDraw, ImageFont
    print("Pillow: installed")

size = 1080

# Profile pic
img = Image.new("RGB", (size, size), (18, 18, 18))
draw = ImageDraw.Draw(img)
draw.ellipse([60, 60, 1020, 1020], fill=(204, 0, 0))
draw.ellipse([120, 120, 960, 960], fill=(255, 255, 255))
cx, cy = 540, 540
draw.polygon([(cx-280,cy+80),(cx+280,cy+80),(cx+220,cy+150),(cx-220,cy+150)], fill=(18,18,18))
draw.polygon([(cx-100,cy-60),(cx+100,cy-60),(cx+80,cy+80),(cx-80,cy+80)], fill=(18,18,18))
draw.rectangle([cx-8, cy-200, cx+8, cy-60], fill=(18,18,18))
draw.polygon([(cx+8,cy-200),(cx+80,cy-170),(cx+8,cy-140)], fill=(204,0,0))
p1 = os.path.join(out, "bomberboat-profile.png")
img.save(p1)
print(f"Saved: {p1}  ({os.path.getsize(p1):,} bytes)")

# Post image
img2 = Image.new("RGB", (size, size), (15, 15, 15))
draw2 = ImageDraw.Draw(img2)
draw2.ellipse([240, 180, 840, 780], fill=(204, 0, 0))
draw2.ellipse([270, 210, 810, 750], fill=(15, 15, 15))

try:
    fb = ImageFont.truetype("arialbd.ttf", 130)
    fr = ImageFont.truetype("arialbd.ttf", 120)
    ft = ImageFont.truetype("arial.ttf", 42)
except:
    try:
        fb = ImageFont.truetype("DejaVuSans-Bold.ttf", 130)
        fr = ImageFont.truetype("DejaVuSans-Bold.ttf", 120)
        ft = ImageFont.truetype("DejaVuSans.ttf", 42)
    except:
        fb = fr = ft = ImageFont.load_default()

draw2.text((540, 390), "BOMBER", font=fb, fill=(255,255,255), anchor="mm")
draw2.text((540, 540), "BOAT",   font=fr, fill=(204,0,0),     anchor="mm")
draw2.text((540, 840), "YARRA RIVER · GAME DAY", font=ft, fill=(160,160,160), anchor="mm")
draw2.text((540, 900), "bomberboat.com.au", font=ft, fill=(204,0,0), anchor="mm")
p2 = os.path.join(out, "bomberboat-post.png")
img2.save(p2)
print(f"Saved: {p2}  ({os.path.getsize(p2):,} bytes)")

print("\nDone! Both files are in:", out)
input("Press Enter to close...")
