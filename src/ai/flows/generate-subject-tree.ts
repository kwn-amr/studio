'use server';

/**
 * @fileOverview Generates a tree graph of subjects related to a field of study using GenAI.
 *
 * - generateSubjectTree - A function that handles the generation of the subject tree.
 * - GenerateSubjectTreeInput - The input type for the generateSubjectTree function.
 * - GenerateSubjectTreeOutput - The return type for the generateSubjectTree function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GenerateSubjectTreeInputSchema = z.object({
  fieldOfStudy: z.string().describe('The field of study to generate a subject tree for.'),
});
export type GenerateSubjectTreeInput = z.infer<typeof GenerateSubjectTreeInputSchema>;

const GenerateSubjectTreeOutputSchema = z.object({
  treeData: z.string().describe('A JSON string representing the tree data structure.'),
});
export type GenerateSubjectTreeOutput = z.infer<typeof GenerateSubjectTreeOutputSchema>;

export async function generateSubjectTree(input: GenerateSubjectTreeInput): Promise<GenerateSubjectTreeOutput> {
  return generateSubjectTreeFlow(input);
}

const generateSubjectTreePrompt = ai.definePrompt({
  name: 'generateSubjectTreePrompt',
  input: {schema: GenerateSubjectTreeInputSchema},
  output: {schema: GenerateSubjectTreeOutputSchema},
  prompt: `You are an expert in structuring fields of study into tree graphs.

  Given the field of study: {{{fieldOfStudy}}},
  generate a JSON string representing a tree graph of subjects related to that field.
  The root node should be the field of study itself.
  Sub-disciplines should be branches, and specific subjects should be leaves.
  Ensure the JSON is valid and can be parsed without errors.  Include multiple levels of hierarchy.
  Each node in the JSON should have a "name" key representing the subject and a potentially empty "children" array representing its subtopics.  The output MUST be a valid JSON string.

  Example of a valid JSON tree structure:
  {
    "name": "Computer Science",
    "children": [
      {
        "name": "Artificial Intelligence",
        "children": [
          {
            "name": "Machine Learning"
          },
          {
            "name": "Deep Learning"
          }
        ]
      },
      {
        "name": "Data Structures and Algorithms"
      }
    ]
  }
  `,
});

const generateSubjectTreeFlow = ai.defineFlow(
  {
    name: 'generateSubjectTreeFlow',
    inputSchema: GenerateSubjectTreeInputSchema,
    outputSchema: GenerateSubjectTreeOutputSchema,
  },
  async input => {
    const {output} = await generateSubjectTreePrompt(input);
    return output!;
  }
);
