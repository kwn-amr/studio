
'use server';

/**
 * @fileOverview Generates a tree graph of subjects related to a field of study using OpenRouter.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */

import type { TreeNodeData } from '@/types'; // Assuming TreeNodeData is defined here

export interface GenerateSubjectTreeInput {
  fieldOfStudy: string;
}

export interface GenerateSubjectTreeOutput {
  treeData: string; // JSON string
}

// Define the JSON schema for the expected output structure (root node)
// This helps OpenRouter's `response_format` ensure the top-level structure.
// The prompt will guide the recursive generation of children.
const subjectTreeJsonSchema = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description: "The name of the main field of study (root node)."
    },
    children: {
      type: "array",
      description: "An array of direct sub-disciplines or main topics. Each item in this array should also be an object with 'name' (string) and 'children' (array) properties, recursively.",
      items: {
        type: "object",
        properties: {
            name: {type: "string"},
            children: {type: "array"}
        },
        required: ["name"]
      }
    }
  },
  required: ["name", "children"] // Make children required at the root, even if empty.
};


export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey || apiKey === "your_openrouter_key_here") {
    console.error('OPENROUTER_API_KEY is not set or is the default placeholder.');
    throw new Error('OpenRouter API key is not configured. Please set OPENROUTER_API_KEY in your .env file.');
  }

  const openRouterUrl = "https://openrouter.ai/api/v1/chat/completions";

  const messages = [
    {
      role: 'system',
      content: `You are an expert in structuring fields of study into comprehensive JSON tree graphs.
Your SOLE task is to generate a JSON string representing an extensive tree graph.
The root node MUST be the field of study itself.
Each node in the JSON MUST be an object with a "name" key (string value) and a "children" key (array of node objects).
If a node has no subtopics, its "children" array MUST be empty ([]).
The tree MUST be highly detailed, featuring multiple levels of hierarchy.
It should span from the most foundational, introductory concepts to more specialized, advanced, or even cutting-edge research topics within the field. Aim for significant depth and breadth.
Your entire response MUST be *only* the raw JSON text representing the tree object.
Do NOT include any other explanatory text, conversation, apologies, or markdown formatting (like \`\`\`json ... \`\`\`) before or after the single, complete JSON object.`
    },
    {
      role: 'user',
      content: `Generate a valid, highly detailed, and comprehensive JSON subject tree for the field of study: "${input.fieldOfStudy}". Ensure your entire response is only the JSON object as specified.`,
    },
  ];

  const requestBody = {
    model: "meta-llama/llama-3.3-70b-instruct", // As per user's example
    provider: { // As per user's example
        only: ["Cerebras"]
    },
    messages: messages,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "subject_tree_schema",
        strict: true,
        schema: subjectTreeJsonSchema
      }
    },
    temperature: 0.5, // Similar to previous Cerebras setting
    top_p: 0.95,      // Similar to previous Cerebras setting
    max_tokens: 4096, // Adjusted for Llama 3.3 on OpenRouter
  };

  try {
    const response = await fetch(openRouterUrl, {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // OpenRouter might appreciate these headers:
        // "HTTP-Referer": "YOUR_SITE_URL", // Optional: Replace with your app's URL
        // "X-Title": "Subject Arbor", // Optional: Replace with your app's name
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorBody = await response.text(); // Use .text() first to avoid JSON parse error if body isn't JSON
      let errorMessage = `OpenRouter API request failed with status ${response.status}: ${response.statusText}.`;
      try {
        const parsedError = JSON.parse(errorBody);
        errorMessage += ` Details: ${parsedError.error?.message || errorBody}`;
      } catch (e) {
        errorMessage += ` Details: ${errorBody}`;
      }
      console.error(errorMessage, "Request body:", JSON.stringify(requestBody, null, 2).substring(0, 500)); // Log part of the request for debugging
      
      if (response.status === 401) {
        throw new Error("OpenRouter API authentication failed (401). Check your OPENROUTER_API_KEY.");
      }
      if (response.status === 429) {
        throw new Error("OpenRouter API rate limit exceeded (429). Please try again later or check your plan.");
      }
      if (response.status === 400 && errorBody.includes("provider")) {
        throw new Error(`OpenRouter API error (400): Problem with model provider configuration. The model 'meta-llama/llama-3.3-70b-instruct' might not be available from the specified provider or the provider configuration is incorrect. Details: ${errorBody.substring(0,300)}`);
      }
       if (response.status === 400 && errorBody.includes("response_format")) {
        throw new Error(`OpenRouter API error (400): Problem with response_format or JSON schema. Details: ${errorBody.substring(0,300)}`);
      }
      throw new Error(errorMessage);
    }

    const result = await response.json();

    if (!result.choices || result.choices.length === 0 || !result.choices[0].message || !result.choices[0].message.content) {
      console.error('OpenRouter API response is missing expected content structure:', result);
      throw new Error('OpenRouter API response did not contain the expected subject tree data.');
    }

    const treeDataString = result.choices[0].message.content;

    // With response_format: { type: "json_schema", strict: true },
    // the content should be a clean JSON string.
    // Basic validation that it looks like JSON.
    if (!(treeDataString.trim().startsWith('{') && treeDataString.trim().endsWith('}'))) {
        console.error("OpenRouter response content is not a valid JSON object string:", treeDataString.substring(0,500));
        throw new Error("AI response was not a valid JSON object string, despite requesting structured output.");
    }
    
    // Further validation (is it parseable, does it have 'name'?) will happen in page.tsx
    // and the strict schema should have been enforced by OpenRouter.
    console.log("Received JSON string from OpenRouter (truncated):", treeDataString.substring(0, 500));
    return { treeData: treeDataString };

  } catch (error: any) {
    console.error('Error calling OpenRouter API or processing its response:', error);
    // Re-throw specific errors or a generic one
    if (error.message.startsWith("OpenRouter API") || error.message.startsWith("AI response was not")) {
        throw error;
    }
    throw new Error(`OpenRouter API processing error: ${error.message || "An unknown error occurred."}`);
  }
}
