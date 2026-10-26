import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createWorkbook } from '../routes/financialReportRoutes.js';
import { buildCombinedReport } from '../services/financialReports.js';

test('combined Excel has numeric reconciled totals, all rows, readable headers and repeatable print titles',async()=>{
 const combined=buildCombinedReport([{billId:1,unitId:1,unitNumber:'231',payerName:'=This is literal text',duesBilled:100,waterBilled:12.34,latePenalty:1.01}],new Map([[1,10.05]]),[{unitId:1,unitNumber:'231'},{unitId:2,unitNumber:'232',residentNames:'No SOA Resident'}],'2026-10-31');
 const source=createWorkbook({filters:{label:'2026-10',startDate:'2026-10-01',endDate:'2026-10-31'},combined},'combined');
 const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await source.xlsx.writeBuffer());const sheet=workbook.getWorksheet('Overall Billing');
 let header;sheet.eachRow(row=>{if(row.getCell(1).value==='Unit')header=row.number;});
 assert.ok(header);assert.equal(sheet.views[0].ySplit,header);assert.equal(sheet.pageSetup.orientation,'landscape');assert.equal(sheet.pageSetup.printTitlesRow,`${header}:${header}`);
 assert.equal(sheet.getCell(header+1,2).value,'=This is literal text');assert.equal(sheet.getCell(header+1,2).type,ExcelJS.ValueType.String);
 assert.equal(sheet.getCell(header+1,3).value,100);assert.equal(sheet.getCell(header+1,6).value,113.35);assert.equal(sheet.getCell(header+1,7).value,10.05);assert.equal(sheet.getCell(header+1,8).value,103.3);
 assert.equal(sheet.getCell(header+2,9).value,'No SOA');assert.match(sheet.getCell(header+1,3).numFmt,/0.00/);
 const total=sheet.getRow(sheet.rowCount);assert.equal(total.getCell(1).value,'Grand Total');assert.equal(total.getCell(6).value,combined.totals.totalBilled);assert.equal(total.getCell(8).value,combined.totals.remainingBalance);
});
