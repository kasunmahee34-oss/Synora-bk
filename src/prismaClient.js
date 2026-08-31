const { PrismaClient } = require('@prisma/client');

// Prevent multiple instances in development/hot-reload environments
const globalForPrisma = globalThis;
const prisma = globalForPrisma.__prismaClient || new PrismaClient();
if (!globalForPrisma.__prismaClient) globalForPrisma.__prismaClient = prisma;

module.exports = prisma;
