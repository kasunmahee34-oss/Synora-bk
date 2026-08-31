const bcrypt = require('bcryptjs');
const prisma = require('../src/prismaClient');

// Users to ensure exist
const defaultUsers = [
  { username: 'admin', role: 'admin', fullName: 'Administrator' },
  { username: 'front_office', role: 'front_office', fullName: 'Front Office' },
  { username: 'cashier', role: 'cashier', fullName: 'Cashier' },
];

const plainPassword = '123'; // password as requested

async function main() {
  const hashed = await bcrypt.hash(plainPassword, 10);
  for (const user of defaultUsers) {
    const existing = await prisma.user.findUnique({ where: { username: user.username } });
    if (existing) {
      console.log(`User ${user.username} already exists, skipping.`);
    } else {
      await prisma.user.create({
        data: {
          username: user.username,
          passwordHash: hashed,
          fullName: user.fullName,
          role: user.role,
          isActive: true,
        },
      });
      console.log(`Created user ${user.username} with role ${user.role}`);
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
