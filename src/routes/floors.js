const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = require('../prismaClient');

/**
 * POST /api/floors
 * body: { floorName, floorNumber, propertyId? }
 */
router.post('/', async (req, res) => {
  try {
    const { floorName, floorNumber, propertyId = 1 } = req.body;

    if (!floorName || !floorName.toString().trim()) {
      return res.status(400).json({ error: 'floorName is required' });
    }
    if (floorNumber === undefined || floorNumber === null || isNaN(Number(floorNumber))) {
      return res.status(400).json({ error: 'floorNumber is required and must be a number' });
    }

    const existing = await prisma.floor.findFirst({
      where: { propertyId: Number(propertyId), floorNumber: Number(floorNumber) },
    });
    if (existing) {
      return res.status(409).json({ error: `Floor number ${floorNumber} already exists for this property` });
    }

    const floor = await prisma.floor.create({
      data: {
        floorName: floorName.toString().trim(),
        floorNumber: Number(floorNumber),
        propertyId: Number(propertyId),
      },
    });

    return res.status(201).json(floor);
  } catch (err) {
    console.error('[POST /api/floors] error:', err);
    return res.status(500).json({ error: 'Failed to create floor' });
  }
});

/**
 * GET /api/floors
 * query: ?propertyId=
 */
router.get('/', async (req, res) => {
  try {
    const { propertyId = 1 } = req.query;
    const floors = await prisma.floor.findMany({
      where: { propertyId: Number(propertyId), isActive: true },
      orderBy: { floorNumber: 'asc' },
    });
    return res.json(floors);
  } catch (err) {
    console.error('[GET /api/floors] error:', err);
    return res.status(500).json({ error: 'Failed to fetch floors' });
  }
});

/**
 * PUT /api/floors/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { floorName, floorNumber, isActive } = req.body;

    const floor = await prisma.floor.update({
      where: { id: Number(id) },
      data: {
        ...(floorName && { floorName: floorName.toString().trim() }),
        ...(floorNumber !== undefined && { floorNumber: Number(floorNumber) }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
      },
    });

    return res.json(floor);
  } catch (err) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'Floor not found' });
    }
    console.error('[PUT /api/floors/:id] error:', err);
    return res.status(500).json({ error: 'Failed to update floor' });
  }
});

/**
 * DELETE /api/floors/:id
 * Soft-delete only — blocked if rooms still reference this floor.
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const roomCount = await prisma.room.count({ where: { floorId: Number(id) } });
    if (roomCount > 0) {
      return res.status(409).json({ error: `Cannot delete: ${roomCount} room(s) still assigned to this floor` });
    }
    await prisma.floor.update({ where: { id: Number(id) }, data: { isActive: false } });
    return res.status(204).send();
  } catch (err) {
    console.error('[DELETE /api/floors/:id] error:', err);
    return res.status(500).json({ error: 'Failed to delete floor' });
  }
});

module.exports = router;
