
import {genkit} from 'genkit';
import {googleAI} from '@genkit-ai/googleai';

// Initialize Genkit with the Google AI plugin.
// Even if a specific flow uses a direct fetch call (like for OpenRouter),
// the `ai` object needs to be initialized for `ai.defineFlow` and other Genkit functionalities.
export const ai = genkit({
  plugins: [googleAI()], // Using googleAI as a default plugin example
});
