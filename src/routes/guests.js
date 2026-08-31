const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');

const prisma = require('../prismaClient');

// Get all guests or search
router.get('/', authenticateToken, requirePermission('guests.view'), async (req, res) => {
  const { search } = req.query;
  try {
    let whereClause = {};
    if (search) {
      whereClause = {
        OR: [
          { fullName: { contains: search } },
          { phone: { contains: search } },
          { email: { contains: search } },
          { idPassportNo: { contains: search } },
        ],
      };
    }

    const guests = await prisma.guest.findMany({
      where: whereClause,
      orderBy: { fullName: 'asc' },
    });
    res.json(guests);
  } catch (error) {
    console.error('Error fetching guests:', error);
    res.status(500).json({ error: 'Failed to fetch guests' });
  }
});

// Get single guest
router.get('/:id', authenticateToken, requirePermission('guests.view'), async (req, res) => {
  try {
    const guest = await prisma.guest.findUnique({
      where: { id: parseInt(req.params.id) },
      include: { reservations: { include: { room: true } } },
    });
    if (!guest) return res.status(404).json({ error: 'Guest not found' });
    res.json(guest);
  } catch (error) {
    console.error('Error fetching guest:', error);
    res.status(500).json({ error: 'Failed to fetch guest' });
  }
});

// Create guest
router.post('/', authenticateToken, requirePermission('guests.create'), async (req, res) => {
  const { fullName, phone, email, nationality, idPassportNo, address } = req.body;
  if (!fullName) {
    return res.status(400).json({ error: 'Full name is required' });
  }

  try {
    const guest = await prisma.guest.create({
      data: { fullName, phone, email, nationality, idPassportNo, address },
    });
    res.status(201).json(guest);
  } catch (error) {
    console.error('Error creating guest:', error);
    res.status(500).json({ error: 'Failed to create guest' });
  }
});

module.exports = router;
