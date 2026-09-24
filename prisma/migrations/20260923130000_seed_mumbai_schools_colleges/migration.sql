-- Starter catalog so the Education picker isn't "Other (specify)" only.
-- Mumbai-area institutions (incl. Thane, which the Mumbai service area covers).
-- Skips any name already present, so admin-added rows are never duplicated.

INSERT INTO "school_master" ("name", "city", "is_active")
SELECT v.name, v.city, true
FROM (VALUES
  ('Cathedral & John Connon School', 'Mumbai'),
  ('Campion School', 'Mumbai'),
  ('Bombay Scottish School, Mahim', 'Mumbai'),
  ('Dhirubhai Ambani International School', 'Mumbai'),
  ('St. Mary''s School (ICSE), Mazagaon', 'Mumbai'),
  ('Don Bosco High School, Matunga', 'Mumbai'),
  ('Jamnabai Narsee School', 'Mumbai'),
  ('Podar International School', 'Mumbai'),
  ('Hiranandani Foundation School, Thane', 'Thane'),
  ('Sulochanadevi Singhania School, Thane', 'Thane')
) AS v(name, city)
WHERE NOT EXISTS (SELECT 1 FROM "school_master" s WHERE lower(s."name") = lower(v.name));

INSERT INTO "college_master" ("name", "city", "is_active")
SELECT v.name, v.city, true
FROM (VALUES
  ('Indian Institute of Technology Bombay (IIT Bombay)', 'Mumbai'),
  ('St. Xavier''s College', 'Mumbai'),
  ('Veermata Jijabai Technological Institute (VJTI)', 'Mumbai'),
  ('Institute of Chemical Technology (ICT)', 'Mumbai'),
  ('Sardar Patel Institute of Technology', 'Mumbai'),
  ('Jai Hind College', 'Mumbai'),
  ('H.R. College of Commerce and Economics', 'Mumbai'),
  ('Narsee Monjee College of Commerce and Economics', 'Mumbai'),
  ('Mithibai College', 'Mumbai'),
  ('K.G. Joshi & N.G. Bedekar College, Thane', 'Thane')
) AS v(name, city)
WHERE NOT EXISTS (SELECT 1 FROM "college_master" c WHERE lower(c."name") = lower(v.name));
