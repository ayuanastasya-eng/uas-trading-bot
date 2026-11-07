"""
Tarik data historis Indodax (history_v2) mundur dari sekarang sampai tanggal awal.
Jalankan DI LAPTOP, bukan di Vercel.

Contoh:
    pip install requests
    python fetch_history.py --pairs btcidr ethidr solidr --tf 240 --start 2023-10-01

Output: data/<pair>_<tf>.csv  (time, open, high, low, close, volume)
"""
import argparse
import csv
import os
import sys
import time
from datetime import datetime, timezone

import requests

BASE = "https://indodax.com"
MIN_INTERVAL = 0.5  # detik antar request -> max 2 req/detik (aman di bawah 3/detik)
TF_SECONDS = {"1": 60, "15": 900, "30": 1800, "60": 3600, "240": 14400, "1D": 86400}

_last_call = 0.0
session = requests.Session()
session.headers.update({"User-Agent": "uas-algotrading-fetch/1.0"})


def get_json(url, params=None, retries=5):
    """GET sequential (tanpa paralel) dengan rate limit + retry backoff."""
    global _last_call
    for attempt in range(retries):
        wait = MIN_INTERVAL - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        try:
            r = session.get(url, params=params, timeout=20)
            if r.status_code == 200:
                return r.json()
            print(f"  HTTP {r.status_code}, retry {attempt + 1}/{retries}", file=sys.stderr)
        except (requests.RequestException, ValueError) as e:
            print(f"  error {e}, retry {attempt + 1}/{retries}", file=sys.stderr)
        time.sleep(2 ** attempt)
    raise RuntimeError(f"Gagal fetch {url} setelah {retries} percobaan")


def server_time():
    data = get_json(f"{BASE}/api/server_time")
    t = int(data["server_time"])
    if t > 10_000_000_000:  # kalau dalam milidetik, ubah ke detik
        t //= 1000
    return t


def parse_bar(b):
    # history_v2 mengembalikan list of object: Time, Open, High, Low, Close, Volume
    t = int(b["Time"])
    if t > 10_000_000_000:  # jaga-jaga kalau milidetik
        t //= 1000
    return (
        t,
        float(b["Open"]),
        float(b["High"]),
        float(b["Low"]),
        float(b["Close"]),
        float(b["Volume"]),
    )


def fetch_pair(pair, tf, start_ts, srv_ts):
    dur = TF_SECONDS[tf]
    symbol = pair.upper()
    bars = {}
    to = srv_ts
    page = 0
    while True:
        page += 1
        data = get_json(
            f"{BASE}/tradingview/history_v2",
            params={"symbol": symbol, "tf": tf, "from": start_ts, "to": to},
        )
        if not data:
            print(f"  [{pair}] respons kosong di to={to}, berhenti.")
            break
        parsed = [parse_bar(b) for b in data]
        earliest = min(p[0] for p in parsed)
        before = len(bars)
        for p in parsed:
            bars[p[0]] = p  # dedup berdasarkan Time
        added = len(bars) - before
        print(f"  [{pair}] page {page}: {len(parsed)} bar, +{added} baru, "
              f"paling awal {datetime.fromtimestamp(earliest, timezone.utc):%Y-%m-%d %H:%M} UTC")
        if earliest <= start_ts or added == 0:
            break
        to = earliest - 1  # geser mundur

    # Buang bar yang belum tertutup (Time + durasi > server_time)
    rows = sorted(bars.values())
    closed = [r for r in rows if r[0] + dur <= srv_ts]
    dropped = len(rows) - len(closed)
    if dropped:
        print(f"  [{pair}] buang {dropped} bar belum tertutup")
    # Potong ke start_ts
    return [r for r in closed if r[0] >= start_ts]


def check_gaps(rows, dur):
    gaps = []
    for a, b in zip(rows, rows[1:]):
        if b[0] - a[0] != dur:
            gaps.append((a[0], b[0], (b[0] - a[0]) // dur - 1))
    return gaps


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pairs", nargs="+", required=True, help="contoh: btcidr ethidr")
    ap.add_argument("--tf", default="240", choices=list(TF_SECONDS))
    ap.add_argument("--start", default="2023-10-01", help="YYYY-MM-DD (UTC)")
    ap.add_argument("--out", default="data")
    args = ap.parse_args()

    start_ts = int(datetime.strptime(args.start, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp())
    srv = server_time()
    print(f"server_time = {datetime.fromtimestamp(srv, timezone.utc):%Y-%m-%d %H:%M:%S} UTC")
    os.makedirs(args.out, exist_ok=True)
    dur = TF_SECONDS[args.tf]

    for pair in args.pairs:
        print(f"Menarik {pair} tf={args.tf} mulai {args.start}")
        try:
            rows = fetch_pair(pair, args.tf, start_ts, srv)
        except Exception as e:
            print(f"  [{pair}] GAGAL, dilewati: {e}")
            continue
        if not rows:
            print(f"  [{pair}] tidak ada data!")
            continue
        path = os.path.join(args.out, f"{pair}_{args.tf}.csv")
        with open(path, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["time", "open", "high", "low", "close", "volume"])
            w.writerows(rows)
        gaps = check_gaps(rows, dur)
        first = datetime.fromtimestamp(rows[0][0], timezone.utc)
        last = datetime.fromtimestamp(rows[-1][0], timezone.utc)
        years = (rows[-1][0] - rows[0][0]) / (365.25 * 86400)
        print(f"  [{pair}] {len(rows)} bar, {first:%Y-%m-%d} -> {last:%Y-%m-%d} ({years:.2f} tahun), "
              f"{len(gaps)} gap -> {path}")
        for g in gaps[:10]:
            print(f"    gap: {datetime.fromtimestamp(g[0], timezone.utc):%Y-%m-%d %H:%M} -> "
                  f"{datetime.fromtimestamp(g[1], timezone.utc):%Y-%m-%d %H:%M} ({g[2]} bar hilang)")


if __name__ == "__main__":
    main()
