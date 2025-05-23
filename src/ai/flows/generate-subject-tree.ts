
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
  treeData: string; // JSON string representing the hierarchical subject tree
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
            // Remove lines that look like echoed instructions
            /^\s*Your response MUST contain ONLY the JSON object itself.*$/gim,
            /^\s*The root node MUST be the field of study itself.*$/gim,
            /^\s*STRICTLY ADHERE to providing only the raw JSON.*$/gim,
            /^\s*ABSOLUTELY NO other text.*$/gim,
            /^\s*Example of the required JSON tree structure:.*$/gim,
            /^\s*```json\s*/, // Start of markdown block
            /\s*```\s*$/,     // End of markdown block
        ];
        
        for (const regex of patternsToRemove) {
            textToParse = textToParse.replace(regex, '').trim();
        }
    }
    
    if (!textToParse) {
        console.warn("After cleaning, the response string for JSON extraction is empty.");
        return null;
    }
    
    // Find the first '{' or '[' to start JSON parsing
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
        if (char === '"') { // Basic string toggle, doesn't handle escaped quotes within strings perfectly but often good enough
            inString = !inString;
        }

        if (!inString) {
            if (char === openChar) {
                balance++;
            } else if (char === closeChar) {
                balance--;
            }
        }

        if (balance === 0 && i >= startIndex) { // Found the end of the first balanced JSON structure
            return textToParse.substring(startIndex, i + 1);
        }
    }
    
    console.warn("Could not find a balanced JSON structure in cleaned text:", textToParse.substring(0,200));
    return null; // No balanced JSON structure found
}


