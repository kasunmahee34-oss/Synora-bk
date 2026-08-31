// backend/src/utils/validation.js

const { PrismaClient } = require('@prisma/client');
const prisma = require('../prismaClient');

/**
 * Validates that the provided mealPlanId matches the mealPlan associated with the given ratePlanId.
 * Throws an Error with a descriptive message if validation fails.
 */
async function validateMealPlanCompatibility(ratePlanId, mealPlanId) {
  if (!ratePlanId) return; // No RatePlan to validate against
  const rp = await prisma.ratePlan.findUnique({
    where: { id: parseInt(ratePlanId) },
    include: { mealPlan: true },
  });
  if (!rp) {
    throw new Error('RatePlan not found');
  }
  const rpMealId = rp.mealPlan ? rp.mealPlan.id : null;
  if (rpMealId && mealPlanId && rpMealId !== parseInt(mealPlanId)) {
    throw new Error('Selected MealPlan does not match the RatePlan configuration');
  }
}

module.exports = { validateMealPlanCompatibility };
