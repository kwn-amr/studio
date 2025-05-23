
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as d3 from 'd3';
import type { TreeNodeData } from '@/types';

interface D3SubjectGraphProps {
  treeData: TreeNodeData | null;
}

interface D3HierarchyNode extends d3.HierarchyPointNode<TreeNodeData> {
  _children?: D3HierarchyNode[];
  children?: D3HierarchyNode[];
  x0?: number;
  y0?: number;
  id?: string;
}


export function D3SubjectGraph({ treeData }: D3SubjectGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  
  // Use a ref for D3 related state that doesn't need to trigger re-renders directly
  const d3State = useRef<{
    svg: d3.Selection<SVGSVGElement, unknown, null, undefined> | null;
    g: d3.Selection<SVGGElement, unknown, null, undefined> | null;
    root: D3HierarchyNode | null;
    treeLayout: d3.TreeLayout<TreeNodeData> | null;
    zoomBehavior: d3.ZoomBehavior<SVGSVGElement, unknown> | null;
    i: number; // for node ids
    dimensions: { width: number; height: number };
  }>({ svg: null, g: null, root: null, treeLayout: null, zoomBehavior: null, i: 0, dimensions: {width: 0, height: 0}});

  const animationDuration = 750;
  const nodeRadius = 6; // Can be sourced from CSS variable if needed dynamically

  const getContainerDimensions = useCallback(() => {
    if (svgRef.current?.parentElement) {
      const parent = svgRef.current.parentElement;
      return {
        width: parent.clientWidth,
        height: parent.clientHeight,
      };
    }
    return { width: 600, height: 400 }; // Default fallback
  }, []);

  const updateChart = useCallback((sourceNode?: D3HierarchyNode) => {
    if (!d3State.current.g || !d3State.current.root || !d3State.current.treeLayout || !tooltipRef.current) return;

    const { width, height } = d3State.current.dimensions;
    const margin = { top: 20, right: 120, bottom: 20, left: 120 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = d3State.current.g;
    const rootNode = d3State.current.root;
    const treeLayout = d3State.current.treeLayout.size([innerHeight, innerWidth]);
    const tooltip = d3.select(tooltipRef.current);

    const treeData = treeLayout(rootNode);
    const nodes = treeData.descendants() as D3HierarchyNode[];
    const links = treeData.links() as d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>[];

    nodes.forEach(d => { d.y = d.depth * 180; });

    const effectiveSource = sourceNode || rootNode;

    // Nodes
    const node = g.selectAll<SVGGElement, D3HierarchyNode>('g.node')
      .data(nodes, d => d.id || (d.id = (++d3State.current.i).toString()));

    const nodeEnter = node.enter().append('g')
      .attr('class', 'node')
      .attr('transform', `translate(${effectiveSource.y0 || effectiveSource.y || 0},${effectiveSource.x0 || effectiveSource.x || 0})`)
      .on('click', (event, d) => handleClick(d))
      .on('mouseover', (event, dNode) => {
        tooltip.style('opacity', 1)
               .html(`<strong>${dNode.data.name}</strong>`)
               .style('left', (event.pageX + 15) + 'px')
               .style('top', (event.pageY - 28) + 'px');
        d3.select(event.currentTarget).select('circle').classed('hovered', true);
         g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
            .classed('highlighted', l => l.source === dNode || l.target === dNode);
      })
      .on('mouseout', (event) => {
        tooltip.style('opacity', 0);
        d3.select(event.currentTarget).select('circle').classed('hovered', false);
        g.selectAll('path.link').classed('highlighted', false);
      });

    nodeEnter.append('circle')
      .attr('r', 1e-6);

    nodeEnter.append('text')
      .attr('dy', '.35em')
      .attr('x', d => (d.children || d._children) ? -(nodeRadius + 5) : (nodeRadius + 5))
      .attr('text-anchor', d => (d.children || d._children) ? 'end' : 'start')
      .text(d => d.data.name);

    const nodeUpdate = nodeEnter.merge(node);

    nodeUpdate.transition()
      .duration(animationDuration)
      .attr('transform', d => `translate(${d.y},${d.x})`);

    nodeUpdate.select<SVGCircleElement>('circle')
      .attr('r', nodeRadius)
      .attr('class', d => {
        let classes = (d.children || d._children) ? 'node-interactive' : 'node-leaf';
        if (d._children) classes += ' collapsed'; else if (d.children) classes += ' expanded';
        return classes;
      });

    nodeUpdate.select('text')
      .style('fill-opacity', 1);

    const nodeExit = node.exit().transition()
      .duration(animationDuration)
      .attr('transform', `translate(${effectiveSource.y},${effectiveSource.x})`)
      .remove();

    nodeExit.select('circle').attr('r', 1e-6);
    nodeExit.select('text').style('fill-opacity', 1e-6);

    // Links
    const link = g.selectAll<SVGPathElement, d3.Link<unknown, D3HierarchyNode, D3HierarchyNode>>('path.link')
      .data(links, d => d.target.id!);

    const linkEnter = link.enter().insert('path', 'g')
      .attr('class', 'link')
      .attr('d', () => {
        const o = { x: effectiveSource.x0 || effectiveSource.x || 0, y: effectiveSource.y0 || effectiveSource.y || 0 };
        return d3.linkHorizontal<any, {x:number, y:number}>().x(d => d.y).y(d => d.x)({ source: o, target: o });
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
        const o = { x: effectiveSource.x, y: effectiveSource.y };
        return d3.linkHorizontal<any, {x:number, y:number}>().x(d => d.y).y(d => d.x)({ source: o, target: o });
      })
      .remove();

    nodes.forEach(d => {
      d.x0 = d.x;
      d.y0 = d.y;
    });
  }, [animationDuration, nodeRadius]);

  const collapse = useCallback((d: D3HierarchyNode) => {
    if (d.children) {
      d._children = d.children;
      d._children.forEach(collapse);
      d.children = undefined; // Use undefined to signify no children for d3-hierarchy
    }
  }, []);

  const handleClick = useCallback((d: D3HierarchyNode) => {
    if (d.children) {
      d._children = d.children;
      d.children = undefined;
    } else {
      d.children = d._children;
      d._children = undefined;
    }
    updateChart(d);
  }, [updateChart]);

  // Effect for initial setup and resize
  useEffect(() => {
    const initOrResize = () => {
        if (!svgRef.current) return;
        d3State.current.dimensions = getContainerDimensions();
        const { width, height } = d3State.current.dimensions;

        const svg = d3.select(svgRef.current)
            .attr('width', width)
            .attr('height', height);
        
        if (!d3State.current.svg) { // Initial setup
            d3State.current.svg = svg;
            d3State.current.zoomBehavior = d3.zoom<SVGSVGElement, unknown>().on('zoom', (event) => {
                if (d3State.current.g) {
                d3State.current.g.attr('transform', event.transform);
                }
            });
            svg.call(d3State.current.zoomBehavior);
            
            const margin = { top: 20, right: 120, bottom: 20, left: 120 };
            d3State.current.g = svg.append('g')
                .attr('transform', `translate(${margin.left},${margin.top})`);
            
            d3State.current.treeLayout = d3.tree<TreeNodeData>();
        } else { // Resize
            // Potentially adjust viewbox or re-call zoom if needed for robust resize.
            // For now, just update dimensions and treeLayout size, then redraw.
        }
        
        if (d3State.current.root) { // If data exists, re-render
             // Ensure the tree layout is aware of new dimensions before updating
            const margin = { top: 20, right: 120, bottom: 20, left: 120 };
            const innerWidth = width - margin.left - margin.right;
            const innerHeight = height - margin.top - margin.bottom;
            if(d3State.current.treeLayout) d3State.current.treeLayout.size([innerHeight, innerWidth]);
            updateChart(d3State.current.root);
        }
    };
    
    initOrResize(); // Call once on mount

    const resizeObserver = new ResizeObserver(initOrResize);
    if (svgRef.current?.parentElement) {
      resizeObserver.observe(svgRef.current.parentElement);
    }

    return () => {
      if (svgRef.current?.parentElement) {
        resizeObserver.unobserve(svgRef.current.parentElement);
      }
      resizeObserver.disconnect();
    };
  }, [getContainerDimensions, updateChart]); // Only on mount/unmount of container logic

  // Effect for data changes
  useEffect(() => {
    if (!treeData || !d3State.current.g || !d3State.current.treeLayout || d3State.current.dimensions.width === 0) {
      if(d3State.current.g) d3State.current.g.selectAll("*").remove(); // Clear graph if no data
      d3State.current.root = null;
      return;
    }
    
    const { height } = d3State.current.dimensions;
    const rootNode = d3.hierarchy(treeData, d => d.children) as D3HierarchyNode;
    rootNode.x0 = height / 2;
    rootNode.y0 = 0;
    d3State.current.root = rootNode;
    d3State.current.i = 0; // Reset node id counter

    // Collapse children of the root's children, but keep root's children visible
    if (rootNode.children) {
      rootNode.children.forEach(child => {
        if (child.children) {
          collapse(child);
        }
      });
    }
    
    updateChart(rootNode);

  }, [treeData, collapse, updateChart]); // React to treeData changes

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }} className="bg-background border border-border rounded-lg">
      <svg ref={svgRef} style={{ width: '100%', height: '100%' }}></svg>
      <div
        ref={tooltipRef}
        className="d3-tooltip"
        style={{
          position: 'absolute',
          textAlign: 'center',
          padding: '4px 8px',
          font: '12px sans-serif',
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--border))',
          borderRadius: 'var(--radius)',
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 0.2s ease-out',
          boxShadow: '0 3px 6px rgba(0,0,0,0.1)',
          zIndex: 10, // Ensure tooltip is on top
        }}
      ></div>
    </div>
  );
}
