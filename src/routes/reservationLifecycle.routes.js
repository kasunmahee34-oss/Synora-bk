const express = require('express');
const router = express.Router();
const sm = require('../services/reservationStateMachine');
const { authenticateToken, requireRole } = require('../middlewares/auth');

function handle(fn) {
  return async (req, res) => {
    try {
      const result = await fn(req);
      res.json(result);
    } catch (err) {
      const status = err instanceof sm.HttpError ? err.status : 500;
      if (status === 500) console.error(`[lifecycle] ${req.path} error:`, err);
      res.status(status).json({ error: err.message || 'Transition failed' });
    }
  };
}

router.post('/reservations/:id/guarantee', handle(async (req) => {
  return sm.transitionToGuaranteed(Number(req.params.id), {
    userId: req.body.userId,
    method: 'manual',
    reason: req.body.reason,
  });
}));

router.post('/reservations/:id/do-check-in', handle(async (req) => {
  return sm.markDoCheckIn(Number(req.params.id), { userId: req.body.userId });
}));

router.post('/reservations/:id/check-in', handle(async (req) => {
  return sm.performCheckIn(Number(req.params.id), {
    userId: req.body.userId,
    roomId: req.body.roomId,
  });
}));

router.post('/reservations/:id/due-checkout', handle(async (req) => {
  return sm.markDueCheckout(Number(req.params.id), { userId: req.body.userId });
}));

router.post('/reservations/:id/checkout', handle(async (req) => {
  return sm.attemptCheckout(Number(req.params.id), { userId: req.body.userId });
}));

router.post('/reservations/:id/force-complete', authenticateToken, requireRole(['admin']), handle(async (req) => {
  return sm.forceCompleteReservation(Number(req.params.id), {
    userId: req.user.id,
    reason: req.body.reason,
  });
}));

module.exports = router;
