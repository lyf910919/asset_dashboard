#!/usr/bin/env python3
import argparse
import concurrent.futures
import datetime as dt
import json
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CST = dt.timezone(dt.timedelta(hours=8))
USER_AGENT = "Mozilla/5.0"
REFERER = "https://quote.eastmoney.com/"


class FetchError(RuntimeError):
    pass


def now_cst():
    return dt.datetime.now(CST).replace(microsecond=0).isoformat()


def fetch_json(url, tries=2, timeout=6):
    last_error = None
    for attempt in range(tries):
        try:
            result = subprocess.run(
                [
                    "curl",
                    "-L",
                    "--http1.1",
                    "--retry",
                    "1",
                    "--retry-all-errors",
                    "--connect-timeout",
                    "4",
                    "--max-time",
                    str(timeout),
                    "-s",
                    url,
                    "-H",
                    f"Referer: {REFERER}",
                    "-H",
                    f"User-Agent: {USER_AGENT}",
                ],
                check=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=timeout + 4,
            )
            if not result.stdout.strip():
                raise FetchError("empty response")
            return json.loads(result.stdout)
        except (subprocess.SubprocessError, json.JSONDecodeError, FetchError) as exc:
            last_error = exc
            if attempt < tries - 1:
                time.sleep(0.4 + attempt * 0.4)
    raise FetchError(str(last_error))


def kline_url(secid, limit):
    fields1 = "f1,f2,f3,f4,f5,f6"
    fields2 = "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61"
    return (
        "https://push2his.eastmoney.com/api/qt/stock/kline/get"
        f"?secid={secid}&klt=101&fqt=1&lmt={limit}&end=20500101"
        f"&fields1={fields1}&fields2={fields2}"
    )


def tencent_symbol(secid):
    market, code = secid.split(".", 1)
    return ("sz" if market == "0" else "sh") + code


def tencent_kline_url(secid, limit):
    symbol = tencent_symbol(secid)
    return f"https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param={symbol},day,,,{limit},qfq"


def parse_kline_line(line):
    parts = line.split(",")
    if len(parts) < 7:
        raise ValueError("bad kline")
    return {
        "date": parts[0],
        "open": float(parts[1]),
        "close": float(parts[2]),
        "high": float(parts[3]),
        "low": float(parts[4]),
        "volumeHands": float(parts[5]),
        "amountYuan": float(parts[6]),
    }


def parse_tencent_row(secid, row):
    market = secid.split(".", 1)[0]
    raw_volume = float(row[5])
    volume_hands = raw_volume / 100 if market == "1" else raw_volume
    return {
        "date": row[0],
        "open": float(row[1]),
        "close": float(row[2]),
        "high": float(row[3]),
        "low": float(row[4]),
        "volumeHands": volume_hands,
        "amountYuan": None,
    }


def fetch_eastmoney_rows(secid, limit):
    data = fetch_json(kline_url(secid, limit), tries=1, timeout=5)
    klines = data.get("data", {}).get("klines") or []
    return [parse_kline_line(line) for line in klines]


def fetch_tencent_rows(secid, limit):
    symbol = tencent_symbol(secid)
    data = fetch_json(tencent_kline_url(secid, limit), tries=2, timeout=6)
    rows = data.get("data", {}).get(symbol, {}).get("qfqday") or data.get("data", {}).get(symbol, {}).get("day") or []
    return [parse_tencent_row(secid, row) for row in rows]


def fetch_constituent(item, limit):
    source = "eastmoney"
    try:
        rows = fetch_eastmoney_rows(item["secid"], limit)
    except Exception:
        source = "tencent"
        rows = fetch_tencent_rows(item["secid"], limit)
    if len(rows) < 20:
        raise FetchError(f"not enough rows: {len(rows)}")
    return {
        "name": item["name"],
        "secid": item["secid"],
        "source": source,
        "rows": rows,
    }


def aggregate(results):
    by_date = {}
    for result in results:
        for row in result["rows"]:
            day = by_date.setdefault(row["date"], {
                "date": row["date"],
                "volumeHands": 0.0,
                "amountYuan": 0.0,
                "amountCount": 0,
                "closeSum": 0.0,
                "constituentCount": 0,
            })
            day["volumeHands"] += row["volumeHands"]
            if row["amountYuan"] is not None:
                day["amountYuan"] += row["amountYuan"]
                day["amountCount"] += 1
            day["closeSum"] += row["close"]
            day["constituentCount"] += 1
    return sorted(by_date.values(), key=lambda row: row["date"])


