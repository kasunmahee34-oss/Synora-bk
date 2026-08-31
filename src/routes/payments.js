const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');

const prisma = require('../prismaClient');

function normalizeReservationStatus(status) {
  if (!status) return status;

  const value = String(status).trim();
  const legacyMapping = {
    confirmed: 'guaranteed',
    do_check_in: 'checked_in',
    due_checkout: 'due_checkout',
    completed: 'completed',
    checked_in: 'checked_in',
    checked_out: 'checked_out',
    room_assigned: 'room_assigned',
    closed: 'closed',
    cancelled: 'cancelled',
    no_show: 'no_show',
    tentative: 'tentative',
    guaranteed: 'guaranteed',
    in_house: 'in_house',
  };

  return legacyMapping[value] || value;
}

// Post a payment
router.post('/', authenticateToken, requirePermission('payments.create'), async (req, res) => {
  const { reservationId, amount, paymentMethod, paymentCategory = 'balance', userId } = req.body;

  if (!reservationId || !amount || !paymentMethod) {
    return res.status(400).json({ error: 'reservationId, amount, paymentMethod are required' });
  }

  // Validate payment_category against enum values
  const validCategories = ['advance', 'full', 'balance', 'refund'];
  if (!validCategories.includes(paymentCategory)) {
    return res.status(400).json({ error: `Invalid payment_category. Must be one of: ${validCategories.join(', ')}` });
  }

  try {
    // Fetch reservation to check status and current lifecycle state
    const reservation = await prisma.reservation.findUnique({
      where: { id: parseInt(reservationId) },
      select: { id: true, status: true, checkIn: true },
    });

    if (!reservation) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    // Reject payments against terminal states (cancelled, no_show)
    const terminalStates = ['cancelled', 'no_show'];
    const normalizedStatus = normalizeReservationStatus(reservation.status);
    if (terminalStates.includes(normalizedStatus)) {
      return res.status(409).json({ 
        error: `Cannot post payment against a ${normalizedStatus} reservation. Reactivation required.` 
      });
    }

    // Night Audit lock check: active and checkout-in-progress reservations can still receive payments
    const activeReservationStatuses = new Set([
      'tentative',
      'guaranteed',
      'room_assigned',
      'checked_in',
      'in_house',
      'due_checkout',
      'early_checkout',
    ]);
    const isReservationActive = activeReservationStatuses.has(normalizedStatus);

    const lastAudit = await prisma.nightAudit.findFirst({
      where: { completed: true },
      orderBy: { auditDate: 'desc' },
    });
    if (lastAudit && !isReservationActive) {
      const auditDateStr = lastAudit.auditDate.toISOString().slice(0, 10);
      if (reservation && reservation.checkIn) {
        const resCheckInStr = new Date(reservation.checkIn).toISOString().slice(0, 10);
        if (resCheckInStr <= auditDateStr) {
          return res.status(409).json({ error: `Business date is locked (last audited date: ${auditDateStr}). Payments cannot be posted for reservations on or before that date.` });
        }
      } else {
        const tzOffset = new Date().getTimezoneOffset() * 60000;
        const localTodayStr = new Date(Date.now() - tzOffset).toISOString().slice(0, 10);
        if (localTodayStr <= auditDateStr) {
          return res.status(409).json({ error: `Business date is locked (last audited date: ${auditDateStr}). Payments cannot be posted.` });
        }
      }
    }

    // Use validated paymentCategory directly as it matches the Prisma enum values
  const paymentCategoryForDb = paymentCategory; // paymentCategory is already one of ['advance','full','balance','refund']


    // Use transaction to ensure payment and status update are atomic
    const result = await prisma.$transaction(async (tx) => {
      // Create the payment
      const payment = await tx.payment.create({
        data: {
          reservationId: parseInt(reservationId),
          amount: parseFloat(amount),
          paymentMethod: paymentMethod,
          paymentCategory: paymentCategoryForDb,
          userId: userId ? parseInt(userId) : null,
        },
      });

      // Auto-guarantee: if this is an advance or full payment and reservation is tentative, transition to guaranteed
      let updatedReservation = reservation;
      if ((paymentCategory === 'advance' || paymentCategory === 'full') && normalizedStatus === 'tentative') {
        // Update reservation status
        updatedReservation = await tx.reservation.update({
          where: { id: parseInt(reservationId) },
          data: {
            status: 'guaranteed',
            guarantee_method: 'advance_payment',
            guaranteed_at: new Date(),
            guaranteed_by: userId ? parseInt(userId) : null,
          },
        });

        // Write audit log entry
        await tx.auditLog.create({
          data: {
            userId: userId ? parseInt(userId) : 1, // Default to user 1 if not provided
            action: 'STATUS_CHANGE',
            module: 'reservations',
            entityType: 'Reservation',
            entityId: parseInt(reservationId),
            description: `Reservation auto-guaranteed via ${paymentCategory} payment`,
            oldValues: { status: 'tentative' },
            newValues: { status: 'guaranteed', guarantee_method: 'advance_payment' },
          },
        });
      }

      return { payment, reservation: updatedReservation };
    });

    // Return payment with updated reservation status
    res.status(201).json({
      payment: result.payment,
      reservation: {
        id: result.reservation.id,
        status: result.reservation.status,
      },
    });
  } catch (error) {
    console.error('Error posting payment:', error);
    // Return error details for debugging (remove in production)
    res.status(500).json({ error: 'Failed to post payment', details: error.message });
  }
});

// Get payments for a specific reservation
router.get('/reservation/:reservationId', authenticateToken, requirePermission('payments.view'), async (req, res) => {
  try {
    const payments = await prisma.payment.findMany({
      where: { reservationId: parseInt(req.params.reservationId) },
      include: { user: { select: { id: true, username: true, fullName: true } } },
      orderBy: { paidAt: 'desc' },
    });
    res.json(payments);
  } catch (error) {
    console.error('Error fetching payments:', error);
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

module.exports = router;
