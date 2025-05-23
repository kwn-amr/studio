
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
    
    let textToParse = fullResponse.trim();

    // Attempt to extract JSON from ```json ... ``` block first
    // Use /s flag for dotall to handle newlines within the JSON block
    const markdownJsonMatch = textToParse.match(/```json\s*([\s\S]*?)\s*```/s);
    if (markdownJsonMatch && markdownJsonMatch[1]) {
        textToParse = markdownJsonMatch[1].trim();
    }
    // Now, `textToParse` is either the content of the markdown block or the original trimmed response.
    // We need to find the first actual JSON object/array within this string.

    let extractedJson: string | null = null;
    let openChar: '{' | '[' | undefined = undefined;
    let closeChar: '}' | ']' | undefined = undefined;
    let startIndex = -1;

    const firstBrace = textToParse.indexOf('{');
    const firstBracket = textToParse.indexOf('[');

    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
        openChar = '{';
        closeChar = '}';
        startIndex = firstBrace;
    } else if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
        openChar = '[';
        closeChar = ']';
        startIndex = firstBracket;
    }

    if (openChar && closeChar && startIndex !== -1) {
        let balance = 0;
        let inString = false;
        let escapeNext = false;
        
        for (let i = startIndex; i < textToParse.length; i++) {
            const char = textToParse[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }
            if (char === '\\') {
                escapeNext = true;
                continue;
            }
            // This simple string parsing handles quoted strings.
            // It doesn't account for all unicode escape nuances but is common.
            if (char === '"') { 
                inString = !inString;
            }

            if (!inString) { // Only count braces/brackets if not inside a string
                if (char === openChar) {
                    balance++;
                } else if (char === closeChar) {
                    balance--;
                }
            }

            if (balance === 0 && i >= startIndex) { 
                // We found a balanced structure from the startIndex.
                extractedJson = textToParse.substring(startIndex, i + 1);
                break; // Assume this is the complete JSON object/array
            }
        }
    }
    
    if (!extractedJson) {
        console.error("Could not extract a valid JSON structure. Original response (partial):", fullResponse.substring(0, 500) ,"Attempted extraction from (partial):", textToParse.substring(0,200));
        throw new Error(`Cerebras API response, after attempting extraction, does not appear to contain a parsable JSON object or array. Original response (partial for debugging): ${fullResponse.substring(0, 200)}`);
    }
    
    const finalJsonString = extractedJson;

    // Final validation on the extracted segment
    if (!(finalJsonString.startsWith('{') && finalJsonString.endsWith('}')) && !(finalJsonString.startsWith('[') && finalJsonString.endsWith(']'))) {
        console.error("Extracted JSON segment does not start/end with braces/brackets. Extracted (partial):", finalJsonString.substring(0,200));
        throw new Error(`Failed to properly extract JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}`);
    }

    return { treeData: finalJsonString };

  } catch (error: any) {
    console.error('Error calling Cerebras API:', error);
    const errorMessage = error?.error?.message || error?.message || "An unknown error occurred while communicating with Cerebras API.";
    if (error.status === 401) {
         throw new Error("Cerebras API authentication failed (401). Check your CEREBRAS_API_KEY.");
    }
    if (error.status === 429) {
        throw new Error("Cerebras API rate limit exceeded (429). Please try again later.");
    }
    if (error instanceof Error && (error.message.startsWith("Cerebras API returned an empty response") || error.message.includes("does not appear to contain a parsable JSON") || error.message.startsWith("Failed to properly extract JSON"))) {
        throw error; // Re-throw our custom errors
    }
    throw new Error(`Cerebras API error: ${errorMessage}`);
  }
}
