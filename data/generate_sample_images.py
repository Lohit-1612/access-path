import os
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

def create_sample_images():
    out_dir = Path(__file__).resolve().parent / "sample_images"
    out_dir.mkdir(parents=True, exist_ok=True)

    def base_canvas(w=640, h=480, sky_color=(180, 210, 240), ground_color=(140, 140, 140)):
        img = Image.new("RGB", (w, h), sky_color)
        draw = ImageDraw.Draw(img)
        # Ground / walkway
        draw.polygon([(0, 200), (w, 200), (w, h), (0, h)], fill=ground_color)
        # Footpath perspective lines
        draw.polygon([(180, 200), (460, 200), (580, h), (60, h)], fill=(200, 200, 205))
        # Sidewalk curbs
        draw.line([(180, 200), (60, h)], fill=(100, 100, 100), width=4)
        draw.line([(460, 200), (580, h)], fill=(100, 100, 100), width=4)
        return img, draw

    # 1. Construction Barrier (East Footpath Blockage Demo Image)
    img1, draw1 = base_canvas()
    # Orange and white striped barrier
    draw1.rectangle([200, 240, 440, 360], fill=(230, 80, 20), outline=(50, 50, 50), width=3)
    for x in range(210, 430, 40):
        draw1.polygon([(x, 240), (x + 20, 240), (x + 10, 360), (x - 10, 360)], fill=(255, 255, 255))
    # Barrier legs
    draw1.rectangle([220, 360, 240, 420], fill=(60, 60, 60))
    draw1.rectangle([400, 360, 420, 420], fill=(60, 60, 60))
    # Text badge
    draw1.rectangle([230, 280, 410, 320], fill=(20, 20, 20))
    draw1.text((250, 290), "ROAD WORK AHEAD", fill=(255, 220, 0))
    img1.save(out_dir / "construction_east_path.jpg", quality=90)

    # 2. Flight of Stairs
    img2, draw2 = base_canvas(ground_color=(120, 120, 120))
    for i, y in enumerate(range(200, 420, 25)):
        color = (160 - i * 5, 160 - i * 5, 165 - i * 5)
        draw2.rectangle([140 - i * 8, y, 500 + i * 8, y + 25], fill=color, outline=(70, 70, 70), width=2)
    # Handrail
    draw2.line([(140, 180), (80, 420)], fill=(40, 40, 40), width=6)
    draw2.line([(500, 180), (560, 420)], fill=(40, 40, 40), width=6)
    img2.save(out_dir / "stairs_flight.jpg", quality=90)

    # 3. Pothole / Damaged Surface
    img3, draw3 = base_canvas()
    # Irregular pothole
    draw3.ellipse([260, 310, 420, 390], fill=(60, 50, 45), outline=(30, 25, 20), width=4)
    draw3.ellipse([280, 325, 390, 375], fill=(35, 30, 25))
    draw3.line([(250, 330), (220, 340)], fill=(50, 40, 35), width=2)
    draw3.line([(430, 340), (460, 360)], fill=(50, 40, 35), width=2)
    img3.save(out_dir / "pothole_path.jpg", quality=90)

    # 4. Clear Accessible Path (Negative Control)
    img4, draw4 = base_canvas()
    # Add green trees and smooth step-free ramp indicator
    draw4.ellipse([50, 80, 150, 220], fill=(40, 120, 40))
    draw4.ellipse([490, 80, 590, 220], fill=(40, 120, 40))
    draw4.text((220, 420), "SURVEYED STEP-FREE PATH", fill=(0, 100, 0))
    img4.save(out_dir / "clear_accessible_path.jpg", quality=90)

    print(f"Generated 4 sample test images in {out_dir}")

if __name__ == "__main__":
    create_sample_images()
