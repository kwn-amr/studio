
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNodeData } from '@/types';
import { Button } from '@/components/ui/button';
import { ImageIcon, Minimize, Maximize, PlusCircle, Loader2 } from 'lucide-react';
import { toPng } from 'html-to-image';

export interface D3HierarchyNode extends d3.HierarchyPointNode<TreeNodeData> {
  _children?: D3HierarchyNode[];
  children?: D3HierarchyNode[];
  x0?: number;
  y0?: number;
  id?: string;
  isGeneratingMore?: boolean;
}

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
  fieldOfStudy: string;
  onGenerateMoreChildren: (targetNodePath: string[], fieldOfStudy: string) => Promise<void>;
  isProcessingAction?: boolean;
}

export function D3SubjectGraph({ treeData, fieldOfStudy, onGenerateMoreChildren, isProcessingAction }: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const graphWrapperRef = useRef<HTMLDivElement>(null);

  const [isFullyExpanded, setIsFullyExpanded] = useState(false);
  const [activeNodeForMore, setActiveNodeForMore] = useState<string | null>(null);

  const d3State = useRef<{
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null;
    g: d3.Selection<SVGGElement, unknown, null, undefined> | null;
    root: D3HierarchyNode | null;
    treeLayout: d3.TreeLayout<TreeNodeData> | null;
    zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null;
    i: number;
    dimensions: { width: number; height: number };
    margin: { top: number; right: number; bottom: number; left: number };
  }>({
    svg: null,
    g: null,
    root: null,
    treeLayout: null,
    zoomBehavior: null,
    i: 0,
    dimensions: {width: 0, height: 0},
    margin: { top: 20, right: 180, bottom: 20, left: 120 }
  });

  const animationDuration = 750;
  const nodeRadius = 6;
  const generateMoreButtonRadius = 8;

  const getContainerDimensions = useCallback(() => {
    if (graphWrapperRef.current) {
      const parent = graphWrapperRef.current;
      return {
        width: parent.clientWidth,
        height: parent.clientHeight,
      };
    }
    return { width: 600, height: 400 };
  }, []);

  const updateChart = useCallback((sourceNode?: D3HierarchyNode) => {
    if (!d3State.current.g || !d3State.current.root || !d3State.current.treeLayout || !tooltipRef.current || !graphWrapperRef.current) return;

    const g = d3State.current.g;
    let rootNode = d3State.current.root;
    const treeLayout = d3State.current.treeLayout;
    const tooltip = d3.select(tooltipRef.current);
    const currentGraphWrapper = graphWrapperRef.current;

    if (treeData && d3State.current.root?.data !== treeData) {
        rootNode = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
        rootNode.x0 = d3State.current.root?.x0 || d3State.current.dimensions.height / 2;
        rootNode.y0 = d3State.current.root?.y0 || 0;
        d3State.current.root = rootNode;
        // Preserve expansion state or handle based on sourceNode
        if (sourceNode && sourceNode.id) {
            const findAndApplyExpansion = (node: D3HierarchyNode, targetId: string, isExpanded: boolean) => {
                if (node.id === targetId) {
                    if (isExpanded && node._children) {
                        node.children = node._children;
                        node._children = undefined;
                    } else if (!isExpanded && node.children) {
                        node._children = node.children;
                        node.children = undefined;
                    }
                    return;
                }
                if (node.children) node.children.forEach(child => findAndApplyExpansion(child, targetId, isExpanded));
                // also check _children if we are trying to expand a collapsed node that was the source
                else if (node._children && isExpanded) node._children.forEach(child => findAndApplyExpansion(child, targetId, isExpanded));
            };
            // Assuming sourceNode.children implies it's expanded, sourceNode._children implies collapsed
            // This might need more robust state tracking if expansion isn't just children/_children
            // findAndApplyExpansion(rootNode, sourceNode.id, !!sourceNode.children);
        }
    }
    if (!rootNode) return;

    const treeDataLayout = treeLayout(rootNode);
    const nodes = treeDataLayout.descendants() as D3HierarchyNode[];
    const links = treeDataLayout.links() as d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>[];

    const effectiveSource = sourceNode || rootNode;

    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id || (d.id = `${d.data.name.replace(/\s+/g, '-')}-${d.depth}-${++d3State.current.i}`));

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || 0},${effectiveSource.x0 || 0})`)
      .on('click', (event, d) => {
        if (d3.select(event.target).classed('generate-more-button-hitbox') || d3.select(event.target.parentNode).classed('generate-more-group')) {
          return;
        }
        handleClick(d);
      })
      .on('mouseover', function(event, dNode) {
        const [mx, my] = d3.pointer(event, currentGraphWrapper);
        let tooltipContent = `<strong>${dNode.data.name}</strong>`;
        if (dNode.data.description && dNode.data.description.trim() !== '') {
          tooltipContent += `<br><small style="display: block; margin-top: 4px; color: hsl(var(--muted-foreground));">${dNode.data.description.trim()}</small>`;
        }
        
        const tooltipNode = tooltip.node() as HTMLDivElement;
        tooltip.html(tooltipContent)
               .style('opacity', 1);

        // Position tooltip, checking for overflow
        const tooltipWidth = tooltipNode.offsetWidth;
        const tooltipHeight = tooltipNode.offsetHeight; // For potential vertical flipping
        const wrapperWidth = currentGraphWrapper.clientWidth;
        const wrapperHeight = currentGraphWrapper.clientHeight;

        let left = mx + 15;
        let top = my + 10;

        if (left + tooltipWidth > wrapperWidth) {
            left = mx - tooltipWidth - 15; // Flip to left of cursor
        }
        if (left < 0) left = 5; // Prevent going off left edge

        if (top + tooltipHeight > wrapperHeight) {
            top = my - tooltipHeight - 10; // Flip above cursor
        }
        if (top < 0) top = 5; // Prevent going off top edge
        
        tooltip.style('left', left + 'px')
               .style('top', top + 'px');
        
        d3.select(this).select('circle.node-main-circle').classed('hovered', true);
        d3.select(this).selectChild('.generate-more-group').classed('generate-more-visible', true);
        g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
            .classed('highlighted', l => l.source === dNode || l.target === dNode);
      })
      .on('mouseout', function() {
        tooltip.style('opacity', 0);
        d3.select(this).select('circle.node-main-circle').classed('hovered', false);
        d3.select(this).selectChild('.generate-more-group').classed('generate-more-visible', false);
        g.selectAll('path.link').classed('highlighted', false);
      });

    nodeEnter.append('circle')
      .attr('class', 'node-main-circle')
      .attr('r', 1e-6);

    nodeEnter.append('text')
      .attr('dy', '.35em')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .text(d => d.data.name);

    const generateMoreGroup = nodeEnter.append('g')
      .attr('class', 'generate-more-group')
      .style('cursor', 'pointer')
      .attr('transform', `translate(${nodeRadius + generateMoreButtonRadius + 3}, 0)`)
      .on('click', async (event, dNode) => {
        event.stopPropagation();
        if (activeNodeForMore === dNode.id || isProcessingAction || dNode.isGeneratingMore) return;
        
        setActiveNodeForMore(dNode.id!);
        dNode.isGeneratingMore = true;
        updateChart(dNode); // Re-render to show loader
        
        try {
          // Construct path for the target node
          const path: string[] = [];
          let current: D3HierarchyNode | null = dNode;
          while (current) {
            path.unshift(current.data.name);
            current = current.parent;
          }
          await onGenerateMoreChildren(path, fieldOfStudy);
        } catch (err) {
          console.error("Error generating more children from D3 graph:", err);
        } finally {
          // State update from parent will cause re-render, so dNode.isGeneratingMore might be stale
          // We rely on the parent component to clear isGeneratingMore status
          // For safety, ensure this node's state is reset if it's still the active one
           if(activeNodeForMore === dNode.id) {
            // dNode.isGeneratingMore = false; // This change needs to be on the main treeData
            setActiveNodeForMore(null);
           }
           // The updateChart will be called naturally by treeData prop change.
        }
      });

    generateMoreGroup.append('circle')
      .attr('class', 'generate-more-button-hitbox')
      .attr('r', generateMoreButtonRadius + 2)
      .style('fill', 'transparent');

    generateMoreGroup.append('g')
      .attr('class', 'plus-icon-group')
      .append('path')
      .attr('d', PlusCircle.path)
      .attr('transform', `translate(${-generateMoreButtonRadius}, ${-generateMoreButtonRadius}) scale(0.7)`);

    generateMoreGroup.append('g')
      .attr('class', 'loader-icon-group')
      .style('display', 'none')
      .append('path')
      .attr('d', Loader2.path)
      .attr('class', 'animate-spin')
      .attr('transform', `translate(${-generateMoreButtonRadius}, ${-generateMoreButtonRadius}) scale(0.7)`);

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition()
      .duration(animationDuration)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    nodeUpdate.select<SVGCircleElement>('circle.node-main-circle')
      .attr('r', nodeRadius)
      .attr('class', d => {
        let classes = 'node-main-circle ';
        classes += (d.children || d._children) ? 'node-interactive' : 'node-leaf';
        if (d._children) classes += ' collapsed'; else if (d.children) classes += ' expanded';
        return classes;
      });

    nodeUpdate.select<SVGGElement>('.generate-more-group')
      .select('.plus-icon-group')
      .style('display', d => d.isGeneratingMore ? 'none' : 'block');

    nodeUpdate.select<SVGGElement>('.generate-more-group')
      .select('.loader-icon-group')
      .style('display', d => d.isGeneratingMore ? 'block' : 'none');

    nodeUpdate.select('text')
      .style('fill-opacity', 1);

    const nodeExit = node.exit().transition()
      .duration(animationDuration)
      .attr('transform', `translate(${effectiveSource.y || 0},${effectiveSource.x0 || 0})`)
      .remove();

    nodeExit.select('circle').attr('r', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    const link = g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
      .data(links, d => d.target.id!);

    const linkEnter = link.enter().insert('path', 'g')
      .attr('class', 'link')
      .attr('d', () => {
        const o = { x: effectiveSource.x0 || 0, y: effectiveSource.y0 || 0 };
        return d3.linkHorizontal<any, {x:number, y:number}>().x(dNode => dNode.y).y(dNode => dNode.x)({ source: o, target: o });
      });

    linkEnter.merge(link)
      .transition()
      .duration(animationDuration)
      .attr('d', d3.linkHorizontal<any, D3HierarchyNode, D3HierarchyNode>()
          .x(dNode => dNode.y!)
          .y(dNode => dNode.x!)
      );

    link.exit().transition()
      .duration(animationDuration)
      .attr('d', () => {
        const o = { x: effectiveSource.x || 0, y: effectiveSource.y || 0 };
        return d3.linkHorizontal<any, {x:number, y:number}>().x(dNode => dNode.y).y(dNode => dNode.x)({ source: o, target: o });
      })
      .remove();

    nodes.forEach(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  }, [animationDuration, nodeRadius, onGenerateMoreChildren, fieldOfStudy, treeData, activeNodeForMore, isProcessingAction]);

  const collapse = useCallback((d: D3HierarchyNode) => {
    if (d.children) {
      d._children = d.children;
      d.children = undefined;
    }
  }, []);

  const collapseAll = useCallback((d: D3HierarchyNode, keepRootChildren = false) => {
    if (d.children) {
      if (!keepRootChildren || d !== d3State.current.root) {
        d._children = d.children;
        d.children.forEach(child => collapseAll(child, false));
        d.children = undefined;
      } else { // Is root and we keep root children expanded
        d.children.forEach(child => collapseAll(child, false)); // Collapse children of root's children
      }
    }
  }, []);


  const expand = useCallback((d: D3HierarchyNode) => {
    if (d._children) {
      d.children = d._children;
      d._children = undefined;
    }
  }, []);

  const expandAll = useCallback((d: D3HierarchyNode) => {
    if (d._children) {
        d.children = d._children;
        d._children = undefined;
    }
    if (d.children) {
        d.children.forEach(expandAll);
    }
  }, []);

  const handleClick = useCallback((d: D3HierarchyNode) => {
    if (d.children) {
      collapse(d);
    } else if (d._children) {
      expand(d);
    }
    updateChart(d);
  }, [updateChart, collapse, expand]);

  const handleToggleExpandAll = () => {
    if (!d3State.current.root) return;
    if (isFullyExpanded) {
      collapseAll(d3State.current.root, true);
    } else {
      expandAll(d3State.current.root);
    }
    setIsFullyExpanded(!isFullyExpanded);
    updateChart(d3State.current.root);
  };

  const handleExportPng = useCallback(() => {
    if (svgRef.current && graphWrapperRef.current) {
      const wrapperStyle = getComputedStyle(graphWrapperRef.current);
      const backgroundColor = wrapperStyle.backgroundColor;
      
      toPng(svgRef.current, {
          backgroundColor: backgroundColor,
          pixelRatio: 2
      })
        .then((dataUrl) => {
          const link = document.createElement('a');
          link.download = `${fieldOfStudy.toLowerCase().replace(/\s+/g, '_')}_graph.png`;
          link.href = dataUrl;
          link.click();
        })
        .catch((err) => {
          console.error('Failed to export PNG:', err);
        });
    }
  }, [fieldOfStudy]);

  useEffect(() => {
    const initOrResize = () => {
        if (!svgRef.current || !graphWrapperRef.current) return;
        d3State.current.dimensions = getContainerDimensions();
        const { width, height } = d3State.current.dimensions;
        const { margin } = d3State.current;

        const svg = d3.select(svgRef.current)
            .attr('width', width)
            .attr('height', height);

        if (!d3State.current.svg) {
            d3State.current.svg = svg;
            d3State.current.zoomBehavior = d3.zoom<SVGSVGElement, unknown>()
              .scaleExtent([0.05, 5]) // Allow more zoom out
              .on('zoom', (event) => {
                if (d3State.current.g) {
                  d3State.current.g.attr('transform', event.transform);
                }
            });
            svg.call(d3State.current.zoomBehavior);

            d3State.current.g = svg.append('g')
                .attr('transform', `translate(${margin.left},${margin.top})`);

            d3State.current.treeLayout = d3.tree<TreeNodeData>().nodeSize([35, 220]);
        }

        if (d3State.current.root) {
            updateChart(d3State.current.root);
        }
    };

    initOrResize();

    const resizeObserver = new ResizeObserver(initOrResize);
    if (graphWrapperRef.current) {
      resizeObserver.observe(graphWrapperRef.current);
    }

    return () => {
      if (graphWrapperRef.current) {
        resizeObserver.unobserve(graphWrapperRef.current);
      }
      resizeObserver.disconnect();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getContainerDimensions]);

  useEffect(() => {
    if (!d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
      if(d3State.current.g && !treeData) d3State.current.g.selectAll("*").remove();
      d3State.current.root = null;
      return;
    }

    if (!treeData) {
        if (d3State.current.g) d3State.current.g.selectAll("*").remove();
        d3State.current.root = null;
        return;
    }

    const { margin, dimensions } = d3State.current;
    const initialX0 = dimensions.height / 2 || 200;

    const isInitialLoad = !d3State.current.root || d3State.current.root.data.name !== treeData.name;

    let oldRoot = d3State.current.root;
    const newRootNode = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    newRootNode.x0 = oldRoot?.x0 || initialX0;
    newRootNode.y0 = oldRoot?.y0 || 0;
    
    // Preserve expanded/collapsed state from old tree if possible
    const preserveState = (oldNode: D3HierarchyNode | undefined, newNode: D3HierarchyNode) => {
        if (oldNode) {
            if (oldNode._children && !oldNode.children) { // Was collapsed
                if (newNode.children) { // New node has children (data might have changed)
                    newNode._children = newNode.children;
                    newNode.children = undefined;
                }
            }
             // If old node was expanded, new node children will be visible by default unless it has no children.
        }
        if (newNode.children) {
            newNode.children.forEach(newChild => {
                const oldChild = oldNode?.children?.find(oc => oc.data.name === newChild.data.name) || oldNode?._children?.find(oc => oc.data.name === newChild.data.name);
                preserveState(oldChild, newChild);
            });
        }
    };

    if (oldRoot && oldRoot.data.name === newRootNode.data.name && !isInitialLoad) {
        preserveState(oldRoot, newRootNode);
    }
    d3State.current.root = newRootNode;
    
    if (isInitialLoad) {
      d3State.current.i = 0;
      if (newRootNode.children) {
        newRootNode.children.forEach(child => {
          if (child.children) {
            collapseAll(child, false);
          }
        });
      }
      setIsFullyExpanded(false);

      if (d3State.current.svg && d3State.current.zoomBehavior && d3State.current.g) {
          const initialZoomScale = 0.6; // Zoom out a bit more initially
          const initialXTranslate = margin.left;
          
          // Estimate graph height to center vertically
          let maxDepth = 0;
          newRootNode.each(d => { if (d.depth > maxDepth) maxDepth = d.depth; });
          const approxGraphWidth = (maxDepth + 1) * 220 * initialZoomScale; // 220 is horizontal nodeSize
          const approxGraphHeight = newRootNode.height ? (newRootNode.height + 1) * 35 * initialZoomScale : dimensions.height / 2;


          let yTranslate = Math.max(margin.top, (dimensions.height - approxGraphHeight) / 2);
          let xTranslate = initialXTranslate;

          if (newRootNode.descendants().length * 35 * initialZoomScale > dimensions.height) { // if graph is tall
             yTranslate = margin.top + 20; // Start near top
          }


          const initialTransform = d3.zoomIdentity.translate(xTranslate, yTranslate).scale(initialZoomScale);
          d3State.current.svg.call(d3State.current.zoomBehavior.transform, initialTransform);
      }
    } else { // If it's an update (like adding more children)
        // Find the source node in the new tree and try to expand it
        if (sourceNode && sourceNode.id && sourceNode.children && sourceNode.children.length > 0) {
            const findAndExpand = (n: D3HierarchyNode, id: string) => {
                if (n.id === id) {
                    if (n._children) { // Ensure it's expanded
                        n.children = n._children;
                        n._children = undefined;
                    }
                    return n; // Return the found node to be used as source for animation
                }
                if (n.children) {
                    for (const child of n.children) {
                        const found = findAndExpand(child, id);
                        if (found) return found;
                    }
                }
                 if (n._children) { // Also check _children if it was collapsed
                    for (const child of n._children) {
                        const found = findAndExpand(child, id);
                        if (found) return found;
                    }
                }
                return null;
            };
            const updatedSourceNode = findAndExpand(newRootNode, sourceNode.id);
            updateChart(updatedSourceNode || newRootNode); // Use updated source for animation
            return; // Skip default updateChart call
        }
    }
    
    updateChart(newRootNode);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, collapseAll]); // updateChart is memoized

  // Effect to update node's generating state from parent isProcessingAction or activeNodeForMore
  useEffect(() => {
    if (d3State.current.root && (isProcessingAction || activeNodeForMore)) {
        let nodeChanged = false;
        d3State.current.root.each(d => {
            const shouldBeGenerating = activeNodeForMore === d.id;
            if (d.isGeneratingMore !== shouldBeGenerating) {
                d.isGeneratingMore = shouldBeGenerating;
                nodeChanged = true;
            }
        });
        if (nodeChanged) {
            updateChart(d3State.current.root); // Re-render to show/hide loaders
        }
    } else if (d3State.current.root && !isProcessingAction && !activeNodeForMore) {
        // Clear any lingering generating states if global processing stopped
        let nodeChanged = false;
        d3State.current.root.each(d => {
            if (d.isGeneratingMore) {
                d.isGeneratingMore = false;
                nodeChanged = true;
            }
        });
        if (nodeChanged) {
             updateChart(d3State.current.root);
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProcessingAction, activeNodeForMore, treeData]);


  return (
    <div ref={graphWrapperRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }} className="bg-background border border-border rounded-lg">
      <div className="absolute top-2 right-2 z-10 flex gap-2">
          <Button variant="outline" size="sm" onClick={handleToggleExpandAll} title={isFullyExpanded ? "Collapse All Nodes" : "Expand All Nodes"} disabled={!treeData || isProcessingAction}>
            {isFullyExpanded ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            <span className="sr-only">{isFullyExpanded ? "Collapse All Nodes" : "Expand All Nodes"}</span>
          </Button>
          <Button variant="outline" size="sm" onClick={handleExportPng} title="Export as PNG" disabled={!treeData || isProcessingAction}>
            <ImageIcon className="h-4 w-4" />
            <span className="sr-only">Export as PNG</span>
          </Button>
      </div>
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }}></svg>
      <div
        ref={tooltipRef}
        className="d3-tooltip"
        style={{
          position: 'absolute',
          textAlign: 'left',
          padding: '6px 10px',
          font: '12px sans-serif',
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 'var(--radius)',
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.2s ease-out',
          boxShadow: '0 3px 8px rgba(0,0,0,0.15)',
          zIndex: 10,
          maxWidth: '250px',
        }}
      ></div>
    </div>
  );
}