def moving_average(rows, key, n=20):
    values = [row[key] for row in rows[-n:]]
    return sum(values) / len(values) if values else None


def complete_amount(row):
    return row.get("amountCount", 0) >= max(1, row.get("constituentCount", 0) * 0.9)


def amount_average(rows, n=20):
    complete_rows = [row for row in rows[-n:] if complete_amount(row)]
    if len(complete_rows) < min(n, len(rows)):
        return None
    return sum(row["amountYuan"] for row in complete_rows) / len(complete_rows)


def build_payload(config, results, failures, min_success_rate):
    rows = aggregate(results)
    latest = rows[-1] if rows else {}
    prev = rows[-2] if len(rows) >= 2 else {}
    last5  = rows[-5:]  if len(rows) >= 5  else rows
    last10 = rows[-10:] if len(rows) >= 10 else rows
    last20 = rows[-20:] if len(rows) >= 20 else rows
    total = len(config["constituents"])
    success_count = len(results)
    success_rate = success_count / total if total else 0
    latest_close = latest.get("closeSum")
    prev_close = prev.get("closeSum")
    price_change_pct = (
        (latest_close / prev_close - 1) * 100
        if latest_close and prev_close
        else None
    )
    return {
        "schemaVersion": 2,
        "indexCode": config["indexCode"],
        "indexName": config["indexName"],
        "generatedAt": now_cst(),
        "constituentVersionDate": config.get("versionDate"),
        "constituentSourceName": config.get("sourceName"),
        "constituentSourceUrl": config.get("sourceUrl"),
        "quoteSource": "EastMoney daily kline, Tencent kline fallback",
        "minSuccessRate": min_success_rate,
        "success": {
            "count": success_count,
            "total": total,
            "rate": round(success_rate, 4),
            "ok": success_rate >= min_success_rate,
        },
        "missing": failures,
        "latest": {
            "date": latest.get("date"),
            "volumeHands": latest.get("volumeHands"),
            "amountYuan": latest.get("amountYuan") if complete_amount(latest) else None,
            "volumeMa5Hands":  moving_average(last5,  "volumeHands"),
            "volumeMa10Hands": moving_average(last10, "volumeHands"),
            "volumeMa20Hands": moving_average(last20, "volumeHands"),
            "amountMa20Yuan": amount_average(last20),
            "previousVolumeHands": prev.get("volumeHands"),
            "previousAmountYuan": prev.get("amountYuan") if complete_amount(prev) else None,
            "priceChangePct": price_change_pct,
            "constituentCount": latest.get("constituentCount"),
            "amountCount": latest.get("amountCount"),
        },
        "series": rows[-60:],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--constituents", default="data/index_constituents/931643.json")
    parser.add_argument("--output", default="data/generated/index-volume-931643.json")
    parser.add_argument("--js-output", default="data/generated/index-volume-931643.js")
    parser.add_argument("--limit", type=int, default=45)
    parser.add_argument("--workers", type=int, default=10)
    parser.add_argument("--min-success-rate", type=float, default=0.9)
    args = parser.parse_args()

    config_path = ROOT / args.constituents
    output_path = ROOT / args.output
    js_output_path = ROOT / args.js_output
    config = json.loads(config_path.read_text(encoding="utf-8"))
    results = []
    failures = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as executor:
        future_map = {
            executor.submit(fetch_constituent, item, args.limit): item
            for item in config["constituents"]
        }
        for future in concurrent.futures.as_completed(future_map):
            item = future_map[future]
            try:
                results.append(future.result())
            except Exception as exc:
                failures.append({
                    "name": item["name"],
                    "secid": item["secid"],
                    "error": str(exc),
                })

    payload = build_payload(config, results, failures, args.min_success_rate)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    js_output_path.parent.mkdir(parents=True, exist_ok=True)
    index_code = config.get("indexCode", "UNKNOWN").replace(".", "_")
    js_var_name = f"__INDEX_VOLUME_{index_code}__"
    js_output_path.write_text(
        f"window.{js_var_name} = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )
    success = payload["success"]
    print(
        f"{payload['indexName']} 成分股量能聚合："
        f"{success['count']}/{success['total']} "
        f"({success['rate']:.1%})，输出 {output_path} / {js_output_path}"
    )
    return 0 if success["ok"] else 2


if __name__ == "__main__":
    sys.exit(main())
