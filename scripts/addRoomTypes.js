const prisma = require('../src/prismaClient');

const roomTypes = [
  {
    typeName: 'Deluxe',
    code: 'DLX',
    description: 'Deluxe room with modern facilities',
    maxOccupancy: 3,
    numberOfAdults: 2,
    numberOfChildren: 1,
    baseRate: 36000,
    status: 'ACTIVE',
    bedType: 'King',
    numberOfBeds: 1,
    roomSize: '35sqm',
    amenities: { wifi: true, tv: true, minibar: true },
    imageUrl: null,
    displayOrder: 1,
  },
  {
    typeName: 'Standard',
    code: 'STD',
    description: 'Standard room',
    maxOccupancy: 2,
    numberOfAdults: 2,
    numberOfChildren: 0,
    baseRate: 20000,
    status: 'ACTIVE',
    bedType: 'Queen',
    numberOfBeds: 1,
    roomSize: '25sqm',
    amenities: { wifi: true, tv: true },
    imageUrl: null,
    displayOrder: 2,
  },
];

async function main() {
  const hashedPwd = ''; // not needed here
  for (const rt of roomTypes) {
    const existing = await prisma.roomType.findUnique({ where: { code: rt.code } }).catch(() => null);
    if (!existing) {
      await prisma.roomType.create({ data: rt });
      console.log(`Created room type ${rt.typeName}`);
    } else {
      console.log(`Room type ${rt.typeName} already exists`);
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
