from io import BytesIO
import posixpath
from zipfile import ZipFile
from xml.etree import ElementTree as ET
from python_calamine import CalamineWorkbook
from .delimited import Field, TabularPreview, infer_type, _value

def read_workbook(content: bytes, suffix: str, sheet_name: str | None, preview: bool, has_header: bool = True):
    with CalamineWorkbook.from_filelike(BytesIO(content)) as workbook:
        if preview and not sheet_name:
            return {'sheets': workbook.sheet_names}
        if not sheet_name and len(workbook.sheet_names) != 1:
            raise ValueError('Select a worksheet')
        selected = sheet_name or workbook.sheet_names[0]
        if selected not in workbook.sheet_names:
            raise ValueError('Unknown worksheet')
        if suffix == 'xlsx':
            with ZipFile(BytesIO(content)) as archive:
                if sum(info.file_size for info in archive.infolist()) > 512 * 1024 * 1024:
                    raise ValueError('Expanded workbook exceeds 512 MB limit')
                ns = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
                book = ET.fromstring(archive.read('xl/workbook.xml'))
                element = next(item for item in book.findall('s:sheets/s:sheet', ns) if item.attrib['name'] == selected)
                rel_id = element.attrib['{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id']
                relations = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
                target = next(item.attrib['Target'] for item in relations if item.attrib['Id'] == rel_id)
                path = target.lstrip('/') if target.startswith('/') else posixpath.normpath('xl/' + target)
                sheet_xml = ET.fromstring(archive.read(path))
                for cell in sheet_xml.findall('.//s:c', ns):
                    value = cell.find('s:v', ns)
                    if cell.find('s:f', ns) is not None and (value is None or value.text is None):
                        raise ValueError('Formula has no cached result at ' + cell.attrib.get('r', '?') + '; open and save the workbook in Excel first')
        matrix = workbook.get_sheet_by_name(selected).to_python()
    if len(matrix) < (2 if has_header else 1):
        raise ValueError('Worksheet has no data rows')
    headers = [str(value).strip() for value in matrix[0]] if has_header else [f'列 {i + 1}' for i in range(len(matrix[0]))]
    if any(not h for h in headers) or len(set(headers)) != len(headers):
        raise ValueError('Column names must be non-empty and unique')
    raw_rows = [list(row) + [None] * (len(headers) - len(row)) for row in (matrix[1:] if has_header else matrix)]
    rows = [[_value(value) if isinstance(value, str) else value for value in row] for row in raw_rows]
    fields = []
    for index, header in enumerate(headers):
        kind = infer_type(rows[0][index], raw_rows[0][index], header)
        fields.append(Field(header, kind))
        if kind == 'string':
            for row_index, row in enumerate(rows):
                if row[index] is not None: row[index] = str(raw_rows[row_index][index])
    return TabularPreview(headers, rows, fields, raw_rows)
