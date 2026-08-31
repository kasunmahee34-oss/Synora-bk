const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = require('../prismaClient');

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { username },
      include: { rbacRole: { include: { permissions: { include: { permission: true } } } } },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        roleId: user.roleId,
        fullName: user.fullName,
        permissions: user.rbacRole?.permissions.map((entry) => entry.permission.key) || [],
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'LOGIN',
        module: 'auth',
        entityType: 'User',
        entityId: user.id,
        description: 'User signed in',
        ipAddress: req.ip,
        userAgent: req.get('user-agent')?.slice(0, 255),
      },
    }).catch((auditError) => console.error('Login audit error:', auditError.message));

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        roleId: user.roleId,
        fullName: user.fullName,
        permissions: user.rbacRole?.permissions.map((entry) => entry.permission.key) || [],
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
