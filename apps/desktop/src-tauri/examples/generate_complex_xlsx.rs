//! Generates fixtures/complex.xlsx: a workbook with many real formulas that
//! carry cached result values, exactly as Excel stores them after a calc.
//!
//! Run from src-tauri:  cargo run --example generate_complex_xlsx

use rust_xlsxwriter::{Formula, Workbook};
use std::path::Path;

fn fmt(v: f64) -> String {
    if v == v.trunc() && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

fn main() {
    let rows: Vec<(&str, &str, f64, f64)> = vec![
        ("widget", "north", 10.0, 2.5),
        ("widget", "south", 6.0, 2.5),
        ("gizmo", "north", 4.0, 7.25),
        ("gadget", "east", 15.0, 1.1),
        ("widget", "east", 8.0, 2.5),
        ("doohickey", "south", 3.0, 12.0),
    ];
    let qtys: Vec<f64> = rows.iter().map(|(_, _, q, _)| *q).collect();
    let prices: Vec<f64> = rows.iter().map(|(_, _, _, p)| *p).collect();
    let line_totals: Vec<f64> = rows.iter().map(|(_, _, q, p)| q * p).collect();
    let sum = |v: &[f64]| v.iter().sum::<f64>();
    let widget_total_qty: f64 = rows
        .iter()
        .filter(|(item, ..)| *item == "widget")
        .map(|(_, _, q, _)| q)
        .sum();
    let north_value: f64 = rows
        .iter()
        .enumerate()
        .filter(|(_, (_, region, _, _))| *region == "north")
        .map(|(i, _)| line_totals[i])
        .sum();
    let widgets_count = rows.iter().filter(|(i, ..)| *i == "widget").count() as f64;

    // (label, formula, expected cached value)
    let cases: Vec<(&str, String, String)> = vec![
        ("total_qty", "=SUM(Data!C2:C7)".into(), fmt(sum(&qtys))),
        (
            "avg_price",
            "=AVERAGE(Data!D2:D7)".into(),
            fmt(sum(&prices) / prices.len() as f64),
        ),
        ("max_line", "=MAX(Data!E2:E7)".into(), {
            let m = line_totals.iter().cloned().fold(f64::MIN, f64::max);
            if m == m.trunc() { format!("{}", m as i64) } else { format!("{m}") }
        }),
        (
            "widget_total_qty",
            "=SUMIF(Data!A2:A7,\"widget\",Data!C2:C7)".into(),
            fmt(widget_total_qty),
        ),
        (
            "north_value",
            "=SUMIF(Data!B2:B7,\"north\",Data!E2:E7)".into(),
            fmt(north_value),
        ),
        (
            "vlookup_gizmo",
            "=VLOOKUP(\"gizmo\",Data!A2:E7,4,FALSE)".into(),
            "7.25".into(),
        ),
        (
            "index_match_gadget",
            "=INDEX(Data!C2:C7,MATCH(\"gadget\",Data!A2:A7,0))".into(),
            "15".into(),
        ),
        (
            "nested_if",
            "=IF(SUMIF(Data!B2:B7,\"north\",Data!C2:C7)>10,IF(AVERAGE(Data!D2:D7)>4,\"High N\",\"Med N\"),\"Low N\")"
                .into(),
            "High N".into(),
        ),
        ("iferror_div", "=IFERROR(1/0,\"div by zero\")".into(), "div by zero".into()),
        (
            "concat_report",
            "=CONCATENATE(\"rows: \",COUNTA(Data!A2:A7))".into(),
            format!("rows: {}", rows.len()),
        ),
        (
            "round_avg",
            "=ROUND(AVERAGE(Data!E2:E7),2)".into(),
            format!(
                "{:.2}",
                (sum(&line_totals) / line_totals.len() as f64 * 100.0).round() / 100.0
            ),
        ),
        ("countif_widgets", "=COUNTIF(Data!A2:A7,\"widget\")".into(), fmt(widgets_count)),
        (
            "and_or_check",
            "=AND(COUNTA(Data!A2:A7)=6,OR(SUM(Data!C2:C7)>40,SUM(Data!C2:C7)<5))".into(),
            "TRUE".into(),
        ),
        (
            "cross_sheet_math",
            "=Data!E2*2+Summary!B2".into(),
            fmt(line_totals[0] * 2.0 + sum(&qtys)),
        ),
    ];

    let mut wb = Workbook::new();
    let data = wb.add_worksheet();
    data.set_name("Data").unwrap();
    for (c, h) in ["item", "region", "qty", "unit_price", "line_total"].iter().enumerate()
    {
        data.write_string(0, c as u16, *h).unwrap();
    }
    for (r, (item, region, qty, price)) in rows.iter().enumerate() {
        let row = r as u32 + 1; // Excel row 2..
        let excel_row = row + 1;
        data.write_string(row, 0, *item).unwrap();
        data.write_string(row, 1, *region).unwrap();
        data.write_number(row, 2, *qty).unwrap();
        data.write_number(row, 3, *price).unwrap();
        data.write_formula(
            row,
            4,
            Formula::new(format!("=C{excel_row}*D{excel_row}"))
                .set_result(fmt(qty * price)),
        )
        .unwrap();
    }

    let summary = wb.add_worksheet();
    summary.set_name("Summary").unwrap();

    summary.write_string(0, 0, "metric").unwrap();
    summary.write_string(0, 1, "value").unwrap();
    for (r, (label, formula, result)) in cases.iter().enumerate() {
        let row = r as u32 + 1;
        summary.write_string(row, 0, *label).unwrap();
        summary
            .write_formula(row, 1, Formula::new(formula.clone()).set_result(result.clone()))
            .unwrap();
    }

    let out_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures");
    std::fs::create_dir_all(&out_dir).unwrap();
    let path = out_dir.join("complex.xlsx");
    wb.save(&path).unwrap();

    // print the expectations so the integration test can be written against truth
    println!("wrote {} ({})", path.display(), std::fs::metadata(&path).unwrap().len());
    for (label, formula, value) in &cases {
        println!("{label}\t{formula}\t{value}");
    }
}
