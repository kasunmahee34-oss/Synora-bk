const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');

const prisma = require('../prismaClient');
const router = express.Router();

router.get('/', authenticateToken, requirePermission('audit.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const where = {};
  if (req.query.module) where.module = req.query.module;
  if (req.query.action) where.action = req.query.action;
  if (req.query.userId) where.userId = Number(req.query.userId);
  if (req.query.from || req.query.to) {
    where.createdAt = {};
    if (req.query.from) where.createdAt.gte = new Date(req.query.from);
    if (req.query.to) where.createdAt.lte = new Date(req.query.to);
  }
  const [items, total] = await prisma.$transaction([
    prisma.auditLog.findMany({
      where, skip: (page - 1) * limit, take: limit, orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, username: true, fullName: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);
  return res.json({ items, total, page, limit });
});

module.exports = router;
