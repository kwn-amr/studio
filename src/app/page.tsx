
"use client";

import * as React from 'react';
import { FieldInputForm } from '@/components/subject-arbor/FieldInputForm';
import { SubjectTreeDisplay } from '@/components/subject-arbor/SubjectTreeDisplay';
import { SubjectArborLogo } from '@/components/subject-arbor/SubjectArborLogo';
import type { TreeNodeData } from '@/types';
import type { D3HierarchyNode } from '@/components/subject-arbor/D3SubjectGraph'; // Assuming D3HierarchyNode is exported or made available
import { generateSubjectTree, type GenerateSubjectTreeInput, type GenerateSubjectTreeOutput } from '@/ai/flows/generate-subject-tree';
import { generateMoreChildren, type GenerateMoreChildrenInput, type GenerateMoreChildrenOutput } from '@/ai/flows/generate-more-children';
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
import { Settings, Check, Loader2 } from 'lucide-react';

export type ApiProvider = 'openrouter' | 'cerebras';
export type SelectedApiOption = 'openrouter-chutes' | 'openrouter-cerebras' | 'cerebras-direct';

const API_OPTION_DETAILS: Record<SelectedApiOption, { name: string; providerForToast: string; modelForToast: string, apiProvider: ApiProvider, openRouterSubProvider?: string }> = {
  'openrouter-chutes': { name: "OpenRouter (Provider: Chutes, Model: Qwen3-30B)", providerForToast: "OpenRouter (Provider: Chutes)", modelForToast: "Qwen3-30B", apiProvider: 'openrouter', openRouterSubProvider: 'Chutes' },
  'openrouter-cerebras': { name: "OpenRouter (Provider: Cerebras, Model: Qwen3-32B)", providerForToast: "OpenRouter (Provider: Cerebras)", modelForToast: "Qwen3-32B", apiProvider: 'openrouter', openRouterSubProvider: 'Cerebras' },
  'cerebras-direct': { name: "Cerebras (Direct, Model: Qwen-32B)", providerForToast: "Cerebras (Direct)", modelForToast: "Qwen-32B", apiProvider: 'cerebras' },
};


