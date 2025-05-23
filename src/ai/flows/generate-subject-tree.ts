
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

  // First, try to remove markdown code fences if present
  let cleanedStr = str.replace(/```json\s*([\s\S]*?)\s*```/, '$1').trim();

  // Remove common conversational prefixes or echoed instructions
  const prefixesToRemove = [
    "Okay, here is the JSON object for the subject tree:",
    "Here is the JSON representation of the subject tree:",
    "Here's the JSON for the subject tree:",
    "Here's the JSON:",
    "Sure, here is the JSON output:",
    "The JSON output is:",
    "You want a JSON tree. Here it is:",
    "```json",
    "```" 
  ];
  prefixesToRemove.forEach(prefix => {
    // Case-insensitive prefix removal
    if (cleanedStr.toLowerCase().startsWith(prefix.toLowerCase())) {
      cleanedStr = cleanedStr.substring(prefix.length).trim();
    }
  });
   const suffixesToRemove = ["```"];
   suffixesToRemove.forEach(suffix => {
    if (cleanedStr.toLowerCase().endsWith(suffix.toLowerCase())) {
      cleanedStr = cleanedStr.substring(0, cleanedStr.length - suffix.length).trim();
    }
  });


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
    console.warn("No JSON object or array start found in string after cleaning. Original string (partial):", str.substring(0,200), "Cleaned string (partial):", cleanedStr.substring(0,200));
    return null; 
  }

  const jsonCandidate = cleanedStr.substring(startIndex);
  let openCount = 0;
  let endIndex = -1;
  const openChar = isObject ? '{' : '[';
  const closeChar = isObject ? '}' : ']';

  for (let i = 0; i < jsonCandidate.length; i++) {
    if (jsonCandidate[i] === openChar) {
      openCount++;
    } else if (jsonCandidate[i] === closeChar) {
      openCount--;
    }
    if (openCount === 0) {
      endIndex = i;
      break; 
    }
  }

  if (endIndex === -1) {
    console.warn("Incomplete JSON structure found after attempting to balance braces/brackets. Started with:", jsonCandidate.substring(0,200));
    return null; 
  }

  return jsonCandidate.substring(0, endIndex + 1);
}


export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  const apiKey = process.env.CEREBRAS_API_KEY;

  if (!apiKey || apiKey === "your_cerebras_key_here") {
    console.error('CEREBRAS_API_KEY is not set or is the default placeholder.');
    throw new Error('Cerebras API key is not configured. Please set CEREBRAS_API_KEY in your .env file.');
  }

  const cerebras = new Cerebras({ apiKey });

  const systemPrompt = `You are an expert in structuring fields of study into comprehensive JSON tree graphs.
Your SOLE task is to generate a VALID JSON string representing an extensive tree graph.
The root node's "name" MUST be the field of study: "${input.fieldOfStudy}".
Each node in the JSON MUST be an object with a "name" key (string value) and a "children" key (array of node objects).
If a node has no subtopics, its "children" array MUST be empty ([]).
The tree MUST be highly detailed, featuring multiple levels of hierarchy.
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field. Aim for significant depth and breadth.
Your entire response MUST be *only* the raw JSON text representing the tree object.
Do NOT include any other explanatory text, conversation, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) before or after the single, complete JSON object.
The JSON response MUST start with '{' and end with '}'.`;

  const userPrompt = `Generate the JSON subject tree for "${input.fieldOfStudy}".`;

  console.log("Sending request to Cerebras for field:", input.fieldOfStudy);

  try {
    const stream = await cerebras.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      model: 'qwen-3-32b', 
      stream: true,
      max_completion_tokens: 8192, 
      temperature: 0.4, 
      top_p: 0.95, 
    });

    let accumulatedContent = '';
    for await (const chunk of stream) {
      accumulatedContent += chunk.choices[0]?.delta?.content || '';
    }
    
    console.log("Raw accumulated response from Cerebras (truncated):", accumulatedContent.substring(0, 1000));
    
    const finalJsonString = extractJsonFromString(accumulatedContent);

    if (!finalJsonString) {
        console.error("Could not extract valid JSON from Cerebras response content. Raw accumulated content (partial):", accumulatedContent.substring(0, 500));
        throw new Error(`Failed to extract a valid JSON object from the AI's response. The content might be malformed, empty, or lack a clear JSON structure. Received (partial): ${accumulatedContent.substring(0,200)}`);
    }
    
    try {
        JSON.parse(finalJsonString); 
    } catch (e: any) {
        console.error("The extracted JSON string from Cerebras is invalid. Extracted (partial):", finalJsonString.substring(0,300), "Original error:", e.message);
        throw new Error(`The AI response, even after extraction, was not valid JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
    }
    
    console.log("Successfully extracted JSON string from Cerebras (truncated):", finalJsonString.substring(0, 500));
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
