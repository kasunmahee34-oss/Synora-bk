const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = require('../prismaClient');

router.get('/', async (req, res) => {
  const { startDate, endDate } = req.query;

  if (!startDate || !endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required (YYYY-MM-DD)' });
  }

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
      return res.status(400).json({ error: 'Invalid dates.' });
    }

    // 1. Get all rooms
    const rooms = await prisma.room.findMany({
      include: { roomType: true },
      orderBy: { roomNumber: 'asc' },
    });

    // 2. Get reservations overlapping with the date range
    const reservations = await prisma.reservation.findMany({
      where: {
        status: {
          notIn: ['cancelled', 'no_show'],
        },
          AND: [
            { checkIn: { lte: end } },
            { checkOut: { gte: start } }
          ]
      },
      include: {
        guest: true,
        travelAgent: true,
      }
    });

    console.log('TapeChart fetched, reservations count:', reservations.length);
    const hasTarget = reservations.some(r => r.confoNo === 'ELLA-20260821-A75X');
    console.log('Contains target reservation?', hasTarget);
    res.json({
      rooms,
      reservations,
      startDate: start.toISOString().split('T')[0],
      endDate: end.toISOString().split('T')[0],
    });
  } catch (error) {
    console.error('Error fetching tape chart data:', error);
    res.status(500).json({ error: 'Failed to fetch tape chart data' });
  }
});

module.exports = router;
