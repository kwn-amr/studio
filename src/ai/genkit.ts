
import {genkit} from 'genkit';

// Initialize Genkit.
// Since the generateSubjectTreeFlow uses a direct fetch call to OpenRouter
// and does not rely on Genkit's built-in model providers for this specific flow,
// we can initialize Genkit with an empty plugins array to avoid errors related
// to missing API keys for plugins like googleAI.
// The ai.defineFlow() functionality itself does not require a model plugin
// if the flow's async callback handles the AI interaction directly.
export const ai = genkit({
  plugins: [],
  // You might want to enable tracing for debugging if needed in the future:
  // enableTracingAndMetrics: true,
});
