import pytest
from fastapi import HTTPException

from app.api.datasets import annotation_preview, annotation_rows, convert_preview
from app.imports.delimited import parse_delimited


def test_annotation_roles_and_open_boundaries():
    headers = ['event', 'from', 'until']
    fields = {'label': 'event', 'start': 'from', 'end': 'until'}
    assert annotation_rows(headers, [['Release', 'NULL', '2026-11-05'], ['Event', '2026-11-01', None]], fields) == [
        {'label': 'Release', 'start': None, 'end': '2026-11-05'},
        {'label': 'Event', 'start': '2026-11-01', 'end': None},
    ]


@pytest.mark.parametrize('row', [['Event', '2026-11-06', '2026-11-05'], ['Event', 'bad-date', None], ['', None, None]])
def test_annotation_rejects_invalid_ranges_and_labels(row):
    with pytest.raises(HTTPException) as error:
        annotation_rows(['label', 'start', 'end'], [row], {'label': 'label', 'start': 'start', 'end': 'end'})
    assert error.value.status_code == 422


def test_annotation_infers_first_row_types_and_preserves_numeric_label_position():
    preview = annotation_preview(parse_delimited('label\tstart\tend\n12\tNULL\t2026-11-05'), ['label', 'start', 'end'])
    assert [field.type for field in preview.fields] == ['integer', 'date', 'date']
    assert preview.rows[0][1] is None
    fields = {'label': 'label', 'start': 'start', 'end': 'end'}
    result = convert_preview(preview, {}, field_order=preview.headers, annotation_fields=fields)
    assert result.headers == ['label', 'start', 'end']
    assert annotation_rows(result.headers, result.rows, fields) == [{'label': '12', 'start': None, 'end': '2026-11-05'}]


def test_annotation_accepts_pasted_slash_dates_through_preview_and_save():
    text = '1.0\t2026/10/1\t2026/10/10\n2.0\t2026/10/11\t2026/10/20\n3.0\t2026/10/21\t2026/10/30\n4.0\t2026/10/31\t2026/11/10'
    preview = annotation_preview(parse_delimited(text, has_header=False), ['label', 'start', 'end'])
    assert [field.type for field in preview.fields] == ['number', 'date', 'date']
    fields = dict(zip(['label', 'start', 'end'], preview.headers))
    saved = convert_preview(preview, {}, field_order=preview.headers, annotation_fields=fields)
    rows = annotation_rows(saved.headers, saved.rows, fields)
    assert len(rows) == 4
    assert rows[0] == {'label': '1.0', 'start': '2026-10-01', 'end': '2026-10-10'}
    assert rows[-1] == {'label': '4.0', 'start': '2026-10-31', 'end': '2026-11-10'}
