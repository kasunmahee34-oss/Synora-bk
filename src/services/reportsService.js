const prisma = require('../prismaClient');

function normalizeLegacyReportStatus(status) {
  if (!status) return status;

  const value = String(status).trim();
  const legacyMap = {
    confirmed: 'guaranteed',
    do_check_in: 'checked_in',
    checked_in: 'checked_in',
    due_checkout: 'due_checkout',
    completed: 'completed',
    checked_out: 'checked_out',
    room_assigned: 'room_assigned',
    closed: 'closed'
  };

  return legacyMap[value] || value;
}

// Helper for timezone-safe date extraction
function parseDateString(dateStr) {
  if (!dateStr) return null;
  return new Date(dateStr);
}

// Helper for pagination
function getPagination(query) {
  const page = Math.max(parseInt(query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit) || 20, 1), 100);
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

// Helper to compute reservation totals (gross, discount, net, paid, refunded, outstanding)
async function compileReservationBalances(reservations) {
  const { calculateTaxBreakdown } = require('./taxInvoiceService');

  return await Promise.all(reservations.map(async (res) => {
    const roomChargeRows = (res.guestCharges || []).filter(charge => !charge.isVoid && charge.chargeType && charge.chargeType.name === 'Room Charge');
    const roomChargeTotal = roomChargeRows.reduce((sum, charge) => sum + Number(charge.amount || 0), 0);
    const roomChargeTax = roomChargeRows.reduce((sum, charge) => {
      const chargeTax = (charge.taxes || []).reduce((taxSum, tax) => taxSum + Number(tax.amount || 0), 0);
      return sum + chargeTax;
    }, 0);

    const checkInDate = new Date(res.checkIn);
    const checkOutDate = new Date(res.checkOut);
    const diffTime = Math.abs(checkOutDate - checkInDate);
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    const roomRevenue = roomChargeTotal > 0 ? roomChargeTotal : (res.rate * nights);

    let roomTax = roomChargeTax;
    if (roomChargeTotal === 0) {
      const roomTaxBreakdown = await calculateTaxBreakdown(roomRevenue, {
        propertyId: res.propertyId,
        onDate: res.checkIn
      });
      roomTax = roomTaxBreakdown.sc + roomTaxBreakdown.vat + roomTaxBreakdown.tdl + roomTaxBreakdown.nbt;
    }
    const roomTotal = roomRevenue + roomTax;

    let incidentalTotal = 0;
    res.guestCharges.forEach(charge => {
      if (!charge.isVoid) {
        const isRoomCharge = charge.chargeType && charge.chargeType.name === 'Room Charge';
        if (!isRoomCharge) {
          incidentalTotal += Number(charge.amount || 0);
          (charge.taxes || []).forEach(t => {
            incidentalTotal += Number(t.amount || 0);
          });
        }
      }
    });

    const grossAmount = roomTotal + incidentalTotal;

    const discountAmount = res.discounts.reduce((sum, d) => sum + Number(d.discountAmount || 0), 0);
    const netAmount = Math.max(grossAmount - discountAmount, 0);

    const paidAmount = res.payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const refundedAmount = res.refunds.reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const netPaid = Math.max(paidAmount - refundedAmount, 0);
    const outstanding = Math.round((netAmount - netPaid) * 100) / 100;

    return {
      id: res.id,
      confoNo: res.confoNo,
      checkIn: res.checkIn,
      checkOut: res.checkOut,
      expectedCheckInAt: res.expectedCheckInAt,
      expectedCheckOutAt: res.expectedCheckOutAt,
      checkedInAt: res.checkedInAt,
      checkedOutAt: res.checkedOutAt,
      status: res.status,
      bookingSource: res.bookingSource,
      guest: {
        fullName: res.guest.fullName,
        email: res.guest.email,
        phone: res.guest.phone
      },
      room: {
        roomNumber: res.room.roomNumber,
        roomType: res.room.roomType.typeName
      },
      rate: res.rate,
      totals: {
        gross: grossAmount,
        discount: discountAmount,
        net: netAmount,
        paid: paidAmount,
        refunded: refundedAmount,
        outstanding: outstanding
      }
    };
  }));
}

// ----------------------------------------------------
// 1. RESERVATION REPORTS
// ----------------------------------------------------

async function getDailyReservations(query) {
  const { page, limit, skip } = getPagination(query);
  const targetDate = parseDateString(query.date) || new Date();
  targetDate.setUTCHours(0,0,0,0);
  const nextDay = new Date(targetDate.getTime() + 86400000);

  const where = {
    OR: [
      // Starts today
      { checkIn: { gte: targetDate, lt: nextDay } },
      // Currently staying
      {
        AND: [
          { checkIn: { lt: targetDate } },
          { checkOut: { gt: targetDate } }
        ]
      }
    ],
    status: { notIn: ['cancelled', 'no_show'] }
  };
  // Optional meal plan filter (accepts mealPlanCode or mealPlanId)
  if (query.mealPlan || query.mealPlanCode) {
    const code = query.mealPlan || query.mealPlanCode;
    where.mealPlanCode = code;
  } else if (query.mealPlanId) {
    where.mealPlanId = Number(query.mealPlanId);
  }

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } },
        payments: true,
        guestCharges: { include: { chargeType: true, taxes: true } },
        discounts: true,
        refunds: true
      },
      orderBy: { checkIn: 'asc' }
    })
  ]);

  const data = await compileReservationBalances(raw);
  return { data, total, page, limit };
}

