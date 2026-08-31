const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');

const prisma = require('../prismaClient');
const router = express.Router();

router.get('/', authenticateToken, requirePermission('permissions.view'), async (req, res) => {
  const where = req.query.module ? { module: req.query.module } : undefined;
  const permissions = await prisma.permission.findMany({ where, orderBy: [{ module: 'asc' }, { action: 'asc' }] });
  return res.json(permissions);
});

module.exports = router;
