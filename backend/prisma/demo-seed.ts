/**
 * Demo data: several clearly marked sample businesses across all seven
 * categories, with products, hours, FAQs, conversations, orders, status
 * history, reviews and conversation feedback.
 *
 * Everything is written to PostgreSQL - the app still reads only from the
 * database. Demo rows are identifiable by their `demo-` slugs, `demo-` auth
 * ids and `.invalid` email addresses.
 *
 * Usage
 *   npm run db:demo                       # create or refresh demo data
 *   npm run db:demo:reset                 # remove demo data, then recreate
 *   npm run db:demo -- --owner-email=you@example.com
 *                                         # also attach an existing DukaanSaathi
 *                                         # account as OWNER of the demo shops
 *
 * No passwords or real credentials are created here: Supabase Auth owns
 * passwords, and demo owner profiles intentionally have no Supabase account.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { DEMO_BUSINESSES, DEMO_CUSTOMERS, DEMO_PREFIX, DEMO_REVIEW_COMMENTS } from './demoData';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const shouldReset = args.includes('--reset');
const ownerEmailArg = args.find((arg) => arg.startsWith('--owner-email='));
const ownerEmail = ownerEmailArg?.split('=')[1] ?? process.env.DEMO_OWNER_EMAIL ?? '';

function demoEmail(key: string) {
  return `demo.${key}@dukaansaathi.invalid`;
}

async function removeDemoData() {
  const businesses = await prisma.business.findMany({
    where: { slug: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });
  const businessIds = businesses.map((business) => business.id);
  if (businessIds.length > 0) {
    await prisma.order.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.conversation.deleteMany({ where: { businessId: { in: businessIds } } });
    await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  }
  await prisma.userProfile.deleteMany({ where: { authUserId: { startsWith: DEMO_PREFIX } } });
  console.log(`Removed demo data (${businessIds.length} businesses).`);
}

async function upsertProfile(authUserId: string, data: { fullName: string; email: string; phone?: string; role: 'CUSTOMER' | 'BUSINESS_OWNER'; optIn?: boolean }) {
  return prisma.userProfile.upsert({
    where: { authUserId },
    update: { fullName: data.fullName, email: data.email, phone: data.phone ?? null, role: data.role },
    create: {
      authUserId,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone ?? null,
      role: data.role,
      emailNotificationsOptIn: data.optIn ?? false,
      signInProvider: 'demo-seed',
    },
  });
}

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  console.log('Loading DukaanSaathi demo data into PostgreSQL...');

  if (shouldReset) await removeDemoData();

  const customers = [];
  for (const customer of DEMO_CUSTOMERS) {
    customers.push(
      await upsertProfile(`${DEMO_PREFIX}customer-${customer.key}`, {
        fullName: customer.fullName,
        email: customer.email,
        phone: customer.phone,
        role: 'CUSTOMER',
        optIn: customer.emailNotificationsOptIn,
      }),
    );
  }

  let orderCounter = 0;
  let reviewCounter = 0;
  let conversationCounter = 0;

  for (const [index, demo] of DEMO_BUSINESSES.entries()) {
    const owner = await upsertProfile(`${DEMO_PREFIX}owner-${demo.key}`, {
      fullName: demo.ownerName,
      email: demoEmail(demo.key),
      phone: demo.publicPhone,
      role: 'BUSINESS_OWNER',
      optIn: true,
    });

    const searchText = [demo.name, demo.city, demo.addressLine, demo.category.replace(/_/g, ' ')]
      .join(' ')
      .toLowerCase();

    const business = await prisma.business.upsert({
      where: { slug: demo.slug },
      update: {
        name: demo.name,
        ownerId: owner.id,
        description: demo.description,
        publicPhone: demo.publicPhone,
        publicEmail: demoEmail(demo.key),
        addressLine: demo.addressLine,
        city: demo.city,
        state: demo.state,
        pincode: demo.pincode,
        latitude: 22.5726 + index * 0.01,
        longitude: 88.3639 + index * 0.01,
        deliveryEnabled: demo.deliveryEnabled,
        pickupEnabled: demo.pickupEnabled,
        deliveryNotes: demo.deliveryNotes,
        paymentMethods: demo.paymentMethods,
        returnPolicy: demo.returnPolicy,
        assistantNotes: demo.assistantNotes,
        emailNotificationsOptIn: true,
        emailNotificationsEmail: demoEmail(demo.key),
        searchText,
      },
      create: {
        ownerId: owner.id,
        name: demo.name,
        slug: demo.slug,
        category: demo.category,
        description: demo.description,
        publicPhone: demo.publicPhone,
        publicEmail: demoEmail(demo.key),
        addressLine: demo.addressLine,
        city: demo.city,
        state: demo.state,
        pincode: demo.pincode,
        latitude: 22.5726 + index * 0.01,
        longitude: 88.3639 + index * 0.01,
        deliveryEnabled: demo.deliveryEnabled,
        pickupEnabled: demo.pickupEnabled,
        deliveryNotes: demo.deliveryNotes,
        paymentMethods: demo.paymentMethods,
        returnPolicy: demo.returnPolicy,
        assistantNotes: demo.assistantNotes,
        emailNotificationsOptIn: true,
        emailNotificationsEmail: demoEmail(demo.key),
        searchText,
      },
    });

    await prisma.businessMember.upsert({
      where: { businessId_userId: { businessId: business.id, userId: owner.id } },
      update: { role: 'OWNER' },
      create: { businessId: business.id, userId: owner.id, role: 'OWNER' },
    });

    // hours
    await prisma.businessHour.deleteMany({ where: { businessId: business.id } });
    await prisma.businessHour.createMany({
      data: demo.hours.map((hour, dayOfWeek) => ({
        businessId: business.id,
        dayOfWeek,
        isClosed: hour.closed,
        openTime: hour.open,
        closeTime: hour.close,
      })),
    });

    // FAQs
    await prisma.businessFaq.deleteMany({ where: { businessId: business.id } });
    await prisma.businessFaq.createMany({
      data: demo.faqs.map((faq, sortOrder) => ({
        businessId: business.id,
        question: faq.question,
        answer: faq.answer,
        sortOrder,
      })),
    });

    // products
    const products = [];
    for (const product of demo.products) {
      const existing = await prisma.product.findFirst({
        where: { businessId: business.id, name: product.name },
      });
      const data = {
        price: new Prisma.Decimal(product.price),
        availability: product.availability,
        description: product.description,
        category: product.category,
        aliases: product.aliases,
        searchText: [product.name, product.category, product.aliases.join(' ')].join(' ').toLowerCase(),
      };
      products.push(
        existing
          ? await prisma.product.update({ where: { id: existing.id }, data: { ...data, isArchived: false } })
          : await prisma.product.create({ data: { businessId: business.id, name: product.name, ...data } }),
      );
    }

    // conversations (one resolved, one open) with a short transcript
    const transcript = [
      { role: 'CUSTOMER' as const, content: 'Do you have atta in stock today?' },
      {
        role: 'ASSISTANT' as const,
        content:
          'Namaskar! Yes, the items listed as Available in our catalogue are in stock today. I can only confirm what the shop has published - for anything else I would suggest calling the shop.',
      },
      { role: 'CUSTOMER' as const, content: 'What are your delivery charges?' },
      { role: 'ASSISTANT' as const, content: demo.deliveryNotes ?? 'The shop has not published delivery charges. Please contact them directly.' },
    ];

    for (const [position, customer] of customers.slice(0, 2).entries()) {
      const isOpen = position === 0;
      const conversation = await prisma.conversation.create({
        data: {
          businessId: business.id,
          userId: customer.id,
          status: isOpen ? 'OPEN' : 'RESOLVED',
          customerLocale: position === 0 ? 'en' : 'bn',
          lastMessageAt: new Date(Date.now() - position * 3600_000),
          messages: {
            create: transcript.map((message, messageIndex) => ({
              role: message.role,
              content: message.content,
              language: position === 0 ? 'en' : 'bn',
              source: messageIndex === 0 ? 'VOICE' : 'TEXT',
              createdAt: new Date(Date.now() - (4 - messageIndex) * 60_000 - position * 3600_000),
            })),
          },
        },
      });
      conversationCounter += 1;
      if (position === 1) {
        await prisma.conversationFeedback.create({
          data: { conversationId: conversation.id, rating: 5, comment: 'Quick reply, useful answer.' },
        });
      }
    }

    orderCounter = 0;
    reviewCounter = 0;

    // Re-running the seed must not collide with the unique constraint on
    // Order.orderCode. Demo orders are identifiable by their deterministic
    // prefix, so remove this business's previous demo orders first.
    await prisma.order.deleteMany({
      where: { businessId: business.id, orderCode: { startsWith: `DS-DEMO-${demo.key.toUpperCase()}-` } },
    });

    // orders: two completed with reviews, plus pending work for the dashboard
    const completedPlans: Array<{ customerIndex: number; lines: number[]; status: 'COMPLETED' }> = [
      { customerIndex: 0, lines: [0, 2], status: 'COMPLETED' },
      { customerIndex: 1, lines: [1], status: 'COMPLETED' },
    ];

    for (const plan of completedPlans) {
      const customer = customers[plan.customerIndex];
      const lines = plan.lines
        .map((productIndex) => products[productIndex])
        .filter((product): product is (typeof products)[number] => Boolean(product))
        .map((product) => ({
          productId: product.id,
          nameSnapshot: product.name,
          unitPriceSnapshot: new Prisma.Decimal(product.price),
          quantity: 1 + (orderCounter % 3),
          lineTotal: new Prisma.Decimal(product.price).mul(1 + (orderCounter % 3)),
        }));
      if (lines.length === 0) continue;
      const total = lines.reduce((acc, line) => acc.plus(line.lineTotal), new Prisma.Decimal(0));
      orderCounter += 1;

      const order = await prisma.order.create({
        data: {
          orderCode: `DS-DEMO-${demo.key.toUpperCase()}-${String(orderCounter).padStart(4, '0')}`,
          businessId: business.id,
          customerId: customer.id,
          fulfillment: demo.deliveryEnabled ? 'DELIVERY' : 'PICKUP',
          status: 'COMPLETED',
          customerName: customer.fullName,
          customerEmail: customer.email,
          customerPhone: customer.phone,
          deliveryAddress: demo.deliveryEnabled ? `${demo.addressLine}, ${demo.city}` : null,
          subtotal: total,
          total,
          createdAt: new Date(Date.now() - (3 + plan.customerIndex) * 86_400_000),
          items: { create: lines },
          statusEvents: {
            create: [
              { status: 'NEW', note: 'Order placed by the customer through DukaanSaathi.', createdAt: new Date(Date.now() - (3 + plan.customerIndex) * 86_400_000) },
              { status: 'ACCEPTED', note: 'Accepted by the shop.', createdAt: new Date(Date.now() - (3 + plan.customerIndex) * 86_400_000 + 3_600_000) },
              { status: 'COMPLETED', note: 'Handed over to the customer.', createdAt: new Date(Date.now() - (3 + plan.customerIndex) * 86_400_000 + 7_200_000) },
            ],
          },
        },
      });

      reviewCounter += 1;
      await prisma.orderReview.create({
        data: {
          orderId: order.id,
          businessId: business.id,
          customerId: customer.id,
          rating: reviewCounter % 5 === 0 ? 4 : 5,
          comment: DEMO_REVIEW_COMMENTS[(index + plan.customerIndex) % DEMO_REVIEW_COMMENTS.length],
          tags: index % 2 === 0 ? ['PRODUCT_QUALITY', 'COMMUNICATION'] : ['VALUE', 'DELIVERY_PICKUP'],
          createdAt: new Date(Date.now() - (2 + plan.customerIndex) * 86_400_000),
        },
      });
    }

    // pending order so the merchant dashboard has something in "Needs attention"
    const pendingCustomer = customers[index % customers.length];
    const pendingProduct = products[0];
    if (pendingProduct) {
      orderCounter += 1;
      const quantity = 2;
      const lineTotal = new Prisma.Decimal(pendingProduct.price).mul(quantity);
      await prisma.order.create({
        data: {
          orderCode: `DS-DEMO-${demo.key.toUpperCase()}-${String(orderCounter).padStart(4, '0')}`,
          businessId: business.id,
          customerId: pendingCustomer.id,
          fulfillment: demo.deliveryEnabled ? 'DELIVERY' : 'PICKUP',
          status: 'NEW',
          customerName: pendingCustomer.fullName,
          customerEmail: pendingCustomer.email,
          customerPhone: pendingCustomer.phone,
          deliveryAddress: demo.deliveryEnabled ? `${demo.addressLine}, ${demo.city}` : null,
          notes: 'Please keep the packet ready by evening.',
          subtotal: lineTotal,
          total: lineTotal,
          createdAt: new Date(Date.now() - 45 * 60_000),
          items: {
            create: [
              {
                productId: pendingProduct.id,
                nameSnapshot: pendingProduct.name,
                unitPriceSnapshot: new Prisma.Decimal(pendingProduct.price),
                quantity,
                lineTotal,
              },
            ],
          },
          statusEvents: { create: { status: 'NEW', note: 'Order placed by the customer through DukaanSaathi.' } },
        },
      });
    }

    // recent-business sync rows for signed-in demo customers
    for (const customer of customers) {
      await prisma.recentBusiness.upsert({
        where: { userId_businessId: { userId: customer.id, businessId: business.id } },
        update: { lastAccessedAt: new Date() },
        create: { userId: customer.id, businessId: business.id },
      });
    }

    console.log(`  ✓ ${demo.name} (${demo.category}) - ${products.length} products`);
  }

  if (ownerEmail) {
    const profile = await prisma.userProfile.findFirst({ where: { email: ownerEmail } });
    if (!profile) {
      console.warn(
        `\nCould not find a DukaanSaathi profile for ${ownerEmail}. Sign in once with that account, then re-run with --owner-email.`,
      );
    } else {
      const demos = await prisma.business.findMany({ where: { slug: { startsWith: DEMO_PREFIX } } });
      for (const business of demos) {
        await prisma.businessMember.upsert({
          where: { businessId_userId: { businessId: business.id, userId: profile.id } },
          update: { role: 'OWNER' },
          create: { businessId: business.id, userId: profile.id, role: 'OWNER' },
        });
      }
      console.log(`\nLinked ${ownerEmail} as OWNER of ${demos.length} demo businesses (no password is stored here).`);
    }
  }

  const summary = await prisma.business.count({ where: { slug: { startsWith: DEMO_PREFIX } } });
  console.log('');
  console.log(`Demo data ready: ${summary} businesses, ${DEMO_BUSINESSES.reduce((acc, b) => acc + b.products.length, 0)} products,`);
  console.log(`${orderCounter} orders, ${conversationCounter} conversations, ${reviewCounter} order reviews.`);
  console.log('Customer browsing and chat work immediately. Demo businesses are samples - not the app\'s data source.');
}

main()
  .catch((error) => {
    console.error('Demo seed failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
