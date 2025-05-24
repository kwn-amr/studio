
"use client";

import * as React from 'react';
import { FieldInputForm } from '@/components/subject-arbor/FieldInputForm';
import { SubjectTreeDisplay } from '@/components/subject-arbor/SubjectTreeDisplay';
import { SubjectArborLogo } from '@/components/subject-arbor/SubjectArborLogo';
import type { TreeNodeData } from '@/types';
import { generateSubjectTree, type GenerateSubjectTreeInput } from '@/ai/flows/generate-subject-tree';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Settings, Check } from 'lucide-react';

export type ApiProvider = 'openrouter' | 'cerebras';

export default function SubjectArborPage() {
  const [fieldOfStudy, setFieldOfStudy] = React.useState<string | null>(null);
  const [treeData, setTreeData] = React.useState<TreeNodeData | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [apiProvider, setApiProvider] = React.useState<ApiProvider>('openrouter');
  const { toast } = useToast();

  React.useEffect(() => {
    const storedProvider = localStorage.getItem('apiProvider') as ApiProvider | null;
    if (storedProvider && (storedProvider === 'openrouter' || storedProvider === 'cerebras')) {
      setApiProvider(storedProvider);
    }
  }, []);

  const handleApiProviderChange = (provider: string) => {
    const newProvider = provider as ApiProvider;
    setApiProvider(newProvider);
    localStorage.setItem('apiProvider', newProvider);
    toast({
      title: "API Provider Updated",
      description: `Switched to ${newProvider === 'openrouter' ? 'OpenRouter (targeting Cerebras)' : 'Cerebras (Direct)'} API.`,
    });
  };

  const handleFieldSubmit = async (submittedField: string) => {
    setIsLoading(true);
    setFieldOfStudy(submittedField);
    setTreeData(null);
    const startTime = performance.now();
    
    try {
      let processingMessage = `Generating subject tree for "${submittedField}" using `;
      if (apiProvider === 'openrouter') {
        processingMessage += 'OpenRouter (targeting Cerebras provider)...';
      } else {
        processingMessage += 'Cerebras (Direct)...';
      }
      processingMessage += ' This may take a moment.';

      toast({
        title: "Processing Request",
        description: processingMessage,
      });
      
      const input: GenerateSubjectTreeInput = { fieldOfStudy: submittedField };
      const resultFromAI = await generateSubjectTree(input, apiProvider);
      
      if (resultFromAI.treeData) {
        try {
          const parsedData = JSON.parse(resultFromAI.treeData) as TreeNodeData;
          
          if (typeof parsedData.name !== 'string' || !Array.isArray(parsedData.children)) {
            console.error("Parsed data is missing 'name' or 'children' array at the root.", parsedData);
            throw new Error("The AI's response, while valid JSON, does not match the expected tree structure (missing root 'name' or 'children').");
          }
          setTreeData(parsedData);
          const endTime = performance.now();
          const durationSeconds = ((endTime - startTime) / 1000).toFixed(2);
          
          let successDescription = `Subject tree for "${submittedField}" generated in ${durationSeconds}s using `;
          if (apiProvider === 'openrouter') {
            successDescription += 'OpenRouter (Cerebras provider).';
          } else {
            successDescription += 'Cerebras (Direct).';
          }

          toast({
            title: "Success!",
            description: successDescription,
            variant: "default",
          });
        } catch (parseError: any) {
          console.error(`Failed to parse tree data string from AI (${apiProvider}):`, parseError, "Received data string (partial):", resultFromAI.treeData.substring(0, 500));
          setTreeData(null);
          let description = `Received data from the AI (${apiProvider}) is not a valid JSON tree structure. Please try again or a different query.`;
          if (parseError.message.includes("does not match the expected tree structure")) {
            description = parseError.message; 
          } else if (parseError instanceof SyntaxError && resultFromAI.treeData) {
             description = `The AI's response (${apiProvider}) was a string that could not be parsed as JSON. Received (partial): ${resultFromAI.treeData.substring(0,100)}... Error: ${parseError.message}`;
          } else {
            description = `Error parsing AI's JSON response (${apiProvider}): ${parseError.message}`;
          }
          toast({
            title: "Parsing Error",
            description: description,
            variant: "destructive",
          });
        }
      } else {
        throw new Error(`No tree data string received from AI (${apiProvider}), though the call seemed to succeed.`);
      }
    } catch (error: any) {
      console.error(`Error generating subject tree with ${apiProvider}:`, error);
      setTreeData(null);
      
      let descriptiveMessage = `An unexpected error occurred while generating the subject tree using ${apiProvider === 'openrouter' ? 'OpenRouter (Cerebras provider)' : 'Cerebras (Direct)'}. Please try again.`;

      if (error && typeof error.message === 'string') {
        const msg = error.message;
        if (msg.includes("API key is not configured")) {
            descriptiveMessage = `${apiProvider === 'openrouter' ? 'OpenRouter' : 'Cerebras'} API key is not configured. Please check your .env file.`;
        } else if (msg.includes("API request failed with status 401")) {
            descriptiveMessage = `${apiProvider === 'openrouter' ? 'OpenRouter' : 'Cerebras'} API authentication failed (401). Check your API key.`;
        } else if (msg.includes("API request failed with status 429")) {
            descriptiveMessage = `${apiProvider === 'openrouter' ? 'OpenRouter' : 'Cerebras'} API rate limit exceeded (429). Please try again later or check your plan.`;
        } else if (msg.includes("API error") && (msg.includes("Provider returned error") || msg.includes("Recursive schemas are currently not supported"))) {
            descriptiveMessage = "The AI model provider encountered an issue. This might be temporary or a model/provider limitation. Details: " + msg;
        } else if (msg.includes("Failed to parse") || msg.includes("did not yield a parsable JSON string")) {
            descriptiveMessage = "The AI's response could not be processed into a valid subject tree. Details: " + msg;
        } else if (msg.includes("was not valid JSON") || msg.includes("does not match the expected tree structure")) {
            descriptiveMessage = "The AI's response was not a valid or correctly structured subject tree. Details: " + msg;
        } else if (msg.startsWith("API") || msg.startsWith("AI response") || msg.startsWith("OpenRouter API error") || msg.startsWith("Cerebras API error")) { 
            descriptiveMessage = error.message;
        } else if (msg.length > 0 && msg.length < 300) {
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
        <div className="container mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <SubjectArborLogo className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold tracking-tight text-foreground">
              Subject Arbor
            </h1>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="rounded-full">
                <Settings className="h-5 w-5" />
                <span className="sr-only">Open API Provider Settings</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>AI Provider</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={apiProvider} onValueChange={handleApiProviderChange}>
                <DropdownMenuRadioItem value="openrouter">
                  OpenRouter (Cerebras)
                  {apiProvider === 'openrouter' && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="cerebras">
                  Cerebras (Direct)
                  {apiProvider === 'cerebras' && <Check className="ml-auto h-4 w-4" />}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
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
