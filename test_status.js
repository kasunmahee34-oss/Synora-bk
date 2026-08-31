const { getFolioBalance } = require('./src/services/folioService');
const prisma = require('./src/prismaClient');

async function test() {
  try {
    const now = new Date();
    const businessDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));

    console.log('Testing pendingArrivals...');
    const pendingArrivals = await prisma.reservation.findMany({
      where: {
        status: { in: ['tentative', 'guaranteed'] },
        checkIn: { lte: businessDate }
      },
      include: { guest: true, room: true }
    });
    console.log('pendingArrivals found:', pendingArrivals.length);

    console.log('Testing noShowCandidates...');
    const noShowCandidates = pendingArrivals.filter(r => r.status === 'tentative');

    console.log('Testing pendingDepartures...');
    const pendingDepartures = await prisma.reservation.findMany({
      where: {
        status: { in: ['in_house', 'due_checkout'] },
        checkOut: { lte: businessDate },
        checkedOutAt: null
      },
      include: { guest: true, room: true }
    });
    console.log('pendingDepartures found:', pendingDepartures.length);

    console.log('Testing pendingDueCheckouts...');
    const pendingDueCheckouts = await prisma.reservation.findMany({
      where: {
        status: 'due_checkout',
        checkedOutAt: null,
      },
      include: { guest: true, room: true }
    });
    
    console.log('Testing getFolioBalance...');
    for (const r of pendingDueCheckouts) {
      await getFolioBalance(r.id);
    }
    console.log('Success');
  } catch(e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}
test();
