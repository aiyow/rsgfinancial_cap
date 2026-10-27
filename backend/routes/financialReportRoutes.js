import express from 'express';
import ExcelJS from 'exceljs';
import pool from '../config/db.js';
import { allowRoles, requireAuth } from '../middleware/authMiddleware.js';
import { getFinancialReport, parseFinancialReportFilters } from '../services/financialReports.js';
import { applyDueLatePenalties } from "../services/payments.js";

const router = express.Router();
const tabLabels = { overview:'Overview', combined:'Overall Billing', dues:'Association Dues', water:'Water Billing', paidDues:'Paid Monthly Dues', receivables:'Accounts Receivable', occupancy:'Unit Occupancy' };
const statusLabels = { PAID:'Paid', PARTIAL:'Partially Paid', UNPAID:'Unpaid', NO_CHARGES:'No Charges', NO_SOA:'No SOA' };
const combinedFields = ['duesBilled','waterBilled','latePenalty','totalBilled','paidAmount','remainingBalance'];

async function readReport(filters) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const report = await getFinancialReport(client,filters);
    await client.query('COMMIT');
    return report;
  } catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
  finally { client.release(); }
}

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
    ['Total monthly billing', money(report.overview.totalBilling), 'currency'],
    ['Total monthly collections', money(report.overview.totalCollections), 'currency'],
    ['Collection efficiency', report.overview.collectionEfficiency === null ? '—' : report.overview.collectionEfficiency / 100, 'percent'],
    ['Association dues billed', money(report.overview.duesBilled), 'currency'],
    ['Association dues collected', money(report.overview.duesCollected), 'currency'],
    ['Water billed', money(report.overview.waterBilled), 'currency'],
    ['Water collected', money(report.overview.waterCollected), 'currency'],
    ['Late penalties', money(report.overview.latePenalties), 'currency'],
    ['Outstanding balance', money(report.overview.outstandingBalance), 'currency'],
    ['Unapplied advance credits', money(report.overview.unappliedCredits), 'currency'],
  ];
  sheet.addRow([]);
  const heading = sheet.addRow(['Summary']);
  heading.font = { bold: true };
  rows.forEach(([label, value, format]) => {
    const row = sheet.addRow([label, value]);
    if (format === 'currency') row.getCell(2).numFmt = '₱#,##0.00';
    if (format === 'percent') row.getCell(2).numFmt = '0.0%';
  });
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
  return headerRow.number;
}

