
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

// Helper function to extract JSON from a string that might contain markdown or conversational fluff
function extractJsonFromString(text: string): string | null {
    if (!text || !text.trim()) {
        console.warn("extractJsonFromString called with empty or whitespace-only text.");
        return null;
    }

    let textToParse = text.trim();

    // Attempt to extract content from markdown block first
    const markdownJsonMatch = textToParse.match(/```json\s*([\s\S]*?)\s*```/s);
    if (markdownJsonMatch && markdownJsonMatch[1]) {
        textToParse = markdownJsonMatch[1].trim();
    } else {
        // If no markdown block, aggressively remove common AI conversational fluff and echoed instructions.
        const patternsToRemove = [
            /^<response>|<\/response>$/g,
            /^[\s\S]*?<think>[\s\S]*?<\/think>\s*/i, 
            /^\s*Okay, here is the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*Sure, here is the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*Here's the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*The JSON(?: output| object| response) is[.:\s]*/i,
            /^\s*I have generated the JSON object as requested\s*[.:\s]*/i,
            // Remove specific echoed instructions if they appear as full lines
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
        // While we expect an object, allow for array if AI mistakenly returns it, primary parsing will validate structure
        openChar = '[';
        closeChar = ']';
        startIndex = firstBracket;
    }

    if (!openChar || !closeChar || startIndex === -1) {
        console.warn("Could not find a starting '{' or '[' for JSON extraction in cleaned text:", textToParse.substring(0,200));
        return null; // No JSON structure found
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
    return null; // Unbalanced JSON
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

  const systemPrompt = `You are an expert in structuring fields of study into comprehensive and detailed tree graphs.
Your SOLE task is to generate a JSON string representing an extensive tree graph of subjects.
Generate the JSON in a top-down, streamable fashion, starting with the root node.
The root node MUST be the field of study itself: "${input.fieldOfStudy}". Its "name" property must be exactly this value.
Sub-disciplines MUST be branches, and specific subjects, concepts, or theories MUST be leaves.
The tree MUST be highly detailed, featuring multiple levels of hierarchy.
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field. Aim for significant depth and breadth.
The JSON output MUST be valid and parsable. Each node in the JSON MUST have a "name" key (string) and a "children" key (array of nodes). If a node has no subtopics, its "children" array MUST be empty ([]).
Your entire response MUST be *only* the raw JSON text representing the tree object.
DO NOT include any other explanatory text, conversation, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) before or after the single, complete JSON object.
DO NOT return a JSON array as the root element. The root MUST be a JSON object.

Example of the required JSON tree structure for a field of study like "Physics":
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
        }
      ]
    },
    {
      "name": "Quantum Mechanics",
      "children": []
    }
  ]
}`;

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `Generate a valid, highly detailed, and comprehensive JSON subject tree for the field of study: "${input.fieldOfStudy}".
Your entire response must be only the JSON object as specified in the system prompt.
Ensure significant depth and breadth, from foundational to advanced topics.
The root node's "name" property must be exactly "${input.fieldOfStudy}".
Ensure all strings within the JSON are properly quoted and escaped.
Provide only the JSON object, starting with '{' and ending with '}'.`,
    },
  ];

  try {
    // The Cerebras SDK's stream: true option means the SDK handles receiving data in chunks from the API.
    // This function then accumulates these chunks to form the full response before processing.
    const stream = await cerebras.chat.completions.create({
      messages: messages,
      model: 'qwen-3-32b',
      stream: true,
      max_completion_tokens: 16382, 
      temperature: 0.2, // Lower temperature for more deterministic and syntactically correct output
      top_p: 0.95,
    });

    let fullResponse = '';
    console.log("Starting to process stream from Cerebras for:", input.fieldOfStudy);
    let chunkCount = 0;
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      fullResponse += content;
      chunkCount++;
    }
    console.log(`Finished processing ${chunkCount} chunks from Cerebras.`);
    console.log("Raw accumulated Cerebras response (first 500 chars):", fullResponse.substring(0, 500));
    
    const finalJsonString = extractJsonFromString(fullResponse);

    if (!finalJsonString) {
        console.error("After extraction, no valid JSON string was found. Original response (partial):", fullResponse.substring(0, 500));
        throw new Error("The AI's response, after attempting extraction, does not appear to contain a parsable JSON object or array.");
    }
    
    console.log("Attempting to parse final extracted JSON (first 500 chars):", finalJsonString.substring(0,500));

    // Basic validation of the extracted JSON string before returning.
    // The main JSON.parse in page.tsx will be the primary validator for the full structure.
    try {
        JSON.parse(finalJsonString); 
    } catch (e: any) {
        console.error("The extracted JSON string is invalid. Extracted (partial):", finalJsonString.substring(0,300), "Error:", e.message);
        throw new Error(`The AI response, even after extraction, was not valid JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
    }

    return { treeData: finalJsonString };

  } catch (error: any) {
    console.error('Error calling Cerebras API or processing its response:', error);
    let errorMessage = error?.error?.message || error?.message || "An unknown error occurred while communicating with Cerebras API.";
    if (error.status === 401) {
         errorMessage = "Cerebras API authentication failed (401). Check your CEREBRAS_API_KEY.";
    } else if (error.status === 429) {
        errorMessage = "Cerebras API rate limit exceeded (429). Please try again later.";
    } else if (error.message && (
        error.message.includes("Cerebras API key is not configured") ||
        error.message.includes("does not appear to contain a parsable JSON") ||
        error.message.includes("was not valid JSON")
    )) {
        errorMessage = error.message; // Use the more specific error message we threw
    }
    // Add more specific Cerebras error handling if their API returns structured errors
    throw new Error(errorMessage);
  }
}

