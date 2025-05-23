
"use client";

import * as React from 'react';
import type { TreeNodeData } from '@/types';
import { TreeNode } from './TreeNode';
import { SubjectNodeGraph } from './SubjectNodeGraph';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SubjectTreeDisplayProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string | null;
  isLoading: boolean;
}

export function SubjectTreeDisplay({ treeData, fieldOfStudy, isLoading }: SubjectTreeDisplayProps) {
  const handleExportJson = () => {
    if (!treeData) return;
    const jsonString = JSON.stringify(treeData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fieldOfStudy ? fieldOfStudy.toLowerCase().replace(/\s+/g, '_') : 'subject'}_tree.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const commonHeightClass = "h-[calc(100vh-22rem)] md:h-[calc(100vh-16rem)]"; // Adjusted for tabs

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xl font-semibold">
          {fieldOfStudy ? `Subject Map for ${fieldOfStudy}` : 'Subject Map'}
        </CardTitle>
        {treeData && !isLoading && (
          <Button variant="outline" size="sm" onClick={handleExportJson} className="ml-auto">
            <Download className="mr-2 h-4 w-4" />
            Export JSON
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex-grow p-0 flex flex-col">
        {isLoading && <p className="text-muted-foreground text-center py-10">Generating tree, please wait...</p>}
        {!isLoading && !treeData && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-network mb-4 text-muted-foreground opacity-50" data-ai-hint="tree diagram"><path d="M16 5C16 3.34315 14.6569 2 13 2C11.3431 2 10 3.34315 10 5C10 6.65685 11.3431 8 13 8C14.6569 8 16 6.65685 16 5Z"/><path d="M12 12.5L12 8"/><path d="M5 19C5 17.3431 6.34315 16 8 16C9.65685 16 11 17.3431 11 19C11 20.6569 9.65685 22 8 22C6.34315 22 5 20.6569 5 19Z"/><path d="M13 19C13 17.3431 14.3431 16 16 16C17.6569 16 19 17.3431 19 19C19 20.6569 17.6569 22 16 22C14.3431 22 13 20.6569 13 19Z"/><path d="M12 12.5L8 16"/><path d="M12 12.5L16 16"/></svg>
            <p className="text-muted-foreground">
              Select or enter a field of study and click &quot;Generate Tree&quot; to visualize the subject hierarchy.
            </p>
          </div>
        )}
        {treeData && !isLoading && (
          <Tabs defaultValue="list" className="w-full flex flex-col flex-grow p-6 pt-2">
            <TabsList className="mb-4 self-start">
              <TabsTrigger value="list">List View</TabsTrigger>
              <TabsTrigger value="graph">Graph View</TabsTrigger>
            </TabsList>
            <TabsContent value="list" className="flex-grow overflow-hidden">
              <ScrollArea className={commonHeightClass}>
                <ul>
                  <TreeNode node={treeData} level={0} defaultExpanded={false} />
                </ul>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="graph" className={`flex-grow overflow-hidden ${commonHeightClass}`}>
              <SubjectNodeGraph treeData={treeData} />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
