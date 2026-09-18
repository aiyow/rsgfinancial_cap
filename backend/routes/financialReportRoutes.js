import express from 'express';
import ExcelJS from 'exceljs';
import pool from '../config/db.js';
import { allowRoles, requireAuth } from '../middleware/authMiddleware.js';
import { getFinancialReport, parseFinancialReportFilters } from '../services/financialReports.js';

const router = express.Router();
const tabs = new Set(['overview', 'dues', 'water', 'receivables']);

function queryFilters(req) {
  try {
    return parseFinancialReportFilters(req.query);
  } catch (error) {
    const requestError = new Error(error.message);
    requestError.status = 400;
    throw requestError;
  }
}

function date(value) {
  return String(value || '').slice(0, 10);
}

function money(value) {
  return Number(value || 0);
}

function addSummary(sheet, report) {
  const rows = [
    ['Total monthly billing', money(report.overview.totalBilling)],
    ['Total monthly collections', money(report.overview.totalCollections)],
    ['Association dues billed', money(report.overview.duesBilled)],
    ['Association dues collected', money(report.overview.duesCollected)],
    ['Water billed', money(report.overview.waterBilled)],
    ['Water collected', money(report.overview.waterCollected)],
    ['Late penalties', money(report.overview.latePenalties)],
    ['Outstanding balance', money(report.overview.outstandingBalance)],
    ['Unapplied advance credits', money(report.overview.unappliedCredits)],
  ];
  sheet.addRow([]);
  sheet.addRow(['Summary']);
  rows.forEach((row) => sheet.addRow(row));
  const first = sheet.rowCount - rows.length;
  sheet.getRow(first).font = { bold: true };
  for (let index = first + 1; index <= sheet.rowCount; index += 1) sheet.getCell(`B${index}`).numFmt = '₱#,##0.00';
}

function addTable(sheet, headers, rows, moneyColumns = []) {
  sheet.addRow([]);
  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F8F5B' } };
  rows.forEach((row) => {
    const dataRow = sheet.addRow(row);
    moneyColumns.forEach((column) => { dataRow.getCell(column).numFmt = '₱#,##0.00'; });
  });
  sheet.views = [{ state: 'frozen', ySplit: headerRow.number }];
}

function createWorkbook(report, tab) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet({ overview: 'Overview', dues: 'Association Dues', water: 'Water Billing', receivables: 'Accounts Receivable' }[tab]);
  sheet.columns = [{ width: 16 }, { width: 24 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  sheet.addRow(['ResiDens Financial Report']);
  sheet.getRow(1).font = { size: 16, bold: true, color: { argb: 'FF1C4E30' } };
  sheet.addRow([`Period: ${report.filters.label}`]);
  if (tab === 'overview') addSummary(sheet, report);
  if (tab === 'dues' || tab === 'water') {
    const section = report[tab];
    addTable(sheet, ['Unit', 'Resident / payer', 'Billing period', 'Batch status', 'Billed'], section.billedRows.map((row) => [row.unitNumber, row.payerName, `${date(row.periodStart)} to ${date(row.periodEnd)}`, row.batchStatus, money(row.billed)]), [5]);
    addTable(sheet, ['Payment date', 'Unit', 'Resident / payer', 'Bill period', 'Applied payment', 'Collected for charge'], section.collectionRows.map((row) => [date(row.paymentDate), row.unitNumber, row.payerName, date(row.periodStart), money(row.appliedAmount), money(row.collected)]), [5, 6]);
  }
  if (tab === 'receivables') {
    addTable(sheet, ['Unit', 'Resident / payer', 'Bill period', 'Due date', 'Billed', 'Paid', 'Balance', 'Status'], report.receivables.map((row) => [row.unitNumber, row.payerName, date(row.periodStart), date(row.dueDate), money(row.totalBilled), money(row.paidAmount), money(row.remainingBalance), row.paymentStatus]), [5, 6, 7]);
  }
  for (const row of sheet.getRows(1, sheet.rowCount) || []) row.alignment = { vertical: 'middle' };
  return workbook;
}

router.use(requireAuth, allowRoles('ADMIN', 'COLLECTOR'));

router.get('/financial', async (req, res, next) => {
  try {
    const report = await getFinancialReport(pool, queryFilters(req));
    return res.json(report);
  } catch (error) { return next(error); }
});

router.get('/financial/export', async (req, res, next) => {
  try {
    const tab = String(req.query.tab || 'overview').toLowerCase();
    if (!tabs.has(tab)) return res.status(400).json({ message: 'Choose a valid report tab to export.' });
    const report = await getFinancialReport(pool, queryFilters(req));
    const workbook = createWorkbook(report, tab);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="financial-report-${tab}-${report.filters.startDate}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) { return next(error); }
});

export default router;
