const express = require('express');
const router = express.Router();
const { authenticateToken, requirePermission } = require('../middlewares/auth');
const reportsService = require('../services/reportsService');
router.use(authenticateToken, requirePermission('reports.view'));

// Middleware to parse and validate standard query parameters
function validateFilters(req, res, next) {
  const { dateFrom, dateTo, page, limit } = req.query;

  if (dateFrom && isNaN(Date.parse(dateFrom))) {
    return res.status(400).json({ error: 'Invalid dateFrom parameter' });
  }
  if (dateTo && isNaN(Date.parse(dateTo))) {
    return res.status(400).json({ error: 'Invalid dateTo parameter' });
  }
  if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
    return res.status(400).json({ error: 'dateFrom must be less than or equal to dateTo' });
  }

  if (page && (isNaN(parseInt(page)) || parseInt(page) < 1)) {
    return res.status(400).json({ error: 'Invalid page parameter (must be positive integer)' });
  }
  if (limit && (isNaN(parseInt(limit)) || parseInt(limit) < 1)) {
    return res.status(400).json({ error: 'Invalid limit parameter (must be positive integer)' });
  }

  next();
}

// ----------------------------------------------------
// 1. RESERVATION REPORTS
// ----------------------------------------------------

router.get('/reservations/daily', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getDailyReservations(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reservations/upcoming', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getUpcomingReservations(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reservations/status', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getReservationStatus(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reservations/cancellations', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getCancellations(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/reservations/no-shows', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getNoShows(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Meal Plan distribution
router.get('/meal-plans/distribution', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getMealPlanDistribution(req.query);
    res.json({ success: true, data: result.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 2. ROOM REPORTS
// ----------------------------------------------------

router.get('/rooms/availability', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getRoomAvailability(req.query);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/rooms/occupancy', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getRoomOccupancy(req.query);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rooms/status', authenticateToken, async (req, res) => {
  try {
    const result = await reportsService.getRoomStatus();
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/rooms/type-occupancy', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getRoomTypeOccupancy(req.query);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 3. CHECK-IN / CHECK-OUT REPORTS
// ----------------------------------------------------

router.get('/check-ins/daily', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getDailyCheckIns(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/check-outs/daily', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getDailyCheckOuts(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/check-ins/expected-arrivals', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getExpectedArrivals(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/check-outs/expected-departures', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getExpectedDepartures(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/check-outs/due', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getDueCheckouts(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 4. FINANCIAL REPORTS (Restricted to Admin role)
// ----------------------------------------------------

router.get('/financial/daily-revenue', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getDailyRevenue(req.query);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial/monthly-revenue', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getMonthlyRevenue(req.query);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial/revenue-by-room-type', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getRevenueByRoomType(req.query);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial/revenue-by-booking-source', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getRevenueByBookingSource(req.query);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial/payment-collection', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getPaymentCollection(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial/outstanding', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getOutstandingPayments(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial/refunds', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getRefunds(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial/discounts', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getDiscounts(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/financial/taxes', authenticateToken, requirePermission('reports.financial'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getTaxes(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 5. GUEST REPORTS
// ----------------------------------------------------

router.get('/guests', authenticateToken, validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getGuestsList(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/guests/:guestId/history', authenticateToken, async (req, res) => {
  try {
    const result = await reportsService.getGuestHistory(req.params.guestId);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
});

router.get('/guests/frequent', authenticateToken, async (req, res) => {
  try {
    const result = await reportsService.getFrequentGuests(req.query);
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 6. MANAGEMENT DASHBOARD & KPIs
// ----------------------------------------------------

router.get('/dashboard/summary', authenticateToken, async (req, res) => {
  try {
    const result = await reportsService.getDashboardSummary();
    res.json({
      success: true,
      data: result.data
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// 7. AUDIT REPORTS (Restricted to Admin role)
// ----------------------------------------------------

router.get('/audit/user-activity', authenticateToken, requirePermission('audit.view'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getUserActivityLogs(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/audit/reservations', authenticateToken, requirePermission('audit.view'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getReservationAuditLogs(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/audit/payments', authenticateToken, requirePermission('audit.view'), validateFilters, async (req, res) => {
  try {
    const result = await reportsService.getPaymentAuditLogs(req.query);
    res.json({
      success: true,
      data: result.data,
      meta: {
        page: result.page,
        limit: result.limit,
        total: result.total
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
