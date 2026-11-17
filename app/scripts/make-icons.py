"""Genera los iconos PNG de la PWA (marca ENVCA). Uso: npm run icons"""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
NAVY = (18, 49, 92)
AMBER = (242, 169, 0)
WHITE = (255, 255, 255)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def icono(size, safe=1.0, redondeado=False):
    S = size * 4  # supermuestreo
    img = Image.new('RGBA', (S, S), NAVY + (255,))
    d = ImageDraw.Draw(img)
    # zona segura (maskable: contenido dentro del 80 % central)
    cx = S / 2
    w = S * 0.74 * safe
    # franja ámbar inferior
    bar_h = S * 0.035 * safe
    # texto ENVCA
    fs = 10
    while True:
        f = ImageFont.truetype(FONT, fs)
        bb = d.textbbox((0, 0), 'ENVCA', font=f)
        if bb[2] - bb[0] >= w:
            break
        fs += 2
    f = ImageFont.truetype(FONT, fs)
    bb = d.textbbox((0, 0), 'ENVCA', font=f)
    tw, th = bb[2] - bb[0], bb[3] - bb[1]
    ty = S / 2 - th / 2 - S * 0.04 * safe
    d.text((cx - tw / 2 - bb[0], ty - bb[1]), 'ENVCA', font=f, fill=WHITE)
    by = ty + th + S * 0.06 * safe
    d.rounded_rectangle((cx - tw / 2, by, cx + tw / 2, by + bar_h), radius=bar_h / 2, fill=AMBER)
    img = img.resize((size, size), Image.LANCZOS)
    if redondeado:
        m = Image.new('L', (size, size), 0)
        ImageDraw.Draw(m).rounded_rectangle((0, 0, size, size), radius=size * 0.2, fill=255)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(img, (0, 0), m)
        return out
    return img.convert('RGB')


os.makedirs(OUT, exist_ok=True)
icono(192, 1.0, True).save(os.path.join(OUT, 'icon-192.png'))
icono(512, 1.0, True).save(os.path.join(OUT, 'icon-512.png'))
icono(512, 0.8).save(os.path.join(OUT, 'maskable-512.png'))
icono(180, 0.95).save(os.path.join(OUT, 'apple-touch-icon.png'))   # iOS aplica sus propias esquinas
icono(64, 1.0, True).save(os.path.join(OUT, 'favicon.png'))
print('ok')