async function getUpcomingReservations(query) {
  const { page, limit, skip } = getPagination(query);
  const targetDate = parseDateString(query.dateFrom) || new Date();
  targetDate.setUTCHours(0,0,0,0);

  const where = {
    checkIn: { gte: targetDate },
    status: { in: ['tentative', 'guaranteed', 'room_assigned', 'checked_in'] }
  };
  if (query.mealPlan || query.mealPlanCode) {
    const code = query.mealPlan || query.mealPlanCode;
    where.mealPlanCode = code;
  } else if (query.mealPlanId) {
    where.mealPlanId = Number(query.mealPlanId);
  }

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } },
        payments: true,
        guestCharges: { include: { chargeType: true, taxes: true } },
        discounts: true,
        refunds: true
      },
      orderBy: { checkIn: 'asc' }
    })
  ]);

  const data = await compileReservationBalances(raw);
  return { data, total, page, limit };
}

async function getReservationStatus(query) {
  const { page, limit, skip } = getPagination(query);
  const status = query.status;

  const where = status ? { status: normalizeLegacyReportStatus(status) } : {};
  if (query.mealPlan || query.mealPlanCode) {
    const code = query.mealPlan || query.mealPlanCode;
    where.mealPlanCode = code;
  } else if (query.mealPlanId) {
    where.mealPlanId = Number(query.mealPlanId);
  }

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } },
        payments: true,
        guestCharges: { include: { chargeType: true, taxes: true } },
        discounts: true,
        refunds: true
      },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  const data = await compileReservationBalances(raw);
  return { data, total, page, limit };
}

async function getCancellations(query) {
  const { page, limit, skip } = getPagination(query);
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    status: 'cancelled',
    ...(dateFrom && dateTo && {
      cancelledAt: { gte: dateFrom, lte: dateTo }
    })
  };
  if (query.mealPlan || query.mealPlanCode) {
    const code = query.mealPlan || query.mealPlanCode;
    where.mealPlanCode = code;
  } else if (query.mealPlanId) {
    where.mealPlanId = Number(query.mealPlanId);
  }

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } },
        payments: true,
        guestCharges: { include: { chargeType: true, taxes: true } },
        discounts: true,
        refunds: true,
        cancelledUser: true
      },
      orderBy: { cancelledAt: 'desc' }
    })
  ]);

  const data = await compileReservationBalances(raw);
  const enriched = data.map((item, idx) => {
    const rawRes = raw[idx];
    return {
      ...item,
      cancellationReason: rawRes.cancellationReason,
      cancelledAt: rawRes.cancelledAt,
      cancelledBy: rawRes.cancelledUser ? rawRes.cancelledUser.fullName : null
    };
  });

  return { data: enriched, total, page, limit };
}

async function getNoShows(query) {
  const { page, limit, skip } = getPagination(query);
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    status: 'no_show',
    ...(dateFrom && dateTo && {
      checkIn: { gte: dateFrom, lte: dateTo }
    })
  };
  if (query.mealPlan || query.mealPlanCode) {
    const code = query.mealPlan || query.mealPlanCode;
    where.mealPlanCode = code;
  } else if (query.mealPlanId) {
    where.mealPlanId = Number(query.mealPlanId);
  }

// ----------------------------------------------------
// Meal Plan distribution report
// ----------------------------------------------------
async function getMealPlanDistribution(query) {
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    ...(dateFrom && dateTo && { checkIn: { gte: dateFrom, lte: dateTo } }),
    status: { notIn: ['cancelled', 'no_show'] }
  };

  const raw = await prisma.reservation.findMany({
    where,
    select: {
      mealPlanCode: true,
      mealPlanName: true,
      checkIn: true,
      checkOut: true,
      id: true
    }
  });

  const map = {};
  raw.forEach(r => {
    const code = r.mealPlanCode || 'UNASSIGNED';
    const name = r.mealPlanName || '';
    const checkIn = new Date(r.checkIn);
    const checkOut = new Date(r.checkOut);
    const nights = Math.max(Math.ceil((checkOut - checkIn) / 86400000), 1);
    if (!map[code]) map[code] = { code, name, reservations: 0, roomNights: 0 };
    map[code].reservations += 1;
    map[code].roomNights += nights;
  });

  const data = Object.values(map);
  return { data };
}

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } },
        payments: true,
        guestCharges: { include: { chargeType: true, taxes: true } },
        discounts: true,
        refunds: true
      },
      orderBy: { checkIn: 'desc' }
    })
  ]);

  const data = await compileReservationBalances(raw);
  return { data, total, page, limit };
}

