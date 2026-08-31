const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');
const { writeAudit } = require('../services/rbac');

const prisma = require('../prismaClient');
const router = express.Router();
const VALID_REFUND_METHODS = ['cash', 'card', 'bank_transfer', 'agent_credit'];

function normalizeRefundMethod(method) {
  const value = String(method || 'cash').trim().toLowerCase();
  return VALID_REFUND_METHODS.includes(value) ? value : 'cash';
}

async function assertBusinessDateNotLocked(reservationId) {
  const reservation = await prisma.reservation.findUnique({
    where: { id: Number(reservationId) },
    select: { id: true, status: true, checkIn: true },
  });

  if (!reservation) return;

  const normalizedStatus = String(reservation.status || '').trim().toLowerCase();
  const activeStatuses = new Set([
    'tentative',
    'guaranteed',
    'room_assigned',
    'checked_in',
    'in_house',
    'due_checkout',
    'early_checkout',
  ]);

  if (!activeStatuses.has(normalizedStatus)) {
    return;
  }

  const lastAudit = await prisma.nightAudit.findFirst({
    where: { completed: true },
    orderBy: { auditDate: 'desc' },
  });

  if (!lastAudit) return;

  const auditDate = new Date(lastAudit.auditDate).toISOString().slice(0, 10);
  const resCheckIn = reservation.checkIn ? new Date(reservation.checkIn).toISOString().slice(0, 10) : null;

  if (resCheckIn && resCheckIn <= auditDate) {
    throw Object.assign(new Error(`Business date is locked (last audited date: ${auditDate}). Refunds cannot be processed for reservations on or before that date.`), { statusCode: 409 });
  }
}

async function getPaymentRefundState(tx, paymentId, reservationId = null) {
  const payment = await tx.payment.findUnique({
    where: { id: Number(paymentId) },
    include: { reservation: true },
  });

  if (!payment) {
    throw Object.assign(new Error('Payment not found'), { statusCode: 404 });
  }

  if (reservationId && payment.reservationId !== Number(reservationId)) {
    throw Object.assign(new Error('Payment does not belong to the selected reservation.'), { statusCode: 400 });
  }

  const refundRows = await tx.refund.findMany({
    where: {
      paymentId: payment.id,
      status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] },
    },
    select: { amount: true },
  });

  const refundedAmount = refundRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return {
    payment,
    totalRefunded: refundedAmount,
    refundableAmount: Math.max(Number(payment.amount) - refundedAmount, 0),
  };
}

router.get('/refunds', authenticateToken, requirePermission('refund.view'), async (req, res) => {
  try {
    const refunds = await prisma.refund.findMany({
      include: {
        reservation: { include: { guest: true } },
        payment: true,
        user: { select: { id: true, fullName: true, username: true } },
      },
      orderBy: { refundDate: 'desc' },
    });

    res.json(refunds);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load refunds' });
  }
});

router.get('/refunds/:id', authenticateToken, requirePermission('refund.view'), async (req, res) => {
  try {
    const refund = await prisma.refund.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        reservation: { include: { guest: true } },
        payment: true,
        user: { select: { id: true, fullName: true, username: true } },
      },
    });

    if (!refund) {
      return res.status(404).json({ error: 'Refund not found' });
    }

    res.json(refund);
  } catch (error) {
    res.status(500).json({ error: 'Failed to load refund' });
  }
});

router.get('/payments/:paymentId/refundable', authenticateToken, requirePermission(['refund.view', 'refund.create', 'refund.process']), async (req, res) => {
  try {
    const paymentId = Number(req.params.paymentId);
    const payment = await prisma.payment.findUnique({
      where: { id: paymentId },
      include: { reservation: true },
    });

    if (!payment) return res.status(404).json({ error: 'Payment not found' });

    const refundRows = await prisma.refund.findMany({
      where: {
        paymentId: payment.id,
        status: { in: ['PENDING', 'APPROVED', 'COMPLETED'] },
      },
      select: { amount: true },
    });

    const totalRefundedAmount = refundRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
    const refundableAmount = Math.max(Number(payment.amount) - totalRefundedAmount, 0);

    res.json({
      paymentId: payment.id,
      reservationId: payment.reservationId,
      originalAmount: Number(payment.amount),
      totalRefunded: totalRefundedAmount,
      refundableAmount,
      status: payment.reservation?.status || null,
    });
  } catch (error) {
    console.error('Error computing refundable amount:', error);
    res.status(500).json({ error: 'Failed to compute refundable amount' });
  }
});

