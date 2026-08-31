const jwt = require('jsonwebtoken');
const prisma = require('../prismaClient');

const AUTH_DEBUG = process.env.AUTH_DEBUG === 'true';
const NIGHT_AUDIT_SESSION_ENFORCEMENT = process.env.NIGHT_AUDIT_SESSION_ENFORCEMENT === 'true';

const getTokenFromRequest = (req) => {
  const authHeader = req.headers['authorization'];
  let token = authHeader && authHeader.split(' ')[1];

  if (!token && req.headers && req.headers.cookie) {
    try {
      const cookieStr = req.headers.cookie;
      const cookies = {};
      for (const part of cookieStr.split(';')) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eqIndex = trimmed.indexOf('=');
        const key = eqIndex >= 0 ? decodeURIComponent(trimmed.slice(0, eqIndex)) : decodeURIComponent(trimmed);
        const value = eqIndex >= 0 ? decodeURIComponent(trimmed.slice(eqIndex + 1)) : '';
        cookies[key] = value;
      }
      token = cookies.token || cookies.access_token || cookies.auth_token || cookies.Authorization;
      if (token && AUTH_DEBUG) console.debug('[auth] token extracted from cookie');
    } catch (error) {
      if (AUTH_DEBUG) console.warn('[auth] Failed to parse cookies', error.message);
    }
  }

  return token;
};

const enforceNightAuditSessionGuard = async (req, user) => {
  if (!NIGHT_AUDIT_SESSION_ENFORCEMENT) {
    return null;
  }

  try {
    const latestAudit = await prisma.nightAudit.findFirst({
      where: { completed: true },
      orderBy: { completedAt: 'desc' },
    });

    if (!latestAudit || !latestAudit.completedAt) {
      return null;
    }

    const completedAt = new Date(latestAudit.completedAt);
    if (Number.isNaN(completedAt.getTime())) {
      return null;
    }

    const auditTimeSec = Math.floor(completedAt.getTime() / 1000);
    const nowSec = Math.floor(Date.now() / 1000);

    if (auditTimeSec > nowSec + 300) {
      console.warn('[auth] Skipping Night Audit session expiry enforcement because audit time is in the future', latestAudit.completedAt);
      return null;
    }

    const tokenIat = user && (typeof user.iat === 'number' || typeof user.iat === 'string') ? Number(user.iat) : null;
    if (!tokenIat) {
      if (AUTH_DEBUG) console.warn('[auth] token iat missing or invalid on token payload', { user });
      return null;
    }

    const SKEW_TOLERANCE_SEC = 120;
    if (tokenIat + SKEW_TOLERANCE_SEC < auditTimeSec) {
      if (AUTH_DEBUG) console.warn('[auth] Forcing session expiry due to Night Audit', { tokenIat, auditTimeSec, url: req.originalUrl, ip: req.ip });
      return { status: 401, error: 'Session expired due to Night Audit. Please log in again.' };
    }

    return null;
  } catch (error) {
    console.error('[auth] Error checking night audit status:', error);
    return { status: 500, error: 'Authentication error' };
  }
};

const authenticateToken = (req, res, next) => {
  const token = getTokenFromRequest(req);

  if (!token) {
    if (AUTH_DEBUG) console.warn('[auth] No access token provided', { ip: req.ip, method: req.method, url: req.originalUrl });
    return res.status(401).json({ error: 'Access token required' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('[auth] JWT_SECRET is not configured in environment');
    return res.status(500).json({ error: 'Server authentication not configured' });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) {
      if (AUTH_DEBUG) console.warn('[auth] JWT verification failed', { err: err.message, ip: req.ip, url: req.originalUrl });
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    try {
      const guardResult = await enforceNightAuditSessionGuard(req, user);
      if (guardResult) {
        return res.status(guardResult.status).json({ error: guardResult.error });
      }

      const currentUser = await prisma.user.findUnique({
        where: { id: Number(user.id) },
        include: { rbacRole: { include: { permissions: { include: { permission: true } } } } },
      });

      if (!currentUser || !currentUser.isActive) {
        if (AUTH_DEBUG) console.warn('[auth] User inactive or not found', { userId: user.id });
        return res.status(401).json({ error: 'User account is inactive' });
      }

      req.user = {
        ...user,
        id: currentUser.id,
        username: currentUser.username,
        fullName: currentUser.fullName,
        role: currentUser.role,
        roleId: currentUser.roleId,
        permissions: currentUser.rbacRole?.permissions.map((entry) => entry.permission.key) || [],
      };
      return next();
    } catch (dbErr) {
      console.error('[auth] Error checking user status in auth middleware:', dbErr);
      if (AUTH_DEBUG) console.error('[auth] Detailed error', { err: dbErr, url: req.originalUrl, ip: req.ip });
      return res.status(500).json({ error: 'Authentication error' });
    }
  });
};

const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Access forbidden: unauthorized role' });
    }
    next();
  };
};

const requirePermission = (permission) => {
  const required = Array.isArray(permission) ? permission : [permission];
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.role === 'admin' || required.some((key) => req.user.permissions?.includes(key))) {
      return next();
    }
    return res.status(403).json({ error: 'Access forbidden: missing permission', requiredPermissions: required });
  };
};

module.exports = { authenticateToken, requireRole, requirePermission };