// ----------------------------------------------------
// 2. ROOM REPORTS
// ----------------------------------------------------

async function getRoomAvailability(query) {
  const dateFrom = parseDateString(query.dateFrom) || new Date();
  const dateTo = parseDateString(query.dateTo) || new Date(Date.now() + 86400000 * 7);

  if (dateTo <= dateFrom) {
    throw new Error('dateTo must be after dateFrom');
  }

  // 1. Fetch all rooms
  const rooms = await prisma.room.findMany({
    include: { roomType: true, floor: true }
  });

  // 2. Fetch reservations overlapping range
  const reservations = await prisma.reservation.findMany({
    where: {
      status: { notIn: ['cancelled', 'no_show'] },
      checkIn: { lt: dateTo },
      checkOut: { gt: dateFrom }
    }
  });

  // 3. Fetch maintenance logs overlapping range
  const maintenanceLogs = await prisma.roomMaintenance.findMany({
    where: {
      startDate: { lt: dateTo },
      endDate: { gt: dateFrom }
    }
  });

  const data = rooms.map(room => {
    const isOccupied = reservations.some(r => r.roomId === room.id);
    const underMaint = maintenanceLogs.some(m => m.roomId === room.id);

    let availabilityStatus = 'available';
    if (underMaint) {
      availabilityStatus = 'maintenance';
    } else if (isOccupied) {
      availabilityStatus = 'occupied';
    }

    return {
      id: room.id,
      roomNumber: room.roomNumber,
      roomType: room.roomType.typeName,
      floor: room.floor ? room.floor.floorName : 'N/A',
      status: availabilityStatus,
      currentOperationalStatus: room.status
    };
  });

  return { data };
}

async function getRoomOccupancy(query) {
  const targetDate = parseDateString(query.date) || new Date();
  targetDate.setUTCHours(0,0,0,0);

  const rooms = await prisma.room.findMany({
    include: { roomType: true, floor: true }
  });

  const activeReservations = await prisma.reservation.findMany({
    where: {
      status: { notIn: ['cancelled', 'no_show'] },
      checkIn: { lte: targetDate },
      checkOut: { gt: targetDate }
    },
    include: { guest: true }
  });

  const occupiedRooms = rooms.map(room => {
    const activeRes = activeReservations.find(r => r.roomId === room.id);
    return {
      roomNumber: room.roomNumber,
      roomType: room.roomType.typeName,
      isOccupied: !!activeRes,
      guestName: activeRes ? activeRes.guest.fullName : null,
      status: room.status
    };
  });

  return { data: occupiedRooms };
}

async function getRoomStatus() {
  const rooms = await prisma.room.findMany({
    include: { roomType: true, floor: true },
    orderBy: { roomNumber: 'asc' }
  });

  const data = rooms.map(r => ({
    id: r.id,
    roomNumber: r.roomNumber,
    roomType: r.roomType.typeName,
    floor: r.floor ? r.floor.floorName : 'N/A',
    status: r.status
  }));

  return { data };
}

async function getRoomTypeOccupancy(query) {
  const targetDate = parseDateString(query.date) || new Date();
  targetDate.setUTCHours(0,0,0,0);

  const roomTypes = await prisma.roomType.findMany({
    include: { rooms: true }
  });

  const activeReservations = await prisma.reservation.findMany({
    where: {
      status: { notIn: ['cancelled', 'no_show'] },
      checkIn: { lte: targetDate },
      checkOut: { gt: targetDate }
    }
  });

  const data = roomTypes.map(rt => {
    const totalRooms = rt.rooms.length;
    const occupied = rt.rooms.filter(room => 
      activeReservations.some(r => r.roomId === room.id)
    ).length;

    const occupancyRate = totalRooms > 0 ? (occupied / totalRooms) * 100 : 0;

    return {
      roomType: rt.typeName,
      totalRooms,
      occupiedRooms: occupied,
      occupancyPercentage: Math.round(occupancyRate * 100) / 100
    };
  });

  return { data };
}

// ----------------------------------------------------
// 3. CHECK-IN / CHECK-OUT REPORTS
// ----------------------------------------------------

async function getDailyCheckIns(query) {
  const { page, limit, skip } = getPagination(query);
  
  let where = {};
  if (query.dateFrom && query.dateTo) {
    const dateFrom = parseDateString(query.dateFrom);
    dateFrom.setUTCHours(0,0,0,0);
    const dateTo = parseDateString(query.dateTo);
    dateTo.setUTCHours(23,59,59,999);
    where.checkedInAt = { gte: dateFrom, lte: dateTo };
  } else {
    const targetDate = parseDateString(query.date) || new Date();
    targetDate.setUTCHours(0,0,0,0);
    const nextDay = new Date(targetDate.getTime() + 86400000);
    where.checkedInAt = { gte: targetDate, lt: nextDay };
  }

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } }
      },
      orderBy: { checkedInAt: 'asc' }
    })
  ]);

  const data = raw.map(r => ({
    confoNo: r.confoNo,
    guestName: r.guest.fullName,
    roomNumber: r.room.roomNumber,
    roomType: r.room.roomType.typeName,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    checkedInAt: r.checkedInAt
  }));

  return { data, total, page, limit };
}

