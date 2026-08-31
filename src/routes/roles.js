const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');
const { writeAudit } = require('../services/rbac');

const prisma = require('../prismaClient');
const router = express.Router();
const roleInclude = { permissions: { include: { permission: true } } };

const serialize = (role) => ({
  ...role,
  permissions: role.permissions.map(({ permission }) => permission),
});

router.get('/', authenticateToken, requirePermission('roles.view'), async (req, res) => {
  const roles = await prisma.role.findMany({ include: roleInclude, orderBy: { name: 'asc' } });
  return res.json(roles.map(serialize));
});

router.post('/', authenticateToken, requirePermission('roles.create'), async (req, res) => {
  const { name, description, permissionIds = [] } = req.body;
  if (!name || !/^[a-z][a-z0-9_-]{1,48}$/i.test(name)) return res.status(400).json({ error: 'A valid role name is required' });
  try {
    const role = await prisma.role.create({
      data: {
        name: name.trim(),
        description: description?.trim() || null,
        permissions: { create: permissionIds.map((permissionId) => ({ permission: { connect: { id: Number(permissionId) } } })) },
      },
      include: roleInclude,
    });
    await writeAudit(req, { action: 'CREATE', module: 'roles', entityType: 'Role', entityId: role.id, description: `Created role ${role.name}`, newValues: { permissionIds } });
    return res.status(201).json(serialize(role));
  } catch (error) {
    if (error.code === 'P2002') return res.status(409).json({ error: 'Role already exists' });
    return res.status(400).json({ error: 'Unable to create role' });
  }
});

router.get('/:id/permissions', authenticateToken, requirePermission('roles.view'), async (req, res) => {
  const role = await prisma.role.findUnique({ where: { id: Number(req.params.id) }, include: roleInclude });
  if (!role) return res.status(404).json({ error: 'Role not found' });
  return res.json(role.permissions.map(({ permission }) => permission));
});

router.put('/:id/permissions', authenticateToken, requirePermission('roles.update'), async (req, res) => {
  const id = Number(req.params.id);
  const permissionIds = Array.isArray(req.body.permissionIds) ? req.body.permissionIds.map(Number) : [];
  const role = await prisma.role.findUnique({ where: { id }, include: roleInclude });
  if (!role) return res.status(404).json({ error: 'Role not found' });
  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: id } });
    if (permissionIds.length) await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId })) });
  });
  await writeAudit(req, { action: 'UPDATE_PERMISSIONS', module: 'roles', entityType: 'Role', entityId: id, description: `Updated permissions for ${role.name}`, oldValues: { permissionIds: role.permissions.map(({ permission }) => permission.id) }, newValues: { permissionIds } });
  const updated = await prisma.role.findUnique({ where: { id }, include: roleInclude });
  return res.json(serialize(updated));
});

router.patch('/:id', authenticateToken, requirePermission('roles.update'), async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, permissionIds } = req.body;
  const existing = await prisma.role.findUnique({ where: { id }, include: roleInclude });
  if (!existing) return res.status(404).json({ error: 'Role not found' });
  if (existing.isSystem && name && name !== existing.name) return res.status(400).json({ error: 'System role names cannot be changed' });
  try {
    const role = await prisma.$transaction(async (tx) => {
      if (permissionIds) {
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        if (permissionIds.length) await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId: id, permissionId: Number(permissionId) })), skipDuplicates: true });
      }
      return tx.role.update({ where: { id }, data: { ...(name && { name: name.trim() }), ...(description !== undefined && { description: description?.trim() || null }) }, include: roleInclude });
    });
    await writeAudit(req, { action: 'UPDATE', module: 'roles', entityType: 'Role', entityId: id, description: `Updated role ${role.name}`, oldValues: { permissionIds: existing.permissions.map(({ permission }) => permission.id) }, newValues: { permissionIds } });
    return res.json(serialize(role));
  } catch (error) {
    return res.status(400).json({ error: 'Unable to update role' });
  }
});

router.delete('/:id', authenticateToken, requirePermission('roles.delete'), async (req, res) => {
  const id = Number(req.params.id);
  const role = await prisma.role.findUnique({ where: { id } });
  if (!role) return res.status(404).json({ error: 'Role not found' });
  if (role.isSystem) return res.status(400).json({ error: 'System roles cannot be deleted' });
  await prisma.role.delete({ where: { id } });
  await writeAudit(req, { action: 'DELETE', module: 'roles', entityType: 'Role', entityId: id, description: `Deleted role ${role.name}` });
  return res.status(204).send();
});

module.exports = router;
