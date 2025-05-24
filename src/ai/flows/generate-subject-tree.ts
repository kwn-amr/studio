
'use server';

/**
 * @fileOverview Generates a tree graph of subjects related to a field of study,
 * allowing selection between OpenRouter (with specific sub-providers) and Cerebras Direct API.
 * Includes descriptions for each node.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */

import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { ChatCompletionMessageParam } from '@cerebras/cerebras_cloud_sdk/resources/chat/completions';

type ApiProvider = 'openrouter' | 'cerebras';

export interface GenerateSubjectTreeInput {
  fieldOfStudy: string;
  apiProvider: ApiProvider;
  openRouterSpecificProvider?: string; // e.g., "Chutes", "Cerebras"
}

export interface GenerateSubjectTreeOutput {
  treeData: string; // JSON string
  usage?: { // Optional: for OpenRouter token usage
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
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

function getCommonSystemPrompt(fieldOfStudy: string, forProvider: 'OpenRouter' | 'Cerebras'): string {
  // Common prompt, slightly adjusted based on known provider quirks or schema enforcement
  return `You are an expert in structuring fields of study into comprehensive and detailed tree graphs.
Your SOLE task is to generate a JSON string representing an extensive tree graph of subjects.
The root node MUST be the field of study itself, which is "${fieldOfStudy}".
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
  "name": "${fieldOfStudy}",
  "description": "A brief, one-sentence summary of ${fieldOfStudy}.",
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
}

export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  const { fieldOfStudy, apiProvider, openRouterSpecificProvider } = input;

  if (apiProvider === 'openrouter') {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error('OpenRouter API key is not configured. Please set OPENROUTER_API_KEY in your environment variables.');
    }

    const url = "https://openrouter.ai/api/v1/chat/completions";
    const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://your-app-url.com", // Replace with your actual app URL
        "X-Title": "Subject Arbor App" // Replace with your app's title
    };

    let model: string;
    let useJsonSchema: boolean;

    if (openRouterSpecificProvider === 'Chutes') {
        model = "qwen/qwen3-30b-a3b:free"; // Qwen3-30B is a good free tier model
        useJsonSchema = true; // Assume Chutes can handle recursive schemas
    } else if (openRouterSpecificProvider === 'Cerebras') {
        model = "meta-llama/llama-3.3-70b-instruct"; // Llama 3.3 70B is powerful
        useJsonSchema = false; // Cerebras provider had issues with recursive schemas
    } else {
        // Default OpenRouter behavior if no specific provider or an unknown one is passed
        model = "nousresearch/nous-hermes-2-mixtral-8x7b-dpo"; // A generally good model
        useJsonSchema = true; // Assume default routing can handle schemas
        console.warn(`Unknown or unspecified OpenRouter provider: ${openRouterSpecificProvider}. Defaulting to ${model} and using JSON schema.`);
    }
    
    const effectiveORProvider = openRouterSpecificProvider || "Default (OpenRouter Choice)";
    console.log(`Using OpenRouter. Provider: ${effectiveORProvider}, Model: ${model}, Use JSON Schema: ${useJsonSchema}`);

    const subjectTreeJsonSchema = {
        name: "subjectTree",
        strict: true,
        description: `A hierarchical tree of subjects for the field of study: ${fieldOfStudy}. Each node must have a name, a brief description, and an array of children nodes.`,
        schema: {
            type: "object",
            properties: {
                name: { type: "string", description: "The name of the subject or topic." },
                description: { type: "string", description: "A brief, one-sentence description of the subject or topic." },
                children: {
                    type: "array",
                    description: "An array of child nodes, representing sub-topics.",
                    items: { "$ref": "#/$defs/treeNode" } 
                }
            },
            required: ["name", "description", "children"],
            additionalProperties: false,
            "$defs": {
                "treeNode": {
                    type: "object",
                    properties: {
                        name: { type: "string", description: "The name of the sub-subject or sub-topic." },
                        description: { type: "string", description: "A brief, one-sentence description of the sub-subject or sub-topic." },
                        children: {
                            type: "array",
                            description: "An array of further child nodes.",
                            items: { "$ref": "#/$defs/treeNode" }
                        }
                    },
                    required: ["name", "description", "children"],
                    additionalProperties: false,
                }
            }
        }
    };

    const requestPayload: any = {
        model: model,
        messages: [
            { role: "system", content: getCommonSystemPrompt(fieldOfStudy, 'OpenRouter') },
            { role: "user", content: `Generate a valid, highly detailed, and comprehensive JSON subject tree with descriptions for "${fieldOfStudy}", strictly adhering to the system prompt's instructions. Focus on depth, breadth, and concise one-sentence descriptions for each node.` }
        ],
        temperature: 0.2,
        max_tokens: 4096, // Increased for potentially larger trees
    };

