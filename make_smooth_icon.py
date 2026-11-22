import os
from PIL import Image, ImageDraw

SRC_IMAGE = "Bullet JLPT N5 Sakura Icon.png"
RES_DIR = os.path.join("android", "app", "src", "main", "res")

LEGACY_SIZES = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192,
}

FG_SIZES = {
    "mipmap-mdpi": 108,
    "mipmap-hdpi": 162,
    "mipmap-xhdpi": 216,
    "mipmap-xxhdpi": 324,
    "mipmap-xxxhdpi": 432,
}


def smooth_squircle_mask(size: int, radius_ratio: float = 0.23, aa_scale: int = 4) -> Image.Image:
    big = size * aa_scale
    radius = int(big * radius_ratio)
    mask_big = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask_big)
    draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=radius, fill=255)
    return mask_big.resize((size, size), Image.Resampling.LANCZOS)


def extract_clean_artwork(path: str) -> Image.Image:
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    gray = img.convert("L")
    px = gray.load()

    top = 0
    while top < h - 1 and sum(px[x, top] for x in range(0, w, max(1, w // 64))) / max(1, (w // max(1, w // 64))) < 35:
        top += 1

    bottom = h - 1
    while bottom > top and sum(px[x, bottom] for x in range(0, w, max(1, w // 64))) / max(1, (w // max(1, w // 64))) < 35:
        bottom -= 1

    left = 0
    while left < w - 1 and sum(px[left, y] for y in range(0, h, max(1, h // 64))) / max(1, (h // max(1, h // 64))) < 35:
        left += 1

    right = w - 1
    while right > left and sum(px[right, y] for y in range(0, h, max(1, h // 64))) / max(1, (h // max(1, h // 64))) < 35:
        right -= 1

    crop_w = max(1, right - left + 1)
    crop_h = max(1, bottom - top + 1)
    pad_x = int(crop_w * 0.02)
    pad_y = int(crop_h * 0.02)

    cropped = img.crop((
        max(0, left + pad_x),
        max(0, top + pad_y),
        min(w, right + 1 - pad_x),
        min(h, bottom + 1 - pad_y),
    )).convert("RGB")

    side = max(cropped.size)
    square = Image.new("RGB", (side, side), (255, 249, 246))
    square.paste(cropped, ((side - cropped.width) // 2, (side - cropped.height) // 2))
    return square


def main() -> None:
    if not os.path.exists(SRC_IMAGE):
        raise FileNotFoundError(f"Missing {SRC_IMAGE} in current directory.")

    art = extract_clean_artwork(SRC_IMAGE)

    for folder, size in LEGACY_SIZES.items():
        out_dir = os.path.join(RES_DIR, folder)
        os.makedirs(out_dir, exist_ok=True)

        full_art = art.resize((size, size), Image.Resampling.LANCZOS).convert("RGBA")
        mask = smooth_squircle_mask(size, radius_ratio=0.22, aa_scale=4)
        smooth_icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        smooth_icon.paste(full_art, (0, 0), mask)

        smooth_icon.save(os.path.join(out_dir, "ic_launcher.png"), "PNG")
        smooth_icon.save(os.path.join(out_dir, "ic_launcher_round.png"), "PNG")

    for folder, fg_size in FG_SIZES.items():
        out_dir = os.path.join(RES_DIR, folder)
        os.makedirs(out_dir, exist_ok=True)

        inner_size = int(fg_size * 0.72)
        resized_art = art.resize((inner_size, inner_size), Image.Resampling.LANCZOS).convert("RGBA")
        inner_mask = smooth_squircle_mask(inner_size, radius_ratio=0.20, aa_scale=4)

        fg_canvas = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
        offset = (fg_size - inner_size) // 2
        fg_canvas.paste(resized_art, (offset, offset), inner_mask)
        fg_canvas.save(os.path.join(out_dir, "ic_launcher_foreground.png"), "PNG")

    values_dir = os.path.join(RES_DIR, "values")
    os.makedirs(values_dir, exist_ok=True)
    with open(os.path.join(values_dir, "ic_launcher_background.xml"), "w", encoding="utf-8") as f:
        f.write(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            "<resources>\n"
            '    <color name="ic_launcher_background">#FFF9F6</color>\n'
            "</resources>\n"
        )

    print("Generated smooth launcher and adaptive foreground icons.")


if __name__ == "__main__":
    main()
