const { getFolioBalance } = require('./src/services/folioService');
const prisma = require('./src/prismaClient');

async function test() {
  try {
    const res = await prisma.reservation.findMany({ where: { status: 'due_checkout', checkedOutAt: null } });
    console.log('Found', res.length);
    for (const r of res) { await getFolioBalance(r.id); }
    console.log('Success');
  } catch(e) { console.error('Error:', e); } finally { await prisma.$disconnect(); }
}

test();