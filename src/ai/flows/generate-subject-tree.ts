
'use server';
/**
 * @fileOverview Generates a tree graph of subjects related to a field of study using Cerebras.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */
import Cerebras from '@cerebras/cerebras_cloud_sdk';

export interface GenerateSubjectTreeInput {
  fieldOfStudy: string;
}

export interface GenerateSubjectTreeOutput {
  treeData: string; // JSON string from the AI
}

// Helper function to extract JSON from a string that might contain leading/trailing text
function extractJsonFromString(str: string): string | null {
  if (!str) return null;

  let cleanedStr = str;
  // Remove markdown code fences if present
  const markdownMatch = str.match(/```json\s*([\s\S]*?)\s*```/);
  if (markdownMatch && markdownMatch[1]) {
    cleanedStr = markdownMatch[1].trim();
  } else {
     // Fallback for cases where markdown fences might be incomplete or slightly off
    cleanedStr = str.replace(/^```json\s*/, '').replace(/\s*```$/, '').trim();
  }


  // Remove common conversational prefixes or echoed instructions
  const prefixesToRemove = [
    "Okay, here is the JSON object for the subject tree:",
    "Here is the JSON representation of the subject tree:",
    "Here's the JSON for the subject tree:",
    "Here's the JSON:",
    "Sure, here is the JSON output:",
    "The JSON output is:",
    "You want a JSON tree. Here it is:",
    "The subject tree is as follows in JSON format:",
    "Certainly, here is the requested JSON structure:",
    "Response:",
    "Output:",
  ];
  // More aggressive prefix removal if initial attempts fail to parse
  for (const prefix of prefixesToRemove) {
    if (cleanedStr.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleanedStr = cleanedStr.substring(prefix.length).trim();
    }
  }
  // Attempt to remove any text before the first '{' or '['
   const firstMeaningfulChar = cleanedStr.search(/[\{\[]/);
   if (firstMeaningfulChar > 0) {
       cleanedStr = cleanedStr.substring(firstMeaningfulChar);
   }


  const firstBrace = cleanedStr.indexOf('{');
  const firstBracket = cleanedStr.indexOf('[');

  let startIndex = -1;
  let isObject = false;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) {
    startIndex = firstBracket;
    isObject = false; // It's an array, though we expect an object for the root
  }

  if (startIndex === -1) {
    console.warn("No JSON object or array start found in string after cleaning. Original string (partial):", str.substring(0,200), "Cleaned string (partial):", cleanedStr.substring(0,200));
    return null;
  }

  // If the string doesn't start at the determined startIndex, slice it.
  if (startIndex > 0) {
      cleanedStr = cleanedStr.substring(startIndex);
  }


  let openCount = 0;
  let endIndex = -1;
  const openChar = isObject ? '{' : '[';
  const closeChar = isObject ? '}' : ']';
  let inString = false;
  let escapeNext = false;

  for (let i = 0; i < cleanedStr.length; i++) {
    const char = cleanedStr[i];

    if (escapeNext) {
        escapeNext = false;
        continue;
    }
    if (char === '\\') {
        escapeNext = true;
        continue;
    }
    if (char === '"' && !escapeNext) {
        inString = !inString;
    }

    if (!inString) {
        if (char === openChar) {
            openCount++;
        } else if (char === closeChar) {
            openCount--;
        }
    }

    if (openCount === 0 && i >= startIndex) { // Ensure we've processed at least one char of the structure
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    console.warn("Incomplete JSON structure found after attempting to balance braces/brackets. Started with:", cleanedStr.substring(0,200));
    return null;
  }
  
  // Make sure we only return from the actual start of the JSON (first brace/bracket)
  return cleanedStr.substring(0, endIndex + 1);
}


export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  const apiKey = process.env.CEREBRAS_API_KEY;

  if (!apiKey || apiKey === "your_cerebras_key_here") {
    console.error('CEREBRAS_API_KEY is not set or is the default placeholder.');
    throw new Error('Cerebras API key is not configured. Please set CEREBRAS_API_KEY in your .env file.');
  }

  const cerebras = new Cerebras({ apiKey });

  const systemPrompt = `You are an AI assistant that generates ONLY valid JSON.
Your SOLE task is to produce a single, complete, and VALID JSON string representing a subject tree for the field: "${input.fieldOfStudy}".
The JSON structure MUST be an object with a "name" key (string value, which should be "${input.fieldOfStudy}") and a "children" key (array of node objects).
Each node object in the "children" array must also have a "name" (string) and "children" (array of node objects).
Leaf nodes (topics with no subtopics) MUST have an empty "children" array (i.e., "children": []).

CRITICAL JSON SYNTAX RULES:
1.  All string values (like for "name") MUST be enclosed in double quotes (e.g., "Physics").
2.  Keys ("name", "children") MUST be enclosed in double quotes.
3.  Objects are enclosed in curly braces {}. Arrays are in square brackets [].
4.  Elements in an array are separated by commas. Key-value pairs in an object are separated by commas.
5.  There should be NO trailing commas after the last element in an array or the last pair in an object.
6.  The JSON string values, especially for "name" fields, must be plain text.
7.  ABSOLUTELY NO conversational text, comments, apologies, self-corrections, diagnostic information, error messages, or markdown (like \`\`\`json) should be part of the JSON output, NEITHER before, after, NOR WITHIN the JSON structure.

EXAMPLE of expected VALID JSON structure:
{
  "name": "Example Field",
  "children": [
    {
      "name": "Sub-discipline 1",
      "children": [
        { "name": "Topic 1.1", "children": [] },
        { "name": "Topic 1.2", "children": [] }
      ]
    },
    { "name": "Sub-discipline 2", "children": [] }
  ]
}

The tree MUST be highly detailed and comprehensive, spanning from foundational concepts to specialized, advanced, or cutting-edge research topics.
Your entire response MUST be *only* the raw JSON text representing the tree object, starting with '{' and ending with '}'.`;

  const userPrompt = `Generate the detailed JSON subject tree for "${input.fieldOfStudy}". Ensure the entire output is only the valid JSON object.`;

  console.log("Sending request to Cerebras for field:", input.fieldOfStudy);
  console.log("System prompt (partial):", systemPrompt.substring(0, 300) + "...");


  try {
    const stream = await cerebras.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: 'qwen-3-32b',
      stream: true,
      max_completion_tokens: 16382,
      temperature: 0.2, // Lowered temperature for more deterministic output
      top_p: 0.9, // Can also slightly lower top_p if needed
    });

    let accumulatedContent = '';
    for await (const chunk of stream) {
      accumulatedContent += chunk.choices[0]?.delta?.content || '';
    }

    console.log("Raw accumulated response from Cerebras (first 1000 chars):", accumulatedContent.substring(0, 1000));
    console.log("Raw accumulated response from Cerebras (last 500 chars):", accumulatedContent.substring(Math.max(0, accumulatedContent.length - 500)));


    const finalJsonString = extractJsonFromString(accumulatedContent);

    if (!finalJsonString) {
        console.error("Could not extract valid JSON from Cerebras response content. Raw accumulated content (partial):", accumulatedContent.substring(0, 500));
        throw new Error(`Failed to extract a valid JSON object from the AI's response. The content might be malformed, empty, or lack a clear JSON structure. Received (partial): ${accumulatedContent.substring(0,200)}`);
    }

    try {
        JSON.parse(finalJsonString);
    } catch (e: any) {
        // Log the problematic string for debugging before throwing the more specific error
        console.error("The extracted JSON string from Cerebras is invalid. Extracted (first 300 chars):", finalJsonString.substring(0,300));
        console.error("Extracted (last 300 chars):", finalJsonString.substring(Math.max(0, finalJsonString.length - 300)));
        console.error("Original parsing error:", e.message);
        throw new Error(`The AI response, even after extraction, was not valid JSON. Error: ${e.message}. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}`);
    }

    console.log("Successfully extracted and validated JSON string from Cerebras (first 500 chars):", finalJsonString.substring(0, 500));
    return { treeData: finalJsonString };

  } catch (error: any) {
    console.error('Error calling Cerebras API or processing its response:', error);
    let errorMessage = `Cerebras API error: ${error.message || "An unknown error occurred."}`;
    if (error.status === 401) {
        errorMessage = "Cerebras API authentication failed (401). Check your CEREBRAS_API_KEY.";
    } else if (error.status === 429) {
        errorMessage = "Cerebras API rate limit exceeded (429). Please try again later.";
    } else if (error.message && (error.message.includes("Failed to extract") || error.message.includes("not valid JSON") || error.message.includes("API key is not configured"))) {
        errorMessage = error.message; // Use the more specific message from our checks
    }
    // Add more specific Cerebras error handling if their API returns structured errors
    throw new Error(errorMessage);
  }
}
