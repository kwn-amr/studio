
'use server';
/**
 * @fileOverview Generates a tree graph of subjects related to a field of study using OpenRouter.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */

export interface GenerateSubjectTreeInput {
  fieldOfStudy: string;
}

export interface GenerateSubjectTreeOutput {
  treeData: string; // JSON string from the AI
}

// Define the JSON schema for the expected output structure
// This uses $defs for a proper recursive definition of the tree node.
const subjectTreeJsonSchema = {
  name: 'subject_tree_schema', // Name for the schema tool
  description: 'A hierarchical tree structure representing a field of study and its sub-topics. Each node has a name and an array of children nodes.',
  strict: true, // Enforce the schema strictly
  schema: {
    $defs: {
      node: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The name of the current subject, topic, or sub-topic.',
          },
          children: {
            type: 'array',
            description: 'An array of sub-topics or children nodes. Should be an empty array if there are no sub-topics.',
            items: {
              $ref: '#/$defs/node', // Recursive reference to the 'node' definition
            },
          },
        },
        required: ['name', 'children'],
        additionalProperties: false, // Disallow properties not defined in the schema
      },
    },
    // The root of the response should be a 'node' object
    $ref: '#/$defs/node',
  },
};

// Helper function to extract JSON from a string that might contain leading/trailing text
function extractJsonFromString(str: string): string | null {
  if (!str) return null;
  let cleanedStr = str.replace(/```json\s*([\s\S]*?)\s*```/, '$1').trim();
  const firstBrace = cleanedStr.indexOf('{');
  const firstBracket = cleanedStr.indexOf('['); // Though our schema expects an object
  let startIndex = -1;
  let isObject = false;

  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
    startIndex = firstBrace;
    isObject = true;
  } else if (firstBracket !== -1) { // Fallback, though less likely for this schema
    startIndex = firstBracket;
    isObject = false;
  }

  if (startIndex === -1) {
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
    console.warn("Incomplete JSON structure found in string:", cleanedStr.substring(0,100));
    return null;
  }
  return cleanedStr.substring(0, endIndex + 1);
}


