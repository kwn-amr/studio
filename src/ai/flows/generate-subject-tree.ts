
'use server';
/**
 * @fileOverview Generates a tree graph of subjects related to a field of study.
 * Can use either OpenRouter (targeting a specific provider like Cerebras or Chutes) or Cerebras direct API.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */
import type { ApiProvider } from '@/app/page';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { TreeNodeData } from '@/types';
import { extractJsonFromString } from '@/lib/ai-utils';


export interface GenerateSubjectTreeInput {
  fieldOfStudy: string;
}

export interface GenerateSubjectTreeOutput {
  treeData: string; // JSON string representing the hierarchical subject tree
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Helper function to extract JSON from a string that might contain markdown or conversational fluff
// MOVED to src/lib/ai-utils.ts

const commonSystemPrompt = (fieldOfStudy: string) => `You are an AI assistant that ONLY outputs JSON.
Your SOLE task is to generate a JSON object representing a detailed, hierarchical subject tree for the field of study: "${fieldOfStudy}".
Each node in the tree MUST be an object with three properties:
    -   "name": A string representing the name of the subject, sub-discipline, or topic. All string values must be properly JSON escaped (e.g., quotes within strings must be escaped as \\").
    -   "description": A string providing a brief, one-sentence description of this specific subject, sub-discipline, or topic. This description should be very concise (a single, short sentence) to ensure computational resources are prioritized for generating a deep and detailed tree structure.
    -   "children": An array of child node objects. If a node has no sub-topics, its "children" array MUST be empty (e.g., []).
The root of the JSON object MUST have a "name" property whose value is EXACTLY "${fieldOfStudy}".
The root of the JSON object MUST have a "description" property, providing a brief, one-sentence summary of the field of study.
The root of the JSON object MUST have a "children" property, which is an array of child node objects.
The tree MUST be highly detailed and comprehensive, featuring multiple levels of hierarchy (aim for at least 3-5 levels deep where appropriate). It should span from foundational concepts to advanced or cutting-edge research topics.
DO NOT include ANY text outside of the JSON object. No explanations, no apologies, no markdown formatting like \`\`\`json.
The final output MUST start with "{" and end with "}". No leading or trailing characters, including whitespace or newlines outside the main JSON structure.
DO NOT return a JSON array as the root element. It MUST be a JSON object.
Generate the JSON in a top-down manner.
DO NOT include any "..." or truncated content within node names, descriptions, or children arrays. All sub-trees should be fully represented.

Example of the required JSON tree structure (ensure your output exactly matches this structure, replacing placeholders with actual content):
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
        }
      ]
    }
  ]
}
Provide ONLY the JSON object.`;


// Schema for recursive tree node structure - used for OpenRouter's response_format
const subjectTreeJsonSchema = {
  type: "object",
  properties: {
    name: { type: "string", description: "Name of the subject, sub-discipline, or topic." },
    description: { type: "string", description: "A brief, one-sentence summary of this subject, sub-discipline, or topic." },
    children: {
      type: "array",
      description: "An array of child node objects. Empty if no sub-topics.",
      items: { "$ref": "#/$defs/treeNode" }, 
    },
  },
  required: ["name", "description", "children"], 
  additionalProperties: false,
  "$defs": { // Definitions for reusable schemas
    "treeNode": {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the child subject/topic." },
        description: { type: "string", description: "A brief, one-sentence summary of this child subject/topic." },
        children: {
          type: "array",
          description: "An array of further child node objects for this child. Empty if it's a leaf.",
          items: { "$ref": "#/$defs/treeNode" },
        },
      },
      required: ["name", "description", "children"],
      additionalProperties: false,
    },
  },
};


