# A clickable calculator built with the Python app's browser GUI.
# Choose this sample in the Python app dialog, insert it, and publish the post.
# ams_gui displays controls and returns the clicked button. It is not tkinter.
print("Loading calculator...")

keys = [
    ("clear", "AC"), ("sign", "+/-"), ("percent", "%"), ("/", "÷"),
    ("7", "7"), ("8", "8"), ("9", "9"), ("*", "×"),
    ("4", "4"), ("5", "5"), ("6", "6"), ("-", "−"),
    ("1", "1"), ("2", "2"), ("3", "3"), ("+", "+"),
    ("0", "0"), (".", "."), ("back", "⌫"), ("=", "="),
    ("quit", "Close"),
]
buttons = [{"id": key, "label": label, "primary": key == "="} for key, label in keys]
display = "0"
first = None
operator = None
fresh = False

while True:
    event = ams_gui({"title": "Calculator", "display": display, "columns": 4, "buttons": buttons})
    key = event.get("action", "quit")
    if key == "quit":
        break
    if key == "clear":
        display, first, operator, fresh = "0", None, None, False
    elif key in "0123456789" and len(key) == 1:
        if fresh or display in ("0", "Error"):
            display = key
        elif len(display) < 16:
            display += key
        fresh = False
    elif key == ".":
        if fresh or display == "Error":
            display = "0"
        if "." not in display:
            display += "."
        fresh = False
    elif key == "back":
        display = display[:-1] or "0"
    elif key in ("sign", "percent"):
        try:
            number = float(display)
            display = format(-number if key == "sign" else number / 100, ".12g")
        except ValueError:
            display = "Error"
    elif key in ("+", "-", "*", "/"):
        try:
            first = float(display)
            operator = key
            fresh = True
        except ValueError:
            display = "Error"
    elif key == "=" and first is not None and operator:
        try:
            number = float(display)
            if operator == "+": result = first + number
            elif operator == "-": result = first - number
            elif operator == "*": result = first * number
            else: result = first / number
            display = format(result, ".12g")
        except (ValueError, ZeroDivisionError, OverflowError):
            display = "Error"
        first, operator, fresh = None, None, True
print("Calculator closed.")