export default function SubjectArborPage() {
  const [fieldOfStudy, setFieldOfStudy] = React.useState<string | null>(null);
  const [treeData, setTreeData] = React.useState<TreeNodeData | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isGeneratingMore, setIsGeneratingMore] = React.useState(false);
  const [selectedApiOption, setSelectedApiOption] = React.useState<SelectedApiOption>('openrouter-chutes');
  const { toast } = useToast();

  React.useEffect(() => {
    const storedOption = localStorage.getItem('selectedApiOption') as SelectedApiOption | null;
    if (storedOption && API_OPTION_DETAILS[storedOption]) {
      setSelectedApiOption(storedOption);
    }
  }, []);

  const handleApiOptionChange = (option: string) => {
    const newOption = option as SelectedApiOption;
    setSelectedApiOption(newOption);
    localStorage.setItem('selectedApiOption', newOption);
    toast({
      title: "AI Backend Updated",
      description: `Switched to ${API_OPTION_DETAILS[newOption].name}.`,
    });
  };

  const handleFieldSubmit = async (submittedField: string) => {
    setIsLoading(true);
    setFieldOfStudy(submittedField);
    setTreeData(null); // Clear previous tree
    const startTime = performance.now();
    
    const currentConfig = API_OPTION_DETAILS[selectedApiOption];

    toast({
      title: "Processing Request",
      description: `Generating subject tree for "${submittedField}" using ${currentConfig.providerForToast} (Model: ${currentConfig.modelForToast}). This may take a moment.`,
    });
      
    try {
      const input: GenerateSubjectTreeInput = { fieldOfStudy: submittedField };
      const resultFromAI: GenerateSubjectTreeOutput = await generateSubjectTree(input, currentConfig.apiProvider, currentConfig.openRouterSubProvider);
      
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
          
          let successDescription = `Subject tree for "${submittedField}" generated in ${durationSeconds}s using ${currentConfig.providerForToast} (Model: ${currentConfig.modelForToast}).`;
          if (resultFromAI.usage) {
            successDescription += ` (Tokens: P${resultFromAI.usage.prompt_tokens}/C${resultFromAI.usage.completion_tokens}/T${resultFromAI.usage.total_tokens})`;
          }
          toast({
            title: "Success!",
            description: successDescription,
            variant: "default",
          });
        } catch (parseError: any) {
          console.error(`Failed to parse tree data string from AI (${currentConfig.providerForToast}):`, parseError, "Received data string (partial):", resultFromAI.treeData.substring(0, 500));
          setTreeData(null);
          let description = `Received data from the AI (${currentConfig.providerForToast}) is not a valid JSON tree structure. Error: ${parseError.message}`;
          toast({ title: "Parsing Error", description: description, variant: "destructive" });
        }
      } else {
        throw new Error(`No tree data string received from AI (${currentConfig.providerForToast}), though the call seemed to succeed.`);
      }
    } catch (error: any) {
      console.error(`Error generating subject tree with ${currentConfig.providerForToast} (Model: ${currentConfig.modelForToast}):`, error);
      setTreeData(null);
      toast({ title: "Error Generating Tree", description: error.message, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateMoreChildren = async (targetNodePath: string[], currentFieldOfStudy: string) => {
      if (!treeData || isGeneratingMore) return;
      setIsGeneratingMore(true);
      const currentConfig = API_OPTION_DETAILS[selectedApiOption];

      let targetNodeRef: TreeNodeData | null = treeData;
      let targetNodeNameForToast = treeData.name;

      // Find the target node in the current treeData using the path
      for (let i = 1; i < targetNodePath.length; i++) { // Start from 1 as path[0] is root
          const childName = targetNodePath[i];
          const foundChild = targetNodeRef?.children?.find(c => c.name === childName);
          if (foundChild) {
              targetNodeRef = foundChild;
          } else {
              targetNodeRef = null;
              break;
          }
      }
      
      if (!targetNodeRef) {
          toast({ title: "Error", description: "Target node not found in the current tree.", variant: "destructive" });
          setIsGeneratingMore(false);
          return;
      }
      targetNodeNameForToast = targetNodeRef.name;

      toast({
          title: "Generating More...",
          description: `Asking AI for more sub-topics for "${targetNodeNameForToast}" using ${currentConfig.providerForToast} (Model: ${currentConfig.modelForToast}).`,
      });

      const input: GenerateMoreChildrenInput = {
          targetNodeName: targetNodeRef.name,
          existingChildrenNames: targetNodeRef.children?.map(c => c.name) || [],
          fieldOfStudy: currentFieldOfStudy,
      };

      try {
          const result: GenerateMoreChildrenOutput = await generateMoreChildren(input, currentConfig.apiProvider, currentConfig.openRouterSubProvider);
          
          if (result.newChildren && result.newChildren.length > 0) {
              // Create a new treeData object to ensure React re-renders
              const newTreeData = JSON.parse(JSON.stringify(treeData)) as TreeNodeData;

              // Find the target node again in the newTreeData (cloned copy)
              let modifiableTargetNodeRef: TreeNodeData | null = newTreeData;
              for (let i = 1; i < targetNodePath.length; i++) {
                  const childName = targetNodePath[i];
                  const foundChild = modifiableTargetNodeRef?.children?.find(c => c.name === childName);
                  if (foundChild) {
                      modifiableTargetNodeRef = foundChild;
                  } else {
                      modifiableTargetNodeRef = null;
                      break;
                  }
              }

              if (modifiableTargetNodeRef) {
                  if (!modifiableTargetNodeRef.children) {
                      modifiableTargetNodeRef.children = [];
                  }
                  // Filter out duplicates just in case AI returns existing names despite prompt
                  const uniqueNewChildren = result.newChildren.filter(
                      newChild => !modifiableTargetNodeRef!.children!.some(existing => existing.name === newChild.name)
                  );
                  modifiableTargetNodeRef.children.push(...uniqueNewChildren);
                  setTreeData(newTreeData); // This will trigger re-render of D3 graph
                  
                  let successMsg = `Added ${uniqueNewChildren.length} new sub-topic(s) to "${targetNodeNameForToast}".`;
                   if (result.usage) {
                       successMsg += ` (Tokens: P${result.usage.prompt_tokens}/C${result.usage.completion_tokens}/T${result.usage.total_tokens})`;
                   }
                  toast({ title: "Success!", description: successMsg });
              } else {
                  throw new Error("Failed to find target node in cloned tree data for update.");
              }
          } else {
              toast({ title: "No New Sub-topics", description: `The AI did not generate additional sub-topics for "${targetNodeNameForToast}". It might be fully explored or the AI couldn't find more distinct topics.` });
          }
      } catch (error: any) {
          console.error("Error generating more children:", error);
          toast({ title: "Error Adding Sub-topics", description: error.message, variant: "destructive" });
      } finally {
          setIsGeneratingMore(false);
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
            <DropdownMenuContent align="end" className="w-96"> {/* Increased width for longer text */}
              <DropdownMenuLabel>AI Backend Configuration</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup value={selectedApiOption} onValueChange={handleApiOptionChange}>
                {(Object.keys(API_OPTION_DETAILS) as SelectedApiOption[]).map(optionKey => (
                  <DropdownMenuRadioItem key={optionKey} value={optionKey} className="text-xs">
                    {API_OPTION_DETAILS[optionKey].name}
                    {selectedApiOption === optionKey && <Check className="ml-auto h-4 w-4" />}
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
            <SubjectTreeDisplay 
              treeData={treeData} 
              fieldOfStudy={fieldOfStudy} 
              isLoading={isLoading || isGeneratingMore} 
              onGenerateMoreChildren={handleGenerateMoreChildren}
            />
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

    