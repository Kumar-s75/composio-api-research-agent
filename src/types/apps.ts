import { z } from "zod";

export const assignmentCategorySchema = z.enum([
  "CRM and Sales",
  "Support and Helpdesk",
  "Communications and Messaging",
  "Marketing, Ads, Email and Social",
  "Ecommerce",
  "Data, SEO and Scraping",
  "Developer, Infra and Data Platforms",
  "Productivity and Project Management",
  "Finance and Fintech",
  "AI, Research and Media-native",
]);

export const appInputSchema = z.object({
  number: z.number().int().min(1).max(100),
  category: assignmentCategorySchema,
  name: z.string().min(1),
  websiteHint: z.string().min(1),
});

const expectedCategories = assignmentCategorySchema.options;

export const appInputDatasetSchema = z
  .array(appInputSchema)
  .length(100, "The assignment dataset must contain exactly 100 apps.")
  .superRefine((apps, context) => {
    const numbers = new Set<number>();
    const names = new Set<string>();
    const categoryCounts = new Map<string, number>();

    for (const app of apps) {
      if (numbers.has(app.number)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate original number: ${app.number}.`,
        });
      }
      numbers.add(app.number);

      const normalizedName = app.name.trim().toLocaleLowerCase("en-US");
      if (names.has(normalizedName)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate app name: ${app.name}.`,
        });
      }
      names.add(normalizedName);

      categoryCounts.set(app.category, (categoryCounts.get(app.category) ?? 0) + 1);
    }

    for (let number = 1; number <= 100; number += 1) {
      if (!numbers.has(number)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Missing original number: ${number}.`,
        });
      }
    }

    for (const category of expectedCategories) {
      if (categoryCounts.get(category) !== 10) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Category ${category} must contain exactly 10 apps.`,
        });
      }
    }
  });

export type AssignmentCategory = z.infer<typeof assignmentCategorySchema>;
export type AppInput = z.infer<typeof appInputSchema>;
export type AppInputDataset = z.infer<typeof appInputDatasetSchema>;
