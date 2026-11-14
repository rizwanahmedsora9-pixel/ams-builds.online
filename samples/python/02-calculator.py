# A small calculator: functions, input() inside a function, and a loop.
# Type an expression such as 12 * 3 or 7 / 2, and "q" to stop.

def calculate(text):
    allowed = set("0123456789 +-*/().%")
    if not set(text) <= allowed:
        return "Only numbers and + - * / ( ) % are allowed here."
    try:
        return eval(text)  # safe enough: the characters were checked above
    except ZeroDivisionError:
        return "That would divide by zero."
    except Exception:
        return "That is not something I can calculate."


print("Calculator. Type an expression, or q to quit.")
while True:
    line = input("> ")
    if line.strip().lower() == "q":
        print("Bye.")
        break
    print("=", calculate(line))
