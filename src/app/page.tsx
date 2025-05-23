
"use client";

import * as React from 'react';
import { FieldInputForm } from '@/components/subject-arbor/FieldInputForm';
import { SubjectTreeDisplay } from '@/components/subject-arbor/SubjectTreeDisplay';
import { SubjectArborLogo } from '@/components/subject-arbor/SubjectArborLogo';
import type { TreeNodeData } from '@/types';
import { generateSubjectTree } from '@/ai/flows/generate-subject-tree';
import { useToast } from '@/hooks/use-toast';

export default function SubjectArborPage() {
  const [fieldOfStudy, setFieldOfStudy] = React.useState<string | null>(null);
  const [treeData, setTreeData] = React.useState<TreeNodeData | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const { toast } = useToast();

  const handleFieldSubmit = async (submittedField: string) => {
    setIsLoading(true);
    setFieldOfStudy(submittedField);
    setTreeData(null); // Clear previous tree
    
    try {
      toast({
        title: "Processing Request",
        description: `Generating subject tree for "${submittedField}"... This may take a moment.`,
      });
      
      const resultFromAI = await generateSubjectTree({ fieldOfStudy: submittedField });
      
      if (resultFromAI.treeData) {
        try {
          const parsedData = JSON.parse(resultFromAI.treeData) as TreeNodeData;
          
          // Validate the structure of the parsed data
          if (typeof parsedData.name !== 'string' || !Array.isArray(parsedData.children)) {
            console.error("Parsed data is missing 'name' or 'children' array at the root.", parsedData);
            throw new Error("The AI's response, while valid JSON, does not match the expected tree structure (missing root 'name' or 'children').");
          }
          setTreeData(parsedData);
          toast({
            title: "Success!",
            description: `Subject tree for "${submittedField}" generated.`,
            variant: "default",
          });
        } catch (parseError: any) {
          console.error("Failed to parse tree data string from AI:", parseError, "Received data string (partial):", resultFromAI.treeData.substring(0, 500));
          setTreeData(null);
          let description = "Received data from the AI is not a valid JSON tree structure. Please try again or a different query.";
          if (parseError.message.includes("does not match the expected tree structure")) {
            description = parseError.message; // Use the specific error message from the check
          } else if (parseError instanceof SyntaxError && resultFromAI.treeData) {
             // Provide a snippet of the invalid JSON if it's a SyntaxError
             description = `The AI's response was a string that could not be parsed as JSON. Received (partial): ${resultFromAI.treeData.substring(0,100)}... Error: ${parseError.message}`;
          } else {
            description = `Error parsing AI's JSON response: ${parseError.message}`;
          }
          toast({
            title: "Parsing Error",
            description: description,
            variant: "destructive",
          });
        }
      } else {
        // This case should ideally not be hit if generateSubjectTree throws on failure or returns empty treeData
        throw new Error("No tree data string received from AI, though the call seemed to succeed.");
      }
    } catch (error: any) {
      console.error("Error generating subject tree:", error);
      setTreeData(null);
      
      // Attempt to provide more descriptive error messages
      let descriptiveMessage = "An unexpected error occurred while generating the subject tree. Please try again.";

      if (error && typeof error.message === 'string') {
        const msg = error.message;
        // Specific OpenRouter error messages
        if (msg.includes("OpenRouter API key is not configured")) {
            descriptiveMessage = "OpenRouter API key is not configured. Please set OPENROUTER_API_KEY in your .env file.";
        } else if (msg.includes("OpenRouter API request failed with status 401")) {
            descriptiveMessage = "OpenRouter API authentication failed (401). Check your OPENROUTER_API_KEY.";
        } else if (msg.includes("OpenRouter API request failed with status 429")) {
            descriptiveMessage = "OpenRouter API rate limit exceeded (429). Please try again later or check your OpenRouter plan.";
        } else if (msg.includes("OpenRouter API error: Problem with the JSON schema")) {
            descriptiveMessage = "There was a problem with how the AI was asked to structure its response. Please try again. If the issue persists, contact support. Details: " + msg.split("Details: ")[1] || msg;
        } else if (msg.includes("OpenRouter API error") && msg.includes("Provider returned error")) {
            descriptiveMessage = "The AI model provider encountered an issue. This might be temporary. Please try again. Details: " + msg;
        } else if (msg.includes("Failed to parse OpenRouter response") || msg.includes("did not yield a parsable JSON string")) {
            // This indicates an issue in extracting or getting the JSON string itself
            descriptiveMessage = "The AI's response could not be processed into a valid subject tree. Please try again. Details: " + msg.split("Details: ")[1] || msg;
        } else if (msg.includes("was not valid JSON") || msg.includes("does not match the expected tree structure")) {
            // These errors come from JSON.parse or our structural validation
            descriptiveMessage = "The AI's response was not a valid or correctly structured subject tree. Please try again. Details: " + msg.split("Details: ")[1] || msg;
        } else if (msg.startsWith("OpenRouter API") || msg.startsWith("AI response")) { // General OpenRouter or AI errors
            descriptiveMessage = error.message;
        } else if (msg.length > 0 && msg.length < 300) { // Show shorter, potentially custom error messages directly
             descriptiveMessage = error.message;
        }
      }

      toast({
        title: "Error Generating Tree",
        description: descriptiveMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <header className="py-6 px-4 md:px-8 border-b border-border">
        <div className="container mx-auto flex items-center gap-3">
          <SubjectArborLogo className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            Subject Arbor
          </h1>
        </div>
      </header>

      <main className="flex-grow container mx-auto p-4 md:p-8">
        <div className="grid md:grid-cols-12 gap-8 h-full">
          <aside className="md:col-span-4 lg:col-span-3">
            <FieldInputForm onSubmit={handleFieldSubmit} isLoading={isLoading} />
          </aside>
          <section className="md:col-span-8 lg:col-span-9">
            <SubjectTreeDisplay treeData={treeData} fieldOfStudy={fieldOfStudy} isLoading={isLoading} />
          </section>
        </div>
      </main>
      
      <footer className="py-6 px-4 md:px-8 border-t border-border mt-auto">
        <div className="container mx-auto text-center text-sm text-muted-foreground">
          <p>&copy; {new Date().getFullYear()} Subject Arbor. Explore knowledge with clarity.</p>
        </div>
      </footer>
    </div>
  );
}