    if (openRouterSpecificProvider) {
        requestPayload.provider = { "only": [openRouterSpecificProvider] };
    }

    if (useJsonSchema) {
        requestPayload.response_format = {
            type: "json_schema",
            json_schema: subjectTreeJsonSchema
        };
    }
    
    console.log("OpenRouter Request Payload (partial):", { ...requestPayload, messages: "[...]" });


    let responseBodyText = '';
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestPayload)
        });

        responseBodyText = await response.text();

        if (!response.ok) {
            let errorMessage = `OpenRouter API request failed with status ${response.status} using model ${model} via ${effectiveORProvider} provider.`;
            try {
                const errorData = JSON.parse(responseBodyText);
                console.error("OpenRouter API Error Data:", errorData);
                errorMessage += ` Details: ${errorData.error?.message || responseBodyText}`;
                if (errorData.error?.metadata?.raw) {
                  errorMessage += ` Raw provider message: ${errorData.error.metadata.raw}`;
                }
            } catch (e) {
                errorMessage += ` Could not parse error response body: ${responseBodyText.substring(0, 200)}`;
            }
            throw new Error(errorMessage);
        }
        
        console.log("Raw OpenRouter successful response text (truncated):", responseBodyText.substring(0, 1000));
        const responseData = JSON.parse(responseBodyText);

        if (responseData.choices && responseData.choices[0]?.message?.content) {
            let treeJsonString = responseData.choices[0].message.content;
            
            // If not using JSON schema, we might need to extract from markdown
            if (!useJsonSchema) {
                 const extracted = extractJsonFromString(treeJsonString);
                 if (extracted) {
                    treeJsonString = extracted;
                 } else {
                    console.error("Failed to extract JSON from OpenRouter response when not using schema. Response (partial):", treeJsonString.substring(0,500));
                    throw new Error("OpenRouter response (without schema enforcement) did not yield extractable JSON.");
                 }
            }
            
            // Basic validation even if schema was used, as a fallback
            try {
                const parsedForValidation = JSON.parse(treeJsonString);
                if (typeof parsedForValidation.name !== 'string' || !Array.isArray(parsedForValidation.children)) {
                    console.warn("Extracted/Received JSON from OpenRouter does not have the expected root structure (name: string, children: array). Parsed (partial):", treeJsonString.substring(0, 300));
                    // Don't throw here, let the main page.tsx validation handle it, but log.
                }
            } catch (e: any) {
                console.error("The JSON string from OpenRouter is invalid. String (partial):", treeJsonString.substring(0,500), "Error:", e.message);
                throw new Error(`The AI response from OpenRouter was not valid JSON, even if schema was used. Error: ${e.message}. Received (partial): ${treeJsonString.substring(0,200)}`);
            }


            return { 
                treeData: treeJsonString,
                usage: responseData.usage 
            };
        } else {
            console.error("Unexpected response structure from OpenRouter:", responseData);
            throw new Error('Failed to get a valid tree from OpenRouter API. Response structure was unexpected.');
        }

    } catch (error: any) {
        console.error(`Error processing OpenRouter request for model ${model} via ${effectiveORProvider}:`, error);
        if (error instanceof Error && (error.message.includes("API request failed") || error.message.includes("Unexpected response structure") || error.message.includes("was not valid JSON") || error.message.includes("did not yield extractable JSON"))) {
            throw error; // Re-throw specific, already formatted errors
        }
        throw new Error(`Failed to generate tree via OpenRouter (Model: ${model}, Provider: ${effectiveORProvider}): ${error.message}`);
    }

  } else if (apiProvider === 'cerebras') {
    const cerebrasApiKey = process.env.CEREBRAS_API_KEY;
    if (!cerebrasApiKey) {
        console.error('CEREBRAS_API_KEY is not set.');
        throw new Error('Cerebras API key is not configured. Please set CEREBRAS_API_KEY in your environment variables.');
    }

    const cerebras = new Cerebras({ apiKey: cerebrasApiKey });
    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: getCommonSystemPrompt(fieldOfStudy, 'Cerebras') },
        { role: 'user', content: `Generate a valid, highly detailed, and comprehensive JSON subject tree with descriptions for "${fieldOfStudy}", strictly adhering to the system prompt's instructions for structure and JSON-only output. Focus on depth, breadth, and concise one-sentence descriptions for each node.` }
    ];

    console.log(`Using Cerebras Direct. Model: qwen-3-32b`);

    try {
        const stream = await cerebras.chat.completions.create({
            messages: messages,
            model: 'qwen-3-32b',
            stream: true,
            max_completion_tokens: 16382,
            temperature: 0.2, 
            top_p: 0.95,
        });

        let rawResponseText = '';
        for await (const chunk of stream) {
            rawResponseText += chunk.choices[0]?.delta?.content || '';
        }
        
        console.log("Raw Cerebras API response (truncated):", rawResponseText.substring(0, 500));

        if (!rawResponseText.trim()) {
            console.warn("Cerebras API returned an empty or whitespace-only response for input:", fieldOfStudy);
            throw new Error("Cerebras API returned an empty response. The model might not have been able to generate content for the given field of study.");
        }
        
        const finalJsonString = extractJsonFromString(rawResponseText);
        
        if (!finalJsonString) {
          console.error("After attempting to get content from Cerebras, no valid JSON string was derived. Original response (partial):", rawResponseText.substring(0, 500));
          throw new Error("The AI's response from Cerebras, after processing, did not yield a parsable JSON string.");
        }
        
        console.log("Attempting to parse final derived JSON from Cerebras (first 500 chars):", finalJsonString.substring(0,500));
        try {
            const parsedForValidation = JSON.parse(finalJsonString);
            // Add a check for the root structure
            if (typeof parsedForValidation.name !== 'string' || !Array.isArray(parsedForValidation.children)) {
               console.warn("Extracted JSON from Cerebras does not have the expected root structure (name: string, children: array). Parsed (partial):", finalJsonString.substring(0, 300));
                // Don't throw here, let page.tsx handle it for user display consistency
            }
        } catch (e: any) {
            console.error("The final derived JSON string from Cerebras is invalid. Derived string (partial):", finalJsonString.substring(0,300), "Error:", e.message);
            throw new Error(`The AI response from Cerebras, after processing, was not valid JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
        }
        return { treeData: finalJsonString }; // No usage data from Cerebras SDK stream

    } catch (error: any) {
        console.error('Error calling Cerebras API or processing its response:', error);
        const errorMessage = error?.error?.message || error?.message || "An unknown error occurred while communicating with Cerebras API.";
        if (error.status === 401) {
             throw new Error("Cerebras API authentication failed (401). Check your CEREBRAS_API_KEY.");
        }
        if (error.status === 429) {
            throw new Error("Cerebras API rate limit exceeded (429). Please try again later.");
        }
        if (error instanceof Error && (
            error.message.startsWith("Cerebras API returned an empty response") || 
            error.message.includes("did not yield a parsable JSON string") ||
            error.message.includes("was not valid JSON")
            )) {
            throw error; 
        }
        throw new Error(`Cerebras API processing error: ${errorMessage}`);
    }
  } else {
    throw new Error(`Unsupported API provider: ${apiProvider}`);
  }
}
