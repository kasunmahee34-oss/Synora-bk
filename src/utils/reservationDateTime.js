const DEFAULT_EXPECTED_CHECK_IN_TIME = '14:00';
const DEFAULT_EXPECTED_CHECK_OUT_TIME = '12:00';

function parseReservationDateTime(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;

  const raw = String(value).trim();
  const normalized = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw) ? `${raw}:00Z` : raw;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    const error = new Error(`${fieldName} must be a valid date and time.`);
    error.status = 400;
    throw error;
  }
  return parsed;
}

function datePart(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function combineDateAndTime(dateValue, timeValue) {
  if (!dateValue) return null;
  const date = datePart(dateValue);
  const time = timeValue || '00:00';
  return parseReservationDateTime(`${date}T${time}`, 'reservation date and time');
}

function fallbackExpectedDateTime(dateValue, defaultTime) {
  return combineDateAndTime(dateValue, defaultTime);
}

function validateExpectedDateRange(checkInAt, checkOutAt) {
  if (!checkInAt || !checkOutAt) return;
  if (checkOutAt <= checkInAt) {
    const error = new Error('Expected check-out date and time must be after expected check-in date and time.');
    error.status = 400;
    throw error;
  }
}

function getActiveBusinessDate(referenceDate = new Date()) {
  // Use LOCAL date methods so the business date reflects the hotel's calendar day,
  // not the UTC date. At e.g. 10 PM UTC-7, UTC is already the next day — using
  // getUTCDate() would return tomorrow's date and incorrectly reject same-day reservations.
  const baseDate = new Date(referenceDate);
  return new Date(Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate(), 0, 0, 0, 0));
}

function validateActiveBusinessDateRange(checkInAt, checkOutAt, referenceDate = new Date()) {
  if (!checkInAt || !checkOutAt) return;

  const activeBusinessDate = getActiveBusinessDate(referenceDate);
  const checkInDate = new Date(datePart(checkInAt) + 'T00:00:00Z');
  const checkOutDate = new Date(datePart(checkOutAt) + 'T00:00:00Z');

  if (checkInDate < activeBusinessDate || checkOutDate < activeBusinessDate) {
    const error = new Error(`Reservations cannot be created or edited before the active business date (${datePart(activeBusinessDate)}).`);
    error.status = 400;
    throw error;
  }
}

module.exports = {
  DEFAULT_EXPECTED_CHECK_IN_TIME,
  DEFAULT_EXPECTED_CHECK_OUT_TIME,
  parseReservationDateTime,
  datePart,
  combineDateAndTime,
  fallbackExpectedDateTime,
  validateExpectedDateRange,
  getActiveBusinessDate,
  validateActiveBusinessDateRange,
};
