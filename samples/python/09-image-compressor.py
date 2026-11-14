# Compress an image in the visitor's browser, then download the smaller JPEG.
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

    # Resize very large phone photos before encoding. Change this limit or the
    # quality below to tune the balance between size and detail.
    image.thumbnail((2000, 2000))
    if image.mode in ("RGBA", "LA") or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    else:
        image = image.convert("RGB")

    result = BytesIO()
    image.save(result, format="JPEG", quality=78, optimize=True)
    output = "compressed-image.jpg"
    with open(output, "wb") as handle:
        handle.write(result.getvalue())

    saved = max(0, original_bytes - len(result.getvalue()))
    print(f"Original: {original_size[0]} × {original_size[1]} px, {original_bytes:,} bytes")
    print(f"Compressed: {image.width} × {image.height} px, {len(result.getvalue()):,} bytes")
    print(f"Saved {saved:,} bytes. The original file never left your device.")
    ams_download(output)
