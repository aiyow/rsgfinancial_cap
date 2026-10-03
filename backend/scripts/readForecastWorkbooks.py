"""Read-only XLSX extraction; never edits the supplied workbooks."""
import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september']
root = Path(__file__).resolve().parents[2]
output = root / 'artifacts' / 'workbook-source.json'
books = []
for index, name in enumerate(MONTHS, 1):
    path = root / 'ml' / 'excel predictive data' / (name + '.xlsx')
    with zipfile.ZipFile(path) as archive:
        shared = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared = [''.join(x.itertext()) for x in ET.fromstring(archive.read('xl/sharedStrings.xml')).findall('s:si', NS)]
        workbook = ET.fromstring(archive.read('xl/workbook.xml'))
        sheets = [(s.attrib.get('name'), s.attrib.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')) for s in workbook.findall('s:sheets/s:sheet', NS)]
        relationships = ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))
        targets = {r.attrib['Id']: r.attrib['Target'] for r in relationships}
        chosen = None
        for sheet_name, rid in sheets:
            target = targets[rid].replace('\\', '/')
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            cells = []
            for row in ET.fromstring(archive.read(target)).findall('s:sheetData/s:row', NS):
                record = {}
                for cell in row.findall('s:c', NS):
                    address = cell.attrib['r']
                    col = ''.join(c for c in address if c.isalpha())
                    val = cell.find('s:v', NS)
                    value = val.text if val is not None else None
                    if cell.attrib.get('t') == 's' and value is not None:
                        value = shared[int(value)]
                    elif cell.attrib.get('t') == 'inlineStr':
                        value = ''.join(cell.find('s:is', NS).itertext())
                    formula = cell.find('s:f', NS)
                    record[col] = {'value': value, 'formula': formula.text if formula is not None else None, 'address': address}
                cells.append(record)
            header_index = next((i for i, row in enumerate(cells) if {'UNIT', 'PREVIOUS', 'PRESENT'}.issubset({str(v['value']).strip().upper() for v in row.values()})), None)
            if header_index is not None:
                chosen = (sheet_name, cells, header_index)
                break
        if chosen is None:
            raise ValueError(f'{path.name}: no meter-reading table found')
        sheet_name, cells, header_index = chosen
        headers = {str(cell['value']).strip().upper(): col for col, cell in cells[header_index].items()}
        def cell(row, field):
            return row.get(headers.get(field), {}).get('value')
        def number(value):
            if value is None or str(value).strip() == '':
                return None
            try:
                result = float(str(value).replace(',', ''))
                return result if result == result and abs(result) != float('inf') else None
            except (ValueError, TypeError):
                return None
        readings = []
        seen = set()
        issues = []
        for row in cells[header_index + 1:]:
            unit = cell(row, 'UNIT')
            if unit is None or str(unit).strip() == '':
                continue
            unit = str(unit).strip()
            if unit.endswith('.0'):
                unit = unit[:-2]
            # Totals and footer rows are not meter readings.
            if not any(ch.isdigit() for ch in unit):
                continue
            if unit in seen:
                raise ValueError(f'{path.name}: duplicate unit {unit}')
            seen.add(unit)
            previous, current = number(cell(row, 'PREVIOUS')), number(cell(row, 'PRESENT'))
            if previous is None or current is None:
                raise ValueError(f'{path.name}: missing reading for unit {unit}')
            consumption = current - previous
            rate = number(cell(row, 'WRATE'))
            cached = number(cell(row, 'CONSUMPTION'))
            charge = number(cell(row, 'WATER BILLED'))
            if cached is not None and abs(cached - consumption) > 0.001:
                issues.append({'unitNumber': unit, 'issue': 'Consumption does not match present minus previous',
                               'cell': row[headers['CONSUMPTION']]['address'], 'cachedValue': cached,
                               'expectedValue': consumption})
            if rate is not None and charge is not None and abs(charge - consumption * rate) > 0.011:
                issues.append({'unitNumber': unit, 'issue': 'Water charge does not match consumption times rate',
                               'cell': row[headers['WATER BILLED']]['address'], 'cachedValue': charge,
                               'expectedValue': consumption * rate})
            readings.append({'unitNumber': unit, 'previousReading': previous, 'currentReading': current,
                             'consumption': consumption, 'waterRate': rate})
        books.append({'periodStart': f'2026-{index:02d}-01', 'path': str(path), 'sheet': sheet_name,
                      'headers': headers, 'readings': readings, 'formulaIssues': issues})
output.parent.mkdir(exist_ok=True)
output.write_text(json.dumps({'yearAssumption': 2026, 'workbooks': books}, indent=2), encoding='utf-8')
print(json.dumps({'output': str(output), 'months': [{'month': b['periodStart'], 'sheet': b['sheet'],
      'readings': len(b['readings']), 'formulaIssues': len(b['formulaIssues']),
      'totalConsumption': round(sum(r['consumption'] for r in b['readings']), 3)} for b in books]}, indent=2))
