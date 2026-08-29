export type ProjectInterface = {
  label: string;
  markup: string;
};

export function getProjectInterface(visual: string): ProjectInterface;
export function renderProjectInterface(visual: string): string;
