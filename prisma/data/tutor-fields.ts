// Standard onboarding fields for the "Tutor" subcategory (Teacher category), matching the
// Figma "Tutor Flow" Basic Details / Travel / Payment screens.

export interface TutorFieldSeed {
  fieldName: string;
  fieldType: 'text' | 'number' | 'date' | 'dropdown' | 'boolean' | 'file' | 'image' | 'menu' | 'pincode';
  category: 'basic_details' | 'travel' | 'payment' | 'service_type' | 'delivery';
  fieldOptions?: string;
  sortOrder: number;
}

export const tutorStandardFields: TutorFieldSeed[] = [
  // Basic Details
  { fieldName: 'Your Name', fieldType: 'text', category: 'basic_details', sortOrder: 1 },
  { fieldName: 'Service Phone No.', fieldType: 'text', category: 'basic_details', sortOrder: 2 },
  { fieldName: 'Service Email', fieldType: 'text', category: 'basic_details', sortOrder: 3 },
  { fieldName: 'Years of experience', fieldType: 'number', category: 'basic_details', sortOrder: 4 },
  { fieldName: 'About yourself', fieldType: 'text', category: 'basic_details', sortOrder: 5 },
  { fieldName: 'Profession', fieldType: 'text', category: 'basic_details', sortOrder: 6 },
  { fieldName: 'Education', fieldType: 'text', category: 'basic_details', sortOrder: 7 },

  // Travel
  { fieldName: 'Class Schedule', fieldType: 'text', category: 'travel', sortOrder: 1 },
  { fieldName: 'Are you willing to Travel?', fieldType: 'dropdown', category: 'travel', fieldOptions: 'Yes, No', sortOrder: 2 },
  { fieldName: 'Maximum distance can you travel', fieldType: 'number', category: 'travel', sortOrder: 3 },
  { fieldName: 'Select the areas you can travel to', fieldType: 'pincode', category: 'travel', sortOrder: 4 },

  // Payment
  { fieldName: 'Payment Type', fieldType: 'dropdown', category: 'payment', fieldOptions: 'Per session, Monthly', sortOrder: 1 },
  { fieldName: 'Your Charges', fieldType: 'number', category: 'payment', sortOrder: 2 },
  { fieldName: 'Negotiable?', fieldType: 'dropdown', category: 'payment', fieldOptions: 'Yes, No', sortOrder: 3 },
  { fieldName: 'Do you expect recurring?', fieldType: 'dropdown', category: 'payment', fieldOptions: 'Yes, No', sortOrder: 4 },
];
