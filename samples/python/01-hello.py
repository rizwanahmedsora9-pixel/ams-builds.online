# The smallest app that proves the terminal works.
# Click "Python app" in the editor, paste this, press "Insert app", save, then
# open the published post. The first run downloads Python (about 12 MB).
print("Hello from Python", __import__("sys").version.split()[0])
name = input("Your name: ")
print(f"Nice to meet you, {name}.")
