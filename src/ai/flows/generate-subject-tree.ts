'use server';

/**
 * @fileOverview Generates a tree graph of subjects related to a field of study using Cerebras AI.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */

import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { ChatCompletionMessageParam } from '@cerebras/cerebras_cloud_sdk/resources/chat/completions';


export interface GenerateSubjectTreeInput {
  fieldOfStudy: string;
}

export interface GenerateSubjectTreeOutput {
  treeData: string; // JSON string
}

export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  const apiKey = process.env.CEREBRAS_API_KEY;

  if (!apiKey) {
    console.error('CEREBRAS_API_KEY is not set.');
    throw new Error('Cerebras API key is not configured. Please set CEREBRAS_API_KEY in your environment variables.');
  }

  const cerebras = new Cerebras({
    apiKey: apiKey,
  });

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `You are an expert in structuring fields of study into tree graphs.
You will generate a JSON string representing a tree graph of subjects.
The root node should be the field of study itself.
Sub-disciplines should be branches, and specific subjects should be leaves.
Ensure the JSON is valid and can be parsed without errors. Include multiple levels of hierarchy.
Each node in the JSON should have a "name" key representing the subject and a potentially empty "children" array representing its subtopics.
The output MUST be a valid JSON string. Do not include any other text, explanations, or markdown formatting before or after the JSON object.

Example of a valid JSON tree structure:
{
  "name": "Computer Science",
  "children": [
    {
      "name": "Artificial Intelligence",
      "children": [
        {
          "name": "Machine Learning"
        },
        {
          "name": "Deep Learning"
        }
      ]
    },
    {
      "name": "Data Structures and Algorithms"
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `Generate a subject tree for the field of study: "${input.fieldOfStudy}". Output only the JSON object.`,
    },
  ];

  try {
    const stream = await cerebras.chat.completions.create({
      messages: messages,
      model: 'qwen-3-32b', // As per user's reference
      stream: true,
      max_completion_tokens: 16382, // As per user's reference
      temperature: 0.7, // As per user's reference
      top_p: 0.95, // As per user's reference
    });

    let fullResponse = '';
    for await (const chunk of stream) {
      fullResponse += chunk.choices[0]?.delta?.content || '';
    }

    if (!fullResponse.trim()) {
        console.warn("Cerebras API returned an empty or whitespace-only response for input:", input.fieldOfStudy);
        throw new Error("Cerebras API returned an empty response. The model might not have been able to generate content for the given field of study.");
    }
    
    // Basic validation that it's likely JSON. More robust parsing happens in page.tsx
    // This helps catch non-JSON responses early.
    const trimmedResponse = fullResponse.trim();
    if (!(trimmedResponse.startsWith('{') && trimmedResponse.endsWith('}')) && !(trimmedResponse.startsWith('[') && trimmedResponse.endsWith(']'))) {
        console.error("Cerebras API did not return a JSON-like structure:", trimmedResponse.substring(0, 500));
        throw new Error(`Cerebras API response does not appear to be a valid JSON object or array. Response (partial): ${trimmedResponse.substring(0, 200)}`);
    }

    return { treeData: trimmedResponse };

  } catch (error: any) {
    console.error('Error calling Cerebras API:', error);
    // Attempt to provide a more specific error message if available
    const errorMessage = error?.error?.message || error?.message || "An unknown error occurred while communicating with Cerebras API.";
    if (error.status === 401) {
         throw new Error("Cerebras API authentication failed (401). Check your CEREBRAS_API_KEY.");
    }
    if (error.status === 429) {
        throw new Error("Cerebras API rate limit exceeded (429). Please try again later.");
    }
    throw new Error(`Cerebras API error: ${errorMessage}`);
  }
}
