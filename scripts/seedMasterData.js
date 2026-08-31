const prisma = require('../src/prismaClient');

async function main() {
  // Seed Floors
  const floors = [
    { floorNumber: 1, floorName: 'Ground Floor' },
    { floorNumber: 2, floorName: 'First Floor' },
    { floorNumber: 3, floorName: 'Second Floor' },
  ];
  for (const f of floors) {
    await prisma.floor.upsert({
      where: { uniq_floor_per_property: { propertyId: 1, floorNumber: f.floorNumber } },
      update: {},
      create: { ...f, propertyId: 1, isActive: true },
    });
    console.log(`Ensured floor ${f.floorName}`);
  }

  // Seed Travel Agents
  const travelAgents = [
    { agentName: 'TravelCo', email: 'info@travelco.com', phone: '1234567890', commissionRate: 5 },
    { agentName: 'HolidayTours', email: 'contact@holidaytours.com', phone: '0987654321', commissionRate: 7 },
  ];
  for (const ta of travelAgents) {
    const existing = await prisma.travelAgent.findFirst({ where: { agentName: ta.agentName } }).catch(() => null);
    if (!existing) {
      await prisma.travelAgent.create({ data: { ...ta, isActive: true } });
      console.log(`Created travel agent ${ta.agentName}`);
    } else {
      console.log(`Travel agent ${ta.agentName} already exists`);
    }
  }

  // Seed Meal Plans
  const mealPlans = [
    { code: 'BB', name: 'Bed & Breakfast', description: 'Breakfast only', breakfastIncluded: true, lunchIncluded: false, dinnerIncluded: false, drinksIncluded: false, snacksIncluded: false },
    { code: 'HB', name: 'Half Board', description: 'Breakfast and dinner', breakfastIncluded: true, lunchIncluded: false, dinnerIncluded: true, drinksIncluded: false, snacksIncluded: false },
    { code: 'FB', name: 'Full Board', description: 'All meals', breakfastIncluded: true, lunchIncluded: true, dinnerIncluded: true, drinksIncluded: false, snacksIncluded: false },
    { code: 'AI', name: 'All Inclusive', description: 'All meals, drinks, and snacks', breakfastIncluded: true, lunchIncluded: true, dinnerIncluded: true, drinksIncluded: true, snacksIncluded: true },
    { code: 'RO', name: 'Room Only', description: 'Room only, no meals', breakfastIncluded: false, lunchIncluded: false, dinnerIncluded: false, drinksIncluded: false, snacksIncluded: false },
  ];
  for (const mp of mealPlans) {
    await prisma.mealPlan.upsert({
      where: { code: mp.code },
      update: { ...mp, isActive: true },
      create: { ...mp, isActive: true },
    });
    console.log(`Upserted meal plan ${mp.name}`);
  }
  await prisma.mealPlan.deleteMany({
    where: { NOT: { code: { in: ['BB','HB','FB','AI','RO'] } } },
  });

  // Seed Rooms (requires a RoomType)
  const roomTypes = await prisma.roomType.findMany({});
  if (roomTypes.length === 0) {
console.log('No Room Types found – skipping room creation');
  } else {
    const defaultRoomTypeId = roomTypes[0].id;
    const rooms = [
      { roomNumber: '101', floorNumber: 1 },
      { roomNumber: '102', floorNumber: 1 },
      { roomNumber: '201', floorNumber: 2 },
    ];
    for (const r of rooms) {
      const existing = await prisma.room.findUnique({ where: { roomNumber: r.roomNumber } }).catch(() => null);
      if (!existing) {
        // Find floor ID
        const floor = await prisma.floor.findFirst({ where: { floorNumber: r.floorNumber } });
        if (!floor) {
          console.log(`Floor ${r.floorNumber} not found, cannot create room ${r.roomNumber}`);
          continue;
        }
        await prisma.room.create({
          data: {
            roomNumber: r.roomNumber,
            floorId: floor.id,
            roomTypeId: defaultRoomTypeId,
            status: 'available',
            propertyId: 1,
          },
        });
        console.log(`Created room ${r.roomNumber}`);
      } else {
        console.log(`Room ${r.roomNumber} already exists`);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
