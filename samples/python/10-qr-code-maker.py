# Make a QR code from a short text or URL; download it as a crisp SVG.
# The browser fetches this small pure-Python package automatically on first run.
import micropip
await micropip.install("qrcode==8.2")

import qrcode
from qrcode.image.svg import SvgPathImage

text = input("Text or URL for the QR code: ").strip()
if not text:
    print("Enter some text or a URL and restart the app.")
else:
    image = qrcode.make(text, image_factory=SvgPathImage, box_size=8, border=4)
    output = "qr-code.svg"
    image.save(output)
    print("QR code created. Download the SVG below.")
    ams_download(output)
