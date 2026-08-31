// backend/src/services/taxInvoiceService.js
//
// Replaces hardcoded SC 10% / VAT 18% / TDL 1% / NBT 2% with rates read from
// the tax_config table, mirroring the legacy basevaluetax config pattern.
// Falls back to the previous hardcoded values ONLY if no config row exists,
// so nothing breaks mid-migration -- but that fallback should be removed
// once tax_config is confirmed seeded correctly.

const prisma = require('../prismaClient');

const FALLBACK_RATES = {
  SC:  { rate: 0.10, compoundOn: 'room_revenue' },
  VAT: { rate: 0.18, compoundOn: 'room_revenue_plus_sc' },
  TDL: { rate: 0.01, compoundOn: 'room_revenue' },
  NBT: { rate: 0.02, compoundOn: 'room_revenue' },
};

/**
 * Fetch the active rate for a tax type on a given date (defaults to today).
 */
async function getActiveRate(taxType, { propertyId = 1, onDate = new Date() } = {}) {
  const row = await prisma.taxConfig.findFirst({
    where: {
      taxType,
      propertyId,
      effectiveFrom: { lte: onDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: onDate } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });

  if (row) return { rate: row.rate, compoundOn: row.compoundOn };

  console.warn(`[taxInvoiceService] No tax_config row for ${taxType} — using fallback rate.`);
  return FALLBACK_RATES[taxType];
}

/**
 * Compute the full tax breakdown for a room revenue amount.
 * Order matters: SC first (it can compound into VAT), then the rest off room_revenue.
 */
async function calculateTaxBreakdown(roomRevenue, { propertyId = 1, onDate = new Date() } = {}) {
  const safeRevenue = Number(roomRevenue) || 0;
  if (safeRevenue <= 0) {
    return { roomRevenue: 0, sc: 0, vat: 0, tdl: 0, nbt: 0, totalAmount: 0 };
  }

  const scConfig = await getActiveRate('SC', { propertyId, onDate });
  const sc = roundMoney(safeRevenue * scConfig.rate);

  const vatConfig = await getActiveRate('VAT', { propertyId, onDate });
  const vatBase = vatConfig.compoundOn === 'room_revenue_plus_sc' ? safeRevenue + sc : safeRevenue;
  const vat = roundMoney(vatBase * vatConfig.rate);

  const tdlConfig = await getActiveRate('TDL', { propertyId, onDate });
  const tdl = roundMoney(safeRevenue * tdlConfig.rate);

  const nbtConfig = await getActiveRate('NBT', { propertyId, onDate });
  const nbt = roundMoney(safeRevenue * nbtConfig.rate);

  const totalAmount = roundMoney(safeRevenue + sc + vat + tdl + nbt);

  return { roomRevenue: safeRevenue, sc, vat, tdl, nbt, totalAmount };
}

function roundMoney(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { calculateTaxBreakdown, getActiveRate };
