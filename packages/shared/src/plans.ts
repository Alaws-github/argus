// Plans: a use case being drafted with the Use Case Planner before it reaches the board.
import { z } from 'zod';
import { Autonomy, Priority, UseCaseCategory } from './cards.js';

// ---------------------------------------------------------------------------
// Plans: a use case being drafted before it reaches the board. The Use Case
// Planner asks questions and fills the brief; the person edits it and adds it
// to Intake under their own name. "Fill it in myself" skips the chat.
// ---------------------------------------------------------------------------
export const PlanBrief = z.object({
  title: z.string().max(160).default(''),
  businessOwner: z.string().max(120).default(''),
  description: z.string().max(4000).default(''),
  dataUsed: z.string().max(2000).default(''),
  affectedPeople: z.string().max(1000).default(''),
  autonomy: Autonomy.default('human_in_loop'),
  vendor: z.string().max(200).default(''),
  category: UseCaseCategory.default('other'),
  priority: Priority.default('p2'),
});
export type PlanBrief = z.infer<typeof PlanBrief>;
export const PLAN_FIELDS: { key: keyof PlanBrief; label: string; required: boolean }[] = [
  { key: 'title', label: 'Name', required: true },
  { key: 'description', label: 'What it does', required: true },
  { key: 'businessOwner', label: 'Business owner', required: true },
  { key: 'dataUsed', label: 'Data it uses', required: true },
  { key: 'affectedPeople', label: 'People affected', required: true },
  { key: 'autonomy', label: 'Autonomy', required: true },
  { key: 'vendor', label: 'Vendor or model', required: false },
  { key: 'category', label: 'Kind of AI', required: false },
  { key: 'priority', label: 'Priority', required: false },
];
export interface PlanMessage {
  role: 'planner' | 'user';
  text: string;
  at: string;
  author: string;
  model?: string;
  runtime?: 'rules' | 'live';
}
export interface Plan {
  id: string;
  key: string;
  mode: 'ai' | 'manual';
  status: 'draft' | 'added';
  brief: PlanBrief;
  /** Fields a person typed in the brief; the Planner won't overwrite them. */
  edited: string[];
  messages: PlanMessage[];
  missing: string[];
  cardKey: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
