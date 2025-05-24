
"use client";

import * as React from 'react';
import { FieldInputForm } from '@/components/subject-arbor/FieldInputForm';
import { SubjectTreeDisplay } from '@/components/subject-arbor/SubjectTreeDisplay';
import { SubjectArborLogo } from '@/components/subject-arbor/SubjectArborLogo';
import type { TreeNodeData } from '@/types';
import { generateSubjectTree, type GenerateSubjectTreeInput, type GenerateSubjectTreeOutput } from '@/ai/flows/generate-subject-tree';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Settings } from 'lucide-react';

type ApiOptionValue = "openrouter-chutes" | "openrouter-cerebras" | "cerebras-direct";

const API_OPTIONS: Array<{ value: ApiOptionValue; label: string; model: string; defaultProvider?: string }> = [
  { value: "openrouter-chutes", label: "OpenRouter (Provider: Chutes)", model: "Qwen3-30B", defaultProvider: "Chutes" },
  { value: "openrouter-cerebras", label: "OpenRouter (Provider: Cerebras)", model: "Llama3.3-70B", defaultProvider: "Cerebras" },
  { value: "cerebras-direct", label: "Cerebras (Direct)", model: "Qwen-32B" },
];

export default function SubjectArborPage() {
  const [fieldOfStudy, setFieldOfStudy] = React.useState<string | null>(null);
  const [treeData, setTreeData] = React.useState<TreeNodeData | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const { toast } = useToast();
  const [selectedApiOption, setSelectedApiOption] = React.useState<ApiOptionValue>(API_OPTIONS[0].value);

  React.useEffect(() => {
    const storedApiOption = localStorage.getItem('subjectArborApiOption') as ApiOptionValue | null;
    if (storedApiOption && API_OPTIONS.some(opt => opt.value === storedApiOption)) {
      setSelectedApiOption(storedApiOption);
    }
  }, []);

  const handleApiOptionChange = (value: string) => {
    const newOption = value as ApiOptionValue;
    setSelectedApiOption(newOption);
    localStorage.setItem('subjectArborApiOption', newOption);
    toast({
      title: "API Provider Changed",
      description: `Switched to ${API_OPTIONS.find(opt => opt.value === newOption)?.label || 'selected provider'}.`,
    });
  };

  const handleFieldSubmit = async (submittedField: string) => {
    setIsLoading(true);
    setFieldOfStudy(submittedField);
    setTreeData(null);
    const startTime = performance.now();

    const currentOptionDetails = API_OPTIONS.find(opt => opt.value === selectedApiOption) || API_OPTIONS[0];
    let apiProvider: 'openrouter' | 'cerebras' = 'openrouter';
    let openRouterSpecificProvider: string | undefined = undefined;
    let toastProviderName = currentOptionDetails.label;

    if (selectedApiOption === 'cerebras-direct') {
      apiProvider = 'cerebras';
      toastProviderName = `Cerebras (Direct - ${currentOptionDetails.model})`;
    } else if (selectedApiOption === 'openrouter-chutes') {
      apiProvider = 'openrouter';
      openRouterSpecificProvider = 'Chutes';
      toastProviderName = `OpenRouter (Provider: Chutes, Model: ${currentOptionDetails.model})`;
    } else if (selectedApiOption === 'openrouter-cerebras') {
      apiProvider = 'openrouter';
      openRouterSpecificProvider = 'Cerebras';
      toastProviderName = `OpenRouter (Provider: Cerebras, Model: ${currentOptionDetails.model})`;
    }
    
    toast({
      title: "Processing Request",
      description: `Generating subject tree for "${submittedField}" using ${toastProviderName}. This may take a moment.`,
    });
      
    try {
      const input: GenerateSubjectTreeInput = { 
        fieldOfStudy: submittedField,
        apiProvider: apiProvider,
        openRouterSpecificProvider: openRouterSpecificProvider
      };
      const resultFromAI: GenerateSubjectTreeOutput = await generateSubjectTree(input);
      
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
          
          let successDescription = `Subject tree for "${submittedField}" generated in ${durationSeconds}s using ${toastProviderName}.`;
          if (resultFromAI.usage) {
            successDescription += ` (Tokens: P:${resultFromAI.usage.prompt_tokens}/C:${resultFromAI.usage.completion_tokens}/T:${resultFromAI.usage.total_tokens})`;
          }

          toast({
            title: "Success!",
            description: successDescription,
            variant: "default",
          });
        } catch (parseError: any) {
          console.error("Failed to parse tree data string from AI:", parseError, "Received data string (partial):", resultFromAI.treeData.substring(0, 500));
          setTreeData(null);
          let description = "Received data from the AI is not a valid JSON tree structure. Please try again or a different query.";
          if (parseError.message.includes("does not match the expected tree structure")) {
            description = parseError.message; 
          } else if (parseError instanceof SyntaxError && resultFromAI.treeData) {
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
        throw new Error("No tree data string received from AI, though the call seemed to succeed.");
      }
    } catch (error: any) {
      console.error(`Error generating subject tree with ${toastProviderName}:`, error);
      setTreeData(null);
      
      let descriptiveMessage = `An unexpected error occurred while generating the subject tree using ${toastProviderName}. Please try again.`;

      if (error && typeof error.message === 'string') {
        const msg = error.message;
        if (msg.includes("API key is not configured")) {
            descriptiveMessage = `${apiProvider === 'cerebras' ? 'Cerebras' : 'OpenRouter'} API key is not configured. Please check your .env file.`;
        } else if (msg.includes("API authentication failed (401)")) {
            descriptiveMessage = `${apiProvider === 'cerebras' ? 'Cerebras' : 'OpenRouter'} API authentication failed (401). Check your API key.`;
        } else if (msg.includes("API rate limit exceeded (429)")) {
            descriptiveMessage = `${apiProvider === 'cerebras' ? 'Cerebras' : 'OpenRouter'} API rate limit exceeded (429). Please try again later or check your plan.`;
        } else if (msg.includes("404") && msg.includes("No allowed providers")) {
             descriptiveMessage = `OpenRouter Error (404): The selected model/provider combination (${currentOptionDetails.model} via ${openRouterSpecificProvider}) is not available. Please try a different configuration.`;
        } else if (msg.includes("Recursive schemas are currently not supported")) {
            descriptiveMessage = `OpenRouter API error (400): The provider (${openRouterSpecificProvider}) does not support the recursive JSON schema needed for this request with model ${currentOptionDetails.model}. Try a different OpenRouter provider or the Direct Cerebras API.`;
        } else if (msg.includes("Failed to parse") || msg.includes("did not yield a parsable JSON string") || msg.includes("was not valid JSON") || msg.includes("does not match the expected tree structure") || msg.includes("does not appear to contain a parsable JSON object or array") || msg.startsWith("The AI's response was entirely non-JSON")) {
            descriptiveMessage = `The AI's response could not be processed into a valid subject tree. Details: ${msg}`;
        } else if (msg.startsWith("Cerebras API") || msg.startsWith("OpenRouter API") || msg.startsWith("AI response")) { 
            descriptiveMessage = error.message; 
        } else if (msg.length > 0 && msg.length < 400) { 
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
                <span className="sr-only">API Provider Settings</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Select AI Backend</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={selectedApiOption} onValueChange={handleApiOptionChange}>
                {API_OPTIONS.map(option => (
                  <DropdownMenuRadioItem key={option.value} value={option.value}>
                    {option.label} ({option.model})
                  </DropdownMenuRadioItem>
                ))}
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
    
