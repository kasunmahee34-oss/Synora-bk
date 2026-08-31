const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = require('../prismaClient');

// Get travel agents
router.get('/', async (req, res) => {
  try {
    const agents = await prisma.travelAgent.findMany({
      orderBy: { agentName: 'asc' },
    });
    res.json(agents);
  } catch (error) {
    console.error('Error fetching travel agents:', error);
    res.status(500).json({ error: 'Failed to fetch travel agents' });
  }
});

// Create travel agent
router.post('/', async (req, res) => {
  const { agentName, contactPerson, phone, email, commissionRate } = req.body;
  if (!agentName) {
    return res.status(400).json({ error: 'Agent name is required' });
  }

  try {
    const agent = await prisma.travelAgent.create({
      data: {
        agentName,
        contactPerson,
        phone,
        email,
        commissionRate: commissionRate ? parseFloat(commissionRate) : 0,
      },
    });
    res.status(201).json(agent);
  } catch (error) {
    console.error('Error creating travel agent:', error);
    res.status(500).json({ error: 'Failed to create travel agent' });
  }
});

// Get agent rate plans
router.get('/:id/rates', async (req, res) => {
  const agentId = parseInt(req.params.id);
  const { bookingSource } = req.query;
  try {
    const rates = await prisma.ratePlan.findMany({
      where: {
        travelAgentId: agentId > 0 ? agentId : null,
        ...(bookingSource === 'direct'
          ? { OR: [{ bookingSource: 'direct' }, { bookingSource: null }] }
          : bookingSource ? { bookingSource } : {}),
      },
      include: { roomType: true, mealPlan: true },
    });
    res.json(rates);
  } catch (error) {
    console.error('Error fetching agent rate plans:', error);
    res.status(500).json({ error: 'Failed to fetch agent rate plans' });
  }
});

// Create/Update agent rate plan
router.post('/rates', async (req, res) => {
  const { roomTypeId, travelAgentId, rate, startDate, endDate, mealPlanId, bookingSource } = req.body;

  if (!roomTypeId || !rate || !startDate || !endDate) {
    return res.status(400).json({ error: 'roomTypeId, rate, startDate, and endDate are required' });
  }
  if (bookingSource && !['direct', 'travel_agent', 'walk_in', 'online'].includes(bookingSource)) {
    return res.status(400).json({ error: 'Invalid booking source' });
  }

  try {
    const newRatePlan = await prisma.ratePlan.create({
      data: {
        roomTypeId: parseInt(roomTypeId),
        travelAgentId: travelAgentId ? parseInt(travelAgentId) : null,
        rate: parseFloat(rate),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        mealPlanId: mealPlanId ? parseInt(mealPlanId) : null,
        bookingSource: bookingSource || (travelAgentId ? 'travel_agent' : 'direct'),
      },
      include: { roomType: true, mealPlan: true }
    });
    res.status(201).json(newRatePlan);
  } catch (error) {
    console.error('Error creating rate plan:', error);
    res.status(500).json({ error: 'Failed to create rate plan' });
  }
});

// Delete agent rate plan
router.delete('/rates/:id', async (req, res) => {
  const rateId = parseInt(req.params.id);
  try {
    await prisma.ratePlan.delete({ where: { id: rateId } });
    res.json({ success: true, message: 'Rate plan deleted' });
  } catch (error) {
    console.error('Error deleting rate plan:', error);
    res.status(500).json({ error: 'Failed to delete rate plan' });
  }
});

// Update agent rate plan
router.put('/rates/:id', async (req, res) => {
  const rateId = parseInt(req.params.id);
  const { rate, startDate, endDate, mealPlanId, bookingSource } = req.body;

  if (!rate || !startDate || !endDate) {
    return res.status(400).json({ error: 'rate, startDate, and endDate are required' });
  }
  if (bookingSource && !['direct', 'travel_agent', 'walk_in', 'online'].includes(bookingSource)) {
    return res.status(400).json({ error: 'Invalid booking source' });
  }

  try {
    const updatedRatePlan = await prisma.ratePlan.update({
      where: { id: rateId },
      data: {
        rate: parseFloat(rate),
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        mealPlanId: mealPlanId ? parseInt(mealPlanId) : null,
        ...(bookingSource ? { bookingSource } : {}),
      },
      include: { roomType: true, mealPlan: true }
    });
    res.json(updatedRatePlan);
  } catch (error) {
    console.error('Error updating rate plan:', error);
    res.status(500).json({ error: 'Failed to update rate plan' });
  }
});

module.exports = router;
