// Service category > Service type master data.
// Transcribed from the provided "Directory" sheet (service category images).

export interface CategorySeed {
  category: string;
  types: string[];
}

export const serviceCategories: CategorySeed[] = [
  {
    category: 'Food',
    types: [
      'Home baker',
      'Tiffin service',
      'Biryani specialist',
      'Food starters',
      'Meals on demand',
      'Home chefs',
      'Weekend chefs',
      'Dessert specialist',
      'Dry snacks specialist',
      'Other',
    ],
  },
  {
    category: 'Teacher',
    types: [
      'Tutor',
      'Art & Craft teacher',
      'Handwriting coach',
      'Music teacher',
      'Dance teacher',
      'Choreographer',
      'Other',
    ],
  },
  {
    category: 'Sports coach',
    types: [
      'Skating',
      'Badminton',
      'Swimming',
      'Table tennis',
      'Football',
      'Cricket',
      'Gymnastics',
      'Karate',
      'Taekwondo',
      'MMA',
      'Others',
    ],
  },
  {
    category: 'Beauticians',
    types: [
      'Make up artist',
      'Nail art specialist',
      'Hair stylist',
      'Tattoo artist',
      'Beauty service provider',
      'Mehendi artist',
      'Other',
    ],
  },
  {
    category: 'Party Organizer',
    types: ['Party organiser', 'Caterer', 'Birthday party planner', 'Wedding planner', 'Event planner'],
  },
  {
    category: 'Professional services',
    types: [
      'Doctor',
      'Lawyer',
      'Physiotherapist',
      'Dentist',
      'Homeopathic doctors',
      'Ayurvedic doctors',
      'Other',
    ],
  },
  {
    category: 'Home design services',
    types: ['Architects', 'Interior Designers', 'Other'],
  },
  {
    category: 'Investment advisors',
    types: ['CA', 'Agents', 'Real estate agent', 'Mutual fund agent', 'Insurance agent', 'Other'],
  },
  {
    category: 'Wellness coach',
    types: ['Healing experts', 'Counselors', 'Dieticians', 'Panchakarma specialist', 'Other'],
  },
  {
    category: 'Fashion Designers',
    types: [
      'Fashion designers',
      'Tailors',
      'Alteration experts',
      'Rental garment providers',
      'Boutique owners',
      'Jewellery designer',
      'Other',
    ],
  },
  {
    category: 'Website/ app development',
    types: ['Web/ app designer', 'UI / UX designer', 'Mobile app development', 'Other'],
  },
];
