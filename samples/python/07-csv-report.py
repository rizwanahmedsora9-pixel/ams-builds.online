# A CSV in, a readable report out. Uses pandas, which is bundled with the
# interpreter (the first run downloads it; pandas needs numpy too).
import pandas as pd

csv_path = ams_pick_file(".csv,text/csv")
if not csv_path:
    print("No CSV chosen. On another try, pick a file with a header row.")
else:
    table = pd.read_csv(csv_path)
    print("Rows:", len(table), " Columns:", len(table.columns))
    print(f"Columns: {', '.join(str(c) for c in table.columns)}")

    numbers = table.select_dtypes("number")
    if numbers.empty:
        print("\nNo numeric columns to summarise.")
    else:
        print("\nSummary of the numbers:")
        print(numbers.describe().round(2).to_string())

    report = "report.csv"
    if not numbers.empty:
        numbers.sum().round(2).to_csv(report, header=["total"])
        print(f"\nWrote {report}.")
        ams_download(report)
