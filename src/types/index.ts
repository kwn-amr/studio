
export interface TreeNodeData {
  name: string;
  description?: string; // Added description field
  children?: TreeNodeData[];
  // Optional: add other properties if needed in the future, e.g., id, details
}
