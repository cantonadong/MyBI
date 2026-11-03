import pytest
import duckdb
from app.expressions import compile_expression

def test_safe_expression_and_zero_denominator():
    sql = compile_expression('[profit] / [sales]', {'profit', 'sales'})
    with duckdb.connect() as connection:
        assert connection.execute(f'SELECT {sql} FROM (SELECT 10 AS profit, 20 AS sales)').fetchone()[0] == .5
        assert connection.execute(f'SELECT {sql} FROM (SELECT 10 AS profit, 0 AS sales)').fetchone()[0] is None

@pytest.mark.parametrize('text', ['__import__("os")', '[missing] + 1', '1;DROP TABLE datasets', '[sales].__class__'])
def test_rejects_non_arithmetic_and_unknown_fields(text):
    with pytest.raises(ValueError): compile_expression(text, {'sales'})
