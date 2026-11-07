"""
Seleksi universe berdasarkan likuiditas di AWAL periode backtest (anti survivorship bias).

Ukuran: median nilai transaksi harian (close x volume, dalam IDR) pada 90 hari pertama
sejak START. Pair yang belum ada data di awal periode dikeluarkan. Stablecoin dikeluarkan.

Jalankan (dari folder uas-trading):
    python universe_select.py --top 5
Output: tabel di layar + universe.csv
"""
import argparse
import csv
import glob
import os
import statistics
from collections import defaultdict
from datetime import datetime, timezone

START = "2023-10-01"
WINDOW_DAYS = 90
MAX_LATE_START_DAYS = 7
EXCLUDE = {"usdtidr", "usdcidr", "daiidr", "busdidr"}  # stablecoin


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=5)
    ap.add_argument("--data", default="data")
    args = ap.parse_args()

    start_ts = int(datetime.strptime(START, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
    end_ts = start_ts + WINDOW_DAYS * 86400

    results = []
    for path in sorted(glob.glob(os.path.join(args.data, "*_240.csv"))):
        pair = os.path.basename(path).split("_")[0]
        if pair in EXCLUDE:
            results.append((pair, None, None, None, "stablecoin"))
            continue
        with open(path) as f:
            rows = list(csv.DictReader(f))
        if not rows:
            results.append((pair, None, None, None, "kosong"))
            continue
        first = int(rows[0]["time"])
        if first > start_ts + MAX_LATE_START_DAYS * 86400:
            d = datetime.fromtimestamp(first, timezone.utc).strftime("%Y-%m-%d")
            results.append((pair, None, None, None, f"baru ada sejak {d}"))
            continue
        daily = defaultdict(float)
        zero = n = 0
        for r in rows:
            t = int(r["time"])
            if t < start_ts:
                continue
            if t >= end_ts:
                break
            n += 1
            v = float(r["close"]) * float(r["volume"])
            if v == 0:
                zero += 1
            daily[t // 86400] += v
        if not daily:
            results.append((pair, None, None, None, "tidak ada data di jendela"))
            continue
        med = statistics.median(daily.values())
        results.append((pair, med, zero / n, n, "ok"))

    ok = sorted([r for r in results if r[4] == "ok"], key=lambda r: -r[1])
    chosen = {r[0] for r in ok[: args.top]}

    print(f"\nJendela likuiditas: {START} + {WINDOW_DAYS} hari\n")
    print(f"{'Rank':<5}{'Pair':<10}{'Median transaksi/hari (Rp)':>28}{'Bar vol=0':>11}  Status")
    for i, r in enumerate(ok, 1):
        mark = "DIPILIH" if r[0] in chosen else "-"
        print(f"{i:<5}{r[0]:<10}{r[1]:>28,.0f}{r[2]*100:>10.1f}%  {mark}")
    for r in results:
        if r[4] != "ok":
            print(f"{'-':<5}{r[0]:<10}{'':>28}{'':>11}  dikeluarkan: {r[4]}")

    with open("universe.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["rank", "pair", "median_daily_turnover_idr", "zero_volume_bar_ratio", "selected", "note"])
        for i, r in enumerate(ok, 1):
            w.writerow([i, r[0], round(r[1]), round(r[2], 4), r[0] in chosen, ""])
        for r in results:
            if r[4] != "ok":
                w.writerow(["", r[0], "", "", False, r[4]])
    print("\nTersimpan: universe.csv")


if __name__ == "__main__":
    main()
