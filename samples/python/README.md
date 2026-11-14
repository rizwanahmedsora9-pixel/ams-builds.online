# Sample Python apps

Each file here is a complete app for a post: copy one into the editor's
**Python app** dialog (choose the `.py` file, or paste the text), insert it,
save the post, and open the published post. The program runs in the visitor's
browser, so nothing has to be installed on the server.

| File | What it shows | Downloads on first run |
| --- | --- | --- |
| `01-hello.py` | `print()` and `input()`, the smallest working app | Python only (~12 MB) |
| `02-calculator.py` | functions, a loop, bad input handled | Python only |
| `03-chart.py` | a bar chart drawn with text, standard library only | Python only |
| `04-matplotlib.py` | `plt.show()` draws a real chart into the terminal | matplotlib |
| `05-notes-to-pdf.py` | writes a PDF by hand, hands it over with `ams_download()` | Python only |
| `06-image-to-pdf.py` | `ams_pick_file()` in, Pillow, PDF out | Pillow (PIL) |
| `07-csv-report.py` | a CSV in, a pandas summary and a CSV back out | pandas, numpy |
| `08-quiz.py` | a class that asks questions and keeps a score | Python only |
| `11-gui-calculator.py` | clickable calculator with `ams_gui()` | Python only |

Things to know before writing your own:

- A browser cannot open a desktop window, start a server, or spawn threads or
  processes. `tkinter`, `pygame`, `flask`, `threading` and friends will fail; the
  editor warns while the code is still open.
- `input()` works anywhere, including inside functions, methods and
  `__init__`, because the app is rewritten to await the answer.
- Files: `ams_pick_file(accept, multiple=False)` returns a path (or a list, or
  `None` if the visitor cancels) and `ams_download(path, name=None)` gives a
  file back to the visitor as a download link. Each file is capped at 20 MB.
- The first run downloads the interpreter from `cdn.jsdelivr.net`; if that host
  is blocked, the terminal says so. Nothing is downloaded until a visitor
  scrolls to the app (or presses Run, when Auto-start is off).

## Browser GUI

`ams_gui(spec)` shows a form and waits until the visitor clicks a button. It
returns `{"action": button_id, "values": {field_name: value}}`. Call it again
with updated data to redraw the interface. `spec` supports `title`, `display`,
`message`, `columns` (1–6), `buttons` (`id`, `label`, optional `primary`) and
`fields` (`name`, `label`, `type` of `text`, `checkbox`, or `select`; `value`;
select also takes an `options` list of strings). File selection is available by
calling `ams_pick_file()` after a GUI button click; `ams_download()` provides
a download. Up to 30 fields and 60 buttons are accepted. All visitor-provided
values should be validated in Python. This is a browser form API, not a desktop
window or a compatibility layer for tkinter, and cannot access the host page.