async function getDailyCheckOuts(query) {
  const { page, limit, skip } = getPagination(query);
  
  let where = {};
  if (query.dateFrom && query.dateTo) {
    const dateFrom = parseDateString(query.dateFrom);
    dateFrom.setUTCHours(0,0,0,0);
    const dateTo = parseDateString(query.dateTo);
    dateTo.setUTCHours(23,59,59,999);
    where.checkedOutAt = { gte: dateFrom, lte: dateTo };
  } else {
    const targetDate = parseDateString(query.date) || new Date();
    targetDate.setUTCHours(0,0,0,0);
    const nextDay = new Date(targetDate.getTime() + 86400000);
    where.checkedOutAt = { gte: targetDate, lt: nextDay };
  }

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } }
      },
      orderBy: { checkedOutAt: 'asc' }
    })
  ]);

  const data = raw.map(r => ({
    confoNo: r.confoNo,
    guestName: r.guest.fullName,
    roomNumber: r.room.roomNumber,
    roomType: r.room.roomType.typeName,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    checkedOutAt: r.checkedOutAt
  }));

  return { data, total, page, limit };
}

async function getExpectedArrivals(query) {
  const { page, limit, skip } = getPagination(query);
  const targetDate = parseDateString(query.date) || new Date();
  targetDate.setUTCHours(0,0,0,0);

  const where = {
    checkIn: targetDate,
    status: { in: ['tentative', 'guaranteed', 'room_assigned', 'checked_in'] }
  };

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } }
      },
      orderBy: { confoNo: 'asc' }
    })
  ]);

  const data = raw.map(r => ({
    confoNo: r.confoNo,
    guestName: r.guest.fullName,
    roomNumber: r.room.roomNumber,
    roomType: r.room.roomType.typeName,
    checkIn: r.checkIn,
    checkOut: r.checkOut
  }));

  return { data, total, page, limit };
}

async function getExpectedDepartures(query) {
  const { page, limit, skip } = getPagination(query);
  const targetDate = parseDateString(query.date) || new Date();
  targetDate.setUTCHours(0,0,0,0);

  const where = {
    checkOut: targetDate,
    status: 'checked_in'
  };

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } }
      },
      orderBy: { confoNo: 'asc' }
    })
  ]);

  const data = raw.map(r => ({
    confoNo: r.confoNo,
    guestName: r.guest.fullName,
    roomNumber: r.room.roomNumber,
    roomType: r.room.roomType.typeName,
    checkIn: r.checkIn,
    checkOut: r.checkOut
  }));

  return { data, total, page, limit };
}

async function getDueCheckouts(query) {
  const { page, limit, skip } = getPagination(query);

  let where = {
    status: 'in_house',
    checkedOutAt: null,
    checkOut: { lte: new Date() }
  };

  if (query.dateFrom && query.dateTo) {
    const dateFrom = parseDateString(query.dateFrom);
    const dateTo = parseDateString(query.dateTo);
    dateFrom.setUTCHours(0,0,0,0);
    dateTo.setUTCHours(23,59,59,999);
    where.checkOut = { gte: dateFrom, lte: dateTo };
  } else if (query.date) {
    const targetDate = parseDateString(query.date) || new Date();
    targetDate.setUTCHours(0,0,0,0);
    const endOfDay = new Date(targetDate.getTime() + 86400000);
    endOfDay.setUTCHours(0, 0, 0, 0);
    where.checkOut = { gte: targetDate, lt: endOfDay };
  }

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } },
        payments: true,
        guestCharges: { include: { chargeType: true, taxes: true } },
        discounts: true,
        refunds: true
      },
      orderBy: { checkOut: 'asc' }
    })
  ]);

  const data = raw.map(res => {
    const roomChargeRows = (res.guestCharges || []).filter(charge => !charge.isVoid && charge.chargeType && charge.chargeType.name === 'Room Charge');
    const roomChargeTotal = roomChargeRows.reduce((sum, charge) => sum + Number(charge.amount || 0), 0);
    const roomChargeTax = roomChargeRows.reduce((totalTax, charge) => totalTax + (charge.taxes || []).reduce((sum, tax) => sum + Number(tax.amount || 0), 0), 0);
    const incidentalTotal = (res.guestCharges || []).reduce((sum, charge) => {
      if (charge.isVoid) return sum;
      if (charge.chargeType && charge.chargeType.name === 'Room Charge') return sum;
      return sum + Number(charge.amount || 0) + (charge.taxes || []).reduce((taxSum, tax) => taxSum + Number(tax.amount || 0), 0);
    }, 0);

    const totalCharges = (roomChargeTotal > 0 ? roomChargeTotal : Number(res.rate || 0)) + roomChargeTax + incidentalTotal;
    const paid = (res.payments || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const refunded = (res.refunds || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);
    const outstanding = Math.round((totalCharges - paid - refunded) * 100) / 100;
    const nightsStayed = Math.max(Math.ceil((new Date(res.checkOut) - new Date(res.checkIn)) / 86400000), 1);

    return {
      reservation: res.confoNo,
      guest: res.guest?.fullName || 'Unknown',
      room: res.room?.roomNumber || 'N/A',
      expectedCheckoutDate: res.checkOut,
      actualCheckout: null,
      totalCharges,
      paid,
      outstanding,
      nightsStayed,
      status: 'DUE_CHECKOUT'
    };
  });

  return { data, total, page, limit };
}

