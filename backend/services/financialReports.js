const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function dateAtUtc(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function validDate(value) {
  if (!datePattern.test(String(value || ''))) return false;
  const date = dateAtUtc(value);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isoToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function number(value) {
  return Number(Number(value || 0).toFixed(2));
}

function cents(value) {
  return Math.round(Number(value || 0) * 100);
}

function money(centsValue) {
  return Number((centsValue / 100).toFixed(2));
}

export function parseFinancialReportFilters(query = {}, now = new Date()) {
  const month = query.month === undefined ? undefined : String(query.month);
  const startDate = query.startDate === undefined ? undefined : String(query.startDate);
  const endDate = query.endDate === undefined ? undefined : String(query.endDate);

  if (month !== undefined && (startDate !== undefined || endDate !== undefined)) {
    throw new Error('Choose either a month or a date range.');
  }
  if ((startDate === undefined) !== (endDate === undefined)) {
    throw new Error('Provide both startDate and endDate for a date range.');
  }
  if (month !== undefined) {
    if (!monthPattern.test(month)) throw new Error('Use YYYY-MM for month.');
    const start = `${month}-01`;
    const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1));
    nextMonth.setUTCDate(0);
    return { mode: 'MONTH', month, startDate: start, endDate: nextMonth.toISOString().slice(0, 10), label: month };
  }
  if (startDate !== undefined) {
    if (!validDate(startDate) || !validDate(endDate)) throw new Error('Use YYYY-MM-DD for startDate and endDate.');
    if (startDate > endDate) throw new Error('startDate cannot be after endDate.');
    return { mode: 'DATE_RANGE', month: null, startDate, endDate, label: `${startDate} to ${endDate}` };
  }
  const today = isoToday(now);
  return parseFinancialReportFilters({ month: today.slice(0, 7) }, now);
}

export function allocateFinancialCollection({ waterBilled = 0, duesBilled = 0, latePenalty = 0, amountApplied = 0 }) {
  const components = [
    { key: 'waterCollected', amount: cents(waterBilled) },
    { key: 'duesCollected', amount: cents(duesBilled) },
    { key: 'latePenaltyCollected', amount: cents(latePenalty) },
  ];
  const totalComponentCents = components.reduce((sum, item) => sum + item.amount, 0);
  const appliedCents = Math.min(Math.max(cents(amountApplied), 0), totalComponentCents);
  const allocation = Object.fromEntries(components.map((item) => [item.key, 0]));
  if (!totalComponentCents || !appliedCents) return allocation;

  const shares = components.map((item, index) => {
    const raw = appliedCents * item.amount / totalComponentCents;
    const floor = Math.floor(raw);
    allocation[item.key] = floor;
    return { ...item, index, remainder: raw - floor };
  });
  let remainder = appliedCents - Object.values(allocation).reduce((sum, value) => sum + value, 0);
  for (const item of shares.sort((left, right) => right.remainder - left.remainder || left.index - right.index)) {
    if (!remainder) break;
    allocation[item.key] += 1;
    remainder -= 1;
  }
  return Object.fromEntries(Object.entries(allocation).map(([key, value]) => [key, money(value)]));
}

export function calculateCollectionEfficiency(totalCollections = 0, totalBilling = 0) {
  const billed = Number(totalBilling || 0);
  if (billed <= 0) return null;
  return Number(((Number(totalCollections || 0) / billed) * 100).toFixed(1));
}

const billDetailSql = `
  SELECT b.id AS "billId", b.unit_id AS "unitId", b.unit_number_snapshot AS "unitNumber",
    COALESCE(NULLIF(b.payer_name_snapshot, ''), 'Unassigned resident') AS "payerName",
    b.period_start_snapshot AS "periodStart", b.period_end_snapshot AS "periodEnd",
    b.due_date_snapshot AS "dueDate", p.status AS "batchStatus",
    COALESCE(SUM(c.quantity * c.rate_applied) FILTER (WHERE c.charge_type = 'WATER'), 0) AS "waterBilled",
    COALESCE(SUM(c.quantity * c.rate_applied) FILTER (WHERE c.charge_type = 'ASSOCIATION_DUES'), 0) AS "duesBilled",
    CASE WHEN b.late_penalty_applied_at IS NOT NULL AND b.late_penalty_applied_at::date <= $1::date
      THEN COALESCE(b.late_penalty_amount, 0) ELSE 0 END AS "latePenalty"
  FROM unit_bills b
  JOIN billing_periods p ON p.id = b.billing_period_id
  LEFT JOIN bill_charges c ON c.unit_bill_id = b.id
  WHERE p.period_type = 'LIVE_BILLING'
    AND p.status IN ('GENERATED', 'FORWARDED', 'CLOSED')`;

