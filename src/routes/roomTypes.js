const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = require('../prismaClient');
const { authenticateToken, requireRole } = require('../middlewares/auth');

// Utility for audit logging
async function logAudit(userId, action, entityType, entityId, description, oldValues, newValues, req) {
  await prisma.auditLog.create({
    data: {
      userId,
      action,
      module: 'RoomType',
      entityType,
      entityId,
      description,
      oldValues,
      newValues,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    }
  });
}

// GET /api/room-types – list with optional filters (status, search)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { status, search, page = 1, limit = 20 } = req.query;
    const where = {};
    if (status) where.status = status;
    if (search) {
      const term = search.trim();
      where.OR = [
        { code: { contains: term, mode: 'insensitive' } },
        { typeName: { contains: term, mode: 'insensitive' } },
        { description: { contains: term, mode: 'insensitive' } }
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [roomTypes, total] = await Promise.all([
      prisma.roomType.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: [{ displayOrder: 'asc' }, { code: 'asc' }]
      }),
      prisma.roomType.count({ where })
    ]);
    res.json({ data: roomTypes, total, page: Number(page), limit: Number(limit) });
  } catch (err) {
    console.error('[GET /room-types] error:', err);
    res.status(500).json({ error: 'Failed to fetch room types' });
  }
});

// GET /api/room-types/:id – details
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const rt = await prisma.roomType.findUnique({
      where: { id: Number(req.params.id) }
    });
    if (!rt) return res.status(404).json({ error: 'Room type not found' });
    res.json(rt);
  } catch (err) {
    console.error('[GET /room-types/:id] error:', err);
    res.status(500).json({ error: 'Failed to fetch room type' });
  }
});

// POST /api/room-types – create (admin only)
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const {
      typeName, code, description, maxOccupancy, numberOfAdults, numberOfChildren,
      baseRate, status, bedType, numberOfBeds, roomSize, amenities, imageUrl, displayOrder
    } = req.body;

    // Validation
    if (!typeName || !code) return res.status(400).json({ error: 'typeName and code are required' });
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length === 0) return res.status(400).json({ error: 'code cannot be empty' });
    const existing = await prisma.roomType.findUnique({ where: { code: trimmedCode } });
    if (existing) return res.status(409).json({ error: 'Room type code must be unique' });
    if (maxOccupancy != null && maxOccupancy < 0) return res.status(400).json({ error: 'maxOccupancy must be non‑negative' });
    if (numberOfAdults != null && numberOfChildren != null && (numberOfAdults + numberOfChildren) > (maxOccupancy || 0)) {
      return res.status(400).json({ error: 'Adults + children cannot exceed maxOccupancy' });
    }
    if (baseRate == null) return res.status(400).json({ error: 'baseRate is required' });

    const newRoomType = await prisma.roomType.create({
      data: {
        typeName,
        code: trimmedCode,
        description,
        maxOccupancy,
        numberOfAdults,
        numberOfChildren,
        baseRate,
        status: status || 'ACTIVE',
        bedType,
        numberOfBeds,
        roomSize,
        amenities,
        imageUrl,
        displayOrder
      }
    });
    // Audit log
    await logAudit(req.user.id, 'CREATE', 'RoomType', newRoomType.id, 'Created room type', null, newRoomType, req);
    res.status(201).json(newRoomType);
  } catch (err) {
    console.error('[POST /room-types] error:', err);
    res.status(500).json({ error: 'Failed to create room type' });
  }
});

// PUT /api/room-types/:id – full update (admin only)
router.put('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.roomType.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Room type not found' });
    const {
      typeName, code, description, maxOccupancy, numberOfAdults, numberOfChildren,
      baseRate, status, bedType, numberOfBeds, roomSize, amenities, imageUrl, displayOrder
    } = req.body;
    // Validation similar to create
    if (code) {
      const trimmedCode = code.trim().toUpperCase();
      const conflict = await prisma.roomType.findFirst({
        where: { code: trimmedCode, NOT: { id } }
      });
      if (conflict) return res.status(409).json({ error: 'Room type code must be unique' });
    }
    if (numberOfAdults != null && numberOfChildren != null && (numberOfAdults + numberOfChildren) > (maxOccupancy || existing.maxOccupancy)) {
      return res.status(400).json({ error: 'Adults + children cannot exceed maxOccupancy' });
    }
    const updated = await prisma.roomType.update({
      where: { id },
      data: {
        typeName,
        code: code ? code.trim().toUpperCase() : undefined,
        description,
        maxOccupancy,
        numberOfAdults,
        numberOfChildren,
        baseRate,
        status,
        bedType,
        numberOfBeds,
        roomSize,
        amenities,
        imageUrl,
        displayOrder
      }
    });
    await logAudit(req.user.id, 'UPDATE', 'RoomType', updated.id, 'Updated room type', existing, updated, req);
    res.json(updated);
  } catch (err) {
    console.error('[PUT /room-types/:id] error:', err);
    res.status(500).json({ error: 'Failed to update room type' });
  }
});

// PATCH /api/room-types/:id/status – toggle active/inactive (admin only)
router.patch('/:id/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { status } = req.body; // expected ACTIVE or INACTIVE
    if (!['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'Invalid status value' });
    const existing = await prisma.roomType.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Room type not found' });
    const updated = await prisma.roomType.update({
      where: { id },
      data: { status }
    });
    await logAudit(req.user.id, 'STATUS_CHANGE', 'RoomType', updated.id, `Changed status to ${status}`, existing, updated, req);
    res.json(updated);
  } catch (err) {
    console.error('[PATCH /room-types/:id/status] error:', err);
    res.status(500).json({ error: 'Failed to change status' });
  }
});

module.exports = router;
