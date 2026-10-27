"""Gera os ícones da extensão em public/icons (requer Pillow)."""
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"
OUT.mkdir(parents=True, exist_ok=True)
S = 512  # desenha grande e reduz para suavizar as bordas

def gradient():
    img = Image.new("RGBA", (S, S))
    px = img.load()
    a, b, c = (131, 58, 180), (214, 36, 110), (252, 175, 69)
    for y in range(S):
        for x in range(S):
            t = (x + (S - y)) / (2 * S)
            if t < 0.5:
                k = t / 0.5; p, q = a, b
            else:
                k = (t - 0.5) / 0.5; p, q = b, c
            px[x, y] = tuple(int(p[i] + (q[i] - p[i]) * k) for i in range(3)) + (255,)
    return img

base = gradient()
mask = Image.new("L", (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((0, 0, S - 1, S - 1), radius=120, fill=255)
icon = Image.new("RGBA", (S, S), (0, 0, 0, 0))
icon.paste(base, (0, 0), mask)

d = ImageDraw.Draw(icon)
white = (255, 255, 255, 255)
# Seta de download
d.rounded_rectangle((226, 110, 286, 290), radius=22, fill=white)
d.polygon([(150, 250), (362, 250), (256, 362)], fill=white)
# Bandeja
d.rounded_rectangle((128, 390, 384, 426), radius=18, fill=white)

for size in (16, 32, 48, 128):
    icon.resize((size, size), Image.LANCZOS).save(OUT / f"icon-{size}.png")
print("ícones gerados em", OUT)
