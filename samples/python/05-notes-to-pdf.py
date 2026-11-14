# Type some notes, get a PDF back. Standard library only: the file is built
# by hand, so nothing has to be downloaded beyond the interpreter itself.
# (A printer-friendly version of the same idea is in 07-report.py.)

def pdf_escape(text):
    return text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def note_pdf(lines, path="notes.pdf"):
    # One page, A4 (595 x 842 points), Helvetica, plain text at the top.
    content = ["BT", "/F1 12 Tf", "56 780 Td", "16 TL"]
    for line in lines:
        content.append(f"({pdf_escape(line)}) Tj")
        content.append("T*")
    content.append("ET")
    stream = "\n".join(content).encode("latin-1", "replace")

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for index, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += str(index).encode() + b" 0 obj\n" + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 " + str(len(objects) + 1).encode() + b"\n0000000000 65535 f \n"
    for offset in offsets:
        out += f"{offset:010d} 00000 n \n".encode()
    out += (
        b"trailer\n<< /Size " + str(len(objects) + 1).encode() + b" /Root 1 0 R >>\n"
        b"startxref\n" + str(xref).encode() + b"\n%%EOF\n"
    )
    with open(path, "wb") as handle:
        handle.write(bytes(out))
    return path


print("Notes to PDF. Type each line; an empty line finishes the note.")
lines = []
while True:
    line = input("> ")
    if not line.strip():
        break
    lines.append(line)

if not lines:
    print("Nothing to write down.")
else:
    made = note_pdf(lines)
    print(f"Made a PDF with {len(lines)} line(s).")
    ams_download(made, "my-notes.pdf")