// ----------------------------------------------------
// 4. FINANCIAL REPORTS
// ----------------------------------------------------

async function getDailyRevenue(query) {
  const targetDate = parseDateString(query.date) || new Date();
  targetDate.setUTCHours(0,0,0,0);
  const nextDay = new Date(targetDate.getTime() + 86400000);

  // 1. Fetch Room charges (NightAudit posted charges on this audit date)
  const roomRevenues = await prisma.guestCharge.aggregate({
    where: {
      postedAt: { gte: targetDate, lt: nextDay },
      chargeType: { name: 'Room Charge' },
      isVoid: false
    },
    _sum: { amount: true }
  });

  // 2. Fetch Incidental charges on this date
  const incidentalRevenues = await prisma.guestCharge.aggregate({
    where: {
      postedAt: { gte: targetDate, lt: nextDay },
      chargeType: { name: { not: 'Room Charge' } },
      isVoid: false
    },
    _sum: { amount: true }
  });

  // 3. Fetch tax totals on this date
  const taxes = await prisma.guestChargeTax.aggregate({
    where: {
      createdAt: { gte: targetDate, lt: nextDay },
      charge: { isVoid: false }
    },
    _sum: { amount: true }
  });

  // 4. Fetch discounts on this date
  const discounts = await prisma.discount.aggregate({
    where: {
      appliedAt: { gte: targetDate, lt: nextDay }
    },
    _sum: { discountAmount: true }
  });

  const roomRev = roomRevenues._sum.amount || 0;
  const incidentalRev = incidentalRevenues._sum.amount || 0;
  const taxSum = taxes._sum.amount || 0;
  const discountSum = discounts._sum.discountAmount || 0;

  const grossTotal = roomRev + incidentalRev + taxSum;
  const netRevenue = Math.max(grossTotal - discountSum, 0);

  return {
    data: {
      date: targetDate.toISOString().slice(0, 10),
      roomRevenue: roomRev,
      incidentalRevenue: incidentalRev,
      taxes: taxSum,
      discounts: discountSum,
      grossTotal,
      netRevenue
    }
  };
}

async function getMonthlyRevenue(query) {
  const year = parseInt(query.year) || new Date().getFullYear();
  const month = parseInt(query.month) || (new Date().getMonth() + 1); // 1-indexed

  const dateFrom = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const dateTo = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));

  const roomRevenues = await prisma.guestCharge.aggregate({
    where: {
      postedAt: { gte: dateFrom, lt: dateTo },
      chargeType: { name: 'Room Charge' },
      isVoid: false
    },
    _sum: { amount: true }
  });

  const incidentalRevenues = await prisma.guestCharge.aggregate({
    where: {
      postedAt: { gte: dateFrom, lt: dateTo },
      chargeType: { name: { not: 'Room Charge' } },
      isVoid: false
    },
    _sum: { amount: true }
  });

  const taxes = await prisma.guestChargeTax.aggregate({
    where: {
      createdAt: { gte: dateFrom, lt: dateTo },
      charge: { isVoid: false }
    },
    _sum: { amount: true }
  });

  const discounts = await prisma.discount.aggregate({
    where: {
      appliedAt: { gte: dateFrom, lt: dateTo }
    },
    _sum: { discountAmount: true }
  });

  const roomRev = roomRevenues._sum.amount || 0;
  const incidentalRev = incidentalRevenues._sum.amount || 0;
  const taxSum = taxes._sum.amount || 0;
  const discountSum = discounts._sum.discountAmount || 0;

  const grossTotal = roomRev + incidentalRev + taxSum;
  const netRevenue = Math.max(grossTotal - discountSum, 0);

  return {
    data: {
      month: `${year}-${String(month).padStart(2, '0')}`,
      roomRevenue: roomRev,
      incidentalRevenue: incidentalRev,
      taxes: taxSum,
      discounts: discountSum,
      grossTotal,
      netRevenue
    }
  };
}

async function getRevenueByRoomType(query) {
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const roomTypes = await prisma.roomType.findMany({
    include: {
      rooms: {
        include: {
          reservations: {
            where: {
              status: { notIn: ['cancelled', 'no_show'] },
              ...(dateFrom && dateTo && {
                checkIn: { lt: dateTo },
                checkOut: { gt: dateFrom }
              })
            }
          }
        }
      }
    }
  });

  const data = roomTypes.map(rt => {
    let revenue = 0;
    rt.rooms.forEach(room => {
      room.reservations.forEach(res => {
        const checkInDate = new Date(res.checkIn);
        const checkOutDate = new Date(res.checkOut);
        const diffTime = Math.abs(checkOutDate - checkInDate);
        const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
        revenue += res.rate * nights;
      });
    });

    return {
      roomType: rt.typeName,
      revenue
    };
  });

  return { data };
}

