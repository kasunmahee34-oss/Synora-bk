const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = require('../prismaClient');

// Post/Generate a travel agent tax invoice
router.post('/', async (req, res) => {
  const {
    confoNo,
    roomRevenue,
    paymentType,
    amount,
    vat,
    sc,
    tdl,
    nbt,
    userId,
    propertyId,
  } = req.body;

  if (!confoNo || roomRevenue === undefined || amount === undefined) {
    return res.status(400).json({ error: 'confoNo, roomRevenue, and amount are required' });
  }

  try {
    const invoice = await prisma.travelAgentTaxInvoice.create({
      data: {
        confoNo,
        roomRevenue: parseFloat(roomRevenue),
        paymentType: paymentType ? parseInt(paymentType) : null,
        amount: parseFloat(amount),
        vat: vat ? parseFloat(vat) : 0,
        sc: sc ? parseFloat(sc) : 0,
        tdl: tdl ? parseFloat(tdl) : 0,
        nbt: nbt ? parseFloat(nbt) : 0,
        userId: userId ? parseInt(userId) : null,
        propertyId: propertyId ? parseInt(propertyId) : 1,
      },
    });

    res.status(201).json(invoice);
  } catch (error) {
    console.error('Error creating travel agent invoice:', error);
    res.status(500).json({ error: 'Failed to create travel agent invoice' });
  }
});

const { calculateTaxBreakdown } = require('../services/taxInvoiceService');

// Calculate invoice breakdown dynamically
router.get('/calculate', async (req, res) => {
  const { roomRevenue, propertyId, date } = req.query;

  if (roomRevenue === undefined) {
    return res.status(400).json({ error: 'roomRevenue query parameter is required' });
  }

  try {
    const revenue = parseFloat(roomRevenue);
    const propId = propertyId ? parseInt(propertyId) : 1;
    const calcDate = date ? new Date(date) : new Date();

    if (isNaN(revenue)) {
      return res.status(400).json({ error: 'Invalid roomRevenue value' });
    }

    const breakdown = await calculateTaxBreakdown(revenue, { propertyId: propId, onDate: calcDate });
    res.json(breakdown);
  } catch (error) {
    console.error('Error calculating tax breakdown:', error);
    res.status(500).json({ error: 'Failed to calculate tax breakdown' });
  }
});

// Get invoices for a specific travel agent
router.get('/:agentId', async (req, res) => {
  const agentId = parseInt(req.params.agentId);
  try {
    // 1. Get reservations for agent
    const reservations = await prisma.reservation.findMany({
      where: { travelAgentId: agentId },
      select: { confoNo: true },
    });

    const confoNos = reservations.map((r) => r.confoNo);

    if (confoNos.length === 0) {
      return res.json([]);
    }

    // 2. Get invoices matching these confoNos
    const invoices = await prisma.travelAgentTaxInvoice.findMany({
      where: {
        confoNo: { in: confoNos },
        isActive: true,
      },
      include: { user: { select: { id: true, username: true, fullName: true } } },
      orderBy: { invoiceDate: 'desc' },
    });

    res.json(invoices);
  } catch (error) {
    console.error('Error fetching travel agent invoices:', error);
    res.status(500).json({ error: 'Failed to fetch travel agent invoices' });
  }
});

module.exports = router;
