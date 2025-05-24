
'use server';
/**
 * @fileOverview Generates a tree graph of subjects related to a field of study.
 * Can use either OpenRouter (targeting a specific provider like Cerebras) or Cerebras direct API.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import type { ApiProvider } from '@/app/page';

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


const commonSystemPrompt = (fieldOfStudy: string) => `You are an AI assistant that ONLY outputs JSON.
Your SOLE task is to generate a JSON object representing a detailed, hierarchical subject tree for the field of study: "${fieldOfStudy}".

IMPORTANT RULES FOR YOUR RESPONSE:
1.  Your entire response MUST be a single, valid JSON object.
2.  The root of the JSON object MUST have a "name" property whose value is EXACTLY "${fieldOfStudy}".
3.  The root of the JSON object MUST have a "description" property, providing a brief, one-sentence summary of the field of study.
4.  The root of the JSON object MUST have a "children" property, which is an array of child node objects.
5.  Each node in the tree (including the root and all children) MUST be an object with three properties:
    -   "name": A string representing the name of the subject, sub-discipline, or topic. All string values must be properly JSON escaped (e.g., quotes within strings must be escaped as \\").
    -   "description": A string providing a brief, one-sentence description of this specific subject, sub-discipline, or topic. This description should be concise and informative.
    -   "children": An array of child node objects. If a node has no sub-topics, its "children" array MUST be empty (e.g., []).
6.  The tree should be highly detailed, featuring multiple levels of hierarchy. It should span from foundational concepts to advanced or cutting-edge research topics.
7.  DO NOT include ANY text outside of the JSON object. No explanations, no apologies, no markdown formatting like \`\`\`json.
8.  The final output MUST start with "{" and end with "}". No leading or trailing characters, including whitespace or newlines outside the main JSON structure.
9.  Generate the JSON in a top-down manner.
10. DO NOT return a JSON array as the root element. It MUST be a JSON object.
11. DO NOT include any "..." or truncated content within node names, descriptions, or children arrays. All sub-trees should be fully represented.

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

export async function generateSubjectTree(
  input: GenerateSubjectTreeInput,
  apiProvider: ApiProvider,
  openRouterSpecificProvider?: string
): Promise<GenerateSubjectTreeOutput> {
  let rawResponseText = '';
  let finalJsonString: string | null = null;
  const systemPromptContent = commonSystemPrompt(input.fieldOfStudy);
  let usageData: GenerateSubjectTreeOutput['usage'] | undefined = undefined;

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
        "HTTP-Referer": "https://subjectarbor.com", 
        "X-Title": "Subject Arbor App" 
      };
      
      const modelToUse = "meta-llama/llama-3.3-70b-instruct"; 
      const effectiveORProvider = openRouterSpecificProvider || "Cerebras"; 
      const providerConfig = { "only": [effectiveORProvider] };

      const requestPayload = {
        model: modelToUse,
        provider: providerConfig,
        messages: [
          { role: "system", content: systemPromptContent },
          { role: "user", content: `Generate the JSON subject tree with descriptions for "${input.fieldOfStudy}".` }
        ],
        temperature: 0.2, 
        max_tokens: 4048, 
        top_p: 0.95,
      };
      console.log(`OpenRouter Request: Model ${modelToUse}, Provider ${effectiveORProvider}, Field: ${input.fieldOfStudy}`);
      console.log("OpenRouter Request Payload (partial messages):", JSON.stringify({...requestPayload, messages: [{role: "system", content: "System prompt summarized..."}, requestPayload.messages[1]]}, null, 2));


      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(requestPayload)
      });
      rawResponseText = await response.text();

      if (!response.ok) {
        console.error("OpenRouter API Error:", response.status, rawResponseText);
        let errorMessage = `OpenRouter API request failed with status ${response.status} using model ${modelToUse} via ${effectiveORProvider} provider.`;
         try {
            const errorData = JSON.parse(rawResponseText);
            if (errorData.error && errorData.error.message) {
                errorMessage += ` Details: ${errorData.error.message}`;
                if (errorData.error.message.includes("Provider returned error")) {
                    errorMessage = `OpenRouter API error (${response.status}): Provider (${effectiveORProvider}) returned error for model ${modelToUse}. Raw provider message: ${errorData.error.metadata?.raw || 'N/A'}`;
                } else if (errorData.error.code === 'invalid_request_error' && errorData.error.param === 'response_format') {
                   errorMessage = `OpenRouter API error: Problem with response_format (model: ${modelToUse}, provider: ${effectiveORProvider}). Details: ${errorData.error.message}`;
              }
            }
        } catch (e) {
            errorMessage += ` Could not parse error response body: ${rawResponseText.substring(0, 200)}`;
        }
        throw new Error(errorMessage);
      }
      console.log("Raw OpenRouter successful response text (truncated):", rawResponseText.substring(0, 1000));
      const responseData = JSON.parse(rawResponseText); 
      if (responseData.choices && responseData.choices.length > 0 && responseData.choices[0].message && responseData.choices[0].message.content) {
          finalJsonString = extractJsonFromString(responseData.choices[0].message.content); 
          if (responseData.usage) {
            usageData = responseData.usage;
          }
      } else {
          console.warn("OpenRouter response did not have the expected choices[0].message.content structure. Attempting to extract JSON from the full response body.");
          finalJsonString = extractJsonFromString(rawResponseText);
      }

    } else if (apiProvider === 'cerebras') {
      const apiKey = process.env.CEREBRAS_API_KEY;
      if (!apiKey) {
        throw new Error('Cerebras API key is not configured. Please set CEREBRAS_API_KEY in your environment variables.');
      }
      const cerebras = new Cerebras({ apiKey });
      const modelToUse = 'qwen-3-32b'; 
      
      console.log(`Cerebras Request: Model ${modelToUse}, Field:`, input.fieldOfStudy);

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
      console.log("Raw Cerebras successful accumulated response text (truncated):", rawResponseText.substring(0, 1000));
      finalJsonString = extractJsonFromString(rawResponseText);
      // Note: Cerebras SDK streaming might not easily provide token usage for the whole request.
      // usageData will remain undefined for Cerebras in this implementation.
    } else {
      const exhaustiveCheck: never = apiProvider;
      throw new Error(`Unsupported API provider: ${exhaustiveCheck}`);
    }

    if (!finalJsonString) {
      const currentApiDesc = apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider || 'Cerebras'})` : 'Cerebras Direct';
      console.error(`After attempting to get content from ${currentApiDesc}, no valid JSON string was derived. Original response (partial):`, rawResponseText.substring(0, 500));
      throw new Error(`The AI's response from ${currentApiDesc}, after processing, did not yield a parsable JSON string.`);
    }
    
    console.log(`Attempting to parse final derived JSON from ${apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider || 'Cerebras'})` : 'Cerebras Direct'} (first 500 chars):`, finalJsonString.substring(0,500));
    try {
        JSON.parse(finalJsonString); 
    } catch (e: any) {
        const currentApiDesc = apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider || 'Cerebras'})` : 'Cerebras Direct';
        console.error(`The final derived JSON string from ${currentApiDesc} is invalid. Derived string (partial):`, finalJsonString.substring(0,300), "Error:", e.message);
        throw new Error(`The AI response from ${currentApiDesc}, after processing, was not valid JSON. Extracted segment (partial for debugging): ${finalJsonString.substring(0, 200)}. Original error: ${e.message}`);
    }
    return { treeData: finalJsonString, usage: usageData };

  } catch (error: any) {
    const currentApiDesc = apiProvider === 'openrouter' ? `OpenRouter (Provider: ${openRouterSpecificProvider || 'Cerebras'})` : 'Cerebras Direct';
    console.error(`Error in generateSubjectTree with ${currentApiDesc}:`, error);
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
        "Problem with the JSON schema"
    ];
    if (error.message && specificApiErrors.some(phrase => error.message.includes(phrase))) {
        throw error; 
    }
    throw new Error(`An unexpected error occurred while generating subject tree via ${currentApiDesc}: ${error.message}`);
  }
}

