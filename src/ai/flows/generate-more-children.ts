
'use server';
/**
 * @fileOverview Generates additional child nodes for a given parent node within a subject tree.
 *
 * - generateMoreChildren - A function that handles the generation of new child nodes.
 * - GenerateMoreChildrenInput - The input type for the generateMoreChildren function.
 * - GenerateMoreChildrenOutput - The return type for the generateMoreChildren function.
 */

import type { ApiProvider } from '@/app/page';
import type { TreeNodeData } from '@/types';
import { extractJsonFromString } from '@/lib/ai-utils'; // Re-use existing extractor
import Cerebras from '@cerebras/cerebras_cloud_sdk';

export interface GenerateMoreChildrenInput {
  targetNodeName: string;
  existingChildrenNames: string[];
  fieldOfStudy: string; // Overall context
}

export interface GenerateMoreChildrenOutput {
  newChildren: TreeNodeData[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

const commonSystemPromptForMoreChildren = (targetNodeName: string, fieldOfStudy: string, existingChildrenNames: string[]) => `You are an expert in structuring fields of study.
Your task is to generate a list of NEW, ADDITIONAL sub-topics (children) for the specific parent topic: "${targetNodeName}" within the broader field of study: "${fieldOfStudy}".
These new sub-topics should be directly related to "${targetNodeName}" and should NOT duplicate any of the following already existing sub-topics: ${existingChildrenNames.join(', ')}. If no new distinct sub-topics can be generated, return an empty array.
Each new sub-topic in your list MUST be a JSON object with three properties:
    - "name": A string representing the name of the new sub-topic. All string values must be properly JSON escaped.
    - "description": A string providing a brief, one-sentence description of this new sub-topic. This description should be concise and informative.
    - "children": An array of child node objects. Since you are generating new leaf-like children for "${targetNodeName}", this "children" array for each new sub-topic MUST be empty (e.g., []).
Your ENTIRE response MUST be *only* the raw JSON text representing an ARRAY of these new sub-topic objects.
Do NOT include any other explanatory text, conversation, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) before or after the single, complete JSON array.
If you determine no new, distinct sub-topics can be generated for "${targetNodeName}" given the existing ones, your response should be an empty JSON array: [].

Example of the required JSON array structure (if new topics are found):
[
  {
    "name": "Newly Generated Sub-Topic A for ${targetNodeName}",
    "description": "A brief, one-sentence description of Newly Generated Sub-Topic A.",
    "children": []
  },
  {
    "name": "Newly Generated Sub-Topic B for ${targetNodeName}",
    "description": "A brief, one-sentence description of Newly Generated Sub-Topic B.",
    "children": []
  }
]

Example if no new topics are found:
[]

Provide ONLY the JSON array.`;

// Schema for the array of new children - used for OpenRouter's response_format
const newChildrenJsonSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name of the new sub-topic." },
      description: { type: "string", description: "A brief, one-sentence summary of this new sub-topic." },
      children: {
        type: "array",
        description: "Should be an empty array for these newly generated children.",
        items: {} // No specific items expected, should be empty
      }
    },
    required: ["name", "description", "children"],
    additionalProperties: false
  }
};


