
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
        description: `Generating subject tree for "${submittedField}"...`,
      });
      const result = await generateSubjectTree({ fieldOfStudy: submittedField });
      
      if (result.treeData) {
        try {
          const parsedData = JSON.parse(result.treeData) as TreeNodeData;
          setTreeData(parsedData);
          toast({
            title: "Success!",
            description: `Subject tree for "${submittedField}" generated.`,
            variant: "default",
          });
        } catch (parseError) {
          console.error("Failed to parse tree data:", parseError, "Received data:", result.treeData.substring(0, 500));
          setTreeData(null);
          toast({
            title: "Parsing Error",
            description: "Received data from the AI is not a valid JSON tree structure. Please try again or a different query.",
            variant: "destructive",
          });
        }
      } else {
        // This case should ideally be caught by generateSubjectTree throwing an error
        throw new Error("No tree data received from AI, though the call succeeded.");
      }
    } catch (error: any) {
      console.error("Error generating subject tree:", error);
      setTreeData(null);
      
      let descriptiveMessage = "An unexpected error occurred while generating the subject tree. Please try again.";

      if (error && typeof error.message === 'string') {
        const msg = error.message.toLowerCase();
        // Check for specific error messages from generateSubjectTree or common issues
        if (msg.includes("quota") || msg.includes("limit") || msg.includes("rate limit exceeded")) {
          descriptiveMessage = "API rate limit exceeded. Please try again later.";
        } else if (msg.includes("api key") || msg.includes("authentication failed")) {
          descriptiveMessage = "API authentication failed. Please check your API key or contact support.";
        } else if (msg.includes("empty response")) {
            descriptiveMessage = "The AI model returned an empty response. It might be unable to process this request for the given field of study.";
        } else if (msg.includes("not a valid json") || msg.includes("not appear to be a valid json")) {
            descriptiveMessage = "The AI model's response was not in the expected JSON format. Please try a different query or try again later.";
        } else if (msg.startsWith("cerebras api error:") || msg.startsWith("cerebras api key is not configured")) {
             // Use the message as is if it's a specific error from our flow or Cerebras client
            descriptiveMessage = error.message;
        } else if (msg.length > 0 && msg.length < 200) { // Generic JS error message if it's reasonable
             descriptiveMessage = error.message;
        }
        // else, the default generic message "An unexpected error occurred..." remains.
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
