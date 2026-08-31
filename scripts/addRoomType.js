const prisma = require('../src/prismaClient');

async function main() {
  // Adjust these values as needed
  const typeName = 'Standard Deluxe';
  const maxOccupancy = 2;
  const baseRate = 150.0;

  try {
    const existing = await prisma.roomType.findUnique({ where: { typeName } });
    if (existing) {
      console.log(`Room type '${typeName}' already exists with id ${existing.id}`);
      return;
    }
    const roomType = await prisma.roomType.create({
      data: {
        typeName,
        maxOccupancy,
        baseRate,
      },
    });
    console.log('Created room type:', roomType);
  } catch (e) {
    console.error('Error creating room type:', e);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