export async function generateMoreChildren(
  input: GenerateMoreChildrenInput,
  apiProvider: ApiProvider,
  openRouterSpecificProvider?: string
): Promise<GenerateMoreChildrenOutput> {
  const systemPromptContent = commonSystemPromptForMoreChildren(input.targetNodeName, input.fieldOfStudy, input.existingChildrenNames);
  let rawResponseText = '';
  let finalJsonString: string | null = null;
  let usageData: GenerateMoreChildrenOutput['usage'] | undefined = undefined;

  console.log(`[generateMoreChildren] Request for: "${input.targetNodeName}" in "${input.fieldOfStudy}". Existing children: ${input.existingChildrenNames.length}`);
  console.log(`[generateMoreChildren] API Provider: ${apiProvider}, OpenRouter Sub-Provider: ${openRouterSpecificProvider || 'N/A'}`);

  try {
    if (apiProvider === 'openrouter') {
      const apiKey = process.env.OPENROUTER_API_KEY;
      if (!apiKey) throw new Error('OpenRouter API key is not configured.');

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
        useJsonSchemaFormat = false; // Cerebras provider had issues with recursive schemas, applying caution
      } else {
        console.warn(`[generateMoreChildren] OpenRouter: Unknown specific provider "${openRouterSpecificProvider}". Defaulting to Chutes.`);
        modelToUse = "qwen/qwen3-30b-a3b:free";
        useJsonSchemaFormat = true;
      }
      console.log(`[generateMoreChildren] OpenRouter: Model ${modelToUse}, Provider: ${openRouterSpecificProvider}, Using JSON Schema: ${useJsonSchemaFormat}`);

      const requestPayload: any = {
        model: modelToUse,
        messages: [
          { role: "system", content: systemPromptContent },
          { role: "user", content: `Generate a JSON array of new sub-topics for "${input.targetNodeName}", considering it's part of "${input.fieldOfStudy}" and avoiding existing children.` }
        ],
        temperature: 0.4, // Slightly higher for creative sub-topic generation
        max_tokens: 2048, // Max tokens for OpenRouter to allow for reasonable number of children
        top_p: 0.95,
      };
       if (openRouterSpecificProvider) {
        requestPayload.provider = { "only": [openRouterSpecificProvider] };
      }

      if (useJsonSchemaFormat) {
        requestPayload.response_format = {
          type: "json_schema",
          json_schema: {
            name: "new_children_array_schema",
            strict: true,
            schema: newChildrenJsonSchema,
          },
        };
      }
      
      const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(requestPayload) });
      rawResponseText = await response.text();

      if (!response.ok) {
        console.error(`[generateMoreChildren] OpenRouter API Error (${response.status}) with Model ${modelToUse} via Provider ${openRouterSpecificProvider}:`, rawResponseText);
        throw new Error(`OpenRouter API request for more children failed with status ${response.status} using model ${modelToUse} via ${openRouterSpecificProvider}. Details: ${rawResponseText.substring(0,300)}`);
      }
      
      const responseData = JSON.parse(rawResponseText);
      if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
        rawResponseText = responseData.choices[0].message.content;
      } else {
         rawResponseText = JSON.stringify(responseData); // Fallback if structure is unexpected
      }
      if (responseData.usage) usageData = responseData.usage;

    } else if (apiProvider === 'cerebras') {
      const apiKey = process.env.CEREBRAS_API_KEY;
      if (!apiKey) throw new Error('Cerebras API key is not configured.');
      
      const cerebras = new Cerebras({ apiKey });
      const modelToUse = 'qwen-3-32b';
      console.log(`[generateMoreChildren] Cerebras Direct: Model ${modelToUse}`);

      const stream = await cerebras.chat.completions.create({
        messages: [
          { role: "system", content: systemPromptContent },
          { role: "user", content: `Generate a JSON array of new sub-topics for "${input.targetNodeName}", considering it's part of "${input.fieldOfStudy}" and avoiding existing children.` }
        ],
        model: modelToUse,
        stream: true,
        max_completion_tokens: 4096, // Adjusted for potentially more children
        temperature: 0.4,
        top_p: 0.95
      });

      let accumulatedContent = "";
      for await (const chunk of stream) {
        accumulatedContent += chunk.choices[0]?.delta?.content || '';
      }
      rawResponseText = accumulatedContent;
    } else {
      throw new Error(`Unsupported API provider: ${apiProvider}`);
    }

    finalJsonString = extractJsonFromString(rawResponseText);

    if (!finalJsonString) {
      console.error(`[generateMoreChildren] After attempting extraction, no valid JSON string was derived. Original content (partial):`, rawResponseText.substring(0, 500));
      throw new Error(`AI Error (Provider: ${apiProvider === 'openrouter' ? openRouterSpecificProvider : 'Cerebras'}): The model's response for additional children could not be processed into a parsable JSON string.`);
    }
    
    // The AI should return an array of TreeNodeData
    const parsedNewChildren = JSON.parse(finalJsonString) as TreeNodeData[];
    if (!Array.isArray(parsedNewChildren)) {
        console.error("[generateMoreChildren] Parsed response is not an array. Received:", finalJsonString.substring(0,300));
        throw new Error("AI Error: Expected an array of new children, but received a different JSON structure.");
    }

    // Validate basic structure of new children
    parsedNewChildren.forEach(child => {
        if (typeof child.name !== 'string' || typeof child.description !== 'string' || !Array.isArray(child.children)) {
            console.warn("[generateMoreChildren] A generated child has an invalid structure:", child);
            // Optionally filter out invalid children or throw a more specific error
        }
        // Ensure children array is empty as per prompt
        child.children = []; 
    });
    
    return { newChildren: parsedNewChildren, usage: usageData };

  } catch (error: any) {
    console.error(`[generateMoreChildren] Error:`, error);
    const currentApiDesc = apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider || 'N/A'})` : 'Cerebras Direct';
    throw new Error(`Failed to generate more children via ${currentApiDesc}: ${error.message}`);
  }
}

    