export function createWorkbook(report, tab) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(tabLabels[tab]);
  sheet.columns = [{ width: 16 }, { width: 24 }, { width: 16 }, { width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  sheet.addRow(['ResiDens Financial Report']);
  sheet.getRow(1).font = { size: 16, bold: true, color: { argb: 'FF1C4E30' } };
  sheet.addRow([`Period: ${report.filters.label}`]);
  if (tab === 'overview') addSummary(sheet, report);
  if (tab === 'combined') addCombinedReport(sheet,report);
  if (tab === 'dues' || tab === 'water') {
    const section = report[tab];
    addTable(sheet, ['Unit', 'Resident / payer', 'Billing period', 'Batch status', 'Billed'], section.billedRows.map((row) => [row.unitNumber, row.payerName, `${date(row.periodStart)} to ${date(row.periodEnd)}`, row.batchStatus, money(row.billed)]), [5]);
    addTable(sheet, ['Payment date', 'Unit', 'Resident / payer', 'Bill period', 'Applied payment', 'Collected for charge'], section.collectionRows.map((row) => [date(row.paymentDate), row.unitNumber, row.payerName, date(row.periodStart), money(row.appliedAmount), money(row.collected)]), [5, 6]);
  }
  if (tab === 'paidDues') {
    const rows = report.paidDues.rows;
    addTable(sheet, ['Payment date', 'Unit', 'Resident / payer', 'SOA period', 'Association dues paid', 'Water paid', 'Combined paid'], rows.map((row) => [date(row.paymentDate), row.unitNumber, row.payerName, date(row.periodStart), money(row.duesCollected), money(row.waterCollected), money(row.combinedCollected)]), [5, 6, 7]);
    const total = sheet.addRow(['Total', '', '', '', money(rows.reduce((sum, row) => sum + Number(row.duesCollected || 0), 0)), money(rows.reduce((sum, row) => sum + Number(row.waterCollected || 0), 0)), money(rows.reduce((sum, row) => sum + Number(row.combinedCollected || 0), 0))]);
    total.font = { bold: true };
    [5, 6, 7].forEach((column) => { total.getCell(column).numFmt = '₱#,##0.00'; });
  }
  if (tab === 'receivables') {
    sheet.getCell('A2').value = `Outstanding as of ${report.filters.endDate}. Includes earlier unpaid bills.`;
    sheet.mergeCells('A2:H2');
    sheet.getRow(2).alignment = { wrapText:true, vertical:'middle' };
    sheet.getRow(2).height = 28;
    addTable(sheet, ['Unit', 'Resident / payer', 'Bill period', 'Due date', 'Billed', 'Paid', 'Balance', 'Status'], report.receivables.map((row) => [row.unitNumber, row.payerName, date(row.periodStart), date(row.dueDate), money(row.totalBilled), money(row.paidAmount), money(row.remainingBalance), row.paymentStatus]), [5, 6, 7]);
  }
  if (tab === 'occupancy') {
    addTable(sheet, ['Unit', 'Floor', 'Resident / payer', 'Occupancy'], report.occupancy.rows.map((row) => [row.unitNumber, row.floor || '—', row.residentNames, row.occupancyStatus]));
    const total = sheet.addRow(['Total units', report.occupancy.totalUnits, 'Occupied', report.occupancy.occupiedUnits, 'Vacant', report.occupancy.vacantUnits]);
    total.font = { bold: true };
  }
  for (const row of sheet.getRows(1, sheet.rowCount) || []) row.eachCell(cell => { cell.alignment = { ...cell.alignment, vertical:'middle' }; });
  return workbook;
}

function addCombinedReport(sheet,report) {
  const { rows,totals,asOfDate }=report.combined;
  sheet.columns=[{width:12},{width:34},{width:19},{width:17},{width:16},{width:19},{width:19},{width:21},{width:20}];
  sheet.getCell('A1').value='ResiDens Overall Billing Report';
  sheet.addRow([`Payment cutoff: ${asOfDate}`]);
  sheet.addRow(['All generated SOAs starting in the selected period, including unpublished SOAs. Earlier bills are excluded.']);
  sheet.addRow(['Paid means approved amounts applied to these SOAs, dated through the cutoff. Unapplied advance credits are excluded.']);
  for(let row=1;row<=5;row++){sheet.mergeCells(row,1,row,9);sheet.getRow(row).alignment={wrapText:true,vertical:'middle'};sheet.getRow(row).height=row===1?26:24;}
  sheet.addRow([]);
  for(const [label,key] of [['Total Billed','totalBilled'],['Total Paid','paidAmount'],['Remaining Balance','remainingBalance']]) {
    const row=sheet.addRow([label,'',totals[key]]);sheet.mergeCells(row.number,1,row.number,2);
    row.font={bold:true};row.getCell(3).numFmt='₱#,##0.00';
  }
  const header=addTable(sheet,['Unit','Resident / Payer','Association Dues','Water Bill','Penalties','Total Billed','Paid','Remaining Balance','Status'],
    rows.map(row=>[row.unitNumber,row.payerName,...combinedFields.map(key=>row[key]),statusLabels[row.status]]),[3,4,5,6,7,8]);
  sheet.getRow(header).height=30;sheet.getRow(header).alignment={wrapText:true,vertical:'middle'};
  rows.forEach((row,index)=>{const dataRow=sheet.getRow(header+index+1);dataRow.getCell(2).alignment={wrapText:true,vertical:'middle'};
    dataRow.height=Math.max(22,Math.ceil(String(row.payerName).length/30)*15);
    for(let col=3;col<=8;col++)dataRow.getCell(col).alignment={horizontal:'right',vertical:'middle'};
  });
  const total=sheet.addRow(['Grand Total','',...combinedFields.map(key=>totals[key]),'']);
  total.font={bold:true};total.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEAF6EE'}};
  for(let col=3;col<=8;col++)total.getCell(col).numFmt='₱#,##0.00';
  sheet.autoFilter={from:{row:header,column:1},to:{row:header+rows.length,column:9}};
  sheet.pageSetup={paperSize:9,orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,
    printTitlesRow:`${header}:${header}`,printArea:`A1:I${sheet.rowCount}`};
}

router.use(requireAuth, allowRoles('ADMIN', 'COLLECTOR'));
router.use(async (req, res, next) => {
  try { await applyDueLatePenalties(pool); next(); } catch (error) { next(error); }
});

router.get('/financial', async (req, res, next) => {
  try {
    const report = await readReport(queryFilters(req));
    res.set('Cache-Control','no-store');
    return res.json(report);
  } catch (error) { return next(error); }
});

router.get('/financial/export', async (req, res, next) => {
  try {
    const requestedTab = String(req.query.tab || 'overview').trim().toLowerCase();
    const tab = Object.keys(tabLabels).find(key=>key.toLowerCase()===requestedTab);
    if (!tab) return res.status(400).json({ message: 'Choose a valid report tab to export.' });
    const report = await readReport(queryFilters(req));
    res.set('Cache-Control','no-store');
    const workbook = createWorkbook(report, tab);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="financial-report-${tab}-${report.filters.startDate}.xlsx"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) { return next(error); }
});

export default router;