function normalizeBill(row) {
  const waterBilled = number(row.waterBilled);
  const duesBilled = number(row.duesBilled);
  const latePenalty = number(row.latePenalty);
  return {
    ...row,
    billId: Number(row.billId),
    unitId: Number(row.unitId),
    waterBilled,
    duesBilled,
    latePenalty,
    totalBilled: number(waterBilled + duesBilled + latePenalty),
  };
}

async function readBills(pool, endDate, conditions, values) {
  const result = await pool.query(
    `${billDetailSql}\n      ${conditions.join('\n      ')}\n    GROUP BY b.id, p.status`,
    [endDate, ...values],
  );
  return result.rows.map(normalizeBill);
}

function sum(rows, key) {
  return number(rows.reduce((total, row) => total + Number(row[key] || 0), 0));
}

function toChargeBillingRow(bill, charge) {
  const billed = charge === 'WATER' ? bill.waterBilled : bill.duesBilled;
  return {
    billId: bill.billId,
    unitNumber: bill.unitNumber,
    payerName: bill.payerName,
    periodStart: bill.periodStart,
    periodEnd: bill.periodEnd,
    batchStatus: bill.batchStatus,
    billed,
  };
}

export async function getFinancialReport(pool, filters) {
  const billedBills = await readBills(pool, filters.endDate, [
    'AND b.period_start_snapshot >= $2::date',
    'AND b.period_start_snapshot <= $3::date',
  ], [filters.startDate, filters.endDate]);

  const receivableBills = await readBills(pool, filters.endDate, [
    'AND b.period_start_snapshot <= $2::date',
  ], [filters.endDate]);

  const [collectionResult, receivableAppliedResult] = await Promise.all([
    pool.query(
      `SELECT ps.id AS "paymentId", ps.verified_payment_date AS "paymentDate",
         ps.payment_method AS "paymentMethod", ps.verified_reference_no AS "paymentReference",
         pa.amount_applied AS "appliedAmount", b.id AS "billId", b.unit_id AS "unitId",
         b.unit_number_snapshot AS "unitNumber",
         COALESCE(NULLIF(b.payer_name_snapshot, ''), 'Unassigned resident') AS "payerName",
         b.period_start_snapshot AS "periodStart", b.period_end_snapshot AS "periodEnd",
         b.due_date_snapshot AS "dueDate", p.status AS "batchStatus",
         COALESCE(SUM(c.quantity * c.rate_applied) FILTER (WHERE c.charge_type = 'WATER'), 0) AS "waterBilled",
         COALESCE(SUM(c.quantity * c.rate_applied) FILTER (WHERE c.charge_type = 'ASSOCIATION_DUES'), 0) AS "duesBilled",
         CASE WHEN b.late_penalty_applied_at IS NOT NULL AND b.late_penalty_applied_at::date <= $1::date
           THEN COALESCE(b.late_penalty_amount, 0) ELSE 0 END AS "latePenalty"
       FROM payment_applications pa
       JOIN payment_submissions ps ON ps.id = pa.payment_submission_id
       JOIN unit_bills b ON b.id = pa.unit_bill_id
       JOIN billing_periods p ON p.id = b.billing_period_id
       LEFT JOIN bill_charges c ON c.unit_bill_id = b.id
       WHERE p.period_type = 'LIVE_BILLING'
         AND p.status IN ('GENERATED', 'FORWARDED', 'CLOSED')
         AND ps.review_status = 'APPROVED'
         AND ps.verified_payment_date >= $2::date
         AND ps.verified_payment_date <= $3::date
       GROUP BY ps.id, pa.id, b.id, p.status
       ORDER BY ps.verified_payment_date, ps.id, pa.id`,
      [filters.endDate, filters.startDate, filters.endDate],
    ),
    pool.query(
      `SELECT pa.unit_bill_id AS "billId", COALESCE(SUM(pa.amount_applied), 0) AS applied
       FROM payment_applications pa
       JOIN payment_submissions ps ON ps.id = pa.payment_submission_id
       WHERE ps.review_status = 'APPROVED'
         AND ps.verified_payment_date <= $1::date
       GROUP BY pa.unit_bill_id`,
      [filters.endDate],
    ),
  ]);

  const applicationRows = collectionResult.rows.map((row) => {
    const bill = normalizeBill(row);
    const allocation = allocateFinancialCollection({
      waterBilled: bill.waterBilled,
      duesBilled: bill.duesBilled,
      latePenalty: bill.latePenalty,
      amountApplied: row.appliedAmount,
    });
    return {
      paymentId: Number(row.paymentId),
      paymentDate: row.paymentDate,
      paymentMethod: row.paymentMethod,
      paymentReference: row.paymentReference,
      appliedAmount: number(row.appliedAmount),
      ...bill,
      ...allocation,
    };
  });

  const cashResult = await pool.query(
    `SELECT COALESCE(SUM(verified_amount), 0) AS "totalCollections"
     FROM payment_submissions
     WHERE review_status = 'APPROVED'
       AND verified_payment_date >= $1::date
       AND verified_payment_date <= $2::date`,
    [filters.startDate, filters.endDate],
  );
  const totalCollections = number(cashResult.rows[0]?.totalCollections);
  const totalBilling = sum(billedBills, 'totalBilled');
  const totalApplied = sum(applicationRows, 'appliedAmount');
  const appliedByBill = new Map(receivableAppliedResult.rows.map((row) => [Number(row.billId), number(row.applied)]));
  const receivables = receivableBills.map((bill) => {
    const paidAmount = Math.min(appliedByBill.get(bill.billId) || 0, bill.totalBilled);
    const remainingBalance = number(Math.max(bill.totalBilled - paidAmount, 0));
    const paymentStatus = paidAmount >= bill.totalBilled && bill.totalBilled > 0
      ? 'PAID'
      : paidAmount > 0 ? 'PARTIAL' : bill.dueDate < filters.endDate ? 'OVERDUE' : 'UNPAID';
    return { ...bill, paidAmount, remainingBalance, paymentStatus };
  }).filter((row) => row.remainingBalance > 0).sort((left, right) => String(left.unitNumber).localeCompare(String(right.unitNumber), undefined, { numeric: true }));

  return {
    filters,
    overview: {
      totalBilling,
      totalCollections,
      collectionEfficiency: calculateCollectionEfficiency(totalCollections, totalBilling),
      waterBilled: sum(billedBills, 'waterBilled'),
      duesBilled: sum(billedBills, 'duesBilled'),
      latePenalties: sum(billedBills, 'latePenalty'),
      waterCollected: sum(applicationRows, 'waterCollected'),
      duesCollected: sum(applicationRows, 'duesCollected'),
      latePenaltyCollected: sum(applicationRows, 'latePenaltyCollected'),
      unappliedCredits: number(Math.max(totalCollections - totalApplied, 0)),
      outstandingBalance: sum(receivables, 'remainingBalance'),
    },
    dues: {
      billedRows: billedBills.map((bill) => toChargeBillingRow(bill, 'ASSOCIATION_DUES')),
      collectionRows: applicationRows.filter((row) => row.duesCollected > 0).map((row) => ({ ...row, collected: row.duesCollected })),
    },
    water: {
      billedRows: billedBills.map((bill) => toChargeBillingRow(bill, 'WATER')),
      collectionRows: applicationRows.filter((row) => row.waterCollected > 0).map((row) => ({ ...row, collected: row.waterCollected })),
    },
    paidDues: {
      rows: applicationRows
        .filter((row) => row.duesCollected > 0 || row.waterCollected > 0)
        .map((row) => ({
          ...row,
          combinedCollected: number(row.duesCollected + row.waterCollected),
        })),
    },
    receivables,
  };
}
