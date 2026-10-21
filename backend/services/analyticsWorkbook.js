import ExcelJS from 'exceljs';

export const workbookMimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function workbookFilename(name, periodMonth) {
  const basename = String(name || '').split(/[\\/]/).at(-1).replace(/[\r\n]/g, '').trim();
  return basename && basename.length <= 255 && /\.xlsx$/i.test(basename) ? basename : `water-history-${periodMonth}.xlsx`;
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export async function exportAnalyticsWorkbook(periodMonth, readings) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'The ResiDens';
  const sheet = workbook.addWorksheet(`Water ${periodMonth}`, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = [
    { header: 'UNIT', key: 'unitNumber', width: 14 },
    { header: 'PREVIOUS', key: 'previousReading', width: 16 },
    { header: 'PRESENT', key: 'currentReading', width: 16 },
    { header: 'CONSUMPTION', key: 'consumption', width: 18 },
    { header: 'WRATE', key: 'waterRate', width: 14 },
    { header: 'WATER BILLED', key: 'waterCharge', width: 18 },
    { header: 'VALIDATION', key: 'validationStatus', width: 16 },
    { header: 'NOTES', key: 'validationNotes', width: 65 },
  ];
  for (const reading of readings) {
    sheet.addRow({ ...reading, unitNumber: String(reading.unitNumber),
      previousReading: numeric(reading.previousReading), currentReading: numeric(reading.currentReading),
      consumption: numeric(reading.consumption), waterRate: numeric(reading.waterRate), waterCharge: numeric(reading.waterCharge),
      validationNotes: Array.isArray(reading.validationNotes) ? reading.validationNotes.join(' ') : reading.validationNotes || '',
    });
  }
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF215D47' } };
  sheet.getRow(1).height = 24;
  for (const column of ['previousReading', 'currentReading', 'consumption']) sheet.getColumn(column).numFmt = '0.000';
  for (const column of ['waterRate', 'waterCharge']) sheet.getColumn(column).numFmt = '0.00';
  sheet.getColumn('validationNotes').alignment = { vertical: 'top', wrapText: true };
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: readings.length + 1, column: 8 } };
  const info = workbook.addWorksheet('About this export');
  info.columns = [{ width: 22 }, { width: 90 }];
  info.addRows([['Billing month', periodMonth], ['Source', 'Excel copy generated from saved imported readings. The original upload was not retained.'],
    ['Reading count', readings.length], ['Units', 'Meter readings and consumption are in cubic meters (m³). Water charges are in PHP.']]);
  info.getColumn(2).alignment = { wrapText: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