async function getRevenueByBookingSource(query) {
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    status: { notIn: ['cancelled', 'no_show'] },
    ...(dateFrom && dateTo && {
      checkIn: { lt: dateTo },
      checkOut: { gt: dateFrom }
    })
  };

  const reservations = await prisma.reservation.findMany({ where });

  const summary = {};
  reservations.forEach(res => {
    const checkInDate = new Date(res.checkIn);
    const checkOutDate = new Date(res.checkOut);
    const diffTime = Math.abs(checkOutDate - checkInDate);
    const nights = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
    const roomRevenue = res.rate * nights;

    summary[res.bookingSource] = (summary[res.bookingSource] || 0) + roomRevenue;
  });

  const data = Object.keys(summary).map(source => ({
    bookingSource: source,
    revenue: summary[source]
  }));

  return { data };
}

async function getPaymentCollection(query) {
  const { page, limit, skip } = getPagination(query);
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    ...(dateFrom && dateTo && {
      paidAt: { gte: dateFrom, lte: dateTo }
    })
  };

  const [total, raw] = await prisma.$transaction([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      skip,
      take: limit,
      include: {
        reservation: { include: { guest: true } },
        user: { select: { id: true, username: true, fullName: true } }
      },
      orderBy: { paidAt: 'desc' }
    })
  ]);

  const data = raw.map(p => ({
    id: p.id,
    confoNo: p.reservation.confoNo,
    guestName: p.reservation.guest.fullName,
    amount: p.amount,
    paymentType: p.paymentType,
    paidAt: p.paidAt,
    reference: p.reference,
    postedBy: p.user ? p.user.fullName : 'System'
  }));

  return { data, total, page, limit };
}

async function getOutstandingPayments(query) {
  const { page, limit, skip } = getPagination(query);
  const status = query.status || 'checked_in';

  const where = { status };

  const [total, raw] = await prisma.$transaction([
    prisma.reservation.count({ where }),
    prisma.reservation.findMany({
      where,
      skip,
      take: limit,
      include: {
        guest: true,
        room: { include: { roomType: true } },
        payments: true,
        guestCharges: { include: { chargeType: true, taxes: true } },
        discounts: true,
        refunds: true
      },
      orderBy: { checkOut: 'asc' }
    })
  ]);

  const balances = await compileReservationBalances(raw);
  // Filter only where outstanding > 0
  const filtered = balances.filter(b => b.totals.outstanding > 0);

  return { data: filtered, total: filtered.length, page, limit };
}

async function getRefunds(query) {
  const { page, limit, skip } = getPagination(query);
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    ...(dateFrom && dateTo && {
      refundDate: { gte: dateFrom, lte: dateTo }
    })
  };

  const [total, raw] = await prisma.$transaction([
    prisma.refund.count({ where }),
    prisma.refund.findMany({
      where,
      skip,
      take: limit,
      include: {
        reservation: { include: { guest: true } },
        payment: true,
        user: { select: { id: true, username: true, fullName: true } }
      },
      orderBy: { refundDate: 'desc' }
    })
  ]);

  const data = raw.map(r => ({
    id: r.id,
    confoNo: r.reservation.confoNo,
    guestName: r.reservation.guest.fullName,
    amount: r.amount,
    refundDate: r.refundDate,
    reason: r.reason,
    paymentReference: r.payment ? r.payment.reference : null,
    processedBy: r.user.fullName
  }));

  return { data, total, page, limit };
}

async function getDiscounts(query) {
  const { page, limit, skip } = getPagination(query);
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    ...(dateFrom && dateTo && {
      appliedAt: { gte: dateFrom, lte: dateTo }
    })
  };

  const [total, raw] = await prisma.$transaction([
    prisma.discount.count({ where }),
    prisma.discount.findMany({
      where,
      skip,
      take: limit,
      include: {
        reservation: { include: { guest: true } },
        guestCharge: true,
        user: { select: { id: true, username: true, fullName: true } }
      },
      orderBy: { appliedAt: 'desc' }
    })
  ]);

  const data = raw.map(d => ({
    id: d.id,
    confoNo: d.reservation.confoNo,
    guestName: d.reservation.guest.fullName,
    originalAmount: d.originalAmount,
    discountAmount: d.discountAmount,
    discountType: d.discountType,
    reason: d.reason,
    appliedBy: d.user.fullName,
    appliedAt: d.appliedAt
  }));

  return { data, total, page, limit };
}

