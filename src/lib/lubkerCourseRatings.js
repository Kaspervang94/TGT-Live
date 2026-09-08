// Official DGU course-rating data supplied for the 2026 TGT final at Lubker.
// Use together with a player's Handicap Index to calculate SPHC:
// Math.round(handicapIndex * (slopeRating / 113) + (courseRating - par))

export const LUBKER_COURSE_RATINGS = {
  "Sand/Forest": {
    par: 72,
    tees: {
      Gold: {
        female: { courseRating: 81.6, slopeRating: 150 },
        male: { courseRating: 75.1, slopeRating: 138 },
      },
      Sort: {
        female: { courseRating: 79.7, slopeRating: 145 },
        male: { courseRating: 73.5, slopeRating: 134 },
      },
      White: {
        female: { courseRating: 77.6, slopeRating: 141 },
        male: { courseRating: 71.8, slopeRating: 131 },
      },
      Yellow: {
        female: { courseRating: 74.9, slopeRating: 136 },
        male: { courseRating: 69.6, slopeRating: 127 },
      },
      Red: {
        female: { courseRating: 72.1, slopeRating: 130 },
        male: { courseRating: 66.9, slopeRating: 125 },
      },
    },
  },
  "Sand/Sky": {
    par: 72,
    tees: {
      Gold: {
        female: { courseRating: 83.5, slopeRating: 154 },
        male: { courseRating: 76.3, slopeRating: 147 },
      },
      Sort: {
        female: { courseRating: 81.3, slopeRating: 149 },
        male: { courseRating: 74.5, slopeRating: 142 },
      },
      White: {
        female: { courseRating: 79.3, slopeRating: 145 },
        male: { courseRating: 72.8, slopeRating: 139 },
      },
      Yellow: {
        female: { courseRating: 77.1, slopeRating: 140 },
        male: { courseRating: 71.1, slopeRating: 136 },
      },
      Red: {
        female: { courseRating: 73.6, slopeRating: 133 },
        male: { courseRating: 68.0, slopeRating: 132 },
      },
    },
  },
};

export function getLubkerCourseRating({ course, tee, category }) {
  const courseData = LUBKER_COURSE_RATINGS[course];
  if (!courseData) throw new Error(`Ukendt Lubker-bane: ${course}`);

  const teeData = courseData.tees[tee];
  if (!teeData) throw new Error(`Ukendt tee: ${tee}`);

  const rating = teeData[category];
  if (!rating) throw new Error(`Ukendt kategori: ${category}`);

  return { par: courseData.par, ...rating };
}

export function calculateLubkerSPHC({ handicapIndex, course, tee, category }) {
  const hcp = Number(handicapIndex);
  if (!Number.isFinite(hcp)) return null;

  const { par, courseRating, slopeRating } = getLubkerCourseRating({
    course,
    tee,
    category,
  });

  return Math.round(hcp * (slopeRating / 113) + (courseRating - par));
}
