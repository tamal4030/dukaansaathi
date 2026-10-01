/**
 * Clearly-marked sample data used by `npm run db:demo`.
 * These are database records, not fixtures the app reads at runtime: the API
 * always queries PostgreSQL. Demo emails use the reserved `.invalid` TLD and
 * demo auth ids are prefixed with `demo-` so they can never collide with a
 * real Supabase user.
 */

export const DEMO_PREFIX = 'demo-';

export interface DemoProduct {
  name: string;
  price: string;
  availability: 'AVAILABLE' | 'OUT_OF_STOCK' | 'UNKNOWN';
  category: string;
  description: string;
  aliases: string[];
}

export interface DemoBusiness {
  key: string;
  name: string;
  slug: string;
  category:
    | 'GROCERY_DAILY_ESSENTIALS'
    | 'FOOD_BEVERAGES'
    | 'FASHION_TEXTILES'
    | 'ELECTRONICS_APPLIANCES'
    | 'HEALTH_PERSONAL_CARE'
    | 'HOME_HARDWARE'
    | 'BOOKS_STATIONERY_GIFTS_OTHER';
  ownerName: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  publicPhone: string;
  description: string;
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deliveryNotes: string | null;
  paymentMethods: string[];
  returnPolicy: string;
  assistantNotes: string;
  hours: Array<{ open: string | null; close: string | null; closed: boolean }>;
  faqs: Array<{ question: string; answer: string }>;
  products: DemoProduct[];
}

const week = (open: string, close: string, closedSunday = false) =>
  Array.from({ length: 7 }, (_, day) => ({
    open: closedSunday && day === 0 ? null : open,
    close: closedSunday && day === 0 ? null : close,
    closed: closedSunday && day === 0,
  }));

