const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');
const prisma = require('../prismaClient');

const VALID_STATUSES = ['available', 'occupied', 'maintenance', 'dirty', 'clean'];

/**
 * GET /api/rooms
 * List rooms, optionally filtered by floorId or status.
 * query: ?floorId=&status=
 */
router.get('/', authenticateToken, requirePermission('rooms.view'), async (req, res) => {
  try {
    const { floorId, status } = req.query;
    const where = {};
    if (floorId) where.floorId = Number(floorId);
    if (status) {
      if (!VALID_STATUSES.includes(status)) {
        return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
      }
      where.status = status;
    }

    const rooms = await prisma.room.findMany({
      where,
      include: { roomType: true, floor: true },
      orderBy: [{ floorId: 'asc' }, { roomNumber: 'asc' }],
    });

    return res.json(rooms);
  } catch (err) {
    console.error('[GET /api/rooms] error:', err);
    return res.status(500).json({ error: 'Failed to fetch rooms' });
  }
});

// Get room types
router.get('/types', authenticateToken, requirePermission('rooms.view'), async (req, res) => {
  try {
    const types = await prisma.roomType.findMany();
    res.json(types);
  } catch (error) {
    console.error('Error fetching room types:', error);
    res.status(500).json({ error: 'Failed to fetch room types' });
  }
});

// Check room availability
router.get('/availability', authenticateToken, requirePermission('rooms.view'), async (req, res) => {
  const checkIn = req.query.checkIn ?? req.query.dateFrom;
  const checkOut = req.query.checkOut ?? req.query.dateTo;

  if (!checkIn || !checkOut) {
    return res.status(400).json({ error: 'checkIn and checkOut dates are required (YYYY-MM-DD)' });
  }

  try {
    const inDate = new Date(checkIn);
    const outDate = new Date(checkOut);

    if (isNaN(inDate.getTime()) || isNaN(outDate.getTime()) || inDate >= outDate) {
      return res.status(400).json({ error: 'Invalid dates. checkIn must be before checkOut.' });
    }

    // Limit year range for database safety
    const inYear = inDate.getFullYear();
    const outYear = outDate.getFullYear();
    if (inYear < 1900 || inYear > 2100 || outYear < 1900 || outYear > 2100) {
      return res.status(400).json({ error: 'Invalid date range. Year must be between 1900 and 2100.' });
    }

    // Find all room IDs that have overlapping bookings
    // Exclude only cancelled and no_show — all other statuses (tentative, guaranteed,
    // room_assigned, checked_in, in_house, due_checkout) occupy the room.
    const bookedReservations = await prisma.reservation.findMany({
      where: {
        status: { notIn: ['cancelled', 'no_show'] },
        AND: [
          { checkIn: { lt: outDate } },
          { checkOut: { gt: inDate } },
        ],
      },
      select: { roomId: true },
    });

    const bookedRoomIds = bookedReservations.map((r) => r.roomId);

    // Get all rooms not in the booked list, and not in maintenance
    const availableRooms = await prisma.room.findMany({
      where: {
        id: {
          notIn: bookedRoomIds.length > 0 ? bookedRoomIds : [-1], // handle empty array correctly in prisma
        },
        status: {
          not: 'maintenance',
        },
      },
      include: { roomType: true, floor: true },
    });

    res.json(availableRooms);
  } catch (error) {
    console.error('Error checking availability:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
});

/**
 * POST /api/rooms
 * Create a new room.
 * body: { roomNumber, roomTypeId, floorId, status? }
 */
router.post('/', authenticateToken, requirePermission('rooms.manage'), async (req, res) => {
  try {
    const { roomNumber, roomTypeId, floorId, status } = req.body;

    // --- validation ---
    if (!roomNumber || !roomNumber.toString().trim()) {
      return res.status(400).json({ error: 'roomNumber is required' });
    }
    if (!roomTypeId) {
      return res.status(400).json({ error: 'roomTypeId is required' });
    }
    if (!floorId) {
      return res.status(400).json({ error: 'floorId is required' });
    }
    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    // room type must exist
    const roomType = await prisma.roomType.findUnique({ where: { id: Number(roomTypeId) } });
    if (!roomType) {
      return res.status(400).json({ error: 'roomTypeId does not match an existing room type' });
    }

    // floor must exist
    const floor = await prisma.floor.findUnique({ where: { id: Number(floorId) } });
    if (!floor) {
      return res.status(400).json({ error: 'floorId does not match an existing floor' });
    }

    // room number must be unique
    const existing = await prisma.room.findUnique({ where: { roomNumber: roomNumber.toString().trim() } });
    if (existing) {
      return res.status(409).json({ error: `Room ${roomNumber} already exists` });
    }

    const room = await prisma.room.create({
      data: {
        roomNumber: roomNumber.toString().trim(),
        roomTypeId: Number(roomTypeId),
        floorId: Number(floorId),
        status: status || 'available',
      },
      include: { roomType: true, floor: true },
    });

    return res.status(201).json(room);
  } catch (err) {
    console.error('[POST /api/rooms] error:', err);
    return res.status(500).json({ error: 'Failed to create room' });
  }
});

/**
 * PUT /api/rooms/:id
 * Edit a room (number, type, floorId, status).
 */
router.put('/:id', authenticateToken, requirePermission('rooms.manage'), async (req, res) => {
  try {
    const { id } = req.params;
    const { roomNumber, roomTypeId, floorId, status } = req.body;

    if (status && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    if (roomNumber) {
      const clash = await prisma.room.findFirst({
        where: { roomNumber: roomNumber.toString().trim(), NOT: { id: Number(id) } },
      });
      if (clash) {
        return res.status(409).json({ error: `Room ${roomNumber} already exists` });
      }
    }

    const room = await prisma.room.update({
      where: { id: Number(id) },
      data: {
        ...(roomNumber && { roomNumber: roomNumber.toString().trim() }),
        ...(roomTypeId && { roomTypeId: Number(roomTypeId) }),
        ...(floorId !== undefined && { floorId: floorId ? Number(floorId) : null }),
        ...(status && { status }),
      },
      include: { roomType: true, floor: true },
    });

    return res.json(room);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Room not found' });
    }
    console.error('[PUT /api/rooms/:id] error:', err);
    return res.status(500).json({ error: 'Failed to update room' });
  }
});

module.exports = router;
