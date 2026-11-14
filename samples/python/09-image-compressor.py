# Compress an image in the visitor's browser to a 100 KB JPEG, then download it.
# Pillow (PIL) is bundled with Pyodide; no Python install or server upload.
from PIL import Image
from io import BytesIO

source = ams_pick_file("image/*")
if not source:
    print("No image chosen.")
else:
    image = Image.open(source)
    original_size = image.width, image.height
    original_bytes = len(open(source, "rb").read())
    target_bytes = 100 * 1024
    max_edge = 2000

    # Flatten transparency onto white before JPEG encoding.
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")

    def encode(picture, quality):
        buffer = BytesIO()
        picture.save(buffer, format="JPEG", quality=quality, optimize=True)
        return buffer.getvalue()

    # Search quality first; if even the lowest quality is too big, reduce the
    # long edge and try again. The original pixels are resized each round.
    base = image
    best = None
    edge = min(max_edge, max(base.size))
    while edge >= 1:
        scale = min(1, edge / max(base.size))
        size = (max(1, round(base.width * scale)), max(1, round(base.height * scale)))
        candidate = base.resize(size, Image.LANCZOS) if size != base.size else base
        high = encode(candidate, 90)
        if len(high) <= target_bytes:
            best = (high, size, 90)
            break
        low = encode(candidate, 5)
        if len(low) <= target_bytes:
            best = (low, size, 5)
            lo_quality, hi_quality = 5, 90
            for _ in range(6):
                mid = (lo_quality + hi_quality) // 2
                data = encode(candidate, mid)
                if len(data) <= target_bytes:
                    best = (data, size, mid)
                    lo_quality = mid
                else:
                    hi_quality = mid
            break
        if edge <= 1:
            break
        factor = min(0.85, (target_bytes / len(low)) ** 0.5 * 0.92)
        next_edge = max(1, int(edge * factor))
        edge = next_edge if next_edge < edge else edge - 1

    if best is None:
        print("Could not reach the 100 KB target in this browser.")
    else:
        data, (width, height), quality = best
        output = "compressed-image.jpg"
        with open(output, "wb") as handle:
            handle.write(data)
        saved = max(0, original_bytes - len(data))
        print(f"Original: {original_size[0]} × {original_size[1]} px, {original_bytes:,} bytes")
        print(f"Compressed: {width} × {height} px, {len(data):,} bytes (JPEG quality {quality}, target 100 KB)")
        print(f"Saved {saved:,} bytes. The original file never left your device.")
        ams_download(output)
