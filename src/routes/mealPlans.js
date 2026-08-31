const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requireRole } = require('../middlewares/auth');

const prisma = require('../prismaClient');

// List meal plans (active filter optional) — public endpoint for active listings
router.get('/', async (req, res) => {
  const { active } = req.query;
  try {
    const where = {};
    if (active === 'true') where.isActive = true;
    const plans = await prisma.mealPlan.findMany({ where, orderBy: { code: 'asc' } });
    res.json(plans);
  } catch (error) {
    console.error('Error fetching meal plans:', error);
    res.status(500).json({ error: 'Failed to fetch meal plans' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const plan = await prisma.mealPlan.findUnique({ where: { id } });
    if (!plan) return res.status(404).json({ error: 'Meal plan not found' });
    res.json(plan);
  } catch (error) {
    console.error('Error fetching meal plan:', error);
    res.status(500).json({ error: 'Failed to fetch meal plan' });
  }
});

// Create meal plan (admin)
router.post('/', authenticateToken, requireRole(['admin']), async (req, res) => {
  const { code, name, description, breakfastIncluded, lunchIncluded, dinnerIncluded, drinksIncluded, snacksIncluded } = req.body;
  if (!code || !name) return res.status(400).json({ error: 'code and name are required' });
  try {
    const existing = await prisma.mealPlan.findUnique({ where: { code } });
    if (existing) return res.status(409).json({ error: 'Meal plan code already exists' });
    const plan = await prisma.mealPlan.create({ data: {
      code, name, description: description || null,
      breakfastIncluded: !!breakfastIncluded,
      lunchIncluded: !!lunchIncluded,
      dinnerIncluded: !!dinnerIncluded,
      drinksIncluded: !!drinksIncluded,
      snacksIncluded: !!snacksIncluded,
    }});
    res.status(201).json(plan);
  } catch (error) {
    console.error('Error creating meal plan:', error);
    res.status(500).json({ error: 'Failed to create meal plan' });
  }
});

// Update meal plan (admin)
router.put('/:id', authenticateToken, requireRole(['admin']), async (req, res) => {
  const id = parseInt(req.params.id);
  const data = req.body;
  try {
    const plan = await prisma.mealPlan.update({ where: { id }, data });
    res.json(plan);
  } catch (error) {
    console.error('Error updating meal plan:', error);
    res.status(500).json({ error: 'Failed to update meal plan' });
  }
});

// Patch status (activate/deactivate)
router.patch('/:id/status', authenticateToken, requireRole(['admin']), async (req, res) => {
  const id = parseInt(req.params.id);
  const { isActive } = req.body;
  if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive boolean required' });
  try {
    const plan = await prisma.mealPlan.update({ where: { id }, data: { isActive } });
    res.json(plan);
  } catch (error) {
    console.error('Error updating meal plan status:', error);
    res.status(500).json({ error: 'Failed to update status' });
  }
});

module.exports = router;
