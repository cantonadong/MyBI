"""Compile read-only arithmetic; client expressions never become raw SQL."""
import ast
import re

def compile_expression(expression: str, fields: set[str]) -> str:
    identifiers = {}
    def replace(match):
        name = match.group(1)
        if name not in fields: raise ValueError('Unknown calculated field: ' + name)
        key = f'_field{len(identifiers)}'
        identifiers[key] = '"' + name.replace('"', '""') + '"'
        return key
    source = re.sub(r'\[([^\]]+)\]', replace, expression)
    def compile_node(node):
        if isinstance(node, ast.Name) and node.id in identifiers: return identifiers[node.id]
        if isinstance(node, ast.Constant) and type(node.value) in {int, float}: return str(node.value)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)): return ('-' if isinstance(node.op, ast.USub) else '+') + '(' + compile_node(node.operand) + ')'
        if isinstance(node, ast.BinOp) and type(node.op) in {ast.Add, ast.Sub, ast.Mult, ast.Div}:
            left, right = compile_node(node.left), compile_node(node.right)
            if isinstance(node.op, ast.Div): return f'({left} / NULLIF({right}, 0))'
            op = {ast.Add: '+', ast.Sub: '-', ast.Mult: '*'}[type(node.op)]
            return f'({left} {op} {right})'
        raise ValueError('Only [field] references, numbers, + - * / and parentheses are allowed')
    try: return compile_node(ast.parse(source, mode='eval').body)
    except SyntaxError as error: raise ValueError('Invalid arithmetic expression') from error
