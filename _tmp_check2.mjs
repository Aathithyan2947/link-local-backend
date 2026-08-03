import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const maha = await prisma.profile.findFirst({ where: { name: 'Maha' } });
const fields = await prisma.spProfileCustomField.findMany({
  where: { profileId: maha.id },
  include: { field: true },
});
for (const f of fields) {
  console.log(f.field.category, '|', f.field.fieldName, '=', JSON.stringify(f.fieldValue));
}
await prisma.$disconnect();