export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('OPENROUTER_API_KEY is not set.');
    throw new Error('OpenRouter API key is not configured. Please set OPENROUTER_API_KEY in your environment variables.');
  }

  const url = "https://openrouter.ai/api/v1/chat/completions";
  const headers = {
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://subjectarbor.com", // Added header
    "X-Title": "Subject Arbor App" // Added header
  };
  
  // Define the JSON schema for the expected output tree structure
  const subjectTreeJsonSchema = {
    name: "subjectTree",
    description: "A hierarchical tree structure representing a field of study, its sub-disciplines, and specific topics. Each node has a name and an array of children nodes.",
    strict: true, // If true, the model will be forced to output JSON that matches the schema.
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        children: {
          type: "array",
          items: { "$ref": "#/$defs/treeNode" } 
        }
      },
      required: ["name", "children"],
      additionalProperties: false,
      "$defs": { // Definitions for reusable schemas
        "treeNode": {
          type: "object",
          properties: {
            name: { type: "string" },
            children: {
              type: "array",
              items: { "$ref": "#/$defs/treeNode" } // Recursive definition
            }
          },
          required: ["name", "children"],
          additionalProperties: false,
        }
      }
    }
  };

  const systemPrompt = `You are an expert in structuring fields of study into comprehensive and detailed tree graphs.
Your SOLE task is to generate a JSON object representing an extensive tree graph of subjects.
The root node's "name" property MUST be exactly "${input.fieldOfStudy}".
Sub-disciplines MUST be branches, and specific subjects, concepts, or theories MUST be leaves.
The tree MUST be highly detailed, featuring multiple levels of hierarchy.
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field. Aim for significant depth and breadth.
Each node in the JSON MUST have a "name" key (string) and a "children" key (array of nodes). If a node has no subtopics, its "children" array MUST be empty ([]).
Your entire response will be parsed as JSON according to the provided schema. Adhere strictly to the schema.
DO NOT include any other explanatory text, conversation, apologies, or markdown formatting.
The root MUST be a JSON object. DO NOT return a JSON array as the root element.
Generate the JSON in a top-down, streamable fashion, starting with the root node.`;

  const modelToUse = "nousresearch/nous-hermes-2-mixtral-8x7b-dpo"; // Using Mixtral
  const requestPayload = {
    model: modelToUse, 
    provider: { 
        "only": ["Cerebras"] // Explicitly requesting Cerebras provider
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Generate a valid, highly detailed, and comprehensive JSON subject tree for the field of study: "${input.fieldOfStudy}". Ensure the root node's "name" is exactly "${input.fieldOfStudy}".` }
    ],
    response_format: {
      type: "json_schema",
      json_schema: subjectTreeJsonSchema
    },
    temperature: 0.2, // Lowered for potentially more focused JSON output
    max_tokens: 4000, // Increased to allow for larger, more detailed trees
    top_p: 0.9,
  };

  console.log("OpenRouter Request Payload (partial messages):", JSON.stringify({...requestPayload, messages: [{role: "system", content: "System prompt summarized..."}, requestPayload.messages[1]]}, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestPayload)
    });

    const responseBodyText = await response.text(); // Get raw text first for debugging
    
    if (!response.ok) {
      console.error("OpenRouter API Error:", response.status, responseBodyText);
      let errorMessage = `OpenRouter API request failed with status ${response.status} using model ${modelToUse} via Cerebras provider.`;
      try {
          const errorData = JSON.parse(responseBodyText);
          if (errorData.error && errorData.error.message) {
              errorMessage += ` Details: ${errorData.error.message}`;
              if (errorData.error.code === 'invalid_request_error' && errorData.error.param === 'response_format') {
                   errorMessage = `OpenRouter API error: Problem with the JSON schema provided for response_format (model: ${modelToUse}, provider: Cerebras). Details: ${errorData.error.message}`;
              } else if (errorData.error.message.includes("Provider returned error")) {
                  errorMessage = `OpenRouter API error (${response.status}): Provider (Cerebras) returned error for model ${modelToUse}. Raw provider message: ${errorData.error.metadata?.raw || 'N/A'}`;
              }
          }
      } catch (e) {
          // If parsing the error itself fails, include the raw text
          errorMessage += ` Could not parse error response body: ${responseBodyText.substring(0, 200)}`;
      }
      throw new Error(errorMessage);
    }
    
    console.log("Raw OpenRouter successful response text (truncated):", responseBodyText.substring(0, 1000));
    
    // Attempt to parse the response assuming it's JSON with the content inside choices[0].message.content
    let finalJsonString: string | null = null;
    try {
        const responseData = JSON.parse(responseBodyText);
        if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
          const content = responseData.choices[0].message.content;
          // If response_format: json_schema is respected, content should be a stringified JSON.
          // If not, it might be an object already, or a string with surrounding text.
          if (typeof content === 'string') {
              finalJsonString = extractJsonFromString(content);
              if (!finalJsonString) { // If extraction failed, it might be pure JSON already
                  console.warn("extractJsonFromString failed on content that was expected to be pure JSON. Using content directly. Content (partial):", content.substring(0,200));
                  finalJsonString = content; // Use the content directly, assuming it's clean JSON
              }
          } else if (typeof content === 'object') {
              // This case implies the API might sometimes return a pre-parsed object, though less common with text-based models
              console.warn("OpenRouter returned a pre-parsed object in 'content', stringifying it.");
              finalJsonString = JSON.stringify(content);
          } else {
               throw new Error("Unexpected type for 'content' in OpenRouter response.");
          }
        } else {
          // If the expected structure is missing, try to extract JSON from the whole body
          console.warn("OpenRouter response did not have the expected choices[0].message.content structure. Attempting to extract JSON from the full response body.");
          finalJsonString = extractJsonFromString(responseBodyText);
          if (!finalJsonString) {
            throw new Error('Unexpected response structure: choices, message, or content missing, and no JSON found in the raw body.');
          }
        }
    } catch (parseError: any) {
        console.error("Error parsing OpenRouter response body or extracting content:", parseError, "Body:", responseBodyText.substring(0, 500));
        // Fallback: try to extract JSON directly from the raw response body if initial parsing/extraction fails
        finalJsonString = extractJsonFromString(responseBodyText);
        if (!finalJsonString) {
          throw new Error(`Failed to parse OpenRouter response or extract content. Error: ${parseError.message}. Response (partial): ${responseBodyText.substring(0,200)}`);
        }
        console.warn("Successfully extracted JSON using fallback on raw response body after initial parse failed.");
    }

    if (!finalJsonString) {
        console.error("After attempting to get content, no valid JSON string was derived. Original response (partial):", responseBodyText.substring(0, 500));
        throw new Error("The AI's response, after processing, did not yield a parsable JSON string.");
    }
    
    // Final validation of the extracted JSON string
    console.log("Attempting to parse final derived JSON (first 500 chars):", finalJsonString.substring(0,500));

    try {
        JSON.parse(finalJsonString); // This is just to ensure it's valid JSON. The page.tsx will do the full validation.
    } catch (e: any) {
        console.error("The final derived JSON string is invalid. Derived string (partial):", finalJsonString.substring(0,300), "Error:", e.message);
        throw new Error(`The AI response, after processing, was not valid JSON. Derived segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
    }

    return { treeData: finalJsonString };

  } catch (error: any) {
    console.error("Error in generateSubjectTree with OpenRouter:", error);
    // Ensure specific, informative errors are re-thrown
     if (error.message && (
          error.message.includes("OpenRouter API key is not configured") ||
          error.message.includes("OpenRouter API request failed") ||
          error.message.includes("OpenRouter API error") || // Catches specific schema/provider errors formatted above
          error.message.includes("Failed to parse OpenRouter response") ||
          error.message.includes("did not yield a parsable JSON string") ||
          error.message.includes("was not valid JSON")
      )) {
          throw error; // Re-throw already specific errors
      }
    // Fallback for other types of errors
    throw new Error(`An unexpected error occurred while generating subject tree via OpenRouter: ${error.message}`);
  }
}
