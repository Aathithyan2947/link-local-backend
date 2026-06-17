import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/password.js';
import { serviceCategories } from './data/service-categories.js';
import {
  complexes,
  localityPincodes,
  localityCoords,
  DIRECTORY_DEFAULT_COORD,
  DIRECTORY_CITY,
  DIRECTORY_SUBURB,
  DIRECTORY_ROAD,
} from './data/directory.js';

const prisma = new PrismaClient();

/* eslint-disable no-console */

async function main() {
  console.log('🌱 Seeding Link Local...');

  // ── Admin ──────────────────────────────────────────────────
  await prisma.admin.upsert({
    where: { email: 'admin@linklocal.app' },
    update: {},
    create: {
      name: 'Super Admin',
      email: 'admin@linklocal.app',
      password: await hashPassword('admin123'),
      role: 'super_admin',
    },
  });

  // ── City ───────────────────────────────────────────────────
  let city = await prisma.city.findFirst({ where: { name: DIRECTORY_CITY.name } });
  if (!city) city = await prisma.city.create({ data: DIRECTORY_CITY });

  for (const [name, state] of [
    ['Bengaluru', 'Karnataka'],
    ['Pune', 'Maharashtra'],
    ['Delhi', 'Delhi'],
    ['Madurai', 'Tamil Nadu'],
  ] as const) {
    const exists = await prisma.city.findFirst({ where: { name } });
    if (!exists) await prisma.city.create({ data: { name, state } });
  }

  // ── Allowed document types ─────────────────────────────────
  for (const docType of ['utility_bill', 'rental_agreement', 'govt_id', 'bank_statement', 'other']) {
    const exists = await prisma.cityAllowedDocType.findFirst({ where: { cityId: city.id, docType } });
    if (!exists) await prisma.cityAllowedDocType.create({ data: { cityId: city.id, docType } });
  }

  // ── Service categories + subcategories (from sheet) ────────
  const subcatByName = new Map<string, number>();
  for (const { category: catName, types } of serviceCategories) {
    let category = await prisma.serviceCategory.findFirst({ where: { name: catName } });
    if (!category) category = await prisma.serviceCategory.create({ data: { name: catName } });
    for (const subName of types) {
      let sub = await prisma.serviceSubcategory.findFirst({
        where: { name: subName, categoryId: category.id },
      });
      if (!sub)
        sub = await prisma.serviceSubcategory.create({
          data: { name: subName, categoryId: category.id },
        });
      subcatByName.set(subName.toLowerCase(), sub.id);
    }
  }
  console.log(`   ✓ ${serviceCategories.length} service categories`);

  // ── Address directory (Thane / Ghodbunder Road) ────────────
  // Areas keyed by locality (Lane 2); complexes seeded as addresses.
  const localities = Array.from(new Set(complexes.map((c) => c.locality)));
  const areaByLocality = new Map<string, number>();
  for (const locality of localities) {
    let area = await prisma.area.findFirst({
      where: { cityId: city.id, areaName: locality, suburb: DIRECTORY_SUBURB },
    });
    if (!area) {
      area = await prisma.area.create({
        data: {
          cityId: city.id,
          areaName: locality,
          suburb: DIRECTORY_SUBURB,
          pincode: localityPincodes[locality] ?? '400615',
        },
      });
    }
    areaByLocality.set(locality, area.id);
  }
  console.log(`   ✓ ${localities.length} localities (areas)`);

  const directoryAddressCount = await prisma.address.count({
    where: { area: { suburb: DIRECTORY_SUBURB }, lane2: { not: null } },
  });
  if (directoryAddressCount === 0) {
    await prisma.address.createMany({
      data: complexes.map((c) => ({
        areaId: areaByLocality.get(c.locality)!,
        apartment: c.complex,
        lane1: c.lane1,
        lane2: c.locality,
        fullAddress: `${c.complex}, ${c.lane1}, ${c.locality}, ${DIRECTORY_ROAD}, ${DIRECTORY_SUBURB}, ${DIRECTORY_CITY.name} - ${localityPincodes[c.locality] ?? '400615'}`,
      })),
    });
    console.log(`   ✓ ${complexes.length} complexes (addresses)`);
  }

  // ── Address Master (curated suggestions, approved) ─────────
  // One approved master row per complex (building), carrying its lane/locality/pincode and
  // a locality-level lat/lng. The app autocompletes against the complex name and, on
  // selection, fills the building too. The 2 km GPS autofill uses the same rows but never
  // fills the building. User flat/plot numbers are never stored here.
  if ((await prisma.addressMaster.count()) === 0) {
    const seen = new Set<string>();
    const masterRows = [];
    for (const c of complexes) {
      const key = `${c.complex.toLowerCase()}|${c.lane1.toLowerCase()}|${c.locality.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const coord = localityCoords[c.locality] ?? DIRECTORY_DEFAULT_COORD;
      masterRows.push({
        cityId: city.id,
        complex: c.complex,
        lane1: c.lane1,
        lane2: c.locality,
        area: DIRECTORY_ROAD,
        suburb: DIRECTORY_SUBURB,
        pincode: localityPincodes[c.locality] ?? '400615',
        latitude: coord.lat,
        longitude: coord.lng,
        status: 'approved',
        source: 'import',
      });
    }
    await prisma.addressMaster.createMany({ data: masterRows });
    console.log(`   ✓ ${masterRows.length} address-master complexes`);
  }

  // ── Professions + Hobbies ──────────────────────────────────
  for (const c of ['Salaried', 'Business', 'Freelancer', 'Consultant', 'Student', 'Retired', 'Advisor', 'On-Contract']) {
    const exists = await prisma.professionMaster.findFirst({ where: { category: c } });
    if (!exists) await prisma.professionMaster.create({ data: { category: c } });
  }
  for (const h of ['Gardening', 'Cycling', 'Cooking', 'Reading', 'Photography', 'Yoga', 'Painting']) {
    await prisma.hobbiesMaster.upsert({ where: { name: h }, update: {}, create: { name: h } });
  }

  // ── Referral sources + tags ────────────────────────────────
  for (const [source, label] of [
    ['social_media', 'Social Media'],
    ['friends_family', 'Friends & Family'],
    ['print_media', 'Print Media'],
    ['neighbourhood_poster', 'Neighbourhood Poster'],
    ['other', 'Other'],
  ] as const) {
    const exists = await prisma.referralSource.findFirst({ where: { source } });
    if (!exists) await prisma.referralSource.create({ data: { source, label } });
  }
  for (const tag of ['Area Leader', 'Highest Contributor', 'Verified Resident']) {
    await prisma.profileTag.upsert({ where: { tagName: tag }, update: {}, create: { tagName: tag } });
  }

  // ── Demo users (Thane / Kasarvadavali) ─────────────────────
  const demoAreaId = areaByLocality.get('Kasarvadavali') ?? areaByLocality.values().next().value!;
  const password = await hashPassword('demo1234');
  let codeSeq = 1000;

  async function makeUser(opts: {
    name: string;
    userType: 'resident' | 'service_provider';
    email?: string;
    mobile?: string;
    aboutMe?: string;
  }) {
    const email = opts.email ?? `${opts.name.toLowerCase().replace(/\s+/g, '.')}@example.com`;
    const existing = await prisma.user.findUnique({ where: { email }, include: { profile: true } });
    if (existing) return existing;

    const address = await prisma.address.create({
      data: {
        areaId: demoAreaId,
        apartment: 'Sudarshan Sky Garden',
        lane1: 'Anand Nagar',
        lane2: 'Kasarvadavali',
        fullAddress: `Sudarshan Sky Garden, Anand Nagar, Kasarvadavali, ${DIRECTORY_ROAD}, ${DIRECTORY_SUBURB}, ${DIRECTORY_CITY.name} - 400615`,
      },
    });

    return prisma.user.create({
      data: {
        email,
        mobile: opts.mobile,
        passwordHash: password,
        authType: 'password',
        userType: opts.userType,
        isVerified: true,
        referralCode: `LL${codeSeq++}`,
        profile: { create: { name: opts.name, aboutMe: opts.aboutMe, addressId: address.id } },
        stats: { create: { referralPointsBalance: 150 } },
        cityMemberships: { create: { cityId: city!.id, isPrimary: true } },
      },
      include: { profile: true },
    });
  }

  const ayush = await makeUser({
    name: 'Ayush Singh',
    userType: 'resident',
    email: 'demo@linklocal.app',
    mobile: '+919800000001',
    aboutMe: 'Recently moved to Kasarvadavali. Love cycling and gardening.',
  });

  const residents = await Promise.all([
    makeUser({ name: 'Rahul Sharma', userType: 'resident', mobile: '+919800000002' }),
    makeUser({ name: 'Meera Yadav', userType: 'resident', mobile: '+919800000003' }),
    makeUser({ name: 'Ritu Singh', userType: 'resident', mobile: '+919800000004' }),
    makeUser({ name: 'Nisha Gupta', userType: 'resident', mobile: '+919800000005' }),
    makeUser({ name: 'Vihaan Mehta', userType: 'resident', mobile: '+919800000006' }),
  ]);

  // Service providers mapped to real subcategories.
  const spDefs = [
    { name: 'Pooja Nair', service: 'Home baker', tagline: 'Home Baker' },
    { name: 'Karan Malhotra', service: 'Tutor', tagline: 'Maths & Science Tutor' },
    { name: 'Anjali Verma', service: 'Make up artist', tagline: 'Makeup Artist' },
    { name: 'Sunita Rao', service: 'Swimming', tagline: 'Swimming Coach' },
  ];
  for (const def of spDefs) {
    const sp = await makeUser({ name: def.name, userType: 'service_provider', aboutMe: def.tagline });
    const subId = subcatByName.get(def.service.toLowerCase());
    if (sp.profile && subId) {
      const has = await prisma.profileServiceType.findFirst({
        where: { profileId: sp.profile.id, subcategoryId: subId },
      });
      if (!has)
        await prisma.profileServiceType.create({
          data: { profileId: sp.profile.id, subcategoryId: subId, serviceNature: 'recurring', frequency: 'weekly' },
        });
    }
  }

  // ── Posts (community discussions) ──────────────────────────
  if ((await prisma.post.count()) === 0) {
    await prisma.post.createMany({
      data: [
        { userId: residents[0].id, postType: 'ask_help', textContent: 'Just Moved in, need help with "Cleaning"' },
        { userId: residents[1].id, postType: 'ask_help', textContent: 'Looking for a Home Tutor for my 8th grader' },
        { userId: residents[2].id, postType: 'ask_help', textContent: 'Looking for a Swimming coach (morning batch)' },
        { userId: ayush.id, postType: 'offer_help', textContent: 'Happy to help neighbours with cycle repairs on weekends.' },
      ],
    });
  }

  // ── Interest groups ────────────────────────────────────────
  if ((await prisma.interestGroup.count()) === 0) {
    const groups = ['Ghodbunder Runners', 'Gardening Club', 'Cycling Group', 'Book Readers', 'Morning Walkers'];
    for (let i = 0; i < groups.length; i++) {
      const g = await prisma.interestGroup.create({
        data: {
          creatorId: residents[i % residents.length].id,
          title: groups[i],
          description: `${groups[i]} — Thane (Ghodbunder Road)`,
        },
      });
      await prisma.interestGroupMember.create({ data: { groupId: g.id, userId: ayush.id, status: 'joined' } });
    }
  }

  // ── Events / workshops ─────────────────────────────────────
  if ((await prisma.event.count()) === 0) {
    await prisma.event.create({
      data: {
        creatorId: residents[3].id,
        title: 'Kids Drawing Workshop',
        description: 'A fun drawing workshop for kids aged 5-12.',
        date: new Date('2026-06-20'),
        mode: 'offline',
        location: 'Community Hall, Kasarvadavali',
        isPaid: false,
      },
    });
    await prisma.event.create({
      data: {
        creatorId: residents[4].id,
        title: 'Morning Yoga Session',
        description: 'Start your day with energising yoga.',
        date: new Date('2026-06-21'),
        startTime: new Date('1970-01-01T07:00:00Z'),
        durationMinutes: 60,
        mode: 'offline',
        location: 'Hiranandani Estate Park',
        isPaid: false,
      },
    });
  }

  console.log('✅ Seed complete.');
  console.log('   Admin:    admin@linklocal.app / admin123');
  console.log('   Resident: demo@linklocal.app  / demo1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