router.post('/payments/:paymentId/refunds', authenticateToken, requirePermission(['refund.create', 'refund.process']), async (req, res) => {
  const paymentId = Number(req.params.paymentId);
  const { reservationId, amount, refundMethod = 'cash', reference, reason } = req.body;

  if (!Number.isInteger(paymentId) || paymentId <= 0) {
    return res.status(400).json({ error: 'Invalid payment ID.' });
  }
  if (!Number.isInteger(Number(reservationId)) || Number(reservationId) <= 0) {
    return res.status(400).json({ error: 'Reservation ID is required.' });
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Refund amount must be greater than zero.' });
  }
  if (!reason || !String(reason).trim()) {
    return res.status(400).json({ error: 'Refund reason is required.' });
  }

  const normalizedMethod = normalizeRefundMethod(refundMethod);
  if (!VALID_REFUND_METHODS.includes(normalizedMethod)) {
    return res.status(400).json({ error: 'Invalid refund method.' });
  }

  try {
    const refund = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id, reservation_id, amount FROM payments WHERE id = ${paymentId} FOR UPDATE`;
      const state = await getPaymentRefundState(tx, paymentId, reservationId);
      await assertBusinessDateNotLocked(state.payment.reservationId);

      const requestedAmount = Number(amount);
      if (requestedAmount > Number(state.refundableAmount)) {
        throw Object.assign(new Error(`Refund exceeds the refundable amount of ${Number(state.refundableAmount).toFixed(2)}.`), { statusCode: 400 });
      }

      const created = await tx.refund.create({
        data: {
          reservationId: state.payment.reservationId,
          paymentId: state.payment.id,
          amount: requestedAmount,
          refundMethod: normalizedMethod,
          reference: reference ? String(reference).trim() : null,
          reason: String(reason).trim(),
          status: 'COMPLETED',
          refundDate: new Date(),
          processedBy: Number(req.user.id),
          processedAt: new Date(),
        },
        include: {
          reservation: { include: { guest: true } },
          payment: true,
          user: { select: { id: true, fullName: true, username: true } },
        },
      });

      await tx.auditLog.create({
        data: {
          userId: Number(req.user.id),
          action: 'REFUND_PROCESSED',
          module: 'refunds',
          entityType: 'Refund',
          entityId: created.id,
          description: `Processed refund of ${requestedAmount} for reservation ${state.payment.reservationId}`,
          oldValues: {},
          newValues: {
            refundId: created.id,
            paymentId: state.payment.id,
            reservationId: state.payment.reservationId,
            amount: requestedAmount,
            status: 'COMPLETED',
          },
        },
      });

      return created;
    });

    await writeAudit(req, {
      action: 'REFUND_PROCESSED',
      module: 'refunds',
      entityType: 'Refund',
      entityId: refund.id,
      description: `Processed refund ${refund.id}`,
      oldValues: {},
      newValues: {
        amount: refund.amount,
        paymentId: refund.paymentId,
        reservationId: refund.reservationId,
        status: refund.status,
      },
    });

    res.status(201).json({ refund });
  } catch (error) {
    console.error('Error creating refund:', error);
    const httpStatus = error.statusCode || 500;
    res.status(httpStatus).json({ error: error.message || 'Failed to create refund' });
  }
});

router.post('/refunds/:id/approve', authenticateToken, requirePermission('refund.approve'), async (req, res) => {
  try {
    const refund = await prisma.refund.findUnique({ where: { id: Number(req.params.id) } });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    const updated = await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: 'APPROVED',
        processedBy: Number(req.user.id),
        processedAt: new Date(),
      },
    });

    await writeAudit(req, {
      action: 'REFUND_APPROVED',
      module: 'refunds',
      entityType: 'Refund',
      entityId: updated.id,
      description: 'Refund approved',
      oldValues: { status: refund.status },
      newValues: { status: updated.status },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to approve refund' });
  }
});

router.post('/refunds/:id/process', authenticateToken, requirePermission('refund.process'), async (req, res) => {
  try {
    const refund = await prisma.refund.findUnique({ where: { id: Number(req.params.id) } });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    const updated = await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: 'COMPLETED',
        processedBy: Number(req.user.id),
        processedAt: new Date(),
      },
    });

    await writeAudit(req, {
      action: 'REFUND_PROCESSED',
      module: 'refunds',
      entityType: 'Refund',
      entityId: updated.id,
      description: 'Refund processed',
      oldValues: { status: refund.status },
      newValues: { status: updated.status },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to process refund' });
  }
});

router.post('/refunds/:id/reject', authenticateToken, requirePermission('refund.approve'), async (req, res) => {
  try {
    const refund = await prisma.refund.findUnique({ where: { id: Number(req.params.id) } });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    const updated = await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: 'REJECTED',
        processedBy: Number(req.user.id),
        processedAt: new Date(),
      },
    });

    await writeAudit(req, {
      action: 'REFUND_REJECTED',
      module: 'refunds',
      entityType: 'Refund',
      entityId: updated.id,
      description: 'Refund rejected',
      oldValues: { status: refund.status },
      newValues: { status: updated.status },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to reject refund' });
  }
});

router.post('/refunds/:id/cancel', authenticateToken, requirePermission('refund.cancel'), async (req, res) => {
  try {
    const refund = await prisma.refund.findUnique({ where: { id: Number(req.params.id) } });
    if (!refund) return res.status(404).json({ error: 'Refund not found' });

    const updated = await prisma.refund.update({
      where: { id: refund.id },
      data: {
        status: 'CANCELLED',
        processedBy: Number(req.user.id),
        processedAt: new Date(),
      },
    });

    await writeAudit(req, {
      action: 'REFUND_CANCELLED',
      module: 'refunds',
      entityType: 'Refund',
      entityId: updated.id,
      description: 'Refund cancelled',
      oldValues: { status: refund.status },
      newValues: { status: updated.status },
    });

    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to cancel refund' });
  }
});

module.exports = router;
