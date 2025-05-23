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
Your SOLE task is to generate a JSON string representing a tree graph of subjects.
The root node MUST be the field of study itself.
Sub-disciplines MUST be branches, and specific subjects MUST be leaves.
The JSON MUST be valid and parsable. Include multiple levels of hierarchy.
Each node in the JSON MUST have a "name" key (string) and a "children" key (array of nodes). If a node has no subtopics, its "children" array MUST be empty ([]).
Your response MUST contain ONLY the JSON object itself, starting with '{' and ending with '}'.
ABSOLUTELY NO other text, conversation, explanations, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) should be present in your output.
STRICTLY ADHERE to providing only the raw JSON.

Example of the required JSON tree structure:
{
  "name": "Computer Science",
  "children": [
    {
      "name": "Artificial Intelligence",
      "children": [
        {
          "name": "Machine Learning",
          "children": []
        },
        {
          "name": "Deep Learning",
          "children": []
        }
      ]
    },
    {
      "name": "Data Structures and Algorithms",
      "children": []
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `Generate a valid JSON subject tree for the field of study: "${input.fieldOfStudy}". Your entire response must be only the JSON object as specified in the system prompt.`,
    },
  ];

  try {
    const stream = await cerebras.chat.completions.create({
      messages: messages,
      model: 'qwen-3-32b',
      stream: true,
      max_completion_tokens: 16382,
      temperature: 0.7,
      top_p: 0.95,
    });

    let fullResponse = '';
    for await (const chunk of stream) {
      fullResponse += chunk.choices[0]?.delta?.content || '';
    }

    if (!fullResponse.trim()) {
        console.warn("Cerebras API returned an empty or whitespace-only response for input:", input.fieldOfStudy);
        throw new Error("Cerebras API returned an empty response. The model might not have been able to generate content for the given field of study.");
    }
    
    let jsonString = fullResponse.trim();

    // Attempt to extract JSON if it's embedded
    // Case 1: ```json ... ```
    const markdownJsonMatch = jsonString.match(/```json\s*([\s\S]*?)\s*```/);
    if (markdownJsonMatch && markdownJsonMatch[1]) {
        jsonString = markdownJsonMatch[1].trim();
    } else {
        // Case 2: Find first '{' and last '}' or first '[' and last ']'
        const firstBrace = jsonString.indexOf('{');
        const lastBrace = jsonString.lastIndexOf('}');
        const firstBracket = jsonString.indexOf('[');
        const lastBracket = jsonString.lastIndexOf(']');

        if (firstBrace !== -1 && lastBrace > firstBrace) {
            // Prefer object if both object and array-like structures are plausible from extraction
            jsonString = jsonString.substring(firstBrace, lastBrace + 1);
        } else if (firstBracket !== -1 && lastBracket > firstBracket) {
            jsonString = jsonString.substring(firstBracket, lastBracket + 1);
        }
        // If neither, jsonString remains fullResponse.trim()
    }
    
    // Basic validation that the (potentially extracted) string is likely JSON.
    if (!(jsonString.startsWith('{') && jsonString.endsWith('}')) && !(jsonString.startsWith('[') && jsonString.endsWith(']'))) {
        console.error("Cerebras API response, after attempting extraction, does not appear to be a valid JSON object or array. Original response (partial):", fullResponse.substring(0, 500) ,"Extracted (partial):", jsonString.substring(0,200));
        throw new Error(`Cerebras API response does not appear to be a valid JSON object or array. Original response (partial for debugging): ${fullResponse.substring(0, 200)}`);
    }

    return { treeData: jsonString };

  } catch (error: any) {
    console.error('Error calling Cerebras API:', error);
    const errorMessage = error?.error?.message || error?.message || "An unknown error occurred while communicating with Cerebras API.";
    if (error.status === 401) {
         throw new Error("Cerebras API authentication failed (401). Check your CEREBRAS_API_KEY.");
    }
    if (error.status === 429) {
        throw new Error("Cerebras API rate limit exceeded (429). Please try again later.");
    }
    // Re-throw other errors, potentially enriched, or use the already specific error message
    if (error instanceof Error && (error.message.startsWith("Cerebras API returned an empty response") || error.message.startsWith("Cerebras API response does not appear to be a valid JSON"))) {
        throw error; // Re-throw our custom errors
    }
    throw new Error(`Cerebras API error: ${errorMessage}`);
  }
}
