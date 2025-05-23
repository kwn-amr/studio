
'use server';

/**
 * @fileOverview Generates a tree graph of subjects related to a field of study using Cerebras SDK.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */

import type { TreeNodeData } from '@/types';
import Cerebras from '@cerebras/cerebras_cloud_sdk';

export interface GenerateSubjectTreeInput {
  fieldOfStudy: string;
}

export interface GenerateSubjectTreeOutput {
  treeData: string; // JSON string
}

// Helper function to extract JSON from a string that might contain leading/trailing text
function extractJsonFromString(str: string): string | null {
  if (!str) return null;

  // Remove potential markdown fences and surrounding whitespace
  let cleanedStr = str.replace(/```json\s*([\s\S]*?)\s*```/, '$1').trim();
  
  // Try to find the start of a JSON object or array
  const firstBrace = cleanedStr.indexOf('{');
  const firstBracket = cleanedStr.indexOf('[');
  
  let startIndex = -1;
  let isObject = false;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    isObject = false;
  }

  if (startIndex === -1) {
    // No JSON structure found
    console.warn("No JSON object or array start found in string:", cleanedStr.substring(0,100));
    return null;
  }

  cleanedStr = cleanedStr.substring(startIndex);
  let openCount = 0;
  let endIndex = -1;
  const openChar = isObject ? '{' : '[';
  const closeChar = isObject ? '}' : ']';

  for (let i = 0; i < cleanedStr.length; i++) {
    if (cleanedStr[i] === openChar) {
      openCount++;
    } else if (cleanedStr[i] === closeChar) {
      openCount--;
    }
    if (openCount === 0) {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    // JSON structure is incomplete
    console.warn("Incomplete JSON structure found in string:", cleanedStr.substring(0,100));
    return null;
  }

  return cleanedStr.substring(0, endIndex + 1);
}


export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  const apiKey = process.env.CEREBRAS_API_KEY;

  if (!apiKey || apiKey === "your_cerebras_key_here") {
    console.error('CEREBRAS_API_KEY is not set or is the default placeholder.');
    throw new Error('Cerebras API key is not configured. Please set CEREBRAS_API_KEY in your .env file.');
  }

  const cerebras = new Cerebras({
    apiKey: apiKey
  });

  const systemPrompt = `You are an expert in structuring fields of study into comprehensive JSON tree graphs.
Your SOLE task is to generate a JSON string representing an extensive tree graph.
The root node MUST be the field of study itself.
Each node in the JSON MUST be an object with a "name" key (string value) and a "children" key (array of node objects).
If a node has no subtopics, its "children" array MUST be empty ([]).
The tree MUST be highly detailed, featuring multiple levels of hierarchy.
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field. Aim for significant depth and breadth.
Your entire response MUST be *only* the raw JSON text representing the tree object.
Do NOT include any other explanatory text, conversation, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) before or after the single, complete JSON object.`;

  const userPrompt = `Generate a valid, highly detailed, and comprehensive JSON subject tree for the field of study: "${input.fieldOfStudy}". Ensure your entire response is only the JSON object as specified.`;

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  let accumulatedContent = '';

  try {
    const stream = await cerebras.chat.completions.create({
      messages: messages,
      model: 'qwen-3-32b',
      stream: true,
      max_completion_tokens: 16382, 
      temperature: 0.5, 
      top_p: 0.95
    });

    for await (const chunk of stream) {
      accumulatedContent += chunk.choices[0]?.delta?.content || '';
    }

    if (!accumulatedContent.trim()) {
      console.error('Cerebras API returned an empty response.');
      throw new Error('Cerebras API returned an empty response.');
    }
    
    console.log("Raw accumulated content from Cerebras (truncated):", accumulatedContent.substring(0, 500));

    const finalJsonString = extractJsonFromString(accumulatedContent);

    if (!finalJsonString) {
      console.error("Could not extract valid JSON from Cerebras response. Raw content (partial):", accumulatedContent.substring(0, 500));
      throw new Error(`Failed to extract a valid JSON object from the AI's response. The response might be malformed or contain non-JSON text. Received (partial): ${accumulatedContent.substring(0,200)}`);
    }
    
    // Validate if the extracted string is indeed parsable JSON
    try {
        JSON.parse(finalJsonString);
    } catch (e: any) {
        console.error("The extracted JSON string is invalid. Extracted (partial):", finalJsonString.substring(0,300), e);
        throw new Error(`The AI response, even after extraction, was not valid JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}`);
    }

    console.log("Successfully extracted JSON string (truncated):", finalJsonString.substring(0, 500));
    return { treeData: finalJsonString };

  } catch (error: any) {
    console.error('Error calling Cerebras API or processing its response:', error);
    let errorMessage = `Cerebras API processing error: ${error.message || "An unknown error occurred."}`;
    if (error.response && error.response.data && error.response.data.message) {
      errorMessage = `Cerebras API Error: ${error.response.data.message}`;
    } else if (error.message && error.message.includes('API key')) {
      errorMessage = error.message; // Preserve specific API key error
    } else if (error.message && error.message.includes('empty response')) {
      errorMessage = error.message; 
    } else if (error.message && error.message.includes('Failed to extract')) {
      errorMessage = error.message;
    } else if (error.message && error.message.includes('was not valid JSON')) {
      errorMessage = error.message;
    }
    
    // Additional check for authentication issues based on typical API behavior
    if (error.isAxiosError && error.response && error.response.status === 401) {
        errorMessage = "Cerebras API authentication failed (401). Check your CEREBRAS_API_KEY.";
    }

    throw new Error(errorMessage);
  }
}
