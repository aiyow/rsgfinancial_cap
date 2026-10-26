import { z } from 'zod';
import { passwordIssues } from './passwordPolicy.js';

// Only for setting a NEW password. Existing credentials retain their login rules.
export const newPasswordSchema = z.string().superRefine((password, context) => {
  for (const issue of passwordIssues(password)) {
    context.addIssue({ code: 'custom', message: issue.message });
  }
});
