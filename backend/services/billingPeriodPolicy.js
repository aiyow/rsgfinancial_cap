// Browser and API deployments have independent roots; keep these policy copies identical.
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

function daysInMonth(year, month) {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function dateParts(value) {
  if (typeof value !== 'string') return null;
  const match = datePattern.exec(value);
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

function formatDate(year, month, day) {
  if (year < 1 || year > 9999) return '';
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isBillingDate(value) {
  return Boolean(dateParts(value));
}

export function addCalendarMonths(value, months) {
  const parts = dateParts(value);
  if (!parts || !Number.isInteger(months)) return '';
  const index = parts.year * 12 + parts.month - 1 + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return formatDate(year, month, Math.min(parts.day, daysInMonth(year, month)));
}

function nextDay(value) {
  const parts = dateParts(value);
  if (!parts) return '';
  if (parts.day < daysInMonth(parts.year, parts.month)) return formatDate(parts.year, parts.month, parts.day + 1);
  return parts.month === 12 ? formatDate(parts.year + 1, 1, 1) : formatDate(parts.year, parts.month + 1, 1);
}

export function billingPeriodDateBounds({ periodStart, periodEnd }) {
  return {
    periodEndMin: addCalendarMonths(periodStart, 1),
    periodEndMax: addCalendarMonths(periodStart, 2),
    dueDateMin: nextDay(periodEnd),
    dueDateMax: addCalendarMonths(periodEnd, 1),
  };
}

export function billingPeriodErrors(values) {
  const errors = {};
  for (const [field, label] of [['periodStart', 'period start'], ['periodEnd', 'period end'], ['dueDate', 'due date']]) {
    if (!isBillingDate(values[field])) errors[field] = `Choose a valid ${label} date.`;
  }
  const bounds = billingPeriodDateBounds(values);
  if (!errors.periodStart && !errors.periodEnd) {
    if (values.periodEnd <= values.periodStart) errors.periodEnd = 'Period end must be after period start.';
    else if (!bounds.periodEndMin || values.periodEnd < bounds.periodEndMin) errors.periodEnd = 'The billing period must be at least 1 calendar month.';
    else if (bounds.periodEndMax && values.periodEnd > bounds.periodEndMax) errors.periodEnd = 'The billing period must not exceed 2 calendar months.';
  }
  if (isBillingDate(values.periodEnd) && !errors.dueDate) {
    if (values.dueDate <= values.periodEnd) errors.dueDate = 'Due date must be after period end.';
    else if (bounds.dueDateMax && values.dueDate > bounds.dueDateMax) errors.dueDate = 'Due date must be within 1 calendar month after period end.';
  }
  for (const [field, label] of [['waterRatePerCubicM', 'Water rate'], ['associationDuesRatePerSqm', 'Association dues rate']]) {
    const value = values[field];
    if (!['number', 'string'].includes(typeof value) || !Number.isFinite(Number(value)) || Number(value) < 0.01) {
      errors[field] = `${label} must be greater than zero (minimum 0.01).`;
    }
  }
  if (values.latePenaltyPercent !== undefined) {
    const value = values.latePenaltyPercent;
    if (!['number', 'string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 100) {
      errors.latePenaltyPercent = 'Late penalty must be between 0 and 100 percent.';
    }
  }
  return errors;
}