export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";

  if (!apiKey || apiKey === "your_openrouter_key_here") {
    console.error('OPENROUTER_API_KEY is not set or is the default placeholder.');
    throw new Error('OpenRouter API key is not configured. Please set OPENROUTER_API_KEY in your .env file.');
  }

  const systemPrompt = `You are an expert in structuring fields of study into comprehensive JSON tree graphs.
Your SOLE task is to generate a JSON string representing an extensive tree graph that strictly adheres to the provided JSON schema.
The root node's "name" MUST be the field of study: "${input.fieldOfStudy}".
Each node in the JSON MUST be an object with a "name" key (string value) and a "children" key (array of node objects).
If a node has no subtopics, its "children" array MUST be empty ([]).
The tree MUST be highly detailed, featuring multiple levels of hierarchy.
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field. Aim for significant depth and breadth.
Your entire response MUST be *only* the raw JSON text representing the tree object, conforming to the schema.
Do NOT include any other explanatory text, conversation, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) before or after the single, complete JSON object.`;

  // User prompt can be simpler as the system prompt and schema define the task.
  const userPrompt = `Generate the JSON subject tree for "${input.fieldOfStudy}" according to the schema.`;

  const requestPayload = {
    model: "meta-llama/llama-3.3-70b-instruct", // Model specified by user
    // No provider field - let OpenRouter select one.
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: {
      type: "json_schema",
      json_schema: subjectTreeJsonSchema,
    },
    temperature: 0.4, // Lower temperature for more deterministic, schema-compliant output
    // top_p: 0.95, // Often good to use one or the other (temp or top_p)
    // max_tokens: 8000 // Consider if large outputs are consistently truncated. Model default is usually sufficient.
  };

  try {
    console.log("Sending request to OpenRouter with payload:", JSON.stringify(requestPayload, null, 2).substring(0,500) + "...");
    const response = await fetch(openRouterUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': `http://localhost:9002`, // Replace with your actual site URL if deployed
        'X-Title': `Subject Arbor`, // Replace with your actual app name
      },
      body: JSON.stringify(requestPayload),
    });

    const responseBodyText = await response.text(); // Get text first for better debugging
    
    if (!response.ok) {
      console.error('OpenRouter API Error Status:', response.status);
      console.error('OpenRouter API Error Response Body:', responseBodyText);
      let errorData;
      try {
        errorData = JSON.parse(responseBodyText);
      } catch (e) {
        errorData = { error: { message: responseBodyText || response.statusText }};
      }

      let errorMessage = `OpenRouter API error (${response.status}): ${errorData.error?.message || 'Unknown error'}`;
      if (response.status === 401) {
        errorMessage = "OpenRouter API authentication failed (401). Check your OPENROUTER_API_KEY.";
      } else if (response.status === 429) {
        errorMessage = "OpenRouter API rate limit exceeded (429). Please try again later.";
      } else if (errorData.error?.code === "model_not_found") {
        errorMessage = `OpenRouter API error: Model not found (${requestPayload.model}).`;
      } else if (errorData.error?.message && (errorData.error.message.includes("Problem with response_format or JSON schema") || errorData.error.message.includes("Array fields require at least one of 'items' or 'prefixItems'"))) {
        errorMessage = `OpenRouter API error: Problem with the JSON schema provided for response_format. Details: ${errorData.error.message}`;
      }
      throw new Error(errorMessage);
    }

    console.log("Raw OpenRouter successful response text (truncated):", responseBodyText.substring(0, 1000));
    
    let result;
    try {
      result = JSON.parse(responseBodyText);
    } catch (parseError: any) {
      console.error("Failed to parse OpenRouter successful response as JSON:", parseError, "Body:", responseBodyText.substring(0,500));
      throw new Error(`OpenRouter responded with success, but the body was not valid JSON. Received (partial): ${responseBodyText.substring(0,200)}`);
    }


    if (!result.choices || result.choices.length === 0 || !result.choices[0].message || !result.choices[0].message.content) {
      console.error('OpenRouter API returned an unexpected response structure:', result);
      throw new Error('OpenRouter API returned an unexpected response structure. No content found.');
    }

    // The content should be a JSON string if json_schema is used and successful
    const jsonContentString = result.choices[0].message.content;

    // Even with json_schema, models might add tiny bits of text or be wrapped in markdown.
    const extractedJson = extractJsonFromString(jsonContentString);

    if (!extractedJson) {
        console.error("Could not extract valid JSON from OpenRouter response content. Raw content from choices[0].message.content (partial):", jsonContentString.substring(0, 500));
        throw new Error(`Failed to extract a valid JSON object from the AI's response content. The content might be malformed or empty. Received (partial): ${jsonContentString.substring(0,200)}`);
    }
    
    // Validate if the extracted string is indeed parsable JSON
    // This step is critical because `json_schema` mode should return valid JSON string in `content`.
    // If `JSON.parse(extractedJson)` fails, it means the model didn't adhere to the schema despite `response_format`.
    try {
        JSON.parse(extractedJson); // This is parsing the string *within* content.
    } catch (e: any) {
        console.error("The extracted JSON string from OpenRouter (from choices[0].message.content) is invalid. Extracted (partial):", extractedJson.substring(0,300), e);
        throw new Error(`The AI response content, even after extraction, was not valid JSON. Extracted segment (partial for debugging): ${extractedJson.substring(0, 200)}. Original error: ${e.message}`);
    }
    
    console.log("Successfully extracted JSON string from OpenRouter (truncated):", extractedJson.substring(0, 500));
    return { treeData: extractedJson }; // Return the JSON string

  } catch (error: any) {
    console.error('Error calling OpenRouter API or processing its response:', error);
    if (error.message && (error.message.startsWith("OpenRouter API error") || error.message.startsWith("Failed to extract") || error.message.includes("was not valid JSON"))) {
        throw error;
    }
    throw new Error(`OpenRouter API processing error: ${error.message || "An unknown error occurred."}`);
  }
}
