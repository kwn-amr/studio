
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
      content: `You are an expert in structuring fields of study into comprehensive and detailed tree graphs.
Your SOLE task is to generate a JSON string representing an extensive tree graph of subjects.
The root node MUST be the field of study itself.
Sub-disciplines MUST be branches, and specific subjects, concepts, or theories MUST be leaves.
The tree MUST be highly detailed, featuring multiple levels of hierarchy.
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field. Aim for significant depth and breadth.
The JSON MUST be valid and parsable.
Each node in the JSON MUST have a "name" key (string) and a "children" key (array of nodes). If a node has no subtopics, its "children" array MUST be empty ([]).
Your response MUST contain ONLY the JSON object itself, starting with '{' and ending with '}'.
ABSOLUTELY NO other text, conversation, explanations, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) should be present in your output.
STRICTLY ADHERE to providing only the raw JSON.

Example of the required JSON tree structure:
{
  "name": "Physics",
  "children": [
    {
      "name": "Classical Mechanics",
      "children": [
        { "name": "Newtonian Mechanics", "children": [
            { "name": "Newton's Laws of Motion", "children": [] },
            { "name": "Work and Energy", "children": [] }
          ] 
        },
        { "name": "Lagrangian Mechanics", "children": [] },
        { "name": "Hamiltonian Mechanics", "children": [] }
      ]
    },
    {
      "name": "Quantum Mechanics",
      "children": [
        { "name": "Foundations of Quantum Mechanics", "children": [
            { "name": "Wave-particle duality", "children": [] },
            { "name": "Schrödinger Equation", "children": [] }
          ]
        },
        { "name": "Quantum Field Theory", "children": [
            { "name": "Quantum Electrodynamics (QED)", "children": [] }
          ] 
        },
        { "name": "String Theory", "children": [] }
      ]
    },
    {
      "name": "Thermodynamics and Statistical Mechanics",
      "children": []
    }
  ]
}`,
    },
    {
      role: 'user',
      content: `Generate a valid, highly detailed, and comprehensive JSON subject tree for the field of study: "${input.fieldOfStudy}". Your entire response must be only the JSON object as specified in the system prompt. Ensure significant depth and breadth, from foundational to advanced topics.`,
    },
  ];

  try {
    const stream = await cerebras.chat.completions.create({
      messages: messages,
      model: 'qwen-3-32b',
      stream: true,
      max_completion_tokens: 16382, // Maximize token limit for larger trees
      temperature: 0.5, // Slightly lower temperature for more focused, structured output
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

    const markdownJsonMatch = textToParse.match(/```json\s*([\s\S]*?)\s*```/s);
    if (markdownJsonMatch && markdownJsonMatch[1]) {
        textToParse = markdownJsonMatch[1].trim();
    }

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
        // This case is less likely for the root of our expected JSON, but included for completeness
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
            if (char === '"') { 
                inString = !inString;
            }

            if (!inString) {
                if (char === openChar) {
                    balance++;
                } else if (char === closeChar) {
                    balance--;
                }
            }

            if (balance === 0 && i >= startIndex) { 
                extractedJson = textToParse.substring(startIndex, i + 1);
                break; 
            }
        }
    }
    
    if (!extractedJson) {
        console.error("Could not extract a valid JSON structure. Original response (partial):", fullResponse.substring(0, 500) ,"Attempted extraction from (partial):", textToParse.substring(0,200));
        throw new Error(`Cerebras API response, after attempting extraction, does not appear to contain a parsable JSON object or array. Original response (partial for debugging): ${fullResponse.substring(0, 200)}`);
    }
    
    const finalJsonString = extractedJson;

    if (!(finalJsonString.startsWith('{') && finalJsonString.endsWith('}')) && !(finalJsonString.startsWith('[') && finalJsonString.endsWith(']'))) {
        console.error("Extracted JSON segment does not start/end with braces/brackets. Extracted (partial):", finalJsonString.substring(0,200));
        throw new Error(`Failed to properly extract JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}`);
    }

    // Basic validation of tree structure (root name and children array)
    try {
        const parsedForBasicValidation = JSON.parse(finalJsonString);
        if (typeof parsedForBasicValidation.name !== 'string' || !Array.isArray(parsedForBasicValidation.children)) {
            console.warn("Extracted JSON does not have the expected root structure (name: string, children: array). Parsed (partial):", finalJsonString.substring(0, 300));
            // Potentially throw, or let the page.tsx handle it if the user is okay with slightly malformed data sometimes.
            // For now, we'll pass it through and let the main parsing catch structural issues deeper in the tree.
        }
    } catch (e) {
        // This catch is if finalJsonString itself is not valid JSON, which shouldn't happen if extraction was perfect.
        // The main JSON.parse in page.tsx will be the primary validator for the full structure.
        console.error("The extracted JSON string is invalid. Extracted (partial):", finalJsonString.substring(0,300), e);
        throw new Error(`The AI response, even after extraction, was not valid JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}`);
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
    if (error instanceof Error && (error.message.startsWith("Cerebras API returned an empty response") || error.message.includes("does not appear to contain a parsable JSON") || error.message.startsWith("Failed to properly extract JSON") || error.message.includes("was not valid JSON") )) {
        throw error; // Re-throw our custom errors
    }
    throw new Error(`Cerebras API error: ${errorMessage}`);
  }
}
