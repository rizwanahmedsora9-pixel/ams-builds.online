# A chart drawn in the terminal, with no package to download.
# It only uses the standard library, so it starts fast.

def bars(values, width=40):
    top = max(values.values())
    for label, value in values.items():
        filled = round(value / top * width)
        print(f"{label:>3} |{'#' * filled} {value}")

print("Rainy days per month (made-up numbers)")
bars({m: n for m, n in zip(
    "Jan Feb Mar Apr May Jun".split(),
    [9, 7, 11, 6, 4, 2],
)})

total = sum([9, 7, 11, 6, 4, 2])
print(f"\nTotal: {total} days")
