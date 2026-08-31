const express = require('express');
const router = express.Router();
const { calculateTaxBreakdown } = require('../services/taxInvoiceService');
const { getFolioBalance } = require('../services/folioService');
const { authenticateToken, requireRole } = require('../middlewares/auth');
const sm = require('../services/reservationStateMachine');

const prisma = require('../prismaClient');

/**
 * GET /api/night-audit/status
 * Returns current business date, last completed run, and pending arrivals/departures.
 */
router.get('/status', authenticateToken, requireRole(['admin', 'front_office']), async (req, res) => {
  try {
    const lastAudit = await prisma.nightAudit.findFirst({
      where: { completed: true },
      orderBy: { auditDate: 'desc' },
      include: { user: { select: { fullName: true, username: true } } }
    });

    // Business date = TODAY in the server's LOCAL timezone.
    // The server is assumed to run in the same timezone as the hotel.
    // We must use LOCAL date methods (getFullYear/Month/Date), NOT UTC methods —
    // using UTC would give "tomorrow" for a hotel in a UTC- timezone
    // (e.g. at 9:43 PM UTC-7, UTC is already the next day).
    // We still store it as a UTC-midnight timestamp so Prisma's @db.Date
    // comparison works correctly.
    const _now = new Date();
    const businessDate = new Date(Date.UTC(
      _now.getFullYear(),   // LOCAL year
      _now.getMonth(),      // LOCAL month
      _now.getDate()        // LOCAL date  ← key fix: Aug 28, not Aug 29
    ));

    // Return ISO date string (YYYY-MM-DD) — date-only, no time component.
    const businessDateStr = businessDate.toISOString().slice(0, 10);

    // Let the frontend know whether today's audit is already completed
    // so it can disable the Run button and show a helpful message.
    const todayAlreadyCompleted = !!(
      lastAudit &&
      new Date(lastAudit.auditDate).toISOString().slice(0, 10) === businessDateStr &&
      lastAudit.completed
    );

    // List pending arrivals (statuses that indicate not-yet-checked-in reservations, check-in date <= businessDate)
    const pendingArrivals = await prisma.reservation.findMany({
      where: {
        status: { in: ['tentative', 'guaranteed'] },
        checkIn: { lte: businessDate }
      },
      include: { guest: true, room: true }
    });

    const noShowCandidates = pendingArrivals.filter(r => r.status === 'tentative');

    // List pending departures (in-house or already flagged due_checkout guests scheduled to depart on or before businessDate and not actually checked out)
    const pendingDepartures = await prisma.reservation.findMany({
      where: {
        status: { in: ['in_house', 'due_checkout'] },
        checkOut: { lte: businessDate },
        checkedOutAt: null
      },
      include: { guest: true, room: true }
    });

    const pendingDueCheckouts = await prisma.reservation.findMany({
      where: {
        status: 'due_checkout',
        checkedOutAt: null,
      },
      include: { guest: true, room: true }
    });

    const blockingDueCheckouts = [];
    for (const reservation of pendingDueCheckouts) {
      try {
        const totalCharges = await getFolioBalance(reservation.id);
        if (totalCharges > 0) {
          blockingDueCheckouts.push({
            reservationId: reservation.id,
            confoNo: reservation.confoNo,
            guestName: reservation.guest?.fullName || 'Unknown',
            roomNumber: reservation.room?.roomNumber || 'N/A',
            expectedCheckout: reservation.expectedCheckOutAt || reservation.checkOut,
            outstandingBalance: totalCharges,
          });
        }
      } catch (e) {
        console.error(`[GET /api/night-audit/status] getFolioBalance failed for reservation ${reservation.id}:`, e);
        // Don't fail the entire status endpoint because of one folio lookup problem.
        // Skip this reservation and continue checking others.
      }
    }

    return res.json({
      lastAudit,
      businessDate: businessDateStr,
      todayAlreadyCompleted,
      pendingArrivals,
      noShowCandidates,
      noShowCandidateCount: noShowCandidates.length,
      pendingDepartures,
      pendingDueCheckouts,
      blockingDueCheckouts,
      hasBlockingDueCheckouts: blockingDueCheckouts.length > 0
    });
  } catch (err) {
    console.error('[GET /api/night-audit/status] error:', err);
    return res.status(500).json({ error: 'Failed to fetch night audit status' });
  }
});

/**
 * POST /api/night-audit/run
 * Run night audit for the current business date.
 * Posts room charges, locks the date, and triggers session logouts.
 */
