import { prisma } from '@/infra/db/prisma';

let counter = 0;
export async function makeOwnerWithHostel() {
  counter += 1;
  const user = await prisma.user.create({
    data: { email: `owner${counter}-${Date.now()}@test.dev`, status: 'ACTIVE' },
  });
  const hostel = await prisma.hostel.create({
    data: {
      ownerId: user.id,
      slug: `test-hostel-${counter}-${Date.now()}`,
      name: 'Test Hostel',
      description: 'desc',
      addressLine1: '1 Test Rd',
      city: 'Goa',
      state: 'Goa',
      postalCode: '403001',
      latitude: 15.5,
      longitude: 73.8,
    },
  });
  return { user, hostel };
}
