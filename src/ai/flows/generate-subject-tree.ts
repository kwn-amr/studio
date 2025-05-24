'use server';
/**
 * @fileOverview Generates a tree graph of subjects related to a field of study using Cerebras AI.
 * Includes descriptions for each node.
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
  treeData: string; // JSON string representing the hierarchical subject tree
  // Note: Cerebras SDK streaming doesn't easily provide token usage summary for the whole request.
  // If token usage is critical, alternative methods or API endpoints would be needed.
}

// Helper function to extract JSON from a string that might contain markdown or conversational fluff
function extractJsonFromString(text: string): string | null {
    if (!text || !text.trim()) {
        console.warn("extractJsonFromString called with empty or whitespace-only text.");
        return null;
    }

    let textToParse = text.trim();
    
    const markdownJsonMatch = textToParse.match(/```json\s*([\s\S]*?)\s*```/s);
    if (markdownJsonMatch && markdownJsonMatch[1]) {
        textToParse = markdownJsonMatch[1].trim();
    } else {
        const patternsToRemove = [
            /^<response>|<\/response>$/g,
            /^[\s\S]*?<think>[\s\S]*?<\/think>\s*/i,
            /^\s*Okay, here is the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*Sure, here is the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*Here's the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*The JSON(?: output| object| response) is[.:\s]*/i,
            /^\s*I have generated the JSON object as requested\s*[.:\s]*/i,
            /^\s*Your response MUST contain ONLY the JSON object itself.*$/gim,
            /^\s*The root node MUST be the field of study itself.*$/gim,
            /^\s*STRICTLY ADHERE to providing only the raw JSON.*$/gim,
            /^\s*ABSOLUTELY NO other text.*$/gim,
            /^\s*Example of the required JSON tree structure:.*$/gim,
            /^\s*```json\s*/, 
            /\s*```\s*$/,     
        ];
        
        for (const regex of patternsToRemove) {
            textToParse = textToParse.replace(regex, '').trim();
        }
    }
    
    if (!textToParse) {
        console.warn("After cleaning, the response string for JSON extraction is empty.");
        return null;
    }
    
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

    if (!openChar || !closeChar || startIndex === -1) {
        console.warn("Could not find a starting '{' or '[' for JSON extraction in cleaned text:", textToParse.substring(0,200));
        return null;
    }

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
            return textToParse.substring(startIndex, i + 1);
        }
    }
    
    console.warn("Could not find a balanced JSON structure in cleaned text:", textToParse.substring(0,200));
    return null;
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

  const systemPromptContent = `You are an expert in structuring fields of study into comprehensive and detailed tree graphs.
Your SOLE task is to generate a JSON string representing an extensive tree graph of subjects.
The root node MUST be the field of study itself, which is "${input.fieldOfStudy}".
Sub-disciplines MUST be branches, and specific subjects, concepts, or theories MUST be leaves.
The tree MUST be highly detailed and comprehensive, featuring multiple levels of hierarchy (aim for at least 3-5 levels deep where appropriate).
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field.
Each node in the JSON MUST be an object with three properties:
-   "name": A string representing the name of the subject, sub-discipline, or topic. All string values must be properly JSON escaped (e.g., quotes within strings must be escaped as \\").
-   "description": A string providing a brief, one-sentence description of this specific subject, sub-discipline, or topic. This description should be concise and informative.
-   "children": An array of child node objects. If a node has no sub-topics, its "children" array MUST be empty (e.g., []).
Node descriptions MUST be very concise (a single, short sentence) to ensure computational resources are prioritized for generating a deep and detailed tree structure.
Your entire response MUST be *only* the raw JSON text representing the tree object.
Do NOT include any other explanatory text, conversation, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) before or after the single, complete JSON object.
The final output MUST start with "{" and end with "}". No leading or trailing characters, including whitespace or newlines outside the main JSON structure.
DO NOT return a JSON array as the root element. It MUST be a JSON object.
DO NOT include any "..." or truncated content within node names, descriptions, or children arrays. All sub-trees should be fully represented.
Generate the JSON in a top-down manner.

Example of the required JSON tree structure:
{
  "name": "${input.fieldOfStudy}",
  "description": "A brief, one-sentence summary of ${input.fieldOfStudy}.",
  "children": [
    {
      "name": "First Level Sub-Discipline",
      "description": "A brief, one-sentence description of First Level Sub-Discipline.",
      "children": [
        {
          "name": "Second Level Topic A",
          "description": "A brief, one-sentence description of Second Level Topic A.",
          "children": []
        },
        {
          "name": "Second Level Topic B",
          "description": "A brief, one-sentence description of Second Level Topic B.",
          "children": [
            {
              "name": "Third Level Specific Concept",
              "description": "A brief, one-sentence description of Third Level Specific Concept.",
              "children": []
            }
          ]
        }
      ]
    },
    {
      "name": "Another First Level Sub-Discipline",
      "description": "A brief, one-sentence description of Another First Level Sub-Discipline.",
      "children": []
    }
  ]
}
Provide ONLY the JSON object.`;

  const messages: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: systemPromptContent,
    },
    {
      role: 'user',
      content: `Generate the JSON subject tree with descriptions for "${input.fieldOfStudy}", strictly adhering to the system prompt's instructions for structure, detail, and JSON-only output. Ensure significant depth, breadth, and include a concise one-sentence description for each node.`,
    },
  ];

  let rawResponseText = '';

  try {
    const stream = await cerebras.chat.completions.create({
      messages: messages,
      model: 'qwen-3-32b',
      stream: true,
      max_completion_tokens: 16382,
      temperature: 0.2, // Lowered temperature for more focused output
      top_p: 0.95,
    });

    for await (const chunk of stream) {
      rawResponseText += chunk.choices[0]?.delta?.content || '';
    }
    
    console.log("Raw Cerebras API response (truncated):", rawResponseText.substring(0, 500));

    if (!rawResponseText.trim()) {
        console.warn("Cerebras API returned an empty or whitespace-only response for input:", input.fieldOfStudy);
        throw new Error("Cerebras API returned an empty response. The model might not have been able to generate content for the given field of study.");
    }
    
    const finalJsonString = extractJsonFromString(rawResponseText);
    
    if (!finalJsonString) {
      console.error("After attempting to get content from Cerebras, no valid JSON string was derived. Original response (partial):", rawResponseText.substring(0, 500));
      throw new Error("The AI's response from Cerebras, after processing, did not yield a parsable JSON string.");
    }
    
    console.log("Attempting to parse final derived JSON from Cerebras (first 500 chars):", finalJsonString.substring(0,500));
    try {
        JSON.parse(finalJsonString); 
    } catch (e: any) {
        console.error("The final derived JSON string from Cerebras is invalid. Derived string (partial):", finalJsonString.substring(0,300), "Error:", e.message);
        throw new Error(`The AI response from Cerebras, after processing, was not valid JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
    }
    return { treeData: finalJsonString };

  } catch (error: any) {
    console.error('Error calling Cerebras API or processing its response:', error);
    const errorMessage = error?.error?.message || error?.message || "An unknown error occurred while communicating with Cerebras API.";
    if (error.status === 401) { // Cerebras SDK might not set status directly on error, this is a general check
         throw new Error("Cerebras API authentication failed (401). Check your CEREBRAS_API_KEY.");
    }
    if (error.status === 429) {
        throw new Error("Cerebras API rate limit exceeded (429). Please try again later.");
    }
    // Re-throw custom errors or specific API errors directly
    if (error instanceof Error && (
        error.message.startsWith("Cerebras API returned an empty response") || 
        error.message.includes("did not yield a parsable JSON string") ||
        error.message.includes("was not valid JSON")
        )) {
        throw error; 
    }
    throw new Error(`Cerebras API processing error: ${errorMessage}`);
  }
}