async function getTaxes(query) {
  const { page, limit, skip } = getPagination(query);
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    ...(dateFrom && dateTo && {
      createdAt: { gte: dateFrom, lte: dateTo }
    })
  };

  const [total, raw] = await prisma.$transaction([
    prisma.guestChargeTax.count({ where }),
    prisma.guestChargeTax.findMany({
      where,
      skip,
      take: limit,
      include: {
        charge: { include: { reservation: { include: { guest: true } } } }
      },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  const data = raw.map(t => ({
    id: t.id,
    confoNo: t.charge.reservation.confoNo,
    guestName: t.charge.reservation.guest.fullName,
    taxType: t.taxType,
    taxRate: t.taxRate,
    taxableAmount: t.taxableAmount,
    taxAmount: t.amount,
    createdAt: t.createdAt
  }));

  return { data, total, page, limit };
}

// ----------------------------------------------------
// 5. GUEST REPORTS
// ----------------------------------------------------

async function getGuestsList(query) {
  const { page, limit, skip } = getPagination(query);
  const search = query.search || '';

  const where = search ? {
    OR: [
      { fullName: { contains: search } },
      { email: { contains: search } },
      { phone: { contains: search } }
    ]
  } : {};

  const [total, raw] = await prisma.$transaction([
    prisma.guest.count({ where }),
    prisma.guest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { fullName: 'asc' }
    })
  ]);

  return { data: raw, total, page, limit };
}

async function getGuestHistory(guestId) {
  const guest = await prisma.guest.findUnique({
    where: { id: parseInt(guestId) },
    include: {
      reservations: {
        include: {
          payments: true,
          guestCharges: { include: { chargeType: true, taxes: true } },
          discounts: true,
          refunds: true,
          room: { include: { roomType: true } }
        }
      }
    }
  });

  if (!guest) {
    throw new Error('Guest not found');
  }

  const reservationHistory = await compileReservationBalances(guest.reservations);

  const totalSpending = reservationHistory.reduce((sum, r) => sum + r.totals.net, 0);
  const roomsStayed = [...new Set(guest.reservations.map(r => r.room.roomNumber))];

  return {
    data: {
      guest: {
        fullName: guest.fullName,
        email: guest.email,
        phone: guest.phone
      },
      reservationCount: guest.reservations.length,
      roomsStayed,
      totalSpending,
      reservations: reservationHistory
    }
  };
}

async function getFrequentGuests(query) {
  const minVisits = parseInt(query.minVisits) || 3;

  const guests = await prisma.guest.findMany({
    include: {
      _count: {
        select: { reservations: true }
      }
    }
  });

  const filtered = guests
    .filter(g => g._count.reservations >= minVisits)
    .map(g => ({
      id: g.id,
      fullName: g.fullName,
      email: g.email,
      phone: g.phone,
      visitsCount: g._count.reservations
    }))
    .sort((a, b) => b.visitsCount - a.visitsCount);

  return { data: filtered };
}

// ----------------------------------------------------
// 6. MANAGEMENT DASHBOARD & KPIs
// ----------------------------------------------------

async function getDashboardSummary() {
  const today = new Date();
  today.setUTCHours(0,0,0,0);
  const nextDay = new Date(today.getTime() + 86400000);
  const thisMonthStart = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1, 0,0,0,0));

  // 1. General counts
  const totalRooms = await prisma.room.count();
  
  // Occupied rooms today
  const occupiedReservations = await prisma.reservation.findMany({
    where: {
      status: { notIn: ['cancelled', 'no_show', 'checked_out'] },
      checkIn: { lte: today },
      checkOut: { gt: today }
    }
  });
  const occupiedRooms = occupiedReservations.length;

  // Maintenance rooms today
  const maintenanceRoomsCount = await prisma.room.count({
    where: { status: 'maintenance' }
  });

  const availableRooms = Math.max(totalRooms - occupiedRooms - maintenanceRoomsCount, 0);

  // Reserved rooms starting today or in future
  const reservedRooms = await prisma.reservation.count({
    where: { status: 'guaranteed', checkIn: { gte: today } }
  });

  // Occupancy rate calculation
  const occupancyPercentage = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

  // 2. Arrivals / departures today
  const todayReservations = await prisma.reservation.count({
    where: { createdAt: { gte: today, lt: nextDay } }
  });
  const todayCheckIns = await prisma.reservation.count({
    where: { checkedInAt: { gte: today, lt: nextDay } }
  });
  const todayCheckOuts = await prisma.reservation.count({
    where: { checkedOutAt: { gte: today, lt: nextDay } }
  });
  const cancelledReservations = await prisma.reservation.count({
    where: { status: 'cancelled', cancelledAt: { gte: today, lt: nextDay } }
  });
  const noShows = await prisma.reservation.count({
    where: { status: 'no_show', checkIn: today }
  });

  // 3. Revenues today
  const todayRevSum = await prisma.guestCharge.aggregate({
    where: {
      postedAt: { gte: today, lt: nextDay },
      chargeType: { name: 'Room Charge' },
      isVoid: false
    },
    _sum: { amount: true }
  });
  const todayRevenue = todayRevSum._sum.amount || 0;

  // Monthly revenue
  const monthlyRevSum = await prisma.guestCharge.aggregate({
    where: {
      postedAt: { gte: thisMonthStart, lt: nextDay },
      chargeType: { name: 'Room Charge' },
      isVoid: false
    },
    _sum: { amount: true }
  });
  const monthlyRevenue = monthlyRevSum._sum.amount || 0;

  // Outstanding payments on active stays
  const activeReservations = await prisma.reservation.findMany({
    where: { status: 'checked_in' },
    include: {
      guest: true,
      room: { include: { roomType: true } },
      payments: true,
      guestCharges: { include: { chargeType: true, taxes: true } },
      discounts: true,
      refunds: true
    }
  });
  const balances = await compileReservationBalances(activeReservations);
  const outstandingPayments = balances.reduce((sum, b) => sum + b.totals.outstanding, 0);

  // 4. ADR / RevPAR KPIs
  // ADR = Room Revenue / Sold Room Nights
  // Sold Room Night = Rooms sold today (active stays)
  const soldRoomNights = occupiedRooms;
  const adr = soldRoomNights > 0 ? todayRevenue / soldRoomNights : 0;

  // RevPAR = Room Revenue / Available Room Nights
  // Available Room Nights = Total rooms minus rooms under maintenance
  const availableRoomNights = Math.max(totalRooms - maintenanceRoomsCount, 1);
  const revpar = todayRevenue / availableRoomNights;

  return {
    data: {
      totalRooms,
      availableRooms,
      occupiedRooms,
      reservedRooms,
      occupancyPercentage: Math.round(occupancyPercentage * 100) / 100,
      todayReservations,
      todayCheckIns,
      todayCheckOuts,
      cancelledReservations,
      noShows,
      todayRevenue,
      monthlyRevenue,
      outstandingPayments,
      adr: Math.round(adr * 100) / 100,
      revpar: Math.round(revpar * 100) / 100
    }
  };
}

