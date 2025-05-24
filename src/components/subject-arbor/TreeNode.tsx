
"use client";

import * as React from 'react';
import type { TreeNodeData } from '@/types';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface TreeNodeProps {
  node: TreeNodeData;
  level: number;
  defaultExpanded?: boolean;
}

export function TreeNode({ node, level, defaultExpanded = false }: TreeNodeProps) {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  const hasChildren = node.children && node.children.length > 0;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation(); 
    if (hasChildren) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <li className={cn("my-1 list-none", level > 0 && "ml-2 pl-6 relative before:absolute before:left-2 before:top-0 before:h-full before:w-px before:bg-border")}>
      <div className="flex items-center group">
        {hasChildren ? (
          <Button
            variant="ghost"
            size="icon"
            onClick={handleToggle}
            className="h-7 w-7 mr-1 shrink-0"
            aria-expanded={isExpanded}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
          >
            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </Button>
        ) : (
          <span className="inline-block w-7 h-7 mr-1 shrink-0"></span> 
        )}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="text-sm font-medium py-1 px-2 rounded-md hover:bg-accent/50 cursor-default break-words">
                {node.name}
              </span>
            </TooltipTrigger>
            <TooltipContent 
              side="right" 
              className="bg-popover text-popover-foreground p-2 rounded-md shadow-lg max-w-xs break-words"
            >
              <p className="font-semibold">{node.name}</p>
              {node.description && (
                <p className="text-xs text-muted-foreground mt-1">
                  {node.description}
                </p>
              )}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      {hasChildren && isExpanded && (
        <ul className="mt-1">
          {node.children?.map((childNode, index) => (
            <TreeNode key={`${childNode.name}-${index}-${level}`} node={childNode} level={level + 1} defaultExpanded={false} />
          ))}
        </ul>
      )}
    </li>
  );
}
