const { seedRbac, prisma } = require('../src/services/rbac');

seedRbac()
  .then(() => console.log('RBAC seeded'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
