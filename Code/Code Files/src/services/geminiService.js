const { GoogleGenAI } = require('@google/genai');

// Initialize the Gemini client using the environment variable
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || 'gemini-3.8-flash';
const MAX_RETRIES = 2;

const isRetryableError = (error) => {
  const status = Number(error.status || error.code);
  return (
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    error.status === 'UNAVAILABLE' ||
    error.message?.includes('high demand')
  );
};

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const generateContent = async (model, contents) => {
  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      return await ai.models.generateContent({ model, contents });
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === MAX_RETRIES) {
        throw error;
      }

      await wait(500 * 2 ** attempt);
    }
  }

  throw lastError;
};

const generateWithFallback = async (contents) => {
  try {
    return await generateContent(PRIMARY_MODEL, contents);
  } catch (error) {
    if (FALLBACK_MODEL === PRIMARY_MODEL || !isRetryableError(error)) {
      throw error;
    }

    console.warn(`Gemini model ${PRIMARY_MODEL} unavailable; trying ${FALLBACK_MODEL}`);
    return generateContent(FALLBACK_MODEL, contents);
  }
};

const toGeminiError = (label, error) => {
  console.error(`${label}:`, error.message);
  const serviceError = new Error('Gemini AI is temporarily unavailable. Please try again shortly.');
  serviceError.statusCode = isRetryableError(error) ? 503 : Number(error.status || error.code) || 500;
  return serviceError;
};

const getLocalWorkoutRecommendation = (age, fitnessGoal, experience) =>
  `For your goal of ${fitnessGoal}, complete three full-body workouts each week. Start with 2-3 sets of 8-12 controlled repetitions for each movement and rest for 60-90 seconds between sets. As a ${experience} trainee, choose weights that leave 2-3 good repetitions in reserve, warm up for 5-10 minutes, and increase the weight gradually when all repetitions feel controlled.`;

const getLocalFitnessInsight = (totalWorkouts, averageDuration, totalCaloriesBurned) =>
  `You have completed ${totalWorkouts} workouts averaging ${averageDuration} minutes and ${totalCaloriesBurned} kcal burned. Keep your schedule consistent and increase either duration or intensity gradually, while allowing enough recovery between demanding sessions.`;

// Generates a personalized workout recommendation using Google Gemini
const generateWorkoutRecommendation = async (age, fitnessGoal, experience) => {
  try {
    const prompt = `Generate a personalized workout recommendation for a person with the following details:
- Age: ${age}
- Fitness Goal: ${fitnessGoal}
- Experience Level: ${experience}

Please keep the recommendation extremely direct, practical, and concise (within 2-3 paragraph). Do not include any greeting, markdown bold stars (*), bullet points, or introductory phrases. Speak directly and provide a clear step-by-step execution plan also.`;

    const response = await generateWithFallback(prompt);
    return response.text ? response.text.trim() : 'No recommendation could be generated.';
  } catch (error) {
    const serviceError = toGeminiError('Gemini Recommendation Error', error);
    if (serviceError.statusCode === 503) {
      return getLocalWorkoutRecommendation(age, fitnessGoal, experience);
    }
    throw serviceError;
  }
};

// Generates personalized fitness insights using Google Gemini
const generateFitnessInsights = async (totalWorkouts, averageDuration, totalCaloriesBurned) => {
  try {
    const prompt = `Analyze this user's fitness progress and generate a highly personalized, encouraging fitness insight:
- Total Workouts Logged: ${totalWorkouts}
- Average Workout Duration: ${averageDuration} minutes
- Total Calories Burned: ${totalCaloriesBurned} kcal

Please keep the insight extremely direct, actionable, and concise (within 2-3 sentences). Do not include any greeting, markdown bold stars (*), bullet points, or introductory phrases. Provide guidance on what to adjust or continue.`;

    const response = await generateWithFallback(prompt);

    return response.text ? response.text.trim() : 'No insight could be generated.';
  } catch (error) {
    const serviceError = toGeminiError('Gemini Insights Error', error);
    if (serviceError.statusCode === 503) {
      return getLocalFitnessInsight(totalWorkouts, averageDuration, totalCaloriesBurned);
    }
    throw serviceError;
  }
};

module.exports = {
  generateWorkoutRecommendation,
  generateFitnessInsights,
};
