from app.imports.delimited import parse_delimited


def test_invalid_dates_identify_the_field_value_and_expected_format():
    from app.api.datasets import convert_preview
    import pytest
    with pytest.raises(ValueError) as error:
        convert_preview(parse_delimited('day_offset\n-30'), {'day_offset': 'date'})
    assert all(text in str(error.value) for text in ['day_offset', '-30', 'YYYY-MM-DD', '文本', '数值'])


def test_bracketed_nulls_are_missing_values_in_numeric_columns():
    from app.api.datasets import convert_preview
    preview = parse_delimited('value\n1.5\n[NULL]\n [NULL] ')
    assert preview.rows == [[1.5], [None], [None]]
    assert convert_preview(preview, {'value': 'number'}).rows == [[1.5], [None], [None]]
    preview = parse_delimited('value\n[NULL]\n2.5')
    assert convert_preview(preview, {'value': 'number'}).rows == [[None], [2.5]]


def test_field_order_keeps_dimensions_first_and_values_with_their_fields():
    from app.api.datasets import convert_preview
    preview = parse_delimited('amount,region,code\n12.5,North,001')
    result = convert_preview(preview, {}, {'code': 'ID'}, ['code', 'amount', 'region'])
    assert result.headers == ['ID', 'region', 'amount']
    assert result.rows == [['001', 'North', 12.5]]
    assert result.raw_rows == [['001', 'North', '12.5']]


def test_headerless_data_keeps_first_row_and_original_text():
    preview = parse_delimited('001,25%\n002,50%', has_header=False)
    assert preview.headers == ['列 1', '列 2']
    assert preview.rows == [['001', 0.25], ['002', 0.5]]
    assert preview.raw_rows == [['001', '25%'], ['002', '50%']]


def test_tsv_preserves_empty_string_zero_and_percentage_source_value():
    preview = parse_delimited("name\tvalue\tnote\nA\t0.1234\t\nB\t0\ttext")

    assert preview.headers == ["name", "value", "note"]
    assert preview.rows == [["A", 0.1234, ""], ["B", 0, "text"]]
    assert [field.type for field in preview.fields] == ["string", "number", "string"]


def test_quoted_csv_keeps_embedded_newline():
    preview = parse_delimited('name,note\nA,"two\nlines"')
    assert preview.rows == [["A", "two\nlines"]]


def test_duplicate_headers_are_rejected():
    try:
        parse_delimited("name,name\nA,B")
    except ValueError as error:
        assert str(error) == "Column names must be non-empty and unique"
    else:
        raise AssertionError("duplicate headers must fail")

def test_mixed_column_and_large_identifiers_keep_original_text():
    from app.api.datasets import convert_preview
    assert convert_preview(parse_delimited('code\n1.00\nABC'), {'code': 'string'}).rows == [['1.00'], ['ABC']]
    preview = parse_delimited('id\n9007199254740993')
    assert preview.fields[0].type == 'string'
    assert preview.rows == [['9007199254740993']]

def test_string_override_keeps_original_numeric_token():
    from app.api.datasets import convert_preview
    assert convert_preview(parse_delimited('code\n1.00'), {'code': 'string'}).rows == [['1.00']]


def test_thousands_grouping_in_tsv_csv_and_single_column():
    for text in ['name\tvalue\nA\t1,026\nB\t-1,234.50', 'name,value\nA,"1,026"\nB,"-1,234.50"']:
        preview = parse_delimited(text)
        assert preview.rows == [['A', 1026], ['B', -1234.5]]
        assert preview.fields[1].type == 'integer'
    assert parse_delimited('amount\n1,026').rows == [[1026]]
    assert parse_delimited('a,b\n1,026').rows == [[1, '026']]


def test_grouping_preserves_text_identifiers_and_string_override():
    from app.api.datasets import convert_preview
    for value in ['12,34', '01,026', '1,234,56', '9,007,199,254,740,993', 'item, name']:
        preview = parse_delimited('value\n' + value)
        assert preview.rows == [[value]]
        assert preview.fields[0].type == 'string'
    assert convert_preview(parse_delimited('value\n1,026\nunknown'), {'value': 'string'}).rows == [['1,026'], ['unknown']]
    preview = parse_delimited('value\n1,026')
    assert convert_preview(preview, {'value': 'string'}).rows == [['1,026']]
    mixed = convert_preview(preview, {'value': 'string'})
    assert convert_preview(mixed, {'value': 'number'}).rows[0] == [1026]
