# Pick one or more pictures, get a single PDF back.
# Pillow (PIL) is bundled with the interpreter; the first run downloads it.
from PIL import Image

paths = ams_pick_file("image/*", multiple=True)
if not paths:
    print("No image chosen.")
else:
    pages = []
    for path in paths:
        picture = Image.open(path).convert("RGB")
        # A very large phone photo would make a very large PDF; fit it in.
        picture.thumbnail((1600, 1600))
        pages.append(picture)
    first, rest = pages[0], pages[1:]
    first.save("images.pdf", "PDF", save_all=True, append_images=rest, resolution=120)
    print(f"Made images.pdf from {len(pages)} image(s).")
    ams_download("images.pdf", "images.pdf")
