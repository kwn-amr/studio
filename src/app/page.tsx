
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
          console.error("Failed to parse tree data:", parseError);
          setTreeData(null);
          toast({
            title: "Parsing Error",
            description: "Received data is not a valid JSON tree structure. Please try again.",
            variant: "destructive",
          });
        }
      } else {
        throw new Error("No tree data received from AI.");
      }
    } catch (error) {
      console.error("Error generating subject tree:", error);
      setTreeData(null);
      let errorMessage = "An unexpected error occurred. Please check the console for details or try a different query.";
      if (error instanceof Error) {
        // Try to provide a more user-friendly message for common issues
        if (error.message.includes("quota") || error.message.includes("limit")) {
             errorMessage = "API quota exceeded. Please try again later.";
        } else if (error.message.includes("API key")) {
             errorMessage = "API key issue. Please contact support.";
        } else if (result && (result as any).error) { // Check if AI flow returned an error object
            errorMessage = (result as any).error.message || errorMessage;
        } else {
            errorMessage = "Failed to generate tree. The AI model might be unable to process this request or there was a network issue.";
        }
      }
      toast({
        title: "Error Generating Tree",
        description: errorMessage,
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
