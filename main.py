"""Compare September and October sales for the first sample."""

import csv
from pathlib import Path


def calculate_sales(file_path):
    with file_path.open("r", encoding="utf-8-sig", newline="") as file:
        return calculate_sales_rows(csv.DictReader(file))


def calculate_sales_rows(rows):
    totals = {}
    seen_ids = set()
    warnings = []

    required = ("거래일", "지점", "매출액", "거래ID")
    missing = [name for name in required if name not in (rows.fieldnames or [])]
    if missing:
        return totals, [f"필수 열 없음: {', '.join(missing)}"]

    for row in rows:
        if any(row.get(name) is None for name in required):
            warnings.append("값이 빠진 거래 행 무시")
            continue

        transaction_id = row["거래ID"]
        if transaction_id in seen_ids:
            warnings.append(f"중복 거래 무시: {transaction_id}")
            continue

        amount_text = row["매출액"].strip()
        if amount_text == "":
            warnings.append(f"매출액이 비어 있어 무시: {transaction_id}")
            continue

        month = row["거래일"][:7]
        branch = row["지점"]
        try:
            amount = int(amount_text)
        except ValueError:
            warnings.append(f"매출액이 숫자가 아니어서 무시: {transaction_id}")
            continue
        seen_ids.add(transaction_id)

        key = (month, branch)
        totals[key] = totals.get(key, 0) + amount

    return totals, warnings


def show_report(file_path):
    totals, warnings = calculate_sales(file_path)

    if warnings:
        for warning in warnings:
            print(warning)
        print("오류가 있어 보고서를 만들지 않았습니다.")
        return

    for branch in ("강남점", "건대점"):
        september = totals.get(("2026-09", branch), 0)
        october = totals.get(("2026-10", branch), 0)
        change = october - september

        print(f"{branch}: 9월 {september:,}원 → 10월 {october:,}원, 증감 {change:+,}원")


if __name__ == "__main__":
    show_report(Path(__file__).with_name("sales.csv"))