export const DEMO_BUSINESSES: DemoBusiness[] = [
  {
    key: 'grocery',
    name: 'Sharma Kirana & General Store',
    slug: 'demo-sharma-kirana',
    category: 'GROCERY_DAILY_ESSENTIALS',
    ownerName: 'Rakesh Sharma',
    addressLine: '14 Bidhan Sarani, near Ganesh Talkies',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700006',
    publicPhone: '+91 98300 11223',
    description: 'Neighbourhood kirana shop for atta, rice, dal, oil and daily essentials.',
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryNotes: 'Free home delivery within 2 km for orders above Rs 300.',
    paymentMethods: ['Cash on delivery', 'UPI (shown as information only)'],
    returnPolicy: 'Sealed packets can be returned within 2 days with the bill. Loose grains are non-returnable.',
    assistantNotes: 'We restock atta and rice every Tuesday and Friday morning.',
    hours: week('07:00', '21:30', true),
    faqs: [
      { question: 'Do you deliver to nearby areas?', answer: 'Yes, free delivery within 2 km for orders above Rs 300. Beyond that we charge Rs 40.' },
      { question: 'Can I pay by UPI?', answer: 'Yes, UPI is accepted at the counter. DukaanSaathi does not process payments.' },
      { question: 'Do you sell loose rice?', answer: 'Yes, Miniket and Gobindobhog rice are sold loose by the kilogram.' },
    ],
    products: [
      { name: 'Aashirvaad Atta 5kg', price: '265.00', availability: 'AVAILABLE', category: 'Atta & rice', description: 'Whole wheat flour, 5 kg pack.', aliases: ['atta', 'aata', 'wheat flour', 'আটা'] },
      { name: 'Miniket Rice 5kg', price: '310.00', availability: 'AVAILABLE', category: 'Atta & rice', description: 'Everyday rice, 5 kg bag.', aliases: ['rice', 'chal', 'চাল'] },
      { name: 'Gobindobhog Rice 1kg', price: '95.00', availability: 'UNKNOWN', category: 'Atta & rice', description: 'Aromatic rice for special occasions.', aliases: ['gobindobhog', 'chal', 'গোবিন্দভোগ'] },
      { name: 'Toor Dal 1kg', price: '165.00', availability: 'AVAILABLE', category: 'Dal & pulses', description: 'Arhar dal, cleaned.', aliases: ['dal', 'arhar', 'ডাল'] },
      { name: 'Fortune Sunflower Oil 1L', price: '142.00', availability: 'AVAILABLE', category: 'Oil & ghee', description: 'Refined sunflower oil, 1 litre.', aliases: ['oil', 'tel', 'তেল'] },
      { name: 'Amul Taaza Milk 500ml', price: '28.00', availability: 'OUT_OF_STOCK', category: 'Dairy', description: 'Toned milk pouch.', aliases: ['milk', 'dudh', 'দুধ'] },
      { name: 'Tata Salt 1kg', price: '30.00', availability: 'AVAILABLE', category: 'Masala & salt', description: 'Iodised salt.', aliases: ['salt', 'nun', 'লবণ'] },
    ],
  },
  {
    key: 'food',
    name: 'Annapurna Tiffin Service',
    slug: 'demo-annapurna-tiffin',
    category: 'FOOD_BEVERAGES',
    ownerName: 'Sujata Banerjee',
    addressLine: '27A Lake Gardens, opposite the post office',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700045',
    publicPhone: '+91 98311 44556',
    description: 'Home-style Bengali tiffin and snacks, cooked fresh every morning.',
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryNotes: 'Lunch delivery between 12:30 pm and 1:30 pm within 3 km.',
    paymentMethods: ['Cash on delivery'],
    returnPolicy: 'Food items cannot be returned. Tell us at delivery if something is wrong and we will replace it.',
    assistantNotes: 'Monday to Saturday lunch menu changes daily. Sunday is only snacks.',
    hours: week('09:00', '20:00', true),
    faqs: [
      { question: 'What time is lunch delivered?', answer: 'Lunch is delivered between 12:30 pm and 1:30 pm.' },
      { question: 'Is there a monthly tiffin plan?', answer: 'Yes, a 26-day lunch plan is Rs 2,400. Ask at the counter to start a plan.' },
      { question: 'Is the food very spicy?', answer: 'We cook mild by default. Say "less chilli" in your order note and we will adjust.' },
    ],
    products: [
      { name: 'Veg Lunch Thali', price: '120.00', availability: 'AVAILABLE', category: 'Lunch', description: 'Rice, dal, two vegetables, one fry and chutney.', aliases: ['thali', 'lunch', 'khawa', 'খাবার'] },
      { name: 'Fish Curry Rice Box', price: '180.00', availability: 'AVAILABLE', category: 'Lunch', description: 'Rohu curry with steamed rice.', aliases: ['fish', 'machh', 'মাছ'] },
      { name: 'Chicken Curry Rice Box', price: '210.00', availability: 'AVAILABLE', category: 'Lunch', description: 'Home-style chicken curry with rice.', aliases: ['chicken', 'murgi', 'মুরগি'] },
      { name: 'Singara (4 pieces)', price: '40.00', availability: 'AVAILABLE', category: 'Snacks', description: 'Fresh potato samosa.', aliases: ['singara', 'samosa', 'shingara', 'সিঙাড়া'] },
      { name: 'Mishti Doi (200g)', price: '60.00', availability: 'UNKNOWN', category: 'Dessert', description: 'Sweetened yoghurt in earthen pot.', aliases: ['mishti doi', 'sweet curd', 'মিষ্টি দই'] },
      { name: 'Evening Snack Box', price: '90.00', availability: 'OUT_OF_STOCK', category: 'Snacks', description: 'Two snacks with tea.', aliases: ['snacks', 'tiffin', 'জলখাবার'] },
    ],
  },
  {
    key: 'fashion',
    name: 'Ritu Sarees & Textiles',
    slug: 'demo-ritu-sarees',
    category: 'FASHION_TEXTILES',
    ownerName: 'Ananya Ghosh',
    addressLine: '5 Gariahat Road, first floor',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700019',
    publicPhone: '+91 90070 33445',
    description: 'Handloom sarees, kurtis and dress material from Bengal and Bihar.',
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryNotes: 'Courier across India, Rs 80 for the first item.',
    paymentMethods: ['Cash on delivery', 'Card at the shop'],
    returnPolicy: 'Exchange within 7 days if the tag is intact. Stitched items cannot be exchanged.',
    assistantNotes: 'Blouse stitching takes 5 working days. Handloom stock changes every week.',
    hours: week('11:00', '20:30', false),
    faqs: [
      { question: 'Do you stitch blouses?', answer: 'Yes, stitching is Rs 450 and takes 5 working days.' },
      { question: 'Can I exchange a saree?', answer: 'Exchange is allowed within 7 days if the tag is intact.' },
      { question: 'Do you courier outside West Bengal?', answer: 'Yes, we courier across India. Charges start at Rs 80.' },
    ],
    products: [
      { name: 'Bengal Handloom Cotton Saree', price: '1450.00', availability: 'AVAILABLE', category: 'Sarees', description: 'Handwoven cotton saree with temple border.', aliases: ['saree', 'shari', 'শাড়ি'] },
      { name: 'Tant Saree (White & Red)', price: '2200.00', availability: 'AVAILABLE', category: 'Sarees', description: 'Traditional Bengali tant saree.', aliases: ['tant', 'lal shada saree', 'তাঁত'] },
      { name: 'Cotton Kurti (M/L/XL)', price: '850.00', availability: 'AVAILABLE', category: 'Kurtis', description: 'Daily wear cotton kurti.', aliases: ['kurti', 'kurta', 'কুর্তি'] },
      { name: 'Unstitched Salwar Suit Set', price: '1650.00', availability: 'UNKNOWN', category: 'Dress material', description: 'Three-piece unstitched set.', aliases: ['salwar', 'dress material', 'থান'] },
      { name: 'Jamdani Saree (Resham)', price: '4800.00', availability: 'OUT_OF_STOCK', category: 'Sarees', description: 'Resham jamdani, currently sold out.', aliases: ['jamdani', 'জামদানি'] },
    ],
  },
  {
    key: 'electronics',
    name: 'Bose Electronics & Repair',
    slug: 'demo-bose-electronics',
    category: 'ELECTRONICS_APPLIANCES',
    ownerName: 'Debabrata Bose',
    addressLine: '88 Chandni Chowk Street',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700012',
    publicPhone: '+91 94330 77889',
    description: 'Small appliances, electrical fittings and in-shop repair service.',
    deliveryEnabled: false,
    pickupEnabled: true,
    deliveryNotes: null,
    paymentMethods: ['Cash at the shop', 'UPI (shown as information only)'],
    returnPolicy: 'Manufacturer warranty applies. No returns after 7 days without the original bill.',
    assistantNotes: 'Repair jobs are accepted at the counter; typical turnaround is 3 to 5 days.',
    hours: week('10:30', '20:00', true),
    faqs: [
      { question: 'Do you repair table fans?', answer: 'Yes, we repair table fans, mixers and small appliances. Inspection charge is Rs 100.' },
      { question: 'Is there any warranty?', answer: 'Products carry the manufacturer warranty. Keep the bill for claims.' },
      { question: 'Do you offer home delivery?', answer: 'No, purchases are pickup only from the shop.' },
    ],
    products: [
      { name: 'Bajaj Mixer Grinder 500W', price: '2899.00', availability: 'AVAILABLE', category: 'Kitchen appliances', description: 'Three jar mixer grinder with 2 year warranty.', aliases: ['mixer', 'grinder', 'mixie', 'মিক্সার'] },
      { name: 'Havells Table Fan 400mm', price: '1990.00', availability: 'AVAILABLE', category: 'Fans', description: 'High speed table fan.', aliases: ['fan', 'table fan', 'ফ্যান'] },
      { name: 'Anchor 6A Switch (pack of 5)', price: '220.00', availability: 'AVAILABLE', category: 'Electrical', description: 'Modular switches.', aliases: ['switch', 'swich', 'সুইচ'] },
      { name: 'Philips LED Bulb 9W', price: '110.00', availability: 'AVAILABLE', category: 'Lighting', description: 'Cool daylight LED bulb.', aliases: ['bulb', 'led', 'বাল্ব'] },
      { name: 'Extension Board 4 Socket', price: '340.00', availability: 'UNKNOWN', category: 'Electrical', description: 'Spike guard with 4 sockets.', aliases: ['extension', 'spike guard'] },
      { name: 'Inverter Battery 150Ah', price: '12500.00', availability: 'OUT_OF_STOCK', category: 'Power backup', description: 'Tubular inverter battery.', aliases: ['battery', 'inverter', 'ব্যাটারি'] },
    ],
  },
  {
    key: 'health',
    name: 'Seva Pharmacy & Wellness',
    slug: 'demo-seva-pharmacy',
    category: 'HEALTH_PERSONAL_CARE',
    ownerName: 'Dr. Meera Nair',
    addressLine: '3 Park Circus Lane',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700017',
    publicPhone: '+91 90510 22110',
    description: 'Retail pharmacy and personal care store. A qualified pharmacist is available at the counter.',
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryNotes: 'Local delivery within 1.5 km. Prescription medicines need a valid prescription at delivery.',
    paymentMethods: ['Cash on delivery'],
    returnPolicy: 'Medicines cannot be returned once sold. Other products can be exchanged within 3 days.',
    assistantNotes:
      'Staff cannot give dosage or medical advice. Always ask customers to consult a qualified pharmacist or clinician.',
    hours: week('08:00', '22:00', false),
    faqs: [
      { question: 'Can I order prescription medicines?', answer: 'You can send a request, but a valid prescription must be shown at delivery. Our pharmacist will confirm.' },
      { question: 'Do you have a pharmacist available?', answer: 'Yes, a qualified pharmacist is at the counter from 10 am to 6 pm.' },
      { question: 'Can you advise on dosage?', answer: 'We cannot give dosage or medical advice. Please consult a qualified pharmacist or clinician.' },
    ],
    products: [
      { name: 'Dettol Antiseptic Liquid 550ml', price: '235.00', availability: 'AVAILABLE', category: 'First aid', description: 'Antiseptic disinfectant liquid.', aliases: ['dettol', 'antiseptic', 'ডেটল'] },
      { name: 'Dolo 650 Tablet (strip of 15)', price: '32.00', availability: 'AVAILABLE', category: 'Fever & pain', description: 'Paracetamol 650 mg. Consult a clinician before use.', aliases: ['dolo', 'paracetamol', 'fever tablet', 'জ্বরের ওষুধ'] },
      { name: 'ORS Powder (pack of 5)', price: '110.00', availability: 'AVAILABLE', category: 'Hydration', description: 'Oral rehydration salts.', aliases: ['ors', 'rehydration', 'ওরস্যালাইন'] },
      { name: 'Himalaya Face Wash 100ml', price: '185.00', availability: 'AVAILABLE', category: 'Personal care', description: 'Purifying neem face wash.', aliases: ['face wash', 'neem'] },
      { name: 'Digital Thermometer', price: '275.00', availability: 'UNKNOWN', category: 'Devices', description: 'Flexible tip digital thermometer.', aliases: ['thermometer', 'temperature machine', 'থার্মোমিটার'] },
      { name: 'Insulin Pen (requires prescription)', price: '0.00', availability: 'UNKNOWN', category: 'Prescription', description: 'Price depends on brand and availability. Bring your prescription.', aliases: ['insulin', 'pen', 'ইনসুলিন'] },
    ],
  },
  {
    key: 'hardware',
    name: 'Maa Tara Hardware & Paints',
    slug: 'demo-maa-tara-hardware',
    category: 'HOME_HARDWARE',
    ownerName: 'Sanjay Das',
    addressLine: '62 Rabindra Sarani, near the ghat',
    city: 'Howrah',
    state: 'West Bengal',
    pincode: '711101',
    publicPhone: '+91 98304 66001',
    description: 'Paints, pipes, tools and building hardware for homes and small contractors.',
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryNotes: 'Delivery within 6 km. Bulk paint orders are delivered within 2 days.',
    paymentMethods: ['Cash on delivery', 'Bank transfer at the shop'],
    returnPolicy: 'Unopened sealed items can be returned within 5 days with the bill.',
    assistantNotes: 'Paint tinting is done at the shop. Bring the shade card number.',
    hours: week('09:00', '19:30', true),
    faqs: [
      { question: 'Do you tint paint to a shade?', answer: 'Yes, tinting is done at the shop. Bring the shade number from the shade card.' },
      { question: 'Do you deliver bricks and cement?', answer: 'We deliver cement and pipes. We do not stock bricks.' },
      { question: 'Can I return unused paint?', answer: 'Unopened sealed buckets can be returned within 5 days with the bill.' },
    ],
    products: [
      { name: 'Asian Paints Apcolite 4L', price: '1450.00', availability: 'AVAILABLE', category: 'Paint', description: 'Premium emulsion, tintable.', aliases: ['paint', 'rong', 'রং'] },
      { name: 'Birla White Cement 5kg', price: '410.00', availability: 'AVAILABLE', category: 'Cement', description: 'White cement for finishing.', aliases: ['cement', 'simen', 'সিমেন্ট'] },
      { name: 'CPVC Pipe 1 inch (3m)', price: '290.00', availability: 'AVAILABLE', category: 'Plumbing', description: 'Hot and cold water pipe.', aliases: ['pipe', 'paip', 'পাইপ'] },
      { name: 'Tap Set (Brass)', price: '640.00', availability: 'UNKNOWN', category: 'Plumbing', description: 'Brass bib cock set.', aliases: ['tap', 'kol', 'কল'] },
      { name: 'Door Lock Set (Godrej)', price: '1150.00', availability: 'AVAILABLE', category: 'Hardware', description: 'Mortise lock set.', aliases: ['lock', 'tala', 'তালা'] },
      { name: 'Claw Hammer 500g', price: '295.00', availability: 'OUT_OF_STOCK', category: 'Tools', description: 'Steel claw hammer with wooden handle.', aliases: ['hammer', 'haturi', 'হাতুড়ি'] },
    ],
  },
  {
    key: 'books',
    name: 'Boi Ghor Books & Gifts',
    slug: 'demo-boi-ghor',
    category: 'BOOKS_STATIONERY_GIFTS_OTHER',
    ownerName: 'Priya Sen',
    addressLine: '9 College Street, near the tram depot',
    city: 'Kolkata',
    state: 'West Bengal',
    pincode: '700009',
    publicPhone: '+91 90720 88112',
    description: 'Bengali and English books, school stationery, greeting cards and gift items.',
    deliveryEnabled: true,
    pickupEnabled: true,
    deliveryNotes: 'Books are couriered across India. Free delivery in Kolkata for orders above Rs 500.',
    paymentMethods: ['Cash on delivery', 'Card at the shop'],
    returnPolicy: 'Books can be exchanged within 5 days if unused. Stationery and gifts cannot be returned.',
    assistantNotes: 'Special orders for out-of-print Bengali titles take 7 to 10 days.',
    hours: week('10:00', '21:00', false),
    faqs: [
      { question: 'Can you arrange an out-of-print Bengali book?', answer: 'Yes, special orders take 7 to 10 days. A 20 percent advance is needed for such orders.' },
      { question: 'Do you gift wrap?', answer: 'Yes, gift wrapping is free for purchases above Rs 300.' },
      { question: 'Do you sell school sets?', answer: 'Yes, class-wise school stationery sets are available from April to June.' },
    ],
    products: [
      { name: 'Classmate Notebook 200 pages', price: '65.00', availability: 'AVAILABLE', category: 'Stationery', description: 'Single line ruled notebook.', aliases: ['notebook', 'khata', 'খাতা'] },
      { name: 'Doms Pencil Pack of 10', price: '90.00', availability: 'AVAILABLE', category: 'Stationery', description: 'Graphite pencils with eraser tip.', aliases: ['pencil', 'pensil', 'পেন্সিল'] },
      { name: 'Ananda Patrika Annual Subscription', price: '1200.00', availability: 'AVAILABLE', category: 'Magazines', description: 'One year subscription, delivered by post.', aliases: ['ananda', 'patrika', 'আনন্দ'] },
      { name: 'Gitanjali (Bengali, Hardcover)', price: '250.00', availability: 'AVAILABLE', category: 'Books', description: 'Tagore\'s Gitanjali, Bengali hardcover edition.', aliases: ['gitanjali', 'rabindranath', 'গীতাঞ্জলি'] },
      { name: 'Gift Mug with Photo Print', price: '350.00', availability: 'UNKNOWN', category: 'Gifts', description: 'Custom photo mug, takes 2 days.', aliases: ['mug', 'gift', 'উপহার'] },
      { name: 'School Stationery Set (Class V)', price: '480.00', availability: 'OUT_OF_STOCK', category: 'Stationery', description: 'Seasonal set, returns in April.', aliases: ['school set', 'school stationery'] },
    ],
  },
];

export interface DemoCustomer {
  key: string;
  fullName: string;
  email: string;
  phone: string;
  emailNotificationsOptIn: boolean;
}

export const DEMO_CUSTOMERS: DemoCustomer[] = [
  { key: 'anita', fullName: 'Anita Roy', email: 'demo.anita@dukaansaathi.invalid', phone: '+91 98300 00011', emailNotificationsOptIn: true },
  { key: 'imran', fullName: 'Imran Sheikh', email: 'demo.imran@dukaansaathi.invalid', phone: '+91 98300 00022', emailNotificationsOptIn: false },
  { key: 'kavita', fullName: 'Kavita Das', email: 'demo.kavita@dukaansaathi.invalid', phone: '+91 98300 00033', emailNotificationsOptIn: true },
];

export const DEMO_REVIEW_COMMENTS = [
  'Fresh stock and the shop called me before delivering. Very helpful.',
  'Good quality, fair price. Delivery was a little late in the evening.',
  'Staff explained everything patiently in Bengali. Will order again.',
  'Packing was neat. One item was out of stock and they told me upfront.',
  'Reasonable prices and quick response to my question on the app.',
];
