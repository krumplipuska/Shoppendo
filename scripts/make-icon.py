"""Render the app's simple vector-style shopping bag mark, with no external assets."""
from pathlib import Path
from PIL import Image, ImageDraw

assets = Path(__file__).resolve().parents[1] / 'assets'
image = Image.new('RGB', (1024, 1024), '#246B4D')
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((266, 343, 758, 805), radius=42, outline='#FFFFFF', width=35)
draw.arc((365, 203, 659, 495), 180, 360, fill='#FFFFFF', width=35)
draw.line((365, 345, 365, 405), fill='#FFFFFF', width=35)
draw.line((659, 345, 659, 405), fill='#FFFFFF', width=35)
draw.ellipse((350, 390, 380, 420), fill='#F1CE6D')
draw.ellipse((644, 390, 674, 420), fill='#F1CE6D')
image.save(assets / 'icon.png')
image.resize((64, 64), Image.Resampling.LANCZOS).save(assets / 'favicon.png')
