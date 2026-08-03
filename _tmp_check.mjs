import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const maha = await prisma.profile.findFirst({ where: { name: 'Maha' }, include: { user: true } });
console.log('Maha profile id:', maha.id, 'userId:', maha.userId);
const fields = await prisma.spProfileCustomField.findMany({
  where: { profileId: maha.id },
  include: { field: true },
});
for (const f of fields) {
  console.log(f.field.category, '|', f.field.fieldName, '=', f.value);
}
await prisma.$disconnect();
