"""Split the square app icon into Android adaptive icon layers.

Android masks launcher icons into circles, squircles, or rounded squares and only guarantees the
central 66/108 of the layer stays visible. The square icon's bag would lose its corners, so this
renders the bag alone on a transparent, smaller foreground, the gradient alone as the background,
and a single-colour silhouette for Android 13+ themed icons.

Needs Pillow and NumPy:  python3 scripts/make-android-icon.py
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

assets = Path(__file__).resolve().parents[1] / 'assets'
source = Image.open(assets / 'shoppendo-icon-square.png').convert('RGB')
size = source.width
pixels = np.asarray(source).astype(np.float64)

# Everything the gradient reaches from outside the bag (and inside its handle) is background.
# copy(): images made by fromarray share NumPy's buffer and are read-only, so floodfill would be a no-op.
white = Image.fromarray(((pixels.min(axis=2) > 245) * 255).astype(np.uint8)).copy()
for seed in [(0, 0), (size - 1, size - 1), (size // 2, int(size * 0.33))]:  # corners and the handle opening
    ImageDraw.floodfill(white, seed, 128)
background_region = np.asarray(white) == 128

# Fit a smooth quadratic gradient to clearly-background pixels and render it without the bag.
ys, xs = np.mgrid[0:size, 0:size] / size
features = np.stack([np.ones_like(xs), xs, ys, xs * xs, ys * ys, xs * ys], axis=-1)
strict = background_region & (pixels.min(axis=2) < 200)
# Normal equations via einsum: some NumPy/Accelerate builds return garbage from large matmuls.
known, values = features[strict], pixels[strict]
coefficients = np.linalg.solve(np.einsum('ni,nj->ij', known, known), np.einsum('ni,nc->ic', known, values))
gradient = np.clip(np.einsum('yxi,ic->yxc', features, coefficients), 0, 255)
Image.fromarray(gradient.astype(np.uint8)).save(assets / 'android-icon-background.png')

# Foreground: the bag in its original colours; anti-aliased edges become partly transparent white.
edge = np.clip(((pixels - gradient) / np.maximum(255 - gradient, 1)).mean(axis=2), 0, 1)
edge = np.clip((edge - 0.08) / 0.92, 0, 1)  # ignore faint residue where the fitted gradient is slightly off
alpha = np.where(background_region, edge, 1.0)
colour = np.where(background_region[..., None], 255.0, pixels)
layer = Image.fromarray(np.dstack([colour, alpha * 255]).astype(np.uint8))

# Themed icon: white parts only, so the list lines read as cut-outs.
whiteness = np.clip((pixels.min(axis=2) - 31) / (255 - 31), 0, 1)
mono_alpha = np.where(background_region, edge, whiteness)
mono = Image.fromarray(np.dstack([np.full_like(mono_alpha, 255)] * 3 + [mono_alpha * 255]).astype(np.uint8))

# Shrink so the bag's farthest corner (0.375 of the width from centre) sits well inside the
# 33/108 safe-zone radius, with a little breathing room under circle masks.
scale = 0.72
def centred(image: Image.Image) -> Image.Image:
    inner = image.resize((round(size * scale),) * 2, Image.Resampling.LANCZOS)
    canvas = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(inner, ((size - inner.width) // 2,) * 2)
    return canvas
centred(layer).save(assets / 'android-icon-foreground.png')
centred(mono).save(assets / 'android-icon-monochrome.png')
print('Wrote android-icon-background.png, android-icon-foreground.png, android-icon-monochrome.png')
