const prisma = require('../prismaClient');

/**
 * Outstanding balance = room charge (rate) + extra charges + tax
 *                        - payments - refunds already issued.
 * Positive = guest still owes. Zero or negative = clear to check out.
 */
async function getFolioBalance(reservationId) {
  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw new Error('Reservation not found');

  try {
    const [charges, roomCharges, chargeTax, payments, refunds] = await Promise.all([
      prisma.guestCharge.aggregate({
        where: { reservationId, isVoid: false },
        _sum: { amount: true },
      }),
      prisma.guestCharge.aggregate({
        where: {
          reservationId,
          isVoid: false,
          chargeType: { name: 'Room Charge' },
        },
        _sum: { amount: true },
      }),
      prisma.guestChargeTax.aggregate({
        where: { charge: { reservationId, isVoid: false } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { reservationId },
        _sum: { amount: true },
      }),
      prisma.refund.aggregate({
        where: { reservationId },
        _sum: { amount: true },
      }),
    ]);

    const totalGuestCharges = Number((charges && charges._sum && charges._sum.amount) || 0);
    const roomChargeTotal = Number((roomCharges && roomCharges._sum && roomCharges._sum.amount) || 0);
    const totalTaxes = Number((chargeTax && chargeTax._sum && chargeTax._sum.amount) || 0);
    const totalPayments = Number((payments && payments._sum && payments._sum.amount) || 0);
    const totalRefunds = Number((refunds && refunds._sum && refunds._sum.amount) || 0);

    const totalCharges = totalGuestCharges + totalTaxes + (roomChargeTotal > 0 ? 0 : Number(reservation.rate || 0));
    const netPaid = Math.max(totalPayments - totalRefunds, 0);

    return Math.round((totalCharges - netPaid) * 100) / 100;
  } catch (e) {
    console.error(`[getFolioBalance] failed for reservation ${reservationId}:`, e);
    // On error, return safe default so callers can continue to operate and we can surface details in logs.
    return 0;
  }
}

module.exports = { getFolioBalance };
