const express = require('express');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');
const { writeAudit } = require('../services/rbac');

const prisma = require('../prismaClient');
const router = express.Router();

const userSelect = {
  id: true, username: true, fullName: true, role: true, roleId: true,
  isActive: true, mealPlanId: true, createdAt: true,
  rbacRole: { select: { id: true, name: true, description: true, permissions: { select: { permission: true } } } },
};

const safeUser = (user) => ({
  ...user,
  permissions: user.rbacRole?.permissions.map(({ permission }) => permission.key) || [],
  rbacRole: user.rbacRole ? {
    id: user.rbacRole.id,
    name: user.rbacRole.name,
    description: user.rbacRole.description,
  } : null,
});

router.get('/me', authenticateToken, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: Number(req.user.id) }, select: userSelect });
  return res.json(safeUser(user));
});

router.get('/', authenticateToken, requirePermission('users.view'), async (req, res) => {
  const where = {};
  if (req.query.active !== undefined) where.isActive = req.query.active !== 'false';
  if (req.query.search) {
    where.OR = [
      { username: { contains: req.query.search } },
      { fullName: { contains: req.query.search } },
    ];
  }
  const users = await prisma.user.findMany({ where, select: userSelect, orderBy: { username: 'asc' } });
  return res.json(users.map(safeUser));
});

router.post('/', authenticateToken, requirePermission('users.create'), async (req, res) => {
  const { username, password, fullName, role = 'front_office', roleId, mealPlanId } = req.body;
  if (!username || !password || password.length < 8) {
    return res.status(400).json({ error: 'username and a password of at least 8 characters are required' });
  }
  if (!roleId && !['admin', 'front_office', 'cashier'].includes(role)) {
    return res.status(400).json({ error: 'role must be admin, front_office, or cashier' });
  }
  try {
    const selectedRole = roleId
      ? await prisma.role.findUnique({ where: { id: Number(roleId) } })
      : await prisma.role.findUnique({ where: { name: role } });
    if (!selectedRole) return res.status(400).json({ error: 'Selected role does not exist' });
    const user = await prisma.user.create({
      data: {
        username: username.trim(),
        passwordHash: await bcrypt.hash(password, 12),
        fullName: fullName?.trim() || null,
        role: ['admin', 'front_office', 'cashier'].includes(role) ? role : 'front_office',
        roleId: selectedRole.id,
        mealPlanId: mealPlanId ? Number(mealPlanId) : null,
      },
      select: userSelect,
    });
    await writeAudit(req, { action: 'CREATE', module: 'users', entityType: 'User', entityId: user.id, description: `Created user ${user.username}`, newValues: { username: user.username, roleId: user.roleId } });
    return res.status(201).json(safeUser(user));
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Username already exists' });
    console.error('Create user error:', error);
    return res.status(500).json({ error: 'Failed to create user' });
  }
});

router.patch('/:id', authenticateToken, requirePermission('users.update'), async (req, res) => {
  const id = Number(req.params.id);
  const { fullName, password, role, roleId, mealPlanId, isActive } = req.body;
  if (id === Number(req.user.id) && isActive === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
  }
  try {
    const existing = await prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!existing) return res.status(404).json({ error: 'User not found' });
    let selectedRole;
    if (roleId || role) {
      selectedRole = await prisma.role.findUnique({ where: roleId ? { id: Number(roleId) } : { name: role } });
      if (!selectedRole) return res.status(400).json({ error: 'Selected role does not exist' });
    }
    const data = {
      ...(fullName !== undefined && { fullName: fullName?.trim() || null }),
      ...(password !== undefined && { passwordHash: await bcrypt.hash(password, 12) }),
      ...(role && ['admin', 'front_office', 'cashier'].includes(role) && { role }),
      ...(selectedRole && { roleId: selectedRole.id }),
      ...(mealPlanId !== undefined && { mealPlanId: mealPlanId ? Number(mealPlanId) : null }),
      ...(isActive !== undefined && { isActive: Boolean(isActive) }),
    };
    const user = await prisma.user.update({ where: { id }, data, select: userSelect });
    await writeAudit(req, { action: 'UPDATE', module: 'users', entityType: 'User', entityId: id, description: `Updated user ${user.username}`, oldValues: { roleId: existing.roleId, isActive: existing.isActive }, newValues: { roleId: user.roleId, isActive: user.isActive } });
    return res.json(safeUser(user));
  } catch (error) {
    console.error('Update user error:', error);
    return res.status(500).json({ error: 'Failed to update user' });
  }
});

router.delete('/:id', authenticateToken, requirePermission('users.delete'), async (req, res) => {
  const id = Number(req.params.id);
  if (id === Number(req.user.id)) return res.status(400).json({ error: 'You cannot deactivate your own account' });
  const user = await prisma.user.update({ where: { id }, data: { isActive: false }, select: userSelect });
  await writeAudit(req, { action: 'DEACTIVATE', module: 'users', entityType: 'User', entityId: id, description: `Deactivated user ${user.username}` });
  return res.json(safeUser(user));
});

module.exports = router;
