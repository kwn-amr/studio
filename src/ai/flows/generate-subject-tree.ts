
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

export const GenerateSubjectTreeInputSchema = z.object({
  fieldOfStudy: z.string().describe('The specific field of study to generate a tree for.'),
});
export type GenerateSubjectTreeInput = z.infer<typeof GenerateSubjectTreeInputSchema>;

export const GenerateSubjectTreeOutputSchema = z.object({
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
  return generateSubjectTreeFlow(input);
}

const subjectTreeJsonSchema = {
  name: "subjectTree",
  description: "A hierarchical tree structure representing a field of study, its sub-disciplines, and specific topics. Each node has a name and an array of children nodes.",
  strict: true, // Enforce strict adherence to the schema
  schema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "The name of the current subject, discipline, or topic."
      },
      children: {
        type: "array",
        description: "An array of child nodes representing sub-topics or sub-disciplines. This array is empty if the current node is a leaf (has no further sub-divisions).",
        items: {
          $ref: "#/$defs/treeNode" // Recursive reference to the treeNode definition
        }
      }
    },
    required: ["name", "children"],
    additionalProperties: false,
    $defs": { // Definitions for reusable schemas
      "treeNode": {
        type: "object",
        properties: {
          name: { type: "string" },
          children: {
            type: "array",
            items: { $ref: "#/$defs/treeNode" } // Self-reference for recursive structure
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
      // Recommended by OpenRouter for troubleshooting
      "HTTP-Referer": "https://subjectarbor.com", // Replace with your app's domain
      "X-Title": "Subject Arbor App" // Replace with your app's name
    };

    const systemPrompt = `You are an expert in structuring fields of study into comprehensive and detailed tree graphs.
Your SOLE task is to generate a JSON object representing an extensive tree graph of subjects.
The root node MUST be the field of study itself: "${input.fieldOfStudy}". Its "name" property must be exactly this value.
Sub-disciplines MUST be branches, and specific subjects, concepts, or theories MUST be leaves.
The tree MUST be highly detailed, featuring multiple levels of hierarchy.
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field. Aim for significant depth and breadth.
Each node in the JSON MUST have a "name" key (string) and a "children" key (array of nodes). If a node has no subtopics, its "children" array MUST be empty ([]).
Your entire response will be parsed as JSON according to the provided schema. Adhere strictly to the schema.
DO NOT include any other explanatory text, conversation, apologies, or markdown formatting.
The root MUST be a JSON object.
Generate the JSON in a top-down, streamable fashion, starting with the root node.`;

    const requestPayload = {
      model: "meta-llama/llama-3.3-70b-instruct", // Or another model known for good JSON output
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Generate a valid, highly detailed, and comprehensive JSON subject tree for the field of study: "${input.fieldOfStudy}". Ensure the root node's "name" is exactly "${input.fieldOfStudy}".` }
      ],
      response_format: {
        type: "json_schema",
        json_schema: subjectTreeJsonSchema
      },
      temperature: 0.2, // Lower temperature for more deterministic and schema-adherent output
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

      const responseBodyText = await response.text(); // Get text first for logging
      
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
      
      // If response_format with strict schema is used, the content should be directly the JSON string.
      // However, we keep extractJsonFromString as a robust fallback.
      let finalJsonString: string | null = null;
      try {
          const responseData = JSON.parse(responseBodyText);
          if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
            const content = responseData.choices[0].message.content;
            // With strict json_schema, content should be the JSON string.
            // If it's a string that *contains* JSON (e.g. wrapped in markdown by mistake), extractJsonFromString will clean it.
            if (typeof content === 'string') {
                finalJsonString = extractJsonFromString(content);
                if (!finalJsonString) { // If extraction fails on a string that should've been pure JSON
                    console.warn("extractJsonFromString failed on content that was expected to be pure JSON. Using content directly. Content (partial):", content.substring(0,200));
                    finalJsonString = content; // Try using the content directly as it might be pure JSON already.
                }
            } else if (typeof content === 'object') {
                // Should not happen with strict json_schema if model adheres, but handle just in case.
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
          throw new Error(`Failed to parse OpenRouter response or extract content. Error: ${parseError.message}. Response (partial): ${responseBodyText.substring(0,200)}`);
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
      // Re-throw specific, informative errors, or a general one.
       if (error.message && (
            error.message.includes("OpenRouter API key is not configured") ||
            error.message.includes("OpenRouter API request failed") ||
            error.message.includes("OpenRouter API error") ||
            error.message.includes("Failed to parse OpenRouter response") ||
            error.message.includes("did not yield a parsable JSON string") ||
            error.message.includes("was not valid JSON")
        )) {
            throw error; // Re-throw already specific error
        }
      throw new Error(`An unexpected error occurred while generating subject tree via OpenRouter: ${error.message}`);
    }
  }
);
