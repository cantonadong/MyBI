from __future__ import annotations

import csv
import math
import re
from datetime import date, datetime
from dataclasses import dataclass
from io import StringIO


@dataclass(frozen=True)
class Field:
    name: str
    type: str


@dataclass(frozen=True)
class TabularPreview:
    headers: list[str]
    rows: list[list[object]]
    fields: list[Field]
    raw_rows: list[list[object]] | None = None


def _value(raw: str) -> object:
    if raw == "":
        return ""
    if raw == '\\N' or raw.strip() == '[NULL]':
        return None
    if raw.strip().endswith('%') and '%' not in raw.strip()[:-1]:
        number = _value(raw.strip()[:-1])
        return number / 100 if type(number) in (int, float) else raw
    if len(raw) >= 10 and raw[4:5] == '-' and raw[7:8] == '-':
        try:
            return datetime.fromisoformat(raw).date() if len(raw) > 10 else date.fromisoformat(raw)
        except ValueError:
            pass
    if len(raw) > 1 and raw[0] == '0' and raw[1].isdigit():
        return raw
    token = raw.replace(',', '') if re.fullmatch(r'[+-]?[1-9][0-9]{0,2}(?:,[0-9]{3})+(?:\.[0-9]+)?', raw.strip()) else raw
    try:
        integer = int(token)
        return integer if abs(integer) <= 9007199254740991 else raw
    except ValueError:
        try:
            number = float(token)
            return number if math.isfinite(number) else raw
        except ValueError:
            return raw


def infer_type(value: object, raw: object = None) -> str:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(raw, str) and any(marker in raw.lower() for marker in ['.', 'e', '%']):
            return 'number'
        return 'integer' if isinstance(value, int) or value.is_integer() else 'number'
    return 'date' if isinstance(value, date) else 'string'


def infer_formats(preview: TabularPreview) -> dict:
    formats = {}
    for index, field in enumerate(preview.fields):
        numeric = field.type in {'number', 'integer'}
        raw = (preview.raw_rows or preview.rows)[0][index]
        percent = numeric and ((isinstance(raw, str) and raw.strip().endswith('%')) or bool(re.search(r'(?:^|[^a-z0-9])(?:pct|percent(?:age)?|ratio|rario|rate)(?:$|[^a-z0-9])', field.name, re.IGNORECASE)))
        decimal = numeric and (field.type != 'integer' or percent or 'per' in field.name.lower())
        decimals = 1 if decimal else 0
        formats[field.name] = {'kind': ('decimal' if decimal else 'integer') if numeric else 'text', 'format': 'percent' if percent else 'number', 'decimals': decimals}
        if field.type == 'date':
            formats[field.name]['dateFormat'] = 'MMM d'
    return formats


def parse_delimited(text: str, delimiter: str | None = None, has_header: bool = True) -> TabularPreview:
    if not text.strip():
        raise ValueError("Input is empty")
    header = text.partition("\n")[0]
    delimiter = delimiter or ("\t" if "\t" in header or ',' not in header else ",")
    if len(delimiter) != 1 or delimiter in {'\r', '\n'}:
        raise ValueError('Delimiter must be one non-newline character')
    records = list(csv.reader(StringIO(text), delimiter=delimiter))
    headers = [header.strip() for header in records[0]] if has_header else [f'列 {i + 1}' for i in range(len(records[0]))]
    if any(not header for header in headers) or len(set(headers)) != len(headers):
        raise ValueError("Column names must be non-empty and unique")
    records = records[1:] if has_header else records
    rows = [[_value(value) for value in record] for record in records]
    if not rows:
        raise ValueError('No data rows')
    if any(len(row) != len(headers) for row in rows):
        raise ValueError('Row column count does not match header')
    fields = []
    for index, header in enumerate(headers):
        field_type = infer_type(rows[0][index], records[0][index])
        fields.append(Field(header, field_type))
        if field_type == 'string':
            for row_index, row in enumerate(rows):
                if row[index] is not None:
                    row[index] = records[row_index][index]
    return TabularPreview(headers, rows, fields, records)
