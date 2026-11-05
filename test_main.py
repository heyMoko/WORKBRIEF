"""Small checks for the sales calculator."""

from pathlib import Path

from main import calculate_sales, show_report


def test_normal_sales():
    sample_file = Path(__file__).with_name("sales.csv")
    totals, warnings = calculate_sales(sample_file)

    assert totals == {
        ("2026-09", "강남점"): 120000,
        ("2026-09", "건대점"): 80000,
        ("2026-10", "강남점"): 150000,
        ("2026-10", "건대점"): 60000,
    }
    assert warnings == []


def test_duplicate_id_is_not_counted_twice(tmp_path):
    sample_file = tmp_path / "sales.csv"
    sample_file.write_text(
        "거래일,지점,매출액,거래ID\n"
        "2026-10-01,강남점,150000,A001\n"
        "2026-10-02,강남점,150000,A001\n",
        encoding="utf-8",
    )

    totals, warnings = calculate_sales(sample_file)
    assert totals[("2026-10", "강남점")] == 150000
    assert warnings == ["중복 거래 무시: A001"]


def test_blank_amount_is_skipped(tmp_path):
    sample_file = tmp_path / "sales.csv"
    sample_file.write_text(
        "거래일,지점,매출액,거래ID\n"
        "2026-10-01,강남점,,A001\n",
        encoding="utf-8",
    )

    totals, warnings = calculate_sales(sample_file)
    assert totals == {}
    assert warnings == ["매출액이 비어 있어 무시: A001"]


def test_non_numeric_amount_is_skipped(tmp_path):
    sample_file = tmp_path / "sales.csv"
    sample_file.write_text(
        "거래일,지점,매출액,거래ID\n"
        "2026-10-01,강남점,미정,A001\n",
        encoding="utf-8",
    )

    totals, warnings = calculate_sales(sample_file)
    assert totals == {}
    assert warnings == ["매출액이 숫자가 아니어서 무시: A001"]


def test_invalid_file_does_not_print_a_report(tmp_path, capsys):
    sample_file = tmp_path / "sales.csv"
    sample_file.write_text(
        "거래일,지점,매출액,거래ID\n"
        "2026-10-01,강남점,150000,A001\n"
        "2026-10-02,강남점,,A002\n",
        encoding="utf-8",
    )

    show_report(sample_file)
    output = capsys.readouterr().out
    assert "매출액이 비어 있어 무시: A002" in output
    assert "오류가 있어 보고서를 만들지 않았습니다." in output
    assert "9월" not in output
