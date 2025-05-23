
'use server';
/**
 * @fileOverview Generates a tree graph of subjects related to a field of study using OpenRouter,
 * orchestrated via a Genkit flow.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const GenerateSubjectTreeInputSchema = z.object({
  fieldOfStudy: z.string().describe('The specific field of study to generate a tree for.'),
});
export type GenerateSubjectTreeInput = z.infer<typeof GenerateSubjectTreeInputSchema>;

const GenerateSubjectTreeOutputSchema = z.object({
  treeData: z.string().describe('A JSON string representing the hierarchical subject tree.'),
});
export type GenerateSubjectTreeOutput = z.infer<typeof GenerateSubjectTreeOutputSchema>;

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
        // More aggressive cleaning of common conversational fluff, including potential echoes of instructions
        const patternsToRemove = [
            /^<response>|<\/response>$/g,
            /^[\s\S]*?<think>[\s\S]*?<\/think>\s*/i, 
            /^\s*Okay, here is the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*Sure, here is the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*Here's the JSON(?: output| object| response)?[.:\s]*/i,
            /^\s*The JSON(?: output| object| response) is[.:\s]*/i,
            /^\s*I have generated the JSON object as requested\s*[.:\s]*/i,
            // Remove potential echoes of strict instructions
            /^\s*Your response MUST contain ONLY the JSON object itself.*$/gim,
            /^\s*The root node MUST be the field of study itself.*$/gim,
            /^\s*STRICTLY ADHERE to providing only the raw JSON.*$/gim,
            /^\s*ABSOLUTELY NO other text.*$/gim,
            /^\s*Example of the required JSON tree structure:.*$/gim,
            // Remove markdown-like fences if not caught by the regex
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
    
    // Find the first '{' or '[' to determine the start of the JSON
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
        // If no clear JSON start is found after cleaning, return null.
        console.warn("Could not find a starting '{' or '[' for JSON extraction in cleaned text:", textToParse.substring(0,200));
        return null;
    }

    // Balance braces/brackets to find the end of the first complete JSON structure
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
        if (char === '"') { // Toggle inString state
            inString = !inString;
        }

        if (!inString) {
            if (char === openChar) {
                balance++;
            } else if (char === closeChar) {
                balance--;
            }
        }

        if (balance === 0 && i >= startIndex) { // Found the end of the first complete JSON structure
            return textToParse.substring(startIndex, i + 1);
        }
    }
    
    console.warn("Could not find a balanced JSON structure in cleaned text:", textToParse.substring(0,200));
    return null; // Return null if no balanced JSON structure is found
}


export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  return generateSubjectTreeFlow(input);
}

const subjectTreeJsonSchema = {
  name: "subjectTree",
  description: "A hierarchical tree structure representing a field of study, its sub-disciplines, and specific topics. Each node has a name and an array of children nodes.",
  strict: true, 
  schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
      },
      children: {
        type: "array",
        items: {
          "$ref": "#/$defs/treeNode" 
        }
      }
    },
    required: ["name", "children"],
    additionalProperties: false,
    "$defs": { 
      "treeNode": {
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
      }
    }
  }
};

const generateSubjectTreeFlow = ai.defineFlow(
  {
    name: 'generateSubjectTreeFlow',
    inputSchema: GenerateSubjectTreeInputSchema,
    outputSchema: GenerateSubjectTreeOutputSchema,
  },
  async (input: GenerateSubjectTreeInput) => {
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

    const requestPayload = {
      model: "nousresearch/nous-hermes-2-mixtral-8x7b-dpo",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate a valid, highly detailed, and comprehensive JSON subject tree for the field of study: "${input.fieldOfStudy}". Ensure the root node's "name" is exactly "${input.fieldOfStudy}".` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: subjectTreeJsonSchema
      },
      temperature: 0.2, 
      max_tokens: 4000, 
      top_p: 0.9,
    };

    console.log("OpenRouter Request Payload (partial messages):", JSON.stringify({...requestPayload, messages: [{role: "system", content: "System prompt summarized..."}, requestPayload.messages[1]]}, null, 2));


    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestPayload)
      });

      const responseBodyText = await response.text(); 
      
      if (!response.ok) {
        console.error("OpenRouter API Error:", response.status, responseBodyText);
        let errorMessage = `OpenRouter API request failed with status ${response.status}.`;
        try {
            const errorData = JSON.parse(responseBodyText);
            if (errorData.error && errorData.error.message) {
                errorMessage += ` Details: ${errorData.error.message}`;
                if (errorData.error.code === 'invalid_request_error' && errorData.error.param === 'response_format') {
                     errorMessage = `OpenRouter API error: Problem with the JSON schema provided for response_format. Details: ${errorData.error.message}`;
                } else if (errorData.error.message.includes("Provider returned error")) {
                    errorMessage = `OpenRouter API error (${response.status}): Provider returned error. Check model availability or provider configuration. Raw provider message: ${errorData.error.metadata?.raw || 'N/A'}`;
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
          const responseData = JSON.parse(responseBodyText);
          if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
            const content = responseData.choices[0].message.content;
            if (typeof content === 'string') {
                finalJsonString = extractJsonFromString(content);
                if (!finalJsonString) { 
                    console.warn("extractJsonFromString failed on content that was expected to be pure JSON. Using content directly. Content (partial):", content.substring(0,200));
                    finalJsonString = content; 
                }
            } else if (typeof content === 'object') {
                console.warn("OpenRouter returned a pre-parsed object in 'content', stringifying it.");
                finalJsonString = JSON.stringify(content);
            } else {
                 throw new Error("Unexpected type for 'content' in OpenRouter response.");
            }
          } else {
            throw new Error('Unexpected response structure: choices, message, or content missing.');
          }
      } catch (parseError: any) {
          console.error("Error parsing OpenRouter response body or extracting content:", parseError, "Body:", responseBodyText.substring(0, 500));
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
      
      console.log("Attempting to parse final derived JSON (first 500 chars):", finalJsonString.substring(0,500));

      try {
          JSON.parse(finalJsonString); 
      } catch (e: any) {
          console.error("The final derived JSON string is invalid. Derived string (partial):", finalJsonString.substring(0,300), "Error:", e.message);
          throw new Error(`The AI response, after processing, was not valid JSON. Derived segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
      }

      return { treeData: finalJsonString };

    } catch (error: any) {
      console.error("Error in generateSubjectTreeFlow with OpenRouter:", error);
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
);