// ----------------------------------------------------
// 7. AUDIT REPORTS
// ----------------------------------------------------

async function getUserActivityLogs(query) {
  const { page, limit, skip } = getPagination(query);
  const userId = query.userId ? parseInt(query.userId) : undefined;
  const module = query.module;
  const action = query.action;
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    ...(userId && { userId }),
    ...(module && { module }),
    ...(action && { action }),
    ...(dateFrom && dateTo && {
      createdAt: { gte: dateFrom, lte: dateTo }
    })
  };

  const [total, raw] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      include: { user: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  const data = raw.map(l => ({
    id: l.id,
    user: l.user.fullName,
    action: l.action,
    module: l.module,
    entityType: l.entityType,
    entityId: l.entityId,
    description: l.description,
    oldValues: l.oldValues,
    newValues: l.newValues,
    ipAddress: l.ipAddress,
    userAgent: l.userAgent,
    createdAt: l.createdAt
  }));

  return { data, total, page, limit };
}

async function getReservationAuditLogs(query) {
  const { page, limit, skip } = getPagination(query);
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    module: 'reservation',
    ...(dateFrom && dateTo && {
      createdAt: { gte: dateFrom, lte: dateTo }
    })
  };

  const [total, raw] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      include: { user: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  const data = raw.map(l => ({
    id: l.id,
    user: l.user.fullName,
    action: l.action,
    entityId: l.entityId,
    description: l.description,
    oldValues: l.oldValues,
    newValues: l.newValues,
    createdAt: l.createdAt
  }));

  return { data, total, page, limit };
}

async function getPaymentAuditLogs(query) {
  const { page, limit, skip } = getPagination(query);
  const dateFrom = parseDateString(query.dateFrom);
  const dateTo = parseDateString(query.dateTo);

  const where = {
    module: 'payment',
    ...(dateFrom && dateTo && {
      createdAt: { gte: dateFrom, lte: dateTo }
    })
  };

  const [total, raw] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      include: { user: { select: { id: true, username: true, fullName: true } } },
      orderBy: { createdAt: 'desc' }
    })
  ]);

  const data = raw.map(l => ({
    id: l.id,
    user: l.user.fullName,
    action: l.action,
    entityId: l.entityId,
    description: l.description,
    oldValues: l.oldValues,
    newValues: l.newValues,
    createdAt: l.createdAt
  }));

  return { data, total, page, limit };
}

module.exports = {
  getDailyReservations,
  getUpcomingReservations,
  getReservationStatus,
  getCancellations,
  getNoShows,
  getRoomAvailability,
  getRoomOccupancy,
  getRoomStatus,
  getRoomTypeOccupancy,
  getDailyCheckIns,
  getDailyCheckOuts,
  getExpectedArrivals,
  getExpectedDepartures,
  getDueCheckouts,
  getDailyRevenue,
  getMonthlyRevenue,
  getRevenueByRoomType,
  getRevenueByBookingSource,
  getPaymentCollection,
  getOutstandingPayments,
  getRefunds,
  getDiscounts,
  getTaxes,
  getGuestsList,
  getGuestHistory,
  getFrequentGuests,
  getDashboardSummary,
  getUserActivityLogs,
  getReservationAuditLogs,
  getPaymentAuditLogs
};