router.post('/run', authenticateToken, requireRole(['admin', 'front_office']), async (req, res) => {
  const userId = req.user.id;

  try {
    let businessDate;
    if (req.body && req.body.auditDate) {
      // auditDate from body is a "YYYY-MM-DD" string → new Date() parses it as UTC midnight.
      // Use UTC methods here because the string is already timezone-agnostic.
      const parsed = new Date(req.body.auditDate);
      businessDate = new Date(Date.UTC(
        parsed.getUTCFullYear(),
        parsed.getUTCMonth(),
        parsed.getUTCDate()
      ));
    } else {
      // No date supplied → use today in the server's LOCAL timezone (hotel timezone).
      // Must use local methods — UTC methods give "tomorrow" in UTC- timezones at night.
      const _n = new Date();
      businessDate = new Date(Date.UTC(
        _n.getFullYear(),   // LOCAL year
        _n.getMonth(),      // LOCAL month
        _n.getDate()        // LOCAL date
      ));
    }

    // Human-readable label for messages (YYYY-MM-DD only)
    const targetDateStr = businessDate.toISOString().slice(0, 10);

    // todayEnd: end-of-day in server LOCAL timezone, stored as UTC timestamp.
    // Using local methods ensures this matches what the hotel considers "today".
    const _now = new Date();
    const todayEnd = new Date(Date.UTC(
      _now.getFullYear(),   // LOCAL year
      _now.getMonth(),      // LOCAL month
      _now.getDate(),       // LOCAL date
      23, 59, 59, 999
    ));

    if (businessDate > todayEnd) {
      return res.status(400).json({ error: `Cannot run Night Audit for a future date (${targetDateStr}).` });
    }

    const existingAudit = await prisma.nightAudit.findUnique({
      where: { auditDate: businessDate }
    });
    if (existingAudit && existingAudit.completed) {
      return res.status(409).json({ error: `Night Audit for business date ${targetDateStr} has already been completed.` });
    }

    const dueCheckoutReservations = await prisma.reservation.findMany({
      where: { status: 'due_checkout', checkedOutAt: null },
      include: { guest: true, room: true }
    });

    const blockingDueCheckouts = [];
    for (const reservation of dueCheckoutReservations) {
      const outstandingBalance = await getFolioBalance(reservation.id);
      if (outstandingBalance > 0) {
        blockingDueCheckouts.push({
          reservationId: reservation.id,
          confoNo: reservation.confoNo,
          guestName: reservation.guest?.fullName || 'Unknown',
          roomNumber: reservation.room?.roomNumber || 'N/A',
          expectedCheckout: reservation.expectedCheckOutAt || reservation.checkOut,
          totalCharges: outstandingBalance + (await prisma.payment.aggregate({ where: { reservationId: reservation.id }, _sum: { amount: true } }))._sum.amount || 0,
          paid: (await prisma.payment.aggregate({ where: { reservationId: reservation.id }, _sum: { amount: true } }))._sum.amount || 0,
          outstandingBalance,
        });
      }
    }

    if (blockingDueCheckouts.length > 0) {
      return res.status(409).json({
        error: 'Night Audit cannot be completed. There are pending check-outs with outstanding balances.',
        affectedReservations: blockingDueCheckouts,
      });
    }

    const dueTodayReservations = await prisma.reservation.findMany({
      where: {
        status: 'in_house',
        checkOut: { lte: businessDate },
        checkedOutAt: null,
      },
      include: { guest: true, room: true }
    });

    for (const reservation of dueTodayReservations) {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: 'due_checkout' },
      });
      await prisma.auditLog.create({
        data: {
          userId,
          action: 'DUE_CHECKOUT_FLAG',
          module: 'reservationLifecycle',
          entityType: 'reservations',
          entityId: reservation.id,
          description: `Reservation flagged as due checkout because expected checkout date was reached while the guest remained in-house.`,
          oldValues: { status: reservation.status },
          newValues: { status: 'due_checkout', dueCheckoutAt: businessDate.toISOString() },
        },
      });
    }

    const inHouseReservations = await prisma.reservation.findMany({
      where: {
        status: 'in_house',
        checkIn: { lte: businessDate },
        checkOut: { gt: businessDate },
        checkedOutAt: null,
      }
    });

    let roomChargeType = await prisma.chargeType.findFirst({ where: { name: 'Room Charge' } });
    if (!roomChargeType) {
      roomChargeType = await prisma.chargeType.create({ data: { name: 'Room Charge', defaultAccount: '580000' } });
    }

    const runTimestamp = new Date();
    const auditEffects = [];
    let revenuePostedCount = 0;

    // ---------- AUTO NO-SHOW: Mark tentative reservations past arrival date ----------
    const noShowCandidates = await prisma.reservation.findMany({
      where: {
        status: 'tentative',
        checkIn: { lte: businessDate },
        checkedInAt: null,
      },
      include: { guest: true, room: true }
    });

    let autoNoShowCount = 0;
    for (const reservation of noShowCandidates) {
      try {
        await sm.markNoShow(reservation.id, { userId });
        autoNoShowCount++;
        auditEffects.push({
          reservationId: reservation.id,
          action: 'No-Show Flagged',
          detail: `Tentative reservation auto-marked as no-show (expected arrival: ${new Date(reservation.checkIn).toISOString().slice(0, 10)})`,
        });
      } catch (e) {
        console.error(`Failed to mark reservation ${reservation.id} as no-show:`, e.message);
        auditEffects.push({
          reservationId: reservation.id,
          action: 'No-Show Failed',
          detail: e.message,
        });
      }
    }

    for (const res of inHouseReservations) {
      // Use pure UTC boundaries so they match the UTC-normalised businessDate and
      // the UTC timestamps stored in the postedAt column.  setHours() would apply
      // local server timezone and create a shifted window.
      const dayStart = new Date(businessDate); // already UTC midnight
      const dayEnd = new Date(Date.UTC(
        businessDate.getUTCFullYear(),
        businessDate.getUTCMonth(),
        businessDate.getUTCDate(),
        23, 59, 59, 999
      ));
      const existingCharge = await prisma.guestCharge.findFirst({
        where: {
          reservationId: res.id,
          chargeTypeId: roomChargeType.id,
          postedAt: { gte: dayStart, lte: dayEnd },
          isVoid: false,
        },
      });

      if (!existingCharge) {
        const taxes = await calculateTaxBreakdown(res.rate || 0, {
          propertyId: res.propertyId,
          onDate: businessDate,
        });
        const createResult = await prisma.guestCharge.createMany({
          data: [{
            reservationId: res.id,
            chargeTypeId: roomChargeType.id,
            description: `Night Audit Room Charge (${targetDateStr})`,
            amount: res.rate || 0,
            postedBy: userId,
            postedAt: businessDate,
          }],
          skipDuplicates: true,
        });

        if (createResult && createResult.count > 0) {
          revenuePostedCount += createResult.count;
        }

        auditEffects.push({
          reservationId: res.id,
          action: 'Room Charge Posted',
          detail: `Night Audit posted room charge for ${targetDateStr}`,
        });

        const createdCharge = await prisma.guestCharge.findFirst({
          where: {
            reservationId: res.id,
            chargeTypeId: roomChargeType.id,
            postedAt: { gte: dayStart, lte: dayEnd },
            isVoid: false,
          },
        });

        if (createdCharge && (taxes.sc > 0 || taxes.vat > 0 || taxes.tdl > 0 || taxes.nbt > 0)) {
          const taxData = [];
          if (taxes.sc > 0) taxData.push({ guestChargeId: createdCharge.id, taxType: 'SC', amount: taxes.sc });
          if (taxes.vat > 0) taxData.push({ guestChargeId: createdCharge.id, taxType: 'VAT', amount: taxes.vat });
          if (taxes.tdl > 0) taxData.push({ guestChargeId: createdCharge.id, taxType: 'TDL', amount: taxes.tdl });
          if (taxes.nbt > 0) taxData.push({ guestChargeId: createdCharge.id, taxType: 'NBT', amount: taxes.nbt });
          if (taxData.length > 0) {
            await prisma.guestChargeTax.createMany({ data: taxData });
          }
        }
      }
    }

    const auditRecord = await prisma.nightAudit.create({
      data: {
        auditDate: businessDate,
        completed: true,
        completedBy: userId,
        completedAt: runTimestamp,
        roomRevenuePosted: revenuePostedCount > 0 || inHouseReservations.length === 0,
        loggedOutUsers: true,
        details: auditEffects,
        autoNoShow: autoNoShowCount,
      },
    });

    return res.json({
      message: `Night Audit successfully completed for ${targetDateStr}.`,
      businessDate: targetDateStr,
      revenuePostedCount,
      totalCheckedIn: inHouseReservations.length,
      autoNoShowCount,
      affectedReservations: auditEffects,
      completedAt: runTimestamp,
      auditRecord,
    });
  } catch (err) {
    console.error('[POST /api/night-audit/run] error:', err);
    return res.status(500).json({ error: 'Night Audit execution failed.' });
  }
});

/**
 * GET /api/night-audit/history
 * Returns list of past Night Audit runs with their logs and details.
 */
router.get('/history', authenticateToken, requireRole(['admin', 'front_office']), async (req, res) => {
  try {
    const history = await prisma.nightAudit.findMany({
      orderBy: { auditDate: 'desc' },
      include: { user: { select: { fullName: true, username: true } } }
    });
    return res.json(history);
  } catch (err) {
    console.error('[GET /api/night-audit/history] error:', err);
    return res.status(500).json({ error: 'Failed to fetch night audit history' });
  }
});

module.exports = router;