export async function generateSubjectTree(
  input: GenerateSubjectTreeInput,
  apiProvider: ApiProvider,
  openRouterSpecificProvider?: string // e.g., "Chutes", "Cerebras"
): Promise<GenerateSubjectTreeOutput> {
  let rawResponseText = '';
  let finalJsonString: string | null = null;
  const systemPromptContent = commonSystemPrompt(input.fieldOfStudy);
  let usageData: GenerateSubjectTreeOutput['usage'] | undefined = undefined;

  console.log(`[generateSubjectTree] Request for: "${input.fieldOfStudy}", API Provider: ${apiProvider}, OpenRouter Sub-Provider: ${openRouterSpecificProvider || 'N/A'}`);
  
  try {
    if (apiProvider === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) {
        throw new Error('OpenRouter API key is not configured. Please set OPENROUTER_API_KEY in your environment variables.');
      }
      const url = "https://openrouter.ai/api/v1/chat/completions";
      const headers = {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://subjectarbor.com", 
        "X-Title": process.env.NEXT_PUBLIC_APP_TITLE || "Subject Arbor App" 
      };
      
      let modelToUse: string;
      let useJsonSchemaFormat: boolean;

      if (openRouterSpecificProvider === 'Chutes') {
          modelToUse = "qwen/qwen3-30b-a3b:free";
          useJsonSchemaFormat = true; 
      } else if (openRouterSpecificProvider === 'Cerebras') {
          modelToUse = "qwen/qwen3-32b"; 
          useJsonSchemaFormat = false; 
      } else {
          console.warn(`[generateSubjectTree] OpenRouter: Unknown or unhandled specific provider "${openRouterSpecificProvider}". Defaulting to Chutes model and schema.`);
          modelToUse = "qwen/qwen3-30b-a3b:free"; 
          useJsonSchemaFormat = true; 
      }
      console.log(`[generateSubjectTree] OpenRouter: Model ${modelToUse}, Provider: ${openRouterSpecificProvider}, Using JSON Schema: ${useJsonSchemaFormat}`);
      
      const requestPayload: any = {
        model: modelToUse,
        messages: [
          { role: "system", content: systemPromptContent },
          { role: "user", content: `Generate the JSON subject tree with descriptions for "${input.fieldOfStudy}".` }
        ],
        temperature: 0.2, 
        max_tokens: 16382, 
        top_p: 0.95,
      };
      
      if (openRouterSpecificProvider) {
        requestPayload.provider = { "only": [openRouterSpecificProvider] };
      }

      if (useJsonSchemaFormat) {
        requestPayload.response_format = {
          type: "json_schema",
          json_schema: {
            name: "subject_tree_schema",
            strict: true, 
            schema: subjectTreeJsonSchema,
          },
        };
      }
      console.log(`[generateSubjectTree] OpenRouter Request Payload (messages summarized):`, JSON.stringify({...requestPayload, messages: [{role: "system", content: "System prompt summarized..."}, requestPayload.messages[1]]}, null, 2));

      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestPayload)
      });
      const responseBodyText = await response.text(); 

      if (!response.ok) {
        console.error(`[generateSubjectTree] OpenRouter API Error (${response.status}) with Model ${modelToUse} via Provider ${openRouterSpecificProvider}:`, responseBodyText);
        let errorMessage = `OpenRouter API request failed with status ${response.status} using model ${modelToUse} via ${openRouterSpecificProvider} provider.`;
         try {
            const errorData = JSON.parse(responseBodyText);
            if (errorData.error && errorData.error.message) {
                if (errorData.error.message.includes("Provider returned error") || errorData.error.message.includes("No allowed providers are available")) {
                    errorMessage = `OpenRouter API error (${response.status}): Provider (${openRouterSpecificProvider}) returned error for model ${modelToUse}. Raw provider message: ${errorData.error.metadata?.raw || errorData.error.message || 'N/A'}`;
                } else if (errorData.error.code === 'invalid_request_error' && errorData.error.param === 'response_format') { 
                   errorMessage = `OpenRouter API error (${response.status}): Problem with the JSON schema provided for response_format (model: ${modelToUse}, provider: ${openRouterSpecificProvider}). Details: ${errorData.error.message}`;
                } else {
                   errorMessage += ` Details: ${errorData.error.message}`;
                }
            }
        } catch (e) {
            errorMessage += ` Could not parse error response body: ${responseBodyText.substring(0, 200)}`;
        }
        throw new Error(errorMessage);
      }
      
      let rawContentFromChoice = "";
      const responseData = JSON.parse(responseBodyText); 
      if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
          rawContentFromChoice = responseData.choices[0].message.content;
      } else {
          console.warn(`[generateSubjectTree] OpenRouter response (Model: ${modelToUse}, Provider: ${openRouterSpecificProvider}) did not have the expected choices[0].message.content structure. Attempting to extract JSON from the full response body.`);
          rawContentFromChoice = responseBodyText; 
      }

      console.log(`[generateSubjectTree] Raw content from AI choice (OpenRouter - Model: ${modelToUse}, Provider: ${openRouterSpecificProvider}, Schema Used: ${useJsonSchemaFormat}, Truncated):`, rawContentFromChoice.substring(0, 1000));
      
      finalJsonString = extractJsonFromString(rawContentFromChoice);

      if (!finalJsonString) {
        console.error(`[generateSubjectTree] After attempting extraction from OpenRouter (Model: ${modelToUse}, Provider: ${openRouterSpecificProvider}, Schema Used: ${useJsonSchemaFormat}), no valid JSON string was derived. Original content from choice (partial):`, rawContentFromChoice.substring(0, 500));
        throw new Error(`OpenRouter (Provider: ${openRouterSpecificProvider || 'N/A'}) API Error: The model's response could not be processed into a parsable JSON string, even after cleaning. This often means the AI did not output valid JSON. Please check server-side console logs for '[extractJsonFromString]' warnings and 'Original content from choice' logs for more details.`);
      }
      
      if (responseData.usage) {
        usageData = responseData.usage;
      }

    } else if (apiProvider === 'cerebras') {
      const apiKey = process.env.CEREBRAS_API_KEY;
      if (!apiKey) {
        throw new Error('Cerebras API key is not configured. Please set CEREBRAS_API_KEY in your environment variables.');
      }
      const cerebras = new Cerebras({ apiKey });
      const modelToUse = 'qwen-3-32b'; 
      
      console.log(`[generateSubjectTree] Cerebras Direct: Model ${modelToUse}, Field:`, input.fieldOfStudy);

      const stream = await cerebras.chat.completions.create({
        messages: [
          { role: "system", content: systemPromptContent },
          { role: "user", content: `Generate the JSON subject tree with descriptions for "${input.fieldOfStudy}".` }
        ],
        model: modelToUse,
        stream: true,
        max_completion_tokens: 16382, 
        temperature: 0.2, 
        top_p: 0.95
      });

      let accumulatedContent = "";
      for await (const chunk of stream) {
        accumulatedContent += chunk.choices[0]?.delta?.content || '';
      }
      rawResponseText = accumulatedContent;
      console.log("[generateSubjectTree] Raw Cerebras successful accumulated response text (truncated):", rawResponseText.substring(0, 1000));
      
      if (!rawResponseText.trim()) {
        console.warn("[generateSubjectTree] Cerebras API returned an empty or whitespace-only response for input:", input.fieldOfStudy);
        throw new Error("Cerebras API returned an empty response. The model might not have been able to generate content for the given field of study.");
      }

      finalJsonString = extractJsonFromString(rawResponseText);
      
      if (!finalJsonString) {
          console.error(`[generateSubjectTree] [Cerebras Direct] After attempting extraction, no valid JSON string was derived. Original raw response (partial):`, rawResponseText.substring(0, 500));
          throw new Error(`Cerebras API Error: The model's response could not be processed into a parsable JSON string, even after cleaning. This often means the AI did not output valid JSON. Please check server-side console logs for '[extractJsonFromString]' warnings and 'Original raw response' logs for more details.`);
      }
    } else {
      const exhaustiveCheck: never = apiProvider; 
      throw new Error(`Unsupported API provider: ${exhaustiveCheck}`);
    }

    
    console.log(`[generateSubjectTree] Attempting to parse final derived JSON from ${apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider || 'N/A'})` : 'Cerebras Direct'} (first 500 chars):`, finalJsonString.substring(0,500));
    try {
        const parsedData = JSON.parse(finalJsonString) as TreeNodeData; 
        if (typeof parsedData.name !== 'string' || !Array.isArray(parsedData.children)) {
            console.warn(`[generateSubjectTree] Parsed JSON from ${apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider})` : 'Cerebras'} does not have the expected root structure (name: string, children: array). Parsed (partial):`, finalJsonString.substring(0, 300));
        }
    } catch (e: any) {
        const currentApiDesc = apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider || 'N/A'})` : 'Cerebras Direct';
        console.error(`[generateSubjectTree] The final derived JSON string from ${currentApiDesc} is invalid. Derived string (partial):`, finalJsonString.substring(0,300), "Error:", e.message);
        throw new Error(`The AI response from ${currentApiDesc}, after processing, was not valid JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
    }
    return { treeData: finalJsonString, usage: usageData };

  } catch (error: any) {
    const currentApiDesc = apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider || 'N/A'})` : 'Cerebras Direct';
    console.error(`[generateSubjectTree] Error in generateSubjectTree with ${currentApiDesc}:`, error);
    const specificApiErrors = [
        "API key is not configured",
        "API request failed",
        "API error", 
        "Failed to parse",
        "did not yield a parsable JSON string",
        "was not valid JSON",
        "Recursive schemas are currently not supported", 
        "Provider returned error", 
        "Problem with model provider configuration",
        "Problem with the JSON schema",
        "No allowed providers are available",
        "model's response could not be processed into a parsable JSON string",
        "Cerebras API returned an empty response",
        "The AI's response was entirely non-JSON"
    ];
    if (error.message && specificApiErrors.some(phrase => error.message.includes(phrase))) {
        throw error; 
    }
    throw new Error(`An unexpected error occurred while generating subject tree via ${currentApiDesc}: ${error.message}`);
  }
}