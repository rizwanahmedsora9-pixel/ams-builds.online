# A chart in a picture, using matplotlib (bundled with the interpreter).
# The first run downloads matplotlib (a few MB); the browser caches it after
# that. plt.show() draws the figure into the terminal.
import matplotlib.pyplot as plt

months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun"]
rain = [9, 7, 11, 6, 4, 2]

fig, ax = plt.subplots(figsize=(6, 3.2), dpi=110)
ax.bar(months, rain, color="#2ea043")
ax.set_title("Rainy days")
ax.set_ylabel("days")
ax.spines[["top", "right"]].set_visible(False)
fig.tight_layout()
plt.show()

print("Total:", sum(rain), "days")
