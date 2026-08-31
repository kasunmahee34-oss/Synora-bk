const prisma = require('./src/prismaClient');

async function main() {
  await prisma.$executeRawUnsafe(`
    ALTER TABLE payments ADD COLUMN payment_category ENUM('advance','full','balance','refund') NOT NULL DEFAULT 'balance'
  `);
  console.log('payment_category column added successfully');
}

main()
  .catch(e => {
    console.error('Error adding payment_category column:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect(); 
  });
