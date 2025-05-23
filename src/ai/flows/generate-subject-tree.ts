
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
    
    // More aggressive removal of markdown and common conversational fluff
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
        // This case should be less common for our root object, but included for completeness
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
        if (char === '"') { // Basic string toggle
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
    "HTTP-Referer": "https://subjectarbor.com", 
    "X-Title": "Subject Arbor App" 
  };
  
  const systemPrompt = `You are an AI assistant that ONLY outputs JSON.
Your SOLE task is to generate a JSON object representing a detailed, hierarchical subject tree for the field of study: "${input.fieldOfStudy}".

IMPORTANT RULES FOR YOUR RESPONSE:
1.  Your entire response MUST be a single, valid JSON object.
2.  The root of the JSON object MUST have a "name" property whose value is EXACTLY "${input.fieldOfStudy}".
3.  The root of the JSON object MUST have a "children" property, which is an array of child node objects.
4.  Each node in the tree (including the root and all children) MUST be an object with two properties:
    -   "name": A string representing the name of the subject, sub-discipline, or topic. All string values must be properly JSON escaped (e.g., quotes within strings must be escaped as \\").
    -   "children": An array of child node objects. If a node has no sub-topics, its "children" array MUST be empty (e.g., []).
5.  The tree should be highly detailed, featuring multiple levels of hierarchy. It should span from foundational concepts to advanced or cutting-edge research topics.
6.  DO NOT include ANY text outside of the JSON object. No explanations, no apologies, no markdown formatting like \`\`\`json.
7.  The final output MUST start with "{" and end with "}". No leading or trailing characters, including whitespace or newlines outside the main JSON structure.

Example of the required JSON tree structure:
{
  "name": "${input.fieldOfStudy}",
  "children": [
    {
      "name": "First Level Sub-Discipline",
      "children": [
        {
          "name": "Second Level Topic A",
          "children": []
        },
        {
          "name": "Second Level Topic B",
          "children": [
            {
              "name": "Third Level Specific Concept",
              "children": []
            }
          ]
        }
      ]
    },
    {
      "name": "Another First Level Sub-Discipline",
      "children": []
    }
  ]
}

Provide ONLY the JSON object.`;

  const modelToUse = "qwen/qwen3-32b"; 
  const requestPayload = {
    model: modelToUse, 
    provider: { 
        "only": ["Cerebras"] 
    },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `Generate a valid, highly detailed, and comprehensive JSON subject tree for the field of study: "${input.fieldOfStudy}". Ensure the root node's "name" is exactly "${input.fieldOfStudy}". Adhere strictly to all JSON formatting rules.` }
    ],
    // Removed response_format due to Cerebras provider limitations with recursive schemas
    temperature: 0.7, 
    max_tokens: 4048, 
    top_p: 0.95,
  };

  console.log("OpenRouter Request Payload (partial messages, no schema):", JSON.stringify({...requestPayload, messages: [{role: "system", content: "System prompt summarized..."}, requestPayload.messages[1]]}, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(requestPayload)
    });

    const responseBodyText = await response.text(); 
    
    if (!response.ok) {
      console.error("OpenRouter API Error:", response.status, responseBodyText);
      let errorMessage = `OpenRouter API request failed with status ${response.status} using model ${modelToUse} via Cerebras provider.`;
      try {
          const errorData = JSON.parse(responseBodyText);
          if (errorData.error && errorData.error.message) {
              errorMessage += ` Details: ${errorData.error.message}`;
              if (errorData.error.code === 'invalid_request_error' && errorData.error.param === 'response_format') { // Should not happen now
                   errorMessage = `OpenRouter API error: Problem with response_format (model: ${modelToUse}, provider: Cerebras). Details: ${errorData.error.message}`;
              } else if (errorData.error.message.includes("Provider returned error")) {
                  errorMessage = `OpenRouter API error (${response.status}): Provider (Cerebras) returned error for model ${modelToUse}. Raw provider message: ${errorData.error.metadata?.raw || 'N/A'}`;
              }
          }
      } catch (e) {
          errorMessage += ` Could not parse error response body: ${responseBodyText.substring(0, 200)}`;
      }
      throw new Error(errorMessage);
    }
    
    console.log("Raw OpenRouter successful response text (truncated):", responseBodyText.substring(0, 1000));
    
    let finalJsonString: string | null = null;
    try {
        // Since response_format.json_schema is removed, responseData.choices[0].message.content should be the AI's attempt at raw JSON.
        // We still pass it through extractJsonFromString for cleaning and robust extraction.
        const responseData = JSON.parse(responseBodyText); // First, parse the overall OpenRouter response
        if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
          const content = responseData.choices[0].message.content;
          finalJsonString = extractJsonFromString(content); // Clean and extract the JSON part from the content
        } else {
          console.warn("OpenRouter response did not have the expected choices[0].message.content structure. Attempting to extract JSON from the full response body.");
          finalJsonString = extractJsonFromString(responseBodyText);
        }
    } catch (parseError: any) {
        console.error("Error parsing OpenRouter response body or extracting content:", parseError, "Body:", responseBodyText.substring(0, 500));
        finalJsonString = extractJsonFromString(responseBodyText); // Fallback: try direct extraction if initial parsing fails
        if (!finalJsonString) {
          throw new Error(`Failed to parse OpenRouter response or extract content. Error: ${parseError.message}. Response (partial): ${responseBodyText.substring(0,200)}`);
        }
        console.warn("Successfully extracted JSON using fallback on raw response body after initial parse failed.");
    }

    if (!finalJsonString) {
        console.error("After attempting to get content, no valid JSON string was derived. Original response (partial):", responseBodyText.substring(0, 500));
        throw new Error("The AI's response, after processing, did not yield a parsable JSON string.");
    }
    
    console.log("Attempting to parse final derived JSON (first 500 chars):", finalJsonString.substring(0,500));

    try {
        JSON.parse(finalJsonString); 
    } catch (e: any) {
        console.error("The final derived JSON string is invalid. Derived string (partial):", finalJsonString.substring(0,300), "Error:", e.message);
        throw new Error(`The AI response, after processing, was not valid JSON. Derived segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
    }

    return { treeData: finalJsonString };

  } catch (error: any) {
    console.error("Error in generateSubjectTree with OpenRouter:", error);
     if (error.message && (
          error.message.includes("OpenRouter API key is not configured") ||
          error.message.includes("OpenRouter API request failed") ||
          error.message.includes("OpenRouter API error") || 
          error.message.includes("Failed to parse OpenRouter response") ||
          error.message.includes("did not yield a parsable JSON string") ||
          error.message.includes("was not valid JSON")
      )) {
          throw error; 
      }
    throw new Error(`An unexpected error occurred while generating subject tree via OpenRouter: ${error.message}`);
  }
}
