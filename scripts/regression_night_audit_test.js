/**
 * Simple regression test script (informal) to inspect Room Charge entries for a reservation
 * Usage: node backend/scripts/regression_night_audit_test.js
 *
 * Note: This script uses DATABASE_URL from env and will not call the running API.
 * It only inspects the DB via Prisma and reports counts. It does NOT modify data.
 */

const prisma = require('../src/prismaClient');

async function run() {
  const confo = process.argv[2] || 'ELLA-20260820-NCFT';
  try {
    const res = await prisma.reservation.findUnique({
      where: { confo_no: confo },
      include: { guestCharges: { include: { chargeType: true, taxes: true } } }
    });

    if (!res) {
      console.error('Reservation not found:', confo);
      process.exit(2);
    }

    console.log(`Reservation ${confo} found: id=${res.id}, rate=${res.rate}, checkIn=${res.checkIn}, checkOut=${res.checkOut}`);

    const roomCharges = res.guestCharges.filter(c => !c.isVoid && c.chargeType && c.chargeType.name === 'Room Charge');
    console.log(`Found ${roomCharges.length} non-void Room Charge guest_charge(s):`);
    for (const c of roomCharges) {
      const taxTotal = (c.taxes || []).reduce((s,t)=>s+(t.amount||0),0);
      console.log(`  id=${c.id} posted_at=${c.postedAt.toISOString().slice(0,10)} amount=${c.amount} tax=${taxTotal} desc=${c.description}`);
    }

    const nights = Math.ceil((new Date(res.checkOut)-new Date(res.checkIn))/(1000*60*60*24)) || 1;
    console.log(`Computed nights: ${nights}`);

    const expectedRoomCharges = nights;
    if (roomCharges.length > expectedRoomCharges) {
      console.warn('Potential duplicate room charges detected: more room charges than nights.');
    } else {
      console.log('Room charge count looks reasonable compared to nights.');
    }

    process.exit(0);
  } catch (err) {
    console.error('Error running regression script:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

run();
