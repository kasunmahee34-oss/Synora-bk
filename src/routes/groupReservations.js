const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, requirePermission } = require('../middlewares/auth');
const { getFolioBalance } = require('../services/folioService');
const sm = require('../services/reservationStateMachine');

const prisma = require('../prismaClient');
const router = express.Router();

function generateGroupCode() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `GRP-${date}-${random}`;
}

function toDateOnly(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function toDateTime(dateValue, timeValue) {
  if (!dateValue) return null;
  const base = new Date(dateValue);
  const timeString = timeValue || '14:00';
  const [hours, minutes] = String(timeString).split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) {
    return null;
  }
  const result = new Date(base);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

function getStatusSummary(reservations) {
  if (!Array.isArray(reservations) || reservations.length === 0) {
    return 'CONFIRMED';
  }

  const statuses = reservations.map((reservation) => reservation.status);
  const allCancelled = statuses.every((status) => status === 'cancelled');
  if (allCancelled) return 'CANCELLED';

  const allCompleted = statuses.every((status) => ['completed', 'checked_out'].includes(status));
  if (allCompleted) return 'COMPLETED';

  const anyInHouse = statuses.some((status) => ['in_house', 'due_checkout', 'checked_in'].includes(status));
  const anyCheckedOut = statuses.some((status) => ['checked_out', 'completed'].includes(status));

  if (anyCheckedOut && anyInHouse) return 'PARTIALLY_CHECKED_OUT';
  if (anyInHouse && statuses.some((status) => ['guaranteed', 'room_assigned'].includes(status))) return 'PARTIALLY_CHECKED_IN';
  if (statuses.every((status) => ['in_house', 'checked_in', 'due_checkout'].includes(status))) return 'IN_HOUSE';
  if (statuses.every((status) => ['guaranteed', 'room_assigned', 'tentative'].includes(status))) return 'CONFIRMED';
  return 'CONFIRMED';
}

async function refreshGroupStatus(groupId) {
  const reservations = await prisma.reservation.findMany({
    where: { groupReservationId: groupId },
    select: { status: true },
  });

  const nextStatus = getStatusSummary(reservations);
  await prisma.groupReservation.update({
    where: { id: groupId },
    data: { status: nextStatus },
  });

  return nextStatus;
}

function normalizeReservationState(status) {
  if (!status) return status;
  const map = {
    confirmed: 'guaranteed',
    checked_in: 'checked_in',
    checked_out: 'checked_out',
    do_check_in: 'checked_in',
    due_checkout: 'due_checkout',
    in_house: 'in_house',
    room_assigned: 'room_assigned',
    guaranteed: 'guaranteed',
  };
  return map[String(status).toLowerCase()] || String(status).toLowerCase();
}

function validateAndBuildDates(checkInDate, checkOutDate, checkInTime, checkOutTime) {
  if (!checkInDate || !checkOutDate) {
    throw new Error('checkInDate and checkOutDate are required');
  }

  const checkInAt = toDateTime(checkInDate, checkInTime || '14:00');
  const checkOutAt = toDateTime(checkOutDate, checkOutTime || '11:00');

  if (!checkInAt || !checkOutAt) {
    throw new Error('Invalid check-in or check-out date/time');
  }

  if (checkOutAt <= checkInAt) {
    throw new Error('check-out date/time must be after check-in date/time');
  }

  return { checkInAt, checkOutAt };
}

router.get('/', authenticateToken, requirePermission('group_reservation.view'), async (req, res) => {
  try {
    const groups = await prisma.groupReservation.findMany({
      include: {
        travelAgent: true,
        reservations: { include: { guest: true, room: { include: { roomType: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(groups);
  } catch (error) {
    console.error('Failed to fetch group reservations:', error);
    res.status(500).json({ error: 'Failed to fetch group reservations' });
  }
});

router.get('/:id', authenticateToken, requirePermission('group_reservation.view'), async (req, res) => {
  try {
    const group = await prisma.groupReservation.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        travelAgent: true,
        reservations: {
          include: { guest: true, room: { include: { roomType: true } }, payments: true },
        },
      },
    });

    if (!group) {
      return res.status(404).json({ error: 'Group reservation not found' });
    }

    res.json(group);
  } catch (error) {
    console.error('Error fetching group reservation:', error);
    res.status(500).json({ error: 'Failed to fetch group reservation' });
  }
});

router.get('/:id/reservations', authenticateToken, requirePermission('group_reservation.view'), async (req, res) => {
  try {
    const reservations = await prisma.reservation.findMany({
      where: { groupReservationId: Number(req.params.id) },
      include: { guest: true, room: { include: { roomType: true } }, travelAgent: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reservations);
  } catch (error) {
    console.error('Failed to fetch child reservations:', error);
    res.status(500).json({ error: 'Failed to fetch child reservations' });
  }
});

router.post('/', authenticateToken, requirePermission('group_reservation.create'), async (req, res) => {
  try {
    const {
      groupName,
      travelAgentId,
      checkInDate,
      checkOutDate,
      checkInTime,
      checkOutTime,
      mealPlanId,
      ratePlanId,
      notes,
      rooms,
      guests,
    } = req.body;

    if (!groupName || !Array.isArray(rooms) || rooms.length === 0) {
      return res.status(400).json({ error: 'Group name and room list are required.' });
    }

    const { checkInAt, checkOutAt } = validateAndBuildDates(checkInDate, checkOutDate, checkInTime, checkOutTime);

    if (mealPlanId) {
      const mealPlan = await prisma.mealPlan.findUnique({ where: { id: Number(mealPlanId) } });
      if (!mealPlan) return res.status(400).json({ error: 'Invalid meal plan.' });
    }

    if (ratePlanId) {
      const ratePlan = await prisma.ratePlan.findUnique({ where: { id: Number(ratePlanId) } });
      if (!ratePlan) return res.status(400).json({ error: 'Invalid rate plan.' });
    }

    if (travelAgentId) {
      const agent = await prisma.travelAgent.findUnique({ where: { id: Number(travelAgentId) } });
      if (!agent) return res.status(400).json({ error: 'Invalid travel agent.' });
    }

    const roomAllocations = [];
    for (const roomEntry of rooms) {
      const roomTypeId = Number(roomEntry.roomTypeId || roomEntry.room_type_id);
      const quantity = Number(roomEntry.quantity || 0);
      if (!roomTypeId || quantity <= 0) {
        return res.status(400).json({ error: 'Each room entry must include a valid roomTypeId and quantity greater than zero.' });
      }
      const roomType = await prisma.roomType.findUnique({ where: { id: roomTypeId } });
      if (!roomType) return res.status(400).json({ error: 'Invalid room type selected.' });

      const availableRooms = await prisma.room.findMany({
        where: { roomTypeId, status: 'available' },
        orderBy: { roomNumber: 'asc' },
      });

      if (availableRooms.length < quantity) {
        return res.status(409).json({ error: `Only ${availableRooms.length} ${roomType.typeName} rooms are available. Requested: ${quantity}.` });
      }

      roomAllocations.push({ roomTypeId, quantity, availableRooms: availableRooms.slice(0, quantity) });
    }

    const totalRequestedRooms = roomAllocations.reduce((sum, item) => sum + item.quantity, 0);
    const guestEntries = Array.isArray(guests) && guests.length > 0 ? guests : [];

    const group = await prisma.$transaction(async (tx) => {
      const createdGroup = await tx.groupReservation.create({
        data: {
          groupCode: generateGroupCode(),
          groupName,
          travelAgentId: travelAgentId ? Number(travelAgentId) : null,
          checkInDate: toDateOnly(checkInDate),
          checkOutDate: toDateOnly(checkOutDate),
          expectedCheckInAt: checkInAt,
          expectedCheckOutAt: checkOutAt,
          mealPlanId: mealPlanId ? Number(mealPlanId) : null,
          ratePlanId: ratePlanId ? Number(ratePlanId) : null,
          status: 'CONFIRMED',
          notes: notes || null,
          createdBy: req.user.id,
        },
      });

      const childReservations = [];
      let guestIndex = 0;

      for (const allocation of roomAllocations) {
        for (let index = 0; index < allocation.quantity; index += 1) {
          const selectedRoom = allocation.availableRooms[index];
          const targetGuest = guestEntries[guestIndex] || null;
          const guestRecord = targetGuest && (targetGuest.guestId || targetGuest.fullName)
            ? await (async () => {
                if (targetGuest.guestId) {
                  return await tx.guest.findUnique({ where: { id: Number(targetGuest.guestId) } });
                }
                return await tx.guest.create({
                  data: {
                    fullName: targetGuest.fullName || `Group Guest ${guestIndex + 1}`,
                    phone: targetGuest.phone || null,
                    email: targetGuest.email || null,
                  },
                });
              })()
            : await tx.guest.create({
                data: { fullName: `Group Guest ${guestIndex + 1}` },
              });

          const selectedRatePlan = ratePlanId
            ? await tx.ratePlan.findUnique({ where: { id: Number(ratePlanId) } })
            : await tx.ratePlan.findFirst({
                where: { roomTypeId: allocation.roomTypeId, travelAgentId: travelAgentId ? Number(travelAgentId) : null },
                orderBy: { startDate: 'asc' },
              });

          const baseRate = selectedRatePlan ? Number(selectedRatePlan.rate) : Number((await tx.roomType.findUnique({ where: { id: allocation.roomTypeId } })).baseRate);
          const finalRate = Number(baseRate || 0);

          const reservation = await tx.reservation.create({
            data: {
              confoNo: `GRP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
              guestId: guestRecord.id,
              travelAgentId: travelAgentId ? Number(travelAgentId) : null,
              roomId: selectedRoom?.id || null,
              groupReservationId: createdGroup.id,
              checkIn: toDateOnly(checkInDate) || new Date(checkInDate),
              checkOut: toDateOnly(checkOutDate) || new Date(checkOutDate),
              adults: 1,
              children: 0,
              status: 'guaranteed',
              bookingSource: travelAgentId ? 'travel_agent' : 'direct',
              rate: finalRate,
              expectedCheckInAt: checkInAt,
              expectedCheckOutAt: checkOutAt,
              mealPlanId: mealPlanId ? Number(mealPlanId) : null,
              createdBy: req.user.id,
            },
          });

          if (selectedRoom) {
            await tx.room.update({
              where: { id: selectedRoom.id },
              data: { status: 'occupied' },
            });
          }

          childReservations.push(reservation);
          guestIndex += 1;
        }
      }

      await tx.groupReservation.update({
        where: { id: createdGroup.id },
        data: { status: getStatusSummary(childReservations) },
      });

      return {
        ...createdGroup,
        reservations: childReservations,
        requestedRoomCount: totalRequestedRooms,
      };
    });

    res.status(201).json({
      ...group,
      message: `${group.requestedRoomCount} child reservations created successfully.`,
    });
  } catch (error) {
    console.error('Error creating group reservation:', error);
    res.status(error.status || 500).json({ error: error.message || 'Failed to create group reservation' });
  }
});

router.post('/:id/check-in', authenticateToken, requirePermission('group_reservation.checkin'), async (req, res) => {
  try {
    const group = await prisma.groupReservation.findUnique({
      where: { id: Number(req.params.id) },
      include: { reservations: true },
    });

    if (!group) return res.status(404).json({ error: 'Group reservation not found.' });

    const results = [];
    let checkedIn = 0;

    for (const reservation of group.reservations) {
      const normalized = normalizeReservationState(reservation.status);
      const canCheckIn = ['guaranteed', 'room_assigned', 'checked_in'].includes(normalized);
      if (!canCheckIn) {
        results.push({ reservationId: reservation.id, status: 'skipped', reason: `Reservation is in '${reservation.status}' status and cannot be checked in in the group flow.` });
        continue;
      }

      try {
        if (reservation.roomId) {
          await sm.performCheckIn(reservation.id, { userId: req.user.id, roomId: reservation.roomId });
          await prisma.reservation.update({ where: { id: reservation.id }, data: { status: 'in_house' } });
        } else {
          results.push({ reservationId: reservation.id, status: 'skipped', reason: 'Room not assigned' });
          continue;
        }
        checkedIn += 1;
        results.push({ reservationId: reservation.id, status: 'success' });
      } catch (error) {
        results.push({ reservationId: reservation.id, status: 'skipped', reason: error.message || 'Check-in failed' });
      }
    }

    await refreshGroupStatus(group.id);

    res.json({ checkedIn, skipped: results.filter((entry) => entry.status === 'skipped').length, results });
  } catch (error) {
    console.error('Group check-in failed:', error);
    res.status(500).json({ error: 'Failed to process group check-in' });
  }
});

router.post('/:id/checkout', authenticateToken, requirePermission('group_reservation.checkout'), async (req, res) => {
  try {
    const group = await prisma.groupReservation.findUnique({
      where: { id: Number(req.params.id) },
      include: { reservations: true },
    });

    if (!group) return res.status(404).json({ error: 'Group reservation not found.' });

    const results = [];
    let checkedOut = 0;

    for (const reservation of group.reservations) {
      const currentStatus = normalizeReservationState(reservation.status);
      if (!['in_house', 'due_checkout', 'checked_in'].includes(currentStatus)) {
        results.push({ reservationId: reservation.id, status: 'skipped', reason: `Reservation is in '${reservation.status}' status and is not eligible for group checkout.` });
        continue;
      }

      const outstandingBalance = await getFolioBalance(reservation.id);
      if (outstandingBalance > 0.009) {
        results.push({ reservationId: reservation.id, status: 'skipped', reason: `Outstanding balance ${outstandingBalance.toFixed(2)} must be settled first.` });
        continue;
      }

      try {
        const result = await sm.attemptCheckout(reservation.id, { userId: req.user.id });
        if (result.blocked) {
          results.push({ reservationId: reservation.id, status: 'skipped', reason: result.message || 'Checkout blocked.' });
          continue;
        }
        checkedOut += 1;
        results.push({ reservationId: reservation.id, status: 'success' });
      } catch (error) {
        results.push({ reservationId: reservation.id, status: 'skipped', reason: error.message || 'Checkout failed' });
      }
    }

    await refreshGroupStatus(group.id);
    res.json({ checkedOut, skipped: results.filter((entry) => entry.status === 'skipped').length, results });
  } catch (error) {
    console.error('Group checkout failed:', error);
    res.status(500).json({ error: 'Failed to process group checkout' });
  }
});

router.put('/:id', authenticateToken, requirePermission('group_reservation.edit'), async (req, res) => {
  try {
    const group = await prisma.groupReservation.update({
      where: { id: Number(req.params.id) },
      data: {
        groupName: req.body.groupName || undefined,
        notes: req.body.notes ?? undefined,
        travelAgentId: req.body.travelAgentId ? Number(req.body.travelAgentId) : undefined,
        mealPlanId: req.body.mealPlanId ? Number(req.body.mealPlanId) : undefined,
        ratePlanId: req.body.ratePlanId ? Number(req.body.ratePlanId) : undefined,
      },
      include: { reservations: true },
    });
    res.json(group);
  } catch (error) {
    console.error('Error updating group reservation:', error);
    res.status(500).json({ error: 'Failed to update group reservation' });
  }
});

router.post('/:id/reservations', authenticateToken, requirePermission('group_reservation.create'), async (req, res) => {
  const { guestId, roomId, roomTypeId, checkIn, checkOut, rate } = req.body;
  if (!guestId || (!roomId && !roomTypeId)) {
    return res.status(400).json({ error: 'guestId and roomId (or roomTypeId) are required.' });
  }

  try {
    const group = await prisma.groupReservation.findUnique({ where: { id: Number(req.params.id) } });
    if (!group) return res.status(404).json({ error: 'Group reservation not found' });

    const reservation = await prisma.reservation.create({
      data: {
        confoNo: `GRP-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
        guestId: Number(guestId),
        roomId: roomId ? Number(roomId) : null,
        groupReservationId: group.id,
        checkIn: checkIn ? new Date(checkIn) : group.checkInDate,
        checkOut: checkOut ? new Date(checkOut) : group.checkOutDate,
        status: 'guaranteed',
        rate: Number(rate || 0),
        bookingSource: 'direct',
        expectedCheckInAt: group.expectedCheckInAt || group.checkInDate,
        expectedCheckOutAt: group.expectedCheckOutAt || group.checkOutDate,
        createdBy: req.user.id,
      },
    });

    await refreshGroupStatus(group.id);
    res.status(201).json(reservation);
  } catch (error) {
    console.error('Error adding child reservation to group:', error);
    res.status(500).json({ error: 'Failed to add child reservation' });
  }
});

router.put('/:id/reservations/:reservationId', authenticateToken, requirePermission('group_reservation.edit'), async (req, res) => {
  try {
    const reservation = await prisma.reservation.update({
      where: { id: Number(req.params.reservationId) },
      data: {
        roomId: req.body.roomId ? Number(req.body.roomId) : undefined,
        status: req.body.status || undefined,
        rate: req.body.rate !== undefined ? Number(req.body.rate) : undefined,
      },
    });
    await refreshGroupStatus(Number(req.params.id));
    res.json(reservation);
  } catch (error) {
    console.error('Error updating child reservation:', error);
    res.status(500).json({ error: 'Failed to update child reservation' });
  }
});

router.delete('/:id/reservations/:reservationId', authenticateToken, requirePermission('group_reservation.edit'), async (req, res) => {
  try {
    await prisma.reservation.delete({ where: { id: Number(req.params.reservationId) } });
    await refreshGroupStatus(Number(req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting child reservation:', error);
    res.status(500).json({ error: 'Failed to delete child reservation' });
  }
});

module.exports = router;
